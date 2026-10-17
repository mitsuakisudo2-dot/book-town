-- Judging registrations against the master, and holding back the ones that
-- are clearly another book (item 4 of the 2026-10-16 plan; the owner's review
-- of the bibliographic master, 2026-10-16 22:36Z, 「食い違いの扱い」). The
-- registration is still never stopped or changed for it: a book keeps what
-- its reader typed, and only where it counts moves.
--
-- What is compared. What the reader typed (title, author) with the master as
-- the book sees it (what the sources answered to questions sent after it was
-- placed, and the operator's corrections), folded as the search folds them
-- (private.fold_book_text). The same: the title, or the title with its
-- subtitle or its volume. Apart: another volume's number (or 上・中・下) where
-- the master has a volume, whatever else agrees (one work is one volume).
-- Close: one inside the other, the title's reading too (a subtitle, 新訳版, a
-- title typed in kana), or an author of the master's in the reader's author
-- line, by name, reading or authority form. Apart: neither (with no author
-- typed, the title alone decides). None: no title in the master (once both
-- sources have answered since the book was placed, or a day on), or no
-- letter in what the reader typed for the title, and no author agreeing.
--
-- When. Ten minutes after the book was placed in its edition (registered, or
-- moved there by an edited ISBN), on the tick after, for every book alike,
-- whether the master had the edition before or not: what the book sees is
-- only what was asked after it was placed, so neither the verdict nor when it
-- comes tells whether someone registered that ISBN before. Then again when
-- what the book sees may have changed (a source's answer, the operator's
-- correction or withdrawal) or the reader edits the title or the author
-- (the owner, 2026-10-17 03:22Z: 確かめ直す), until the reader says the book
-- is the ISBN's, and again once they edit it after that; only a different
-- verdict shows.
--
-- What it changes. A book judged apart is held: it goes to a work of its own
-- (as a book without an ISBN is), out of its edition's work, so the work's
-- page, counts and candidates leave it out, and the master is not shown for
-- it anywhere, only what its reader typed. Its reader is told once
-- (book_holds) and answers by editing the ISBN (it is placed again) or by
-- saying the book is the ISBN's (confirm_book_isbn), which puts it back in
-- its edition's work. A book not judged yet is left out of the counts too
-- (book_counts_in_work), as every book is for its first ten minutes. The
-- operator sees the held books in bibliography_review, does not join one's
-- work (the reader answers first), and can put one back (release_hold).
--
-- Asking, with patience. The library is waited on for a minute (it was 30
-- seconds), and neither source is asked more while a question to it has
-- gone unanswered for half a minute: pg_net sends its questions one batch
-- after another, so more would only pile up behind a slow one (seen in
-- production, 2026-10-17: the library answers some in well under a second
-- and some after half a minute or more, and turns some away with 429).
--
-- Rollback: a new migration undoes this one with
--   drop trigger books_retitled on public.books;
--   drop trigger edition_sources_changed on private.edition_sources;
--   drop trigger edition_fixes_changed on private.edition_fixes;
--   drop function public.book_holds(), public.confirm_book_isbn(uuid),
--     private.release_hold(uuid);
--   update public.books b set work_id = e.work_id
--   from public.editions e, private.book_checks c
--   where e.id = b.edition_id and c.book_id = b.id and c.held_work is not null;
--   delete from private.work_changes where kind in ('hold', 'unhold');
--   alter table private.work_changes drop constraint work_changes_kind_check;
--   alter table private.work_changes add constraint work_changes_kind_check
--     check (kind in ('edited', 'join', 'unjoin', 'part'));
--   drop view private.bibliography_review;
--   drop function private.bib_judge(), private.bib_slow(text),
--     private.bib_recheck(uuid, boolean), private.bib_sources_changed(),
--     private.bib_fixes_changed(), private.book_retitled(), private.book_counts_in_work(uuid),
--     private.bib_verdict(text, text, text, text, text, text, jsonb), private.bib_marks(text),
--     private.bib_key(text);
--   alter table private.book_checks drop column checked_at, drop column verdict,
--     drop column judged_at, drop column confirmed_at, drop column held_work;

