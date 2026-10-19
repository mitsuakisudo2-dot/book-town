-- Asking the sources more fairly and less (item 4 of the 2026-10-16 plan, its
-- rest; AUD-015, 016 and 129 of the 2026-10-17 audit). The library and openBD
-- are asked as before (20261101000000_bibliography.sql,
-- 20261102000000_bibliography_holds.sql), with these differences:
--
--   * A reader's books take turns. When a reader places books faster than
--     the library can be asked (one question a tick, twenty seconds), ten go
--     at once and each after them is placed twenty seconds after the one
--     before (private.bib_pace): one reader's many books no longer push
--     everyone else's back. Its master comes ten minutes after it is placed, as for
--     every book. Not a book the cache answers (anyone may see already that
--     its edition is someone's), nor a reader's copy of another's book.
--   * What is sent is picked from the first few rows of an index (what is
--     owed a question, then what is due on its schedule), not from every row
--     due: a tick takes no longer with forty thousand rows due than with two
--     thousand. Each edition's source says whether a book is owed a question
--     (owed). An edition with no book is not asked until one is placed.
--   * The library's answer kept is used again for a book owed a question,
--     at its turn, when it is a week old at most: it comes at the next tick,
--     as the library's answer would, and no question is sent. Every book
--     waits ten minutes before it is judged and shown, so nobody can tell
--     from the wait whether the ISBN had been registered before (as long as
--     the library answers within the ten minutes). openBD is asked as before
--     (a hundred ISBNs a question).
--   * The library saying it no longer has a record it had (counted once a
--     day at most): two answers in a row list the edition for the operator
--     (bibliography_review, gone at the source); three, and its values are
--     no longer used, as openBD's (a title the master would be left without
--     stays, listed as title kept). Finding it again starts the count over.
--   * Asked again on its schedule half as often for an edition nobody may
--     see is someone's (only registered privately).
--
-- And the copy taken before the books were judged again
-- (20261118000000_bibliography_judging.sql) goes, its verdicts checked in
-- production.
--
-- Rollback: a new migration with
--   update private.edition_sources set request_id = null, sent_at = null,
--     sent_for = null, request_place = null
--   where request_id = -1;
--   drop function private.bib_send(), private.bib_queue(text, integer),
--     private.bib_reused(uuid, text), private.bib_reusable(uuid),
--     private.bib_ask(uuid, boolean, timestamptz), private.bib_wait(private.edition_sources);
--   drop table private.bib_pace;
--   drop view private.bibliography_review;
--   drop index private.edition_sources_queue;
--   alter table private.edition_sources drop column owed, drop column lost,
--     drop column lost_at;
--   create index edition_sources_due on private.edition_sources (source, next_at)
--     where request_id is null and state <> 'withdrawn';
-- and then makes private.bib_ask(uuid, boolean), private.bib_receive() and
-- private.allow_bibliography(uuid, text) again as
-- 20261101000000_bibliography.sql has them, and private.bib_send(),
-- private.bib_take(...), private.bib_slow(text), private.bib_tick(),
-- private.book_checked(), private.withdraw_bibliography(uuid, text) and the
-- view private.bibliography_review (with create) as 20261102000000_bibliography_holds.sql
-- has them, each with its revoke. tests/db-fetching.test.ts runs exactly
-- that. The books placed later by their turns keep those times.

-- The copy of the books, their checks and the editions' sources taken before
-- they were judged again: the verdicts were checked in production.
select private.drop_copy('20261118000000_bibliography_judging');

select set_config('lock_timeout', '10s', true);

-- Each edition's source: whether a book (or the operator) is owed a question
-- (it is when private.bib_turn says so; set when a book is placed, worked out
-- again when an answer is kept), and the library's answers in a row that no
-- longer found a record it had (lost, counted once a day at most: lost_at).
alter table private.edition_sources
  add column owed boolean not null default false,
  add column lost smallint not null default 0 check (lost between 0 and 1000),
  add column lost_at timestamptz;
update private.edition_sources s
set owed = private.bib_turn(s.edition_id, s.settled_for, s.tried_for, s.refetch_at) is not null;
drop index private.edition_sources_due;
create index edition_sources_queue on private.edition_sources (source, owed, next_at, edition_id)
  where request_id is null and state <> 'withdrawn';

