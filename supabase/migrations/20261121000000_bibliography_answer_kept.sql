-- The library's answer kept, used again for a book owed a question
-- (20261119000000_bibliography_fetching.sql), comes only with a question:
-- the one sent at the same tick. When that question is answered (the
-- library found the book or said it has none), the answers kept used again
-- with it come with its answer; when it fails (an error, a refusal, no answer
-- in fifteen minutes), they fail with it, as a question about them would
-- have, and their books wait for the library as every other book does. At a
-- tick with nothing else to ask the library about, the last of them is
-- asked, not used again. So a book whose edition's answer is kept waits for
-- the library as any other does. Nothing new is kept, and what is asked
-- first is as before.
--
-- Rollback: a new migration with
--   update private.edition_sources set request_id = null, sent_at = null,
--     sent_for = null, request_place = null
--   where request_id < 0;
--   drop function private.bib_with(bigint, boolean);
-- and then makes private.bib_reused(uuid, text), private.bib_receive() and
-- private.bib_send() again as 20261119000000_bibliography_fetching.sql has
-- them, each with its revoke. tests/db-fetching.test.ts runs exactly that.

select set_config('lock_timeout', '10s', true);

-- Answers kept marked as before (-1): asked again in turn at the next tick.
update private.edition_sources set request_id = null, sent_at = null, sent_for = null,
  request_place = null
where request_id = -1;

-- As before (fetching), for an answer kept used again with any question
-- (marked with the question's number, less than nought).
create or replace function private.bib_reused(edition uuid, source text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s private.edition_sources;
  served timestamptz;
  later timestamptz;
begin
  select * into s from private.edition_sources x
  where x.edition_id = bib_reused.edition and x.source = bib_reused.source
    and x.request_id < 0
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

-- The answers kept used again with a question (bib_send marks them with
-- minus its number), once it is answered: they come with an answer, and fail
-- as it does without one (bib_take). The caller holds their rows.
create function private.bib_with(question bigint, answered boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in
    select x.edition_id, x.source from private.edition_sources x
    where x.request_id = -bib_with.question
  loop
    if answered then
      perform private.bib_reused(r.edition_id, r.source);
    else
      perform private.bib_take(r.edition_id, r.source, -bib_with.question, 'failed',
        null, null, null, null);
    end if;
  end loop;
end;
$$;
revoke all on function private.bib_with(bigint, boolean) from public, anon, authenticated;

-- As before (fetching), and the answers kept used again with a question come
-- or fail with its answer (bib_with): a question is read once its rows and
-- theirs are free. Answers kept whose question is out no longer (it went
-- with its edition) fail.
create or replace function private.bib_receive() returns void
language plpgsql security definer set search_path = '' as $$
declare
  out_q record;
  answer record;
  body jsonb;
  s record;
  a record;
  answered boolean;
begin
  for out_q in
    select x.request_id, x.source, min(x.sent_at) as sent_at, max(x.request_place) as places,
      count(*) as editions,
      (select count(*) from private.edition_sources k where k.request_id = -x.request_id) as kept
    from private.edition_sources x
    where x.request_id > 0
    group by x.request_id, x.source
  loop
    if (select count(*) from (
          select 1 from private.edition_sources x
          where x.request_id in (out_q.request_id, -out_q.request_id)
          for update skip locked) l) < out_q.editions + out_q.kept then
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
        perform private.bib_with(out_q.request_id, false);
      end if;
      continue;
    end if;
    body := null;
    answered := false;
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
          answered := a.state in ('found', 'missing');
        else
          select * into a from private.openbd_answer(body -> (s.request_place - 1), s.isbn);
          perform private.bib_take(s.edition_id, 'openbd', out_q.request_id, a.state, a.record,
            null, null, a.fields);
        end if;
      exception when others then
        perform private.bib_take(s.edition_id, out_q.source, out_q.request_id, 'failed',
          null, null, null, null);
        answered := false;
      end;
    end loop;
    perform private.bib_with(out_q.request_id, answered);
    begin
      delete from net._http_response h where h.id = out_q.request_id;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  perform private.bib_take(r.edition_id, r.source, r.request_id, 'failed',
    null, null, null, null)
  from (
    select x.edition_id, x.source, x.request_id from private.edition_sources x
    where x.request_id < 0
      and not exists (
        select 1 from private.edition_sources q where q.request_id = -x.request_id)
    for update skip locked) r;
end;
$$;
revoke all on function private.bib_receive() from public, anon, authenticated;

-- As before (fetching), but each answer kept used again goes with the
-- question sent at the same tick (marked with minus its number): the first
-- edition in turn that cannot be answered from what is kept, or, with none,
-- the last of those that can, asked instead.
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
  kept integer[] := '{}';
  ask integer;
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
      if turns[i] is null or not private.bib_reusable(ids[i]) then
        ask := i;
        exit;
      end if;
      kept := kept || i;
      i := i + 1;
    end loop;
    if ask is null and cardinality(kept) > 0 then
      ask := kept[cardinality(kept)];
      kept := kept[1:cardinality(kept) - 1];
    end if;
    if ask is not null then
      asked := net.http_get(
        url := 'https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&version=1.2'
          || '&recordSchema=dcndl&recordPacking=xml&onlyBib=true&maximumRecords=20'
          || '&query=isbn%3D%22' || isbns[ask] || '%22'
          || '%20AND%20dpid%3D%22iss-ndl-opac%20iss-ndl-opac-inprocess%22',
        headers := agent,
        timeout_milliseconds := 60000);
      update private.edition_sources s
      set request_id = asked, sent_at = now(),
        sent_for = case when turns[ask] is null then now()
          else least(coalesce(turns[ask + 1], now()), now()) end,
        request_place = 1
      where s.edition_id = ids[ask] and s.source = 'ndl';
      update private.edition_sources s
      set request_id = -asked, sent_at = now(),
        sent_for = least(coalesce(turns[u.k + 1], now()), now()), request_place = 1
      from unnest(kept) u (k)
      where s.edition_id = ids[u.k] and s.source = 'ndl';
    end if;
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