-- and then makes private.bib_send(), private.bib_tick(), private.book_checked(),
-- private.withdraw_bibliography(uuid, text), public.book_bibliography(uuid[])
-- and the view private.bibliography_review again as
-- 20261101000000_bibliography.sql has them, private.join_works(uuid,
-- uuid) as 20261031000000_edition_ids.sql has it, and private.work_candidates()
-- as 20261027000000_works.sql has it, each with create or replace (the view
-- with create) and the revoke after it. pnpm test:db runs exactly that.
-- Held books go back to their editions' works; the works made for them stay,
-- with no book, which nobody reads.

-- Comparing ----------------------------------------------------------------------

-- A title or an author as the judging compares it: folded as the search
-- folds it, or, written in a script the folding drops (한국어, Русский), in
-- lower case without its spaces and punctuation.
create function private.bib_key(t text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(private.fold_book_text(t), ''),
    lower(regexp_replace(normalize(coalesce(t, ''), nfkc), '[[:space:][:punct:]]', '', 'g')))
$$;
revoke all on function private.bib_key(text) from public, anon, authenticated;

-- What tells a volume in a key: its numbers in order, and 上・中・下 at its
-- end (ノルウェイの森 上, 第2巻 下).
create function private.bib_marks(k text) returns text[]
language sql immutable set search_path = '' as $$
  select private.title_numbers(k)
    || case when k ~ '[上中下]巻?$' then array[substring(k from '([上中下])巻?$')]
      else '{}'::text[] end
$$;
revoke all on function private.bib_marks(text) from public, anon, authenticated;

-- What a reader typed for a book (title, author) against the master's title,
-- subtitle, volume, title reading and creators: same, close, apart or none
-- (the top of this file).
create function private.bib_verdict(title text, author text, m_title text,
  m_subtitle text, m_volume text, m_reading text, m_creators jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  mine text := private.bib_key(title);
  whole text[] := array[
    private.bib_key(m_title),
    private.bib_key(m_title || coalesce(m_volume, '')),
    private.bib_key(m_title || coalesce(m_subtitle, '')),
    private.bib_key(m_title || coalesce(m_subtitle, '') || coalesce(m_volume, ''))];
  t text;
  person jsonb;
  form text;
  keys text[];
  folded text;
  raw text;
  theirs text;
begin
  if mine = '' then
    mine := null;
  end if;
  if mine = any (whole) then
    return 'same';
  end if;
  -- Another volume: the reader's marks are none of the master's, where the
  -- master tells its volume (in the volume, or numbers in the title).
  if mine is not null and private.bib_marks(mine) <> '{}'
      and (nullif(m_volume, '') is not null or private.bib_marks(whole[1]) <> '{}')
      and not exists (select 1 from unnest(whole) w where private.bib_marks(w) = private.bib_marks(mine))
  then
    return 'apart';
  end if;
  foreach t in array whole || private.bib_key(m_reading) loop
    if mine is not null and t <> '' and least(char_length(mine), char_length(t)) >= 2
        and (strpos(mine, t) > 0 or strpos(t, mine) > 0) then
      return 'close';
    end if;
  end loop;
  -- An author: as the name is printed, as it reads, or the authority's form
  -- without its years (Bradbury, Ray, 1920-2012 for レイ・ブラッドベリ). One
  -- in a script the folding drops, by the whole line.
  keys := private.author_keys(author);
  folded := private.fold_book_text(author);
  raw := case when folded = '' then private.bib_key(author) else '' end;
  for person in
    select x from jsonb_array_elements(
      case when jsonb_typeof(m_creators) = 'array' then m_creators else '[]' end) x
  loop
    foreach form in array array[person ->> 'name', person ->> 'reading',
        regexp_replace(person ->> 'heading', ',\s*[0-9][-0-9?.]*\s*$', '')] loop
      theirs := private.bib_key(form);
      if form is not null and (private.authors_agree(keys, folded,
            private.author_keys(form), private.fold_book_text(form))
          or (raw <> '' and least(char_length(raw), char_length(theirs)) >= 2
            and (strpos(raw, theirs) > 0 or strpos(theirs, raw) > 0))) then
        return 'close';
      end if;
    end loop;
  end loop;
  -- Nothing to compare in the title, and no author agreeing.
  return case when mine is null then 'none' else 'apart' end;
end;
$$;
revoke all on function private.bib_verdict(text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;

-- What is kept ------------------------------------------------------------------------

-- For each book, besides when it was placed: when it was last compared (null:
-- to compare on the next tick, from ten minutes after it was placed), the
-- verdict (null: not yet), when the verdict became what it is, when its
-- reader said the book is the ISBN's (it is not judged again until it is
-- placed again), and the work it is held in, while it is held. A book without
-- an ISBN has nothing to be compared with: none, from when it is placed.
alter table private.book_checks
  add column checked_at timestamptz,
  add column verdict text check (verdict in ('same', 'close', 'apart', 'none')),
  add column judged_at timestamptz,
  add column confirmed_at timestamptz,
  add column held_work uuid references public.works (id),
  add check ((held_work is null) or (verdict = 'apart' and confirmed_at is null));
create index book_checks_unchecked on private.book_checks (placed_at)
  where checked_at is null;
create index book_checks_unjudged on private.book_checks (placed_at)
  where verdict is null;

update private.book_checks c set checked_at = now(), verdict = 'none', judged_at = now()
from public.books b
where b.id = c.book_id and b.isbn is null;

-- A book held, and put back: the moves are written down with the others.
alter table private.work_changes drop constraint work_changes_kind_check;
alter table private.work_changes add constraint work_changes_kind_check
  check (kind in ('edited', 'join', 'unjoin', 'part', 'hold', 'unhold'));

-- Asking, with patience ------------------------------------------------------------

-- Whether a source is slow to answer now: a question to it has been out half
-- a minute with no answer read yet (bib_receive reads every answer that has
-- come before bib_send runs). Until it answers, or the question is given up
-- after fifteen minutes, the source is asked nothing more.
create function private.bib_slow(source text) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.edition_sources s
    where s.source = bib_slow.source and s.request_id is not null
      and s.sent_at < now() - interval '30 seconds')