-- A reader's books placed at their turns, twenty seconds apart, ten at once:
-- next_at is when the reader's next book would be placed if none went at
-- once (twenty seconds after the one before, or now); a book is placed then,
-- less the nine others that may go with it (three minutes), or now. Gone an
-- hour after (bib_tick), and with the account.
create table private.bib_pace (
  reader uuid primary key references auth.users (id) on delete cascade,
  next_at timestamptz not null
);
create index bib_pace_next on private.bib_pace (next_at);
alter table private.bib_pace enable row level security;
revoke all on private.bib_pace from public, anon, authenticated;

-- How long until a source is asked again on its schedule (bib_next): twice as
-- long after an answer (found or not) for an edition nobody may see is
-- someone's (no catalog record, none of its books in a public place).
create function private.bib_wait(s private.edition_sources) returns interval
language sql stable set search_path = '' as $$
  select (private.bib_next(s.source, s.state, s.misses, s.failures, s.status, s.fields) - now())
    * case when s.state in ('found', 'missing') and not exists (
        select 1 from public.books b
        where b.edition_id = s.edition_id
          and (b.source <> 'manual' or private.book_is_listed(b.id))) then 2 else 1 end
$$;
revoke all on function private.bib_wait(private.edition_sources) from public, anon, authenticated;

-- As before (bibliography), at the turn of the book placed (at): a source
-- owed a question already keeps its earlier turn; one that was not is due at
-- this one (an edition nobody had placed a book in since its last answer).
drop function private.bib_ask(uuid, boolean);
create function private.bib_ask(edition uuid, refetch boolean default false,
  at timestamptz default now()) returns void
language sql security definer set search_path = '' as $$
  update private.edition_sources s set
    misses = 0, failures = 0, owed = true,
    refetch_at = case when bib_ask.refetch then now() else s.refetch_at end,
    next_at = case when s.request_id is not null then s.next_at
      when s.owed then least(s.next_at, bib_ask.at)
      else bib_ask.at end
  where s.edition_id = bib_ask.edition and s.state <> 'withdrawn'
$$;
revoke all on function private.bib_ask(uuid, boolean, timestamptz) from public, anon, authenticated;

-- As before (holds), and placed at the reader's turn (bib_pace) when it is
-- to be asked about: now while the reader has placed fewer than ten books in
-- the last twenty seconds each, else twenty seconds after the one before. A book the cache
-- answers, one without an ISBN, a copy of another's book (its place is the
-- original's, give_own_copy) and a book of nobody's are placed now.
create or replace function private.book_checked() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  cached boolean;
  placed timestamptz := now();
begin
  cached := new.isbn is not null and exists (
    select 1 from public.books o
    where o.edition_id = new.edition_id and o.id <> new.id
      and (o.source <> 'manual' or private.book_is_listed(o.id)));
  if new.isbn is not null and not cached and new.created_by is not null
      and current_setting('private.copying', true) is distinct from 'on' then
    insert into private.bib_pace as p (reader, next_at)
    values (new.created_by, now() + interval '20 seconds')
    on conflict (reader) do update set next_at = greatest(p.next_at, now()) + interval '20 seconds'
    returning greatest(now(), p.next_at - interval '200 seconds') into placed;
  end if;
  insert into private.book_checks (book_id, placed_at, checked_at, verdict, judged_at)
  values (new.id, placed, case when new.isbn is null then now() end,
    case when new.isbn is null then 'none' end, case when new.isbn is null then now() end)
  on conflict (book_id) do update set placed_at = excluded.placed_at,
    checked_at = excluded.checked_at, verdict = excluded.verdict,
    judged_at = excluded.judged_at, confirmed_at = null, held_work = null;
  if cached then
    update private.edition_sources s set settled_for = greatest(s.settled_for, now()),
      tried_for = greatest(s.tried_for, now()),
      found_for = greatest(s.found_for, case when s.found_for is not null then now() end),
      title_for = greatest(s.title_for, case when s.title_for is not null then now() end)
    where s.edition_id = new.edition_id and s.state <> 'withdrawn'
      and s.settled_for is not null;
    update private.edition_sources s set misses = 0, failures = 0, owed = true,
      next_at = case when s.request_id is null then now() else s.next_at end
    where s.edition_id = new.edition_id and s.state <> 'withdrawn'
      and s.settled_for is null;
  else
    perform private.bib_ask(new.edition_id, false, placed);
  end if;
  return null;
end;
$$;
revoke all on function private.book_checked() from public, anon, authenticated;