$$;
revoke all on function private.bib_slow(text) from public, anon, authenticated;

-- As before (bibliography), but not to a source slow to answer, the library
-- waited on for a minute, and the rest in an order of their own when their
-- times are the same (answers read together are due again together): by the
-- edition's id, as the books placed together are.
create or replace function private.bib_send() returns void
language plpgsql security definer set search_path = '' as $$
declare
  ask record;
  asked bigint;
  ids uuid[];
  isbns text[];
  agent constant jsonb := '{"User-Agent": "BookTown (+https://booktown.page)"}';
begin
  for ask in
    select s.edition_id, e.isbn
    from private.edition_sources s
    join public.editions e on e.id = s.edition_id
    cross join lateral (
      select private.bib_owed(s.edition_id, s.settled_at, s.refetch_at) as at) owed
    where s.source = 'ndl' and s.request_id is null and s.state <> 'withdrawn'
      and s.next_at <= now()
      and not private.bib_slow('ndl')
      and exists (select 1 from public.books b where b.edition_id = s.edition_id)
    order by owed.at is null, owed.at, case when owed.at is not null then s.edition_id end,
      s.status is distinct from 'C3', s.state <> 'missing', s.next_at, s.edition_id
    limit 1
    for update of s skip locked
  loop
    asked := net.http_get(
      url := 'https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&version=1.2'
        || '&recordSchema=dcndl&recordPacking=xml&onlyBib=true&maximumRecords=20'
        || '&query=isbn%3D%22' || ask.isbn || '%22'
        || '%20AND%20dpid%3D%22iss-ndl-opac%20iss-ndl-opac-inprocess%22',
      headers := agent,
      timeout_milliseconds := 60000);
    update private.edition_sources s set request_id = asked, sent_at = now(), request_place = 1
    where s.edition_id = ask.edition_id and s.source = 'ndl';
  end loop;

  select array_agg(d.edition_id), array_agg(d.isbn) into ids, isbns
  from (
    select s.edition_id, e.isbn
    from private.edition_sources s
    join public.editions e on e.id = s.edition_id
    cross join lateral (
      select private.bib_owed(s.edition_id, s.settled_at, s.refetch_at) as at) owed
    where s.source = 'openbd' and s.request_id is null and s.state <> 'withdrawn'
      and s.next_at <= now()
      and not private.bib_slow('openbd')
      and exists (select 1 from public.books b where b.edition_id = s.edition_id)
    order by owed.at is null, owed.at, case when owed.at is not null then s.edition_id end,
      s.state <> 'missing', s.next_at, s.edition_id
    limit 100
    for update of s skip locked
  ) d;
  if ids is not null then
    asked := net.http_get(
      url := 'https://api.openbd.jp/v1/get?isbn=' || array_to_string(isbns, ','),
      headers := agent,
      timeout_milliseconds := 30000);
    update private.edition_sources s set request_id = asked, sent_at = now(), request_place = u.n
    from unnest(ids) with ordinality u (id, n)
    where s.edition_id = u.id and s.source = 'openbd';
  end if;