-- As before (holds), and: whether a book is still owed a question after the
-- answer (owed), asked again at its turn (not before: a book placed later by
-- its reader's turn waits for it), and on its schedule otherwise (bib_wait).
-- The library no longer finding a record it had (counted once a day at
-- most): its values stay for two answers in a row, and go with the third, as
-- openBD's go at once. Finding it again starts the count over.
create or replace function private.bib_take(edition uuid, source text, question bigint, state text,
  record text, record_id text, status text, fields jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s private.edition_sources;
  sent timestamptz;
  served timestamptz;
  alone boolean;
  later timestamptz;
begin
  select * into s from private.edition_sources x
  where x.edition_id = bib_take.edition and x.source = bib_take.source
  for update;
  if not found or (question is not null and s.request_id is distinct from question) then
    return;
  end if;
  sent := s.sent_at;
  served := coalesce(s.sent_for, s.sent_at);
  later := case when served is not null then private.bib_owed(s.edition_id,
    greatest(served, s.settled_for), s.refetch_at) end;
  s.sent_for := null;
  s.tried_for := greatest(s.tried_for, served);
  s.request_id := null;
  s.sent_at := null;
  s.request_place := null;
  if s.state <> 'withdrawn' then
    s.answered_at := now();
    -- Whether this source's title is the only one the master has.
    alone := s.fields ? 'title'
      and not exists (
        select 1 from private.edition_sources o
        where o.edition_id = s.edition_id and o.source <> s.source and o.fields ? 'title')
      and not exists (
        select 1 from private.edition_fixes f
        where f.edition_id = s.edition_id and f.field = 'title');
    if bib_take.state = 'found' then
      if not (bib_take.fields ? 'title') and alone then
        bib_take.fields := bib_take.fields || jsonb_build_object('title', s.fields -> 'title');
        s.title_kept_at := coalesce(s.title_kept_at, now());
      else
        s.title_kept_at := null;
        s.title_sent_at := case when bib_take.fields ? 'title' then sent end;
        s.title_for := case when bib_take.fields ? 'title'
          then greatest(s.title_for, served) end;
      end if;
      s.state := 'found';
      s.record := bib_take.record;
      s.record_id := bib_take.record_id;
      s.status := bib_take.status;
      s.fields := bib_take.fields;
      s.found_at := now();
      s.found_sent_at := sent;
      s.found_for := greatest(s.found_for, served);
      s.misses := 0;
      s.failures := 0;
      s.lost := 0;
      s.lost_at := null;
    elsif bib_take.state = 'missing' then
      s.state := 'missing';
      s.misses := case when later is not null then s.misses else least(s.misses + 1, 1000) end;
      s.failures := 0;
      if s.source = 'ndl' and s.record is not null
          and (s.lost_at is null or s.lost_at <= now() - interval '20 hours') then
        s.lost := least(s.lost + 1, 1000);
        s.lost_at := now();
      end if;
      if s.source = 'openbd' or (s.record is not null and s.lost >= 3) then
        s.record := null;
        s.record_id := null;
        s.status := null;
        s.found_sent_at := null;
        s.found_for := null;
        if alone then
          s.fields := jsonb_build_object('title', s.fields -> 'title');
          s.title_kept_at := coalesce(s.title_kept_at, now());
        else
          s.fields := '{}';
          s.title_kept_at := null;
          s.title_sent_at := null;
          s.title_for := null;
        end if;
      end if;
    else
      s.state := 'failed';
      s.failures := case when later is not null then s.failures
        else least(s.failures + 1, 1000) end;
    end if;
    if s.state <> 'failed' and sent is not null then
      s.settled_at := greatest(s.settled_at, sent);
      s.settled_for := greatest(s.settled_for, served);
    end if;
    s.next_at := case when later is not null then greatest(now(), later)
      else now() + private.bib_wait(s) end;
  end if;
  s.owed := private.bib_turn(s.edition_id, s.settled_for, s.tried_for, s.refetch_at) is not null;
  update private.edition_sources x set
    state = s.state, record = s.record, record_id = s.record_id, status = s.status,
    fields = s.fields, answered_at = s.answered_at, found_at = s.found_at,
    found_sent_at = s.found_sent_at, title_sent_at = s.title_sent_at,
    found_for = s.found_for, title_for = s.title_for, settled_for = s.settled_for,
    tried_for = s.tried_for, sent_for = null,
    misses = s.misses, failures = s.failures, next_at = s.next_at, settled_at = s.settled_at,
    request_id = null, sent_at = null, request_place = null, title_kept_at = s.title_kept_at,
    owed = s.owed, lost = s.lost, lost_at = s.lost_at
  where x.edition_id = s.edition_id and x.source = s.source;
end;
$$;
revoke all on function private.bib_take(uuid, text, bigint, text, text, text, text, jsonb)
  from public, anon, authenticated;

-- Whether the library's answer kept for an edition can answer a book owed a
-- question instead of asking again: it answered (found or not) within the
-- week, all it found is shown to the books it answered (its title too, or
-- the title was kept), it has not stopped finding a record it had, and the
-- operator has not asked for a new answer since.
create function private.bib_reusable(edition uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.edition_sources s
    where s.edition_id = bib_reusable.edition and s.source = 'ndl'
      and s.state in ('found', 'missing') and s.lost = 0
      and s.settled_for is not null
      and (s.state = 'missing' or s.found_for is not null)
      and (not s.fields ? 'title' or s.title_for is not null or s.title_kept_at is not null)
      and s.answered_at >= now() - interval '7 days'
      and coalesce(s.refetch_at, '-infinity') <= s.settled_for)
$$;
revoke all on function private.bib_reusable(uuid) from public, anon, authenticated;

-- The answer kept, used again for the turn it was picked for (bib_send marks
-- it with the question -1; it comes at the next tick, as an answer would):
-- what it found now answers the books placed by then, and what was owed by
-- then is settled. Nothing else about the answer changes (not when it was
-- answered: it is as old as it was). Asked again at the turn of a book placed
-- after, or on the answer's schedule.
create function private.bib_reused(edition uuid, source text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s private.edition_sources;
  served timestamptz;
  later timestamptz;
begin
  select * into s from private.edition_sources x
  where x.edition_id = bib_reused.edition and x.source = bib_reused.source
    and x.request_id = -1
  for update;
  if not found then
    return;
  end if;
  served := s.sent_for;
  if s.state <> 'withdrawn' then
    later := private.bib_owed(s.edition_id, greatest(served, s.settled_for), s.refetch_at);
    s.settled_for := greatest(s.settled_for, served);
    s.tried_for := greatest(s.tried_for, served);
    if s.state = 'found' then
      s.found_for := greatest(s.found_for, served);
      if s.title_for is not null and s.title_kept_at is null then
        s.title_for := greatest(s.title_for, served);
      end if;
    end if;
    s.next_at := case when later is not null then greatest(now(), later)
      else s.answered_at + private.bib_wait(s) end;
  end if;
  s.owed := private.bib_turn(s.edition_id, s.settled_for, s.tried_for, s.refetch_at) is not null;
  update private.edition_sources x set
    settled_for = s.settled_for, tried_for = s.tried_for, found_for = s.found_for,
    title_for = s.title_for, next_at = s.next_at, owed = s.owed,
    request_id = null, sent_at = null, sent_for = null, request_place = null
  where x.edition_id = s.edition_id and x.source = s.source;
end;
$$;
revoke all on function private.bib_reused(uuid, text) from public, anon, authenticated;

-- As before (bibliography), and first the answers kept that were used again
-- at the tick before (bib_reused).
create or replace function private.bib_receive() returns void
language plpgsql security definer set search_path = '' as $$
declare
  out_q record;
  answer record;
  body jsonb;
  s record;
  a record;
begin
  perform private.bib_reused(r.edition_id, r.source)
  from (
    select x.edition_id, x.source from private.edition_sources x
    where x.request_id = -1 and x.sent_at < now()
    for update skip locked) r;
  for out_q in
    select x.request_id, x.source, min(x.sent_at) as sent_at, max(x.request_place) as places,
      count(*) as editions
    from private.edition_sources x
    where x.request_id is not null and x.request_id <> -1
    group by x.request_id, x.source
  loop
    if (select count(*) from (
          select 1 from private.edition_sources x where x.request_id = out_q.request_id
          for update skip locked) l) < out_q.editions then
      continue;
    end if;
    select h.status_code, h.content, h.timed_out, h.error_msg into answer
    from net._http_response h where h.id = out_q.request_id
    limit 1;
    if not found then
      if out_q.sent_at < now() - interval '15 minutes' then
        perform private.bib_take(x.edition_id, x.source, out_q.request_id, 'failed',
          null, null, null, null)
        from private.edition_sources x where x.request_id = out_q.request_id;
      end if;
      continue;
    end if;
    body := null;
    if out_q.source = 'openbd' and answer.status_code = 200 then
      begin
        body := answer.content::jsonb;
      exception when others then
        body := null;
      end;
    end if;
    for s in
      select x.edition_id, x.request_place, e.isbn
      from private.edition_sources x join public.editions e on e.id = x.edition_id
      where x.request_id = out_q.request_id
    loop
      begin
        if answer.status_code is distinct from 200 or answer.timed_out
            or answer.error_msg is not null
            or (out_q.source = 'openbd'
              and (case when jsonb_typeof(body) = 'array' then jsonb_array_length(body) end)
                is distinct from out_q.places) then
          perform private.bib_take(s.edition_id, out_q.source, out_q.request_id, 'failed',
            null, null, null, null);
        elsif out_q.source = 'ndl' then
          select * into a from private.ndl_answer(answer.content, s.isbn);
          perform private.bib_take(s.edition_id, 'ndl', out_q.request_id, a.state, a.record,
            a.record_id, a.status, a.fields);
        else
          select * into a from private.openbd_answer(body -> (s.request_place - 1), s.isbn);
          perform private.bib_take(s.edition_id, 'openbd', out_q.request_id, a.state, a.record,
            null, null, a.fields);
        end if;
      exception when others then
        perform private.bib_take(s.edition_id, out_q.source, out_q.request_id, 'failed',
          null, null, null, null);
      end;
    end loop;
    begin
      delete from net._http_response h where h.id = out_q.request_id;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end;
$$;
revoke all on function private.bib_receive() from public, anon, authenticated;

-- As before (holds): a question sent (not an answer kept used again) that
-- has gone thirty seconds without an answer.
create or replace function private.bib_slow(source text) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.edition_sources s
    where s.source = bib_slow.source and s.request_id > 0
      and s.sent_at < now() - interval '30 seconds')
$$;
revoke all on function private.bib_slow(text) from public, anon, authenticated;

-- What a source is to be asked about next, in order, at most n: first what
-- is owed a question, by its turn (ties by the edition's id), then what is
-- due on its schedule (the library's records in the making first, then what
-- it had not found, by when due, then by the edition's id), as before
-- (holds). Read from the first rows of the index only (by when due), so it
-- takes as long with forty thousand rows due as with fifty. Rows met there
-- that are owed nothing any more (their books gone, or answered by the
-- cache) are owed no longer, asked again on the schedule of their answer;
-- rows of an edition with no book are not asked until one is placed. (Those
-- rows are taken first, and their books read after, so that a book placed
-- meanwhile counts: its ask waits for this tick, and owes the row again.)
create function private.bib_queue(src text, n integer)
returns table (edition_id uuid, isbn text, turn timestamptz, place bigint)
language plpgsql security definer set search_path = '' as $$
declare
  span constant integer := greatest(n, 50);
  owed_rows uuid[];
  due_rows uuid[];
begin
  select array_agg(w.edition_id) into owed_rows from (
    select x.edition_id from private.edition_sources x
    where x.source = src and x.owed and x.request_id is null and x.state <> 'withdrawn'
      and x.next_at <= now()
    order by x.next_at, x.edition_id
    limit span
    for update skip locked) w;
  select array_agg(w.edition_id) into due_rows from (
    select x.edition_id from private.edition_sources x
    where x.source = src and not x.owed and x.request_id is null and x.state <> 'withdrawn'
      and x.next_at <= now()
    order by x.next_at, x.edition_id
    limit span
    for update skip locked) w;
  update private.edition_sources s set owed = false,
    next_at = coalesce(s.answered_at + private.bib_wait(s), 'infinity')
  where s.source = src and s.edition_id = any (owed_rows) and s.owed
    and private.bib_turn(s.edition_id, s.settled_for, s.tried_for, s.refetch_at) is null;
  update private.edition_sources s set next_at = 'infinity'
  where s.source = src and s.edition_id = any (due_rows) and not s.owed
    and not exists (select 1 from public.books b where b.edition_id = s.edition_id);
  return query
  with owed as (
    select x.edition_id, x.settled_for, x.tried_for, x.refetch_at
    from private.edition_sources x
    where x.source = src and x.owed and x.request_id is null and x.state <> 'withdrawn'
      and x.next_at <= now()
    order by x.next_at, x.edition_id
    limit span
  ), scheduled as (
    select x.edition_id, x.status, x.state, x.next_at
    from private.edition_sources x
    where x.source = src and not x.owed and x.request_id is null and x.state <> 'withdrawn'
      and x.next_at <= now()
      and exists (select 1 from public.books b where b.edition_id = x.edition_id)
    order by x.next_at, x.edition_id
    limit span
  ), picked as (
    select o.edition_id,
      private.bib_turn(o.edition_id, o.settled_for, o.tried_for, o.refetch_at) as turn,
      null::text as status, null::text as state, null::timestamptz as next_at
    from owed o
    union all
    select d.edition_id, null, d.status, d.state, d.next_at from scheduled d
  ), ordered as (
    select p.edition_id, e.isbn, p.turn,
      row_number() over (
        order by p.turn is null, p.turn, case when p.turn is not null then p.edition_id end,
          p.status is distinct from 'C3', p.state <> 'missing', p.next_at, p.edition_id) as place
    from picked p join public.editions e on e.id = p.edition_id
  )
  select o.edition_id, o.isbn, o.turn, o.place from ordered o
  where o.place <= n
  order by o.place;
end;
$$;
revoke all on function private.bib_queue(text, integer) from public, anon, authenticated;

-- As before (holds), from bib_queue. The library: each edition owed a
-- question in turn, whose answer kept can be used again (bib_reusable), is
-- answered from it at the next tick, fifty a tick at most; the first that
-- cannot is asked, as before. A question (or an answer used again) answers
-- every book of its edition placed before the turn of the next one in the
-- queue (or now), and no book after.
create or replace function private.bib_send() returns void
language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[];
  isbns text[];
  turns timestamptz[];
  sent uuid[];
  sent_isbns text[];
  sent_turns timestamptz[];
  i integer := 1;
  upto timestamptz;
  asked bigint;
  agent constant jsonb := '{"User-Agent": "BookTown (+https://booktown.page)"}';
begin
  if not private.bib_slow('ndl') then
    select array_agg(q.edition_id order by q.place), array_agg(q.isbn order by q.place),
      array_agg(q.turn order by q.place)
    into ids, isbns, turns
    from private.bib_queue('ndl', 51) q;
    while i <= least(coalesce(cardinality(ids), 0), 50) loop
      -- (A row being written is passed over, as before: the next tick asks it.)
      exit when not exists (
        select 1 from private.edition_sources s
        where s.edition_id = ids[i] and s.source = 'ndl' and s.request_id is null
        for update skip locked);
      upto := least(coalesce(turns[i + 1], now()), now());
      if turns[i] is not null and private.bib_reusable(ids[i]) then
        update private.edition_sources s
        set request_id = -1, sent_at = now(), sent_for = upto, request_place = 1
        where s.edition_id = ids[i] and s.source = 'ndl';
        i := i + 1;
        continue;
      end if;
      asked := net.http_get(
        url := 'https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&version=1.2'
          || '&recordSchema=dcndl&recordPacking=xml&onlyBib=true&maximumRecords=20'
          || '&query=isbn%3D%22' || isbns[i] || '%22'
          || '%20AND%20dpid%3D%22iss-ndl-opac%20iss-ndl-opac-inprocess%22',
        headers := agent,
        timeout_milliseconds := 60000);
      update private.edition_sources s
      set request_id = asked, sent_at = now(),
        sent_for = case when turns[i] is null then now() else upto end, request_place = 1
      where s.edition_id = ids[i] and s.source = 'ndl';
      exit;
    end loop;
  end if;

  -- openBD: the first hundred due, in one question, and the turn of the
  -- first one left for later.
  ids := null;
  if not private.bib_slow('openbd') then
    select array_agg(q.edition_id order by q.place), array_agg(q.isbn order by q.place),
      array_agg(q.turn order by q.place)
    into ids, isbns, turns
    from private.bib_queue('openbd', 101) q;
  end if;
  if ids is not null then
    select array_agg(x.edition_id order by x.n), array_agg(x.isbn order by x.n),
      array_agg(x.turn order by x.n)
    into sent, sent_isbns, sent_turns
    from (
      select s.edition_id, u.isbn, u.turn, u.n
      from private.edition_sources s
      join unnest(ids[1:100], isbns[1:100], turns[1:100]) with ordinality u (id, isbn, turn, n)
        on u.id = s.edition_id
      where s.source = 'openbd' and s.request_id is null
      order by u.n
      for update of s skip locked
    ) x;
  end if;
  if sent is not null then
    upto := least(coalesce(
      (select min(u.turn) from unnest(ids, turns) u (id, turn) where u.id <> all (sent)),
      now()), now());
    asked := net.http_get(
      url := 'https://api.openbd.jp/v1/get?isbn=' || array_to_string(sent_isbns, ','),
      headers := agent,
      timeout_milliseconds := 30000);
    update private.edition_sources s
    set request_id = asked, sent_at = now(),
      sent_for = case when u.turn is null then now() else upto end, request_place = u.n
    from unnest(sent, sent_turns) with ordinality u (id, turn, n)
    where s.edition_id = u.id and s.source = 'openbd';
  end if;
end;
$$;
revoke all on function private.bib_send() from public, anon, authenticated;

-- As before (holds), and a reader's turns go an hour after the last.
create or replace function private.bib_tick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bib_receive();
  -- Judging that fails (it should not) leaves the answers and the
  -- questions to go on; the database's log has the warning.
  begin
    perform private.bib_judge();
  exception when others then
    raise warning 'bib_judge failed: %', sqlstate;
  end;
  perform private.bib_send();
  delete from private.bib_pace p
  where p.reader in (
    select x.reader from private.bib_pace x
    where x.next_at < now() - interval '1 hour'
    for update skip locked);
end;
$$;
revoke all on function private.bib_tick() from public, anon, authenticated;

-- As before (holds), owed nothing and its count of records gone over.
create or replace function private.withdraw_bibliography(book uuid, source text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ed uuid := private.bib_edition_of(book);
begin
  if not exists (
      select 1 from public.books b
      where b.edition_id = ed and private.book_is_listed(b.id)) then
    raise exception 'none of the edition''s books is in a public place';
  end if;
  perform private.bib_recheck(ed, true);
  update private.edition_sources s set state = 'withdrawn', record = null, record_id = null,
    status = null, fields = '{}', next_at = null, refetch_at = null, misses = 0, failures = 0,
    title_kept_at = null, found_sent_at = null, title_sent_at = null,
    found_for = null, title_for = null, owed = false, lost = 0, lost_at = null
  where s.edition_id = ed and s.source = withdraw_bibliography.source;
  if not found then
    raise exception 'no % data for the book', source;
  end if;
end;
$$;
revoke all on function private.withdraw_bibliography(uuid, text) from public, anon, authenticated;

-- As before (bibliography), owed the operator's question.
create or replace function private.allow_bibliography(book uuid, source text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update private.edition_sources s set state = 'waiting', next_at = now(), refetch_at = now(),
    owed = true
  where s.edition_id = private.bib_edition_of(book) and s.source = allow_bibliography.source
    and s.state = 'withdrawn';
  if not found then
    raise exception 'the book''s % data was not withdrawn', source;
  end if;
end;
$$;
revoke all on function private.allow_bibliography(uuid, text) from public, anon, authenticated;

-- As before (holds), and the editions the library said twice in a row it no
-- longer has the record of (gone at the source; with three, its values are
-- no longer used). Its rows go into no pull request, issue or log, as before.
create or replace view private.bibliography_review as
select e.isbn, s.source, s.state, s.failures, s.answered_at, s.title_kept_at,
  case when s.title_kept_at is not null then 'title kept'
    when s.lost >= 2 then 'gone at the source' else 'failing' end as why,
  exists (select 1 from public.books b where b.edition_id = e.id and private.book_is_listed(b.id))
    as listed,
  (select b.id from public.books b where b.edition_id = e.id order by b.created_at limit 1)
    as a_book,
  null::timestamptz as held_at, null::text as title, null::text as author,
  null::text as master_title, null::jsonb as master_creators
from private.edition_sources s
join public.editions e on e.id = s.edition_id
where s.title_kept_at is not null or s.failures >= 4 or s.lost >= 2
union all
select e.isbn, null, null, null, null, null, 'held',
  exists (select 1 from public.books o where o.edition_id = e.id and private.book_is_listed(o.id)),
  b.id, c.judged_at, b.title, b.author, d.title, d.creators
from private.book_checks c
join public.books b on b.id = c.book_id
join public.editions e on e.id = b.edition_id
cross join lateral private.edition_bibliography(b.edition_id, c.placed_at) d
where c.held_work is not null;
revoke all on private.bibliography_review from public, anon, authenticated;