end;
$$;
revoke all on function private.bib_send() from public, anon, authenticated;

-- Judging ------------------------------------------------------------------------

-- The edition's books are compared again on the next tick: what they see of
-- the master may have changed. Not a book its reader said is the ISBN's, nor
-- one not compared yet. In the tick (a source's answer), a book whose row is
-- being written (placed again, its title edited, its reader answering) is
-- passed over without waiting: that writing marks it itself, and waiting on
-- a reader who waits on the edition's sources would never end. The
-- operator's tools wait (with wait), so a book the tick is judging from what
-- was there before is marked once the tick is done.
create function private.bib_recheck(edition uuid, wait boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if wait then
    update private.book_checks c set checked_at = null
    from public.books b
    where b.id = c.book_id and b.edition_id = bib_recheck.edition
      and c.checked_at is not null and c.confirmed_at is null;
  else
    update private.book_checks c set checked_at = null
    where c.book_id in (
      select x.book_id from private.book_checks x
      join public.books b on b.id = x.book_id
      where b.edition_id = bib_recheck.edition
        and x.checked_at is not null and x.confirmed_at is null
      for update of x skip locked);
  end if;
end;
$$;
revoke all on function private.bib_recheck(uuid, boolean) from public, anon, authenticated;

-- A source's answer kept (bib_take), withdrawn or allowed back (the
-- operator's withdrawal marks its books first, waiting: see
-- withdraw_bibliography), and the operator's corrections: what the
-- edition's books see may have changed.
create function private.bib_sources_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bib_recheck(new.edition_id);
  return null;
end;
$$;
revoke all on function private.bib_sources_changed() from public, anon, authenticated;
create trigger edition_sources_changed after update on private.edition_sources
  for each row when (old.fields is distinct from new.fields
    or old.state is distinct from new.state
    or old.found_sent_at is distinct from new.found_sent_at
    or old.title_sent_at is distinct from new.title_sent_at
    or old.settled_at is distinct from new.settled_at)
  execute function private.bib_sources_changed();

create function private.bib_fixes_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bib_recheck(
    case when tg_op = 'DELETE' then old.edition_id else new.edition_id end, true);
  return null;
end;
$$;
revoke all on function private.bib_fixes_changed() from public, anon, authenticated;
create trigger edition_fixes_changed after insert or update or delete on private.edition_fixes
  for each row execute function private.bib_fixes_changed();

-- A reader edits what they typed for a book with an ISBN: it is compared
-- again, and what they said about it before (that it is the ISBN's) was
-- about what it said then.
create function private.book_retitled() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update private.book_checks c set checked_at = null, confirmed_at = null
  where c.book_id = new.id;
  return null;
end;
$$;
revoke all on function private.book_retitled() from public, anon, authenticated;
create trigger books_retitled after update of title, author on public.books
  for each row when ((old.title is distinct from new.title or old.author is distinct from new.author)
    and new.isbn is not null)
  execute function private.book_retitled();

-- Compares the books due (the top of this file), a few hundred a turn, the
-- longest placed first; a book being written to is left for the next turn.
-- A book whose master has no title yet waits, unless both sources have
-- answered since it was placed, or a day has gone: then none. A verdict
-- apart holds the book in a work of its own; any other puts a held book back
-- in its edition's work. judged_at moves only when the verdict changes.
create function private.bib_judge() returns void
language plpgsql security definer set search_path = '' as $$
declare
  k record;
  m record;
  v text;
  held uuid;
  back uuid;
begin
  for k in
    select c.book_id, c.placed_at, c.verdict, c.confirmed_at, c.held_work,
      b.title, b.author, b.work_id, b.edition_id
    from private.book_checks c
    join public.books b on b.id = c.book_id
    join public.editions e on e.id = b.edition_id
    where e.isbn is not null
      and c.confirmed_at is null
      and c.placed_at <= now() - interval '10 minutes'
      and (c.checked_at is null
        or (c.verdict is null and c.placed_at <= now() - interval '1 day'))
    order by c.placed_at, c.book_id
    limit 300
    for no key update of c, b skip locked
  loop
    select * into m from private.edition_bibliography(k.edition_id, k.placed_at);
    if m.title is null then
      if k.placed_at > now() - interval '1 day' and exists (
          select 1 from private.edition_sources s
          where s.edition_id = k.edition_id and s.state <> 'withdrawn'
            and coalesce(s.settled_at, '-infinity') < k.placed_at) then
        update private.book_checks c set checked_at = now() where c.book_id = k.book_id;
        continue;
      end if;
      v := 'none';
    else
      v := private.bib_verdict(k.title, k.author, m.title, m.subtitle, m.volume,
        m.title_reading, m.creators);
    end if;
    held := k.held_work;
    if v = 'apart' and held is null then
      insert into public.works default values returning id into held;
      update public.books b set work_id = held where b.id = k.book_id;
      insert into private.work_changes (book_id, from_work, to_work, kind)
      values (k.book_id, k.work_id, held, 'hold');
    elsif v <> 'apart' and held is not null then
      update public.books b set work_id = e.work_id
      from public.editions e
      where b.id = k.book_id and e.id = b.edition_id
      returning b.work_id into back;
      insert into private.work_changes (book_id, from_work, to_work, kind)
      values (k.book_id, held, back, 'unhold');
      held := null;
    end if;
    update private.book_checks c set checked_at = now(), verdict = v,
      judged_at = case when c.verdict is distinct from v then now() else c.judged_at end,
      held_work = held
    where c.book_id = k.book_id;
  end loop;
end;
$$;
revoke all on function private.bib_judge() from public, anon, authenticated;

-- Each turn: the answers, the judging, then the asking.
create or replace function private.bib_tick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bib_receive();
  perform private.bib_judge();
  perform private.bib_send();
end;
$$;
revoke all on function private.bib_tick() from public, anon, authenticated;

-- Placed again (registered, or moved by an edited ISBN), a book is judged
-- again from the start: not compared yet, no verdict, nothing said by its
-- reader, held nowhere (the move took it to its new edition's work). A book
-- without an ISBN is none at once.
create or replace function private.book_checked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.book_checks (book_id, placed_at, checked_at, verdict, judged_at)
  values (new.id, now(), case when new.isbn is null then now() end,
    case when new.isbn is null then 'none' end, case when new.isbn is null then now() end)
  on conflict (book_id) do update set placed_at = excluded.placed_at,
    checked_at = excluded.checked_at, verdict = excluded.verdict,
    judged_at = excluded.judged_at, confirmed_at = null, held_work = null;
  perform private.bib_ask(new.edition_id);
  return null;
end;
$$;
revoke all on function private.book_checked() from public, anon, authenticated;

-- What the master shows -----------------------------------------------------------

-- As before (bibliography), once the book is judged to be the edition's
-- (the same, close, or its reader said so): a book held is shown with what
-- its reader typed, everywhere, and so is one not judged yet.
create or replace function public.book_bibliography(ids uuid[])
returns table (book_id uuid, title text, title_reading text, subtitle text, volume text,
  edition text, series jsonb, creators jsonb, credits jsonb, publisher text, issued text,
  ndc text, sources jsonb)
language sql stable security definer set search_path = '' as $$
  select b.id, d.title, d.title_reading, d.subtitle, d.volume, d.edition, d.series,
    d.creators, d.credits, d.publisher, d.issued, d.ndc, d.sources
  from public.books b
  join private.book_checks c on c.book_id = b.id
  cross join lateral private.edition_bibliography(b.edition_id, c.placed_at) d
  where b.id = any ((book_bibliography.ids)[1:200])
    and c.placed_at <= now() - interval '10 minutes'
    and (c.verdict in ('same', 'close') or c.confirmed_at is not null)
    and d.sources <> '{}'
    and (b.created_by = (select auth.uid())
      or private.book_is_listed(b.id)
      or private.book_is_mine(b.id))
$$;
revoke all on function public.book_bibliography(uuid[]) from public, anon, authenticated;
grant execute on function public.book_bibliography(uuid[]) to anon, authenticated;

-- The reader's books held, for the notice that tells them once: when each was
-- held, and the master's title and creators as the book sees them (「この
-- ISBN は『…』の本のようです」). Only the reader's own: books they
-- registered.
create function public.book_holds()
returns table (book_id uuid, held_at timestamptz, title text, creators jsonb)
language sql stable security definer set search_path = '' as $$
  select b.id, c.judged_at, d.title, d.creators
  from public.books b
  join private.book_checks c on c.book_id = b.id
  cross join lateral private.edition_bibliography(b.edition_id, c.placed_at) d
  where b.created_by = (select auth.uid())
    and c.held_work is not null
    and d.title is not null
  order by c.judged_at, b.id
$$;
revoke all on function public.book_holds() from public, anon, authenticated;
grant execute on function public.book_holds() to authenticated;

-- The reader says a book they hold back is the ISBN's after all: it goes back
-- to its edition's work, the master shows for it, and it is not judged again
-- until it is placed again. Only for a book of theirs that is held; any
-- other id is refused alike.
create function public.confirm_book_isbn(book uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k record;
  back uuid;
begin
  select b.work_id, c.held_work into k
  from public.books b
  join private.book_checks c on c.book_id = b.id
  where b.id = confirm_book_isbn.book and b.created_by = (select auth.uid())
    and c.held_work is not null
  for no key update of b, c;
  if not found then
    raise exception 'no book of yours is held with that id' using errcode = 'P0002';
  end if;
  update public.books b set work_id = e.work_id
  from public.editions e
  where b.id = confirm_book_isbn.book and e.id = b.edition_id
  returning b.work_id into back;
  insert into private.work_changes (book_id, from_work, to_work, kind)
  values (confirm_book_isbn.book, k.held_work, back, 'unhold');
  update private.book_checks c
  set confirmed_at = now(), checked_at = now(), held_work = null
  where c.book_id = confirm_book_isbn.book;
end;
$$;
revoke all on function public.confirm_book_isbn(uuid) from public, anon, authenticated;
grant execute on function public.confirm_book_isbn(uuid) to authenticated;

-- For the operator (the SQL Editor, as the other tools): puts a held book
-- back in its edition's work as its reader's answer would, when the reader
-- cannot answer any more (the account is gone) or the operator sees the two
-- are one book. It is not judged again until it is placed again or edited.
create function private.release_hold(book uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k record;
  back uuid;
begin
  select c.held_work into k
  from public.books b
  join private.book_checks c on c.book_id = b.id
  where b.id = release_hold.book and c.held_work is not null
  for no key update of b, c;
  if not found then
    raise exception 'no book is held with that id' using errcode = 'P0002';
  end if;
  update public.books b set work_id = e.work_id
  from public.editions e
  where b.id = release_hold.book and e.id = b.edition_id
  returning b.work_id into back;
  insert into private.work_changes (book_id, from_work, to_work, kind)
  values (release_hold.book, k.held_work, back, 'unhold');
  update private.book_checks c
  set confirmed_at = now(), checked_at = now(), held_work = null
  where c.book_id = release_hold.book;
end;
$$;
revoke all on function private.release_hold(uuid) from public, anon, authenticated;

-- Works ------------------------------------------------------------------------------

-- Whether a book counts in its work: judged the same, close or none, or said
-- by its reader to be the ISBN's. Not one held, nor one not judged yet. For
-- the work's page (item 17), and the candidates below.
create function private.book_counts_in_work(book uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.book_checks c
    where c.book_id = book_counts_in_work.book
      and (c.verdict in ('same', 'close', 'none') or c.confirmed_at is not null))
$$;
revoke all on function private.book_counts_in_work(uuid) from public, anon, authenticated;

-- As before (works), from the books that count in their works only.
create or replace function private.work_candidates()
returns table (
  book_a uuid,
  book_b uuid,
  title_a text,
  title_b text,
  author_a text,
  author_b text,
  isbn_a text,
  isbn_b text,
  readers bigint,
  reviews bigint,
  shops bigint
)
language sql stable security definer set search_path = '' as $$
  with seen as (
    select b.id, b.work_id,
      private.fold_book_text(b.title) as title_key,
      private.fold_book_text(b.author) as author_key,
      private.author_keys(b.author) as author_keys
    from public.books b
    where (b.source <> 'manual' or private.book_is_listed(b.id))
      and private.book_counts_in_work(b.id)
  ),
  heads as (
    select distinct on (s.work_id, s.title_key, s.author_key) s.*
    from seen s
    where s.title_key <> '' and s.author_key <> ''
    order by s.work_id, s.title_key, s.author_key, s.id
  ),
  weight as (
    select w.work_id,
      (select count(distinct r.user_id) from public.reading_entries r
       join public.books e on e.id = r.book_id
       where e.work_id = w.work_id and private.book_counts_in_work(e.id)
         and r.is_public and not private.is_hidden('profile', r.user_id)) as readers,
      (select count(*) from public.posts p
       join public.books e on e.id = p.book_id
       where e.work_id = w.work_id and private.book_counts_in_work(e.id)
         and p.parent_id is null and p.reading_mode is distinct from 'solo'
         and not private.is_hidden('post', p.id)
         and not private.is_hidden('profile', p.author_id)) as reviews,
      (select count(*) from public.shops s
       where s.is_open
         and not private.is_hidden('shop', s.id)
         and not private.is_hidden('profile', s.owner_id)
         and exists (
           select 1 from public.books e
           where e.work_id = w.work_id and private.book_counts_in_work(e.id)
             and (s.public_scene_books @> jsonb_build_array(e.id::text)
               or s.public_shelves @> jsonb_build_array(jsonb_build_object(
                 'items', jsonb_build_array(jsonb_build_object('bookId', e.id::text)))))
         )) as shops
    from (select distinct h.work_id from heads h) w
  ),
  ranked as (
    select h.*, row_number() over (
      partition by h.title_key, h.author_key
      order by g.readers + g.reviews + g.shops desc, h.work_id) as place
    from heads h join weight g on g.work_id = h.work_id
  ),
  pairs as (
    -- The same title and author: each work beside the one most touched.
    select t.id as a_id, o.id as b_id, t.work_id as a_work, o.work_id as b_work
    from ranked t
    join ranked o on o.title_key = t.title_key and o.author_key = t.author_key and o.place > 1
    where t.place = 1
    union all
    -- Written differently but agreeing: the most touched work of each.
    select a.id, b.id, a.work_id, b.work_id
    from ranked a
    join ranked b on left(b.title_key, 2) = left(a.title_key, 2)
      and (b.title_key, b.author_key) > (a.title_key, a.author_key)
    where a.place = 1 and b.place = 1
      and private.titles_agree(a.title_key, b.title_key)
      and private.authors_agree(a.author_keys, a.author_key, b.author_keys, b.author_key)
  ),
  -- Pairs kept apart, as the works they are now.
  apart as (
    select
      least(coalesce(wa.merged_into, wa.id), coalesce(wb.merged_into, wb.id)) as work_a,
      greatest(coalesce(wa.merged_into, wa.id), coalesce(wb.merged_into, wb.id)) as work_b
    from private.works_apart x
    join public.works wa on wa.id = x.work_a
    join public.works wb on wb.id = x.work_b
  ),
  chosen as (
    select distinct on (least(p.a_work, p.b_work), greatest(p.a_work, p.b_work)) p.*
    from pairs p
    where p.a_work <> p.b_work and not exists (
      select 1 from apart x
      where x.work_a = least(p.a_work, p.b_work) and x.work_b = greatest(p.a_work, p.b_work)
    )
    order by least(p.a_work, p.b_work), greatest(p.a_work, p.b_work), p.a_id, p.b_id
  )
  select a.id, b.id, a.title, b.title, a.author, b.author, a.isbn, b.isbn,
    ga.readers + gb.readers, ga.reviews + gb.reviews, ga.shops + gb.shops
  from chosen c
  join public.books a on a.id = c.a_id
  join public.books b on b.id = c.b_id
  join weight ga on ga.work_id = c.a_work
  join weight gb on gb.work_id = c.b_work
  order by ga.readers + gb.readers + ga.reviews + gb.reviews + ga.shops + gb.shops desc,
    a.id, b.id
$$;
revoke all on function private.work_candidates() from public, anon, authenticated;

-- The operator's tools -------------------------------------------------------------

-- As before (bibliography), and the edition's books are marked to be
-- compared again first, waiting for the tick to be done with them (in the
-- order a reader placing a book takes its rows, so neither waits on the
-- other for ever).
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
    title_kept_at = null, found_sent_at = null, title_sent_at = null
  where s.edition_id = ed and s.source = withdraw_bibliography.source;
  if not found then
    raise exception 'no % data for the book', source;
  end if;
end;
$$;
revoke all on function private.withdraw_bibliography(uuid, text) from public, anon, authenticated;

-- As before (edition_ids), and not with a held book's work: its reader
-- answers first (says it is the ISBN's, or edits its ISBN).
create or replace function private.join_works(stays_with uuid, goes_with uuid)
returns table (join_id uuid, moved integer)
language plpgsql security definer set search_path = '' as $$
declare
  kept uuid;
  gone uuid;
  made uuid;
  n integer;
begin
  lock table public.books in share row exclusive mode;
  select b.work_id into kept from public.books b where b.id = stays_with;
  select b.work_id into gone from public.books b where b.id = goes_with;
  if kept is null or gone is null then
    raise exception 'no book has that id' using errcode = 'P0002';
  end if;
  if exists (
      select 1 from private.book_checks c
      where c.book_id in (stays_with, goes_with) and c.held_work is not null) then
    raise exception 'a held book: its reader answers first, or edits its ISBN';
  end if;
  if kept = gone then
    raise exception 'the two books are one work already';
  end if;
  insert into private.work_joins (kept, gone, isbns, editions, led_here)
  values (kept, gone,
    array(select e.isbn from public.editions e
      where e.work_id = gone and e.isbn is not null order by e.isbn),
    array(select e.id from public.editions e where e.work_id = gone order by e.id),
    array(select w.id from public.works w where w.merged_into = gone order by w.id))
  returning id into made;
  insert into private.work_changes (book_id, from_work, to_work, kind, join_id)
  select b.id, gone, kept, 'join', made from public.books b where b.work_id = gone;
  update public.editions e set work_id = kept where e.work_id = gone;
  update public.books b set work_id = kept where b.work_id = gone;
  get diagnostics n = row_count;
  -- Works joined into the one that goes now lead to the one that stays, and
  -- so does what was decided about them (works_apart).
  update public.works w set merged_into = kept where w.id = gone or w.merged_into = gone;
  return query select made, n;
end;
$$;
revoke all on function private.join_works(uuid, uuid) from public, anon, authenticated;

-- The operator's list ---------------------------------------------------------------

-- As before (bibliography), and every book held: when it was held, what its
-- reader typed (title, author) and the master's title and creators. Its rows go into no pull request,
-- issue or log, as before.
create or replace view private.bibliography_review as
select e.isbn, s.source, s.state, s.failures, s.answered_at, s.title_kept_at,
  case when s.title_kept_at is not null then 'title kept' else 'failing' end as why,
  exists (select 1 from public.books b where b.edition_id = e.id and private.book_is_listed(b.id))
    as listed,
  (select b.id from public.books b where b.edition_id = e.id order by b.created_at limit 1)
    as a_book,
  null::timestamptz as held_at, null::text as title, null::text as author,
  null::text as master_title, null::jsonb as master_creators
from private.edition_sources s
join public.editions e on e.id = s.edition_id
where s.title_kept_at is not null or s.failures >= 4
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
