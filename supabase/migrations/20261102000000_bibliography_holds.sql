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
-- subtitle or its volume, or the title and the same volume written another
-- way (第1巻, 上 for 1). Apart: the title and another volume, where the
-- master tells its volume, whatever else agrees (one work is one volume; the
-- owner, 2026-10-17 04:15Z); no volume typed is not another. Close: one inside the other, the title's reading too (a subtitle, 新訳版, a
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
--   insert into private.work_changes (book_id, from_work, to_work, kind)
--   select b.id, c.held_work, e.work_id, 'unhold'
--   from public.books b
--   join public.editions e on e.id = b.edition_id
--   join private.book_checks c on c.book_id = b.id
--   where c.held_work is not null;
--   update public.books b set work_id = e.work_id
--   from public.editions e, private.book_checks c
--   where e.id = b.edition_id and c.book_id = b.id and c.held_work is not null;
--   drop view private.bibliography_review;
--   drop function private.bib_judge(), private.bib_slow(text),
--     private.bib_recheck(uuid, boolean, timestamptz, timestamptz), private.bib_sources_changed(),
--     private.bib_fixes_changed(), private.book_retitled(), private.book_counts_in_work(uuid),
--     private.bib_verdict(text, text, text, text, text, text, jsonb), private.bib_volume(text),
--     private.bib_number(text), private.bib_same_volume(text, text), private.bib_key(text);
--   drop table private.book_rechecks;
--   alter table private.book_checks drop column checked_at, drop column verdict,
--     drop column judged_at, drop column confirmed_at, drop column held_work;
--   drop function private.bib_turn(uuid, timestamptz, timestamptz, timestamptz);
--   alter table private.edition_sources drop column sent_for, drop column tried_for,
--     drop column settled_for, drop column found_for, drop column title_for;

-- and then makes private.bib_send(), private.bib_tick(), private.book_checked(),
-- private.bib_take(...), private.edition_bibliography(uuid, timestamptz),
-- private.withdraw_bibliography(uuid, text), public.book_bibliography(uuid[])
-- and the view private.bibliography_review again as
-- 20261101000000_bibliography.sql has them, private.join_works(uuid,
-- uuid) as 20261031000000_edition_ids.sql has it, and private.work_candidates()
-- and private.keep_apart(uuid, uuid) as 20261027000000_works.sql has them,
-- each with create or replace (the view with create) and the revoke after it
-- (and book_bibliography's grant). pnpm test:db runs exactly that, with a
-- book held. Held books go back to their editions' works, written down as
-- the reader's answer is; the works made for them stay, with no book, which
-- nobody reads, and so do the moves written down, hold and unhold among them.

-- Nobody writes a book, an edition's sources or a book's checks until this
-- file is done: the tables first, in the order a registration takes them in
-- (its book, its edition's work, the edition's sources, the book's checks),
-- so this file and a registration never wait on each other; books and works
-- only for writing (the triggers and the reference below), so a reader still
-- reads them. In a DO block, as 20261031000000_edition_ids.sql does it.
select set_config('lock_timeout', '10s', true);
do $$
begin
  lock table public.books in share row exclusive mode;
  lock table public.works in share row exclusive mode;
  lock table private.edition_sources in access exclusive mode;
  lock table private.edition_fixes in share row exclusive mode;
  lock table private.book_checks in access exclusive mode;
  lock table private.work_changes in access exclusive mode;
end;
$$;

-- Comparing ----------------------------------------------------------------------

-- A title or an author as the judging compares it: folded as the search
-- folds it, or, with a letter of a script the folding drops (Русский,
-- Ελληνικά, Łódź), or nothing the folding keeps, the whole of it in lower
-- case without its spaces and punctuation (Война и мир 1, not 1).
create function private.bib_key(t text) returns text
language sql immutable set search_path = '' as $$
  select case
    when normalize(regexp_replace(normalize(coalesce(t, ''), nfkd), '[̀-ͯ]', '', 'g'), nfkc)
        ~ '[À-ÖØ-öø-ɏͰ-׿؀-ۿऀ-ॿ฀-๿]'
      or private.fold_book_text(t) = ''
    then lower(regexp_replace(normalize(coalesce(t, ''), nfkc), '[[:space:][:punct:]]', '', 'g'))
    else private.fold_book_text(t)
  end
$$;
revoke all on function private.bib_key(text) from public, anon, authenticated;

-- A volume's number as the judging compares it: in figures without leading
-- zeros (02 is 2, ２ is 2 already), in kanji up to 九十九 (二十三 is 23), or
-- 上・中・下 as they are. Not a year (four figures or more), nor anything
-- else.
create function private.bib_number(k text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  m text[];
  digits constant text := '一二三四五六七八九';
begin
  if k ~ '^[0-9]{1,3}$' then
    return coalesce(nullif(ltrim(k, '0'), ''), '0');
  elsif k ~ '^[上中下]$' then
    return k;
  end if;
  m := regexp_match(coalesce(k, ''), '^([一二三四五六七八九]?)(十?)([一二三四五六七八九]?)$');
  if m is null or k = '' then
    return null;
  elsif m[2] = '' then
    return case when char_length(k) = 1 then strpos(digits, k)::text end;
  end if;
  return (coalesce(nullif(strpos(digits, nullif(m[1], '')), 0), 1) * 10
    + coalesce(strpos(digits, nullif(m[3], '')), 0))::text;
end;
$$;
revoke all on function private.bib_number(text) from public, anon, authenticated;

-- The volume typed at the end of a title, and the title before it, as keys:
-- 進撃の巨人 2, 進撃の巨人（２）, 進撃の巨人 第2巻, 1Q84 BOOK2, Vol.3,
-- ノルウェイの森（上）, 銀河英雄伝説 二. Read before folding, so ゴルゴ13 2 is
-- volume 2 of ゴルゴ13. No volume when the title does not end in one (新装版,
-- 2026年版, a year); the base is empty when there is nothing before it (2, 第2巻).
create function private.bib_volume(t text, out base text, out mark text)
language plpgsql immutable set search_path = '' as $$
declare
  rest text := regexp_replace(normalize(coalesce(t, ''), nfkc),
    '[[:space:])\]}）］｝」』】〕〉》]*$', '');
  found text;
begin
  rest := regexp_replace(rest, '(巻|集|部|編)$', '');
  found := substring(rest from '([0-9]+|[一二三四五六七八九十]+|[上中下])$');
  mark := private.bib_number(found);
  if mark is not null then
    base := private.bib_key(regexp_replace(
      left(rest, char_length(rest) - char_length(found)),
      '(第|vol\.?|volume|book|part|no\.)[[:space:]]*$', '', 'i'));
  end if;
end;
$$;
revoke all on function private.bib_volume(text) from public, anon, authenticated;

-- Whether two volumes' numbers are one volume: the same, or 上 and 1, 中 and
-- 2, 下 and 2 or 3 (a set in two or in three).
create function private.bib_same_volume(a text, b text) returns boolean
language sql immutable set search_path = '' as $$
  select a = b or (a, b) in (('上', '1'), ('1', '上'), ('中', '2'), ('2', '中'),
    ('下', '2'), ('2', '下'), ('下', '3'), ('3', '下'))
$$;
revoke all on function private.bib_same_volume(text, text) from public, anon, authenticated;

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
  typed record;
  told record;
  one boolean;
begin
  if mine = '' then
    mine := null;
  end if;
  if mine = any (whole) then
    return 'same';
  end if;
  -- A volume: what the reader typed is the master's title (or its reading)
  -- and a volume, and the master tells its volume, in the volume or at the
  -- end of the title. The same volume written another way is the same (第1巻,
  -- （１）, 上 for 1); another volume is apart, whatever else agrees (one
  -- work is one volume). No volume typed is neither: the rest decides.
  select * into typed from private.bib_volume(title);
  if typed.mark is not null and typed.base <> '' then
    select * into told from private.bib_volume(m_volume);
    with told_as (base, mark) as (
      select private.bib_key(m_title), told.mark where told.base = ''
      union all
      select x.base, x.mark from private.bib_volume(m_title) x where x.base <> ''
      union all
      select private.bib_key(m_reading), told.mark
      where told.base = '' and coalesce(m_reading, '') <> ''
      union all
      select x.base, x.mark from private.bib_volume(m_reading) x where x.base <> ''
    )
    select bool_or(private.bib_same_volume(w.mark, typed.mark)) into one
    from told_as w
    where w.base = typed.base and w.mark is not null;
    if one then
      return 'same';
    elsif not one then
      return 'apart';
    end if;
  end if;
  foreach t in array whole || private.bib_key(m_reading) loop
    if mine is not null and t <> '' and least(char_length(mine), char_length(t)) >= 2
        and (strpos(mine, t) > 0 or strpos(t, mine) > 0) then
      return 'close';
    end if;
  end loop;
  -- An author: as the name is printed, as it reads, or the authority's form
  -- without its years (Bradbury, Ray, 1920-2012 for レイ・ブラッドベリ). One
  -- in a script the folding drops, by the whole line. The first twenty of the
  -- master's (an anthology may list hundreds; comparing them all would make
  -- the tick slow, and the title has been compared already).
  keys := private.author_keys(author);
  folded := private.fold_book_text(author);
  raw := case when folded = '' then private.bib_key(author) else '' end;
  for person in
    select x from jsonb_array_elements(
      case when jsonb_typeof(m_creators) = 'array' then m_creators else '[]' end) x
    limit 20
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
  add check (held_work is null
    or (verdict is not distinct from 'apart' and confirmed_at is null));
create index book_checks_unchecked on private.book_checks (placed_at)
  where checked_at is null;
create index book_checks_unjudged on private.book_checks (placed_at)
  where verdict is null;

update private.book_checks c set checked_at = now(), verdict = 'none', judged_at = now()
from public.books b
where b.id = c.book_id and b.isbn is null;

-- Books a source's answer could not mark to compare again, their checks
-- being written to just then (bib_recheck): the next tick compares them.
-- The tick alone writes here, so nothing is lost between its turns. Not a
-- reference to the book: making one would wait on the book's row.
create table private.book_rechecks (
  book_id uuid primary key
);
alter table private.book_rechecks enable row level security;
revoke all on private.book_rechecks from public, anon, authenticated;

-- For each edition and source, besides when its questions went (as before):
-- the turn the question out was asked for, the latest turn asked for (its
-- answer found, missing or failed), the latest one answered (found or
-- missing), and the turns the source's found answer and its title answered.
-- A question answers the books whose turn had come when it went (placed
-- before every book still waiting its turn then), and no later one: a book
-- placed while an earlier book of the same ISBN waited is asked about at
-- its own turn, as if nobody had the ISBN (bib_send). What was kept before
-- answered the books placed before its question went, as it did.
alter table private.edition_sources
  add column sent_for timestamptz,
  add column tried_for timestamptz,
  add column settled_for timestamptz,
  add column found_for timestamptz,
  add column title_for timestamptz;
update private.edition_sources set sent_for = sent_at, tried_for = settled_at,
  settled_for = settled_at, found_for = found_sent_at, title_for = title_sent_at;
alter table private.edition_sources
  add check ((request_id is null) = (sent_for is null));

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

-- The turn an edition's source is owed a question at: its oldest book placed
-- since the latest turn asked for (or the operator's ask since then); else,
-- the question for it having failed, its oldest book placed since the latest
-- turn answered (asked again when the wait after the failure is over; a book
-- placed meanwhile asks at once, bib_ask). Null: owed nothing (asked again on
-- its schedule).
create function private.bib_turn(edition uuid, settled timestamptz, tried timestamptz,
  refetch timestamptz) returns timestamptz
language sql stable set search_path = '' as $$
  select coalesce(
    least(
      (select min(c.placed_at)
       from public.books b join private.book_checks c on c.book_id = b.id
       where b.edition_id = bib_turn.edition
         and c.placed_at > coalesce(greatest(settled, tried), '-infinity')),
      case when refetch > coalesce(greatest(settled, tried), '-infinity') then refetch end),
    private.bib_owed(edition, settled, refetch))
$$;
revoke all on function private.bib_turn(uuid, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;

-- As before (bibliography), but each question for a turn: first what is owed
-- a question, by its turn (ties by the edition's id), then the rest as before
-- (and by the edition's id when their times are the same: answers read
-- together are due again together). A question answers every book of its
-- edition placed before the turn of the first edition left for later (or
-- now, when none is left), and no book after: a book placed later waits its
-- own turn, as a book of an ISBN nobody had does. Not to a source slow to
-- answer, and the library is waited on for a minute.
create or replace function private.bib_send() returns void
language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[];
  isbns text[];
  turns timestamptz[];
  sent uuid[];
  sent_isbns text[];
  sent_turns timestamptz[];
  upto timestamptz;
  asked bigint;
  agent constant jsonb := '{"User-Agent": "BookTown (+https://booktown.page)"}';
begin
  -- An edition owed nothing (asked again on its schedule) is asked for now,
  -- as before: every book of it was placed before.
  -- The library: the first edition due, and the turn of the one after it.
  select array_agg(d.edition_id order by d.place), array_agg(d.isbn order by d.place),
    array_agg(d.turn order by d.place)
  into ids, isbns, turns
  from (
    select s.edition_id, e.isbn, t.turn,
      row_number() over (
        order by t.turn is null, t.turn, case when t.turn is not null then s.edition_id end,
          s.status is distinct from 'C3', s.state <> 'missing', s.next_at, s.edition_id) as place
    from private.edition_sources s
    join public.editions e on e.id = s.edition_id
    cross join lateral (
      select private.bib_turn(s.edition_id, s.settled_for, s.tried_for, s.refetch_at)
        as turn) t
    where s.source = 'ndl' and s.request_id is null and s.state <> 'withdrawn'
      and s.next_at <= now()
      and not private.bib_slow('ndl')
      and exists (select 1 from public.books b where b.edition_id = s.edition_id)
  ) d
  where d.place <= 2;
  -- (A row being written is passed over, as before: the next turn asks it.)
  if ids is not null and exists (
      select 1 from private.edition_sources s
      where s.edition_id = ids[1] and s.source = 'ndl' and s.request_id is null
      for update skip locked) then
    upto := least(coalesce(turns[2], now()), now());
    asked := net.http_get(
      url := 'https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&version=1.2'
        || '&recordSchema=dcndl&recordPacking=xml&onlyBib=true&maximumRecords=20'
        || '&query=isbn%3D%22' || isbns[1] || '%22'
        || '%20AND%20dpid%3D%22iss-ndl-opac%20iss-ndl-opac-inprocess%22',
      headers := agent,
      timeout_milliseconds := 60000);
    update private.edition_sources s
    set request_id = asked, sent_at = now(),
      sent_for = case when turns[1] is null then now() else upto end, request_place = 1
    where s.edition_id = ids[1] and s.source = 'ndl';
  end if;

  -- openBD: the first hundred due, in one question, and the turn of the
  -- first one left for later.
  select array_agg(d.edition_id order by d.place), array_agg(d.isbn order by d.place),
    array_agg(d.turn order by d.place)
  into ids, isbns, turns
  from (
    select s.edition_id, e.isbn, t.turn,
      row_number() over (
        order by t.turn is null, t.turn, case when t.turn is not null then s.edition_id end,
          s.state <> 'missing', s.next_at, s.edition_id) as place
    from private.edition_sources s
    join public.editions e on e.id = s.edition_id
    cross join lateral (
      select private.bib_turn(s.edition_id, s.settled_for, s.tried_for, s.refetch_at)
        as turn) t
    where s.source = 'openbd' and s.request_id is null and s.state <> 'withdrawn'
      and s.next_at <= now()
      and not private.bib_slow('openbd')
      and exists (select 1 from public.books b where b.edition_id = s.edition_id)
  ) d
  where d.place <= 101;
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

-- As before (bibliography), for the turn the question was asked for: what
-- it found answers the books placed by then (and by any later turn it
-- answered for before), it settles what was owed by then, and a book placed
-- after that turn (the cache not having answered it) is still owed its own.
-- (The times the questions went are kept as before.)
create or replace function private.bib_take(edition uuid, source text, question bigint, state text,
  record text, record_id text, status text, fields jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s private.edition_sources;
  sent timestamptz;
  served timestamptz;
  alone boolean;
  later boolean;
begin
  select * into s from private.edition_sources x
  where x.edition_id = bib_take.edition and x.source = bib_take.source
  for update;
  if not found or (question is not null and s.request_id is distinct from question) then
    return;
  end if;
  sent := s.sent_at;
  served := coalesce(s.sent_for, s.sent_at);
  later := served is not null and private.bib_owed(s.edition_id,
    greatest(served, s.settled_for), s.refetch_at) is not null;
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
    elsif bib_take.state = 'missing' then
      s.state := 'missing';
      s.misses := case when later then s.misses else least(s.misses + 1, 1000) end;
      s.failures := 0;
      if s.source = 'openbd' then
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
      s.failures := case when later then s.failures else least(s.failures + 1, 1000) end;
    end if;
    if s.state <> 'failed' and sent is not null then
      s.settled_at := greatest(s.settled_at, sent);
      s.settled_for := greatest(s.settled_for, served);
    end if;
    s.next_at := case when later then now()
      else private.bib_next(s.source, s.state, s.misses, s.failures, s.status, s.fields) end;
  end if;
  update private.edition_sources x set
    state = s.state, record = s.record, record_id = s.record_id, status = s.status,
    fields = s.fields, answered_at = s.answered_at, found_at = s.found_at,
    found_sent_at = s.found_sent_at, title_sent_at = s.title_sent_at,
    found_for = s.found_for, title_for = s.title_for, settled_for = s.settled_for,
    tried_for = s.tried_for, sent_for = null,
    misses = s.misses, failures = s.failures, next_at = s.next_at, settled_at = s.settled_at,
    request_id = null, sent_at = null, request_place = null, title_kept_at = s.title_kept_at
  where x.edition_id = s.edition_id and x.source = s.source;
end;
$$;
revoke all on function private.bib_take(uuid, text, bigint, text, text, text, text, jsonb)
  from public, anon, authenticated;

-- As before (bibliography), with since the turn: what the sources said in
-- answer to questions asked for a turn from then on (a book is shown what
-- was asked for its turn or a later one).
create or replace function private.edition_bibliography(ed uuid, since timestamptz default '-infinity')
returns table (title text, title_reading text, subtitle text, volume text, edition text,
  series jsonb, creators jsonb, credits jsonb, publisher text, issued text, ndc text,
  sources jsonb)
language sql stable set search_path = '' as $$
  with picked as (
    select k.field, coalesce(
      (select jsonb_build_array(f.value, 'fix') from private.edition_fixes f
       where f.edition_id = ed and f.field = k.field),
      (select jsonb_build_array(s.fields -> k.field, s.source) from private.edition_sources s
       where s.edition_id = ed and private.bib_filled(s.fields -> k.field)
         and coalesce(case when k.field = 'title' then s.title_for else s.found_for end,
           '-infinity') >= since
       order by s.source = 'ndl' desc
       limit 1)) as pick
    from unnest(array['title', 'title_reading', 'subtitle', 'volume', 'edition', 'series',
      'creators', 'credits', 'publisher', 'issued', 'ndc']) k (field)
  ), shown as (
    select
      coalesce(jsonb_object_agg(p.field, p.pick -> 0)
        filter (where private.bib_filled(p.pick -> 0)), '{}') as v,
      coalesce(jsonb_object_agg(p.field, p.pick -> 1)
        filter (where private.bib_filled(p.pick -> 0)), '{}') as sources
    from picked p
  )
  select v ->> 'title', v ->> 'title_reading', v ->> 'subtitle', v ->> 'volume',
    v ->> 'edition', v -> 'series', v -> 'creators', v -> 'credits', v ->> 'publisher',
    v ->> 'issued', v ->> 'ndc', sources
  from shown
$$;
revoke all on function private.edition_bibliography(uuid, timestamptz)
  from public, anon, authenticated;

-- Judging ------------------------------------------------------------------------

-- The edition's books placed after one time and by another (all of them, by
-- default) are compared again on the next tick: what they see of the master
-- may have changed. Not a book its reader said is the ISBN's, nor one not
-- compared yet. In the tick (a source's answer), a book whose checks are
-- being written (placed again, its title edited, its reader answering) is
-- not waited on, as waiting on a reader who waits on the edition's sources
-- would never end; it is written down in book_rechecks, and the next tick
-- compares it. The operator's tools wait (with wait), so a book the tick is
-- judging from what was there before is marked once the tick is done.
create function private.bib_recheck(edition uuid, wait boolean default false,
  after timestamptz default '-infinity', upto timestamptz default 'infinity') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if after >= upto then
    return;
  end if;
  if wait then
    update private.book_checks c set checked_at = null
    from public.books b
    where b.id = c.book_id and b.edition_id = bib_recheck.edition
      and c.placed_at > after and c.placed_at <= upto
      and c.checked_at is not null and c.confirmed_at is null;
    return;
  end if;
  with due as (
    select x.book_id from private.book_checks x
    join public.books b on b.id = x.book_id
    where b.edition_id = bib_recheck.edition
      and x.placed_at > after and x.placed_at <= upto
      and x.checked_at is not null and x.confirmed_at is null
  ), marked as (
    update private.book_checks c set checked_at = null
    where c.book_id in (
      select x.book_id from private.book_checks x
      where x.book_id in (select d.book_id from due d)
      for update of x skip locked)
    returning c.book_id
  )
  insert into private.book_rechecks (book_id)
  select d.book_id from due d
  where d.book_id not in (select m.book_id from marked m)
  on conflict do nothing;
end;
$$;
revoke all on function private.bib_recheck(uuid, boolean, timestamptz, timestamptz)
  from public, anon, authenticated;

-- A source's answer kept (bib_take), the cache answering a book (book_checked),
-- withdrawn or allowed back (the operator's withdrawal marks its books
-- first, waiting: see withdraw_bibliography): what the edition's books see
-- may have changed. Only the books whose view did: what a source said is
-- shown to the books placed by the turn it answered (found_for, title_for)
-- and counts as answered for them (settled_for), so a turn that moves shows
-- it to the books placed between, and an answer that differs to every book
-- shown it, before and after. Withdrawn or allowed back, all of them.
create function private.bib_sources_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  after timestamptz := 'infinity';
  upto timestamptz := '-infinity';
  pair timestamptz[];
begin
  if (old.state = 'withdrawn') is distinct from (new.state = 'withdrawn') then
    perform private.bib_recheck(new.edition_id);
  elsif old.fields is distinct from new.fields then
    perform private.bib_recheck(new.edition_id, false, '-infinity',
      coalesce(greatest(old.found_for, new.found_for, old.title_for, new.title_for,
        old.settled_for, new.settled_for), '-infinity'));
  else
    foreach pair slice 1 in array array[
        array[old.found_for, new.found_for],
        array[old.title_for, new.title_for],
        array[old.settled_for, new.settled_for]] loop
      if pair[1] is distinct from pair[2] then
        after := least(after,
          case when pair[1] is null or pair[2] is null then '-infinity'
            else least(pair[1], pair[2]) end);
        upto := greatest(upto, pair[1], pair[2]);
      end if;
    end loop;
    perform private.bib_recheck(new.edition_id, false, after, upto);
  end if;
  return null;
end;
$$;
revoke all on function private.bib_sources_changed() from public, anon, authenticated;
create trigger edition_sources_changed after update on private.edition_sources
  for each row when (old.fields is distinct from new.fields
    or old.state is distinct from new.state
    or old.found_for is distinct from new.found_for
    or old.title_for is distinct from new.title_for
    or old.settled_for is distinct from new.settled_for)
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

-- Compares the books due (the top of this file), a few hundred a turn: the
-- ones not judged yet first, then the ones to compare again, the longest
-- placed first. A book being written to is left for the next turn, and so is
-- the whole turn when the operator is moving books between works (their
-- tools hold the books for that; waiting here could wait on them for ever).
-- A book whose master has no title yet waits, unless both sources have
-- answered for its turn, or a day has gone: then none. So does one without
-- an ISBN (registered while this file was being applied). A verdict apart
-- holds the book in a work of its own (the one it was held in before, when
-- that is still empty); any other puts a held book back in its edition's
-- work. judged_at moves only when the verdict changes.
create function private.bib_judge() returns void
language plpgsql security definer set search_path = '' as $$
declare
  k record;
  m record;
  v text;
  held uuid;
  back uuid;
begin
  begin
    lock table public.books in row exclusive mode nowait;
  exception when lock_not_available then
    return;
  end;
  delete from private.book_rechecks r
  where not exists (
    select 1 from private.book_checks c
    where c.book_id = r.book_id and c.confirmed_at is null);
  for k in
    with due (book_id) as (
      select c.book_id from private.book_checks c
      where c.checked_at is null and c.placed_at <= now() - interval '10 minutes'
      union
      select r.book_id from private.book_rechecks r
      union
      select c.book_id from private.book_checks c
      where c.verdict is null and c.placed_at <= now() - interval '1 day')
    select c.book_id, c.placed_at, c.verdict, c.confirmed_at, c.held_work,
      b.title, b.author, b.work_id, b.edition_id, e.isbn
    from due
    join private.book_checks c on c.book_id = due.book_id
    join public.books b on b.id = c.book_id
    join public.editions e on e.id = b.edition_id
    where c.confirmed_at is null
      and c.placed_at <= now() - interval '10 minutes'
    order by c.verdict is not null, c.placed_at, c.book_id
    limit 300
    for no key update of c, b skip locked
  loop
    delete from private.book_rechecks r where r.book_id = k.book_id;
    if k.isbn is null then
      v := 'none';
    else
      select * into m from private.edition_bibliography(k.edition_id, k.placed_at);
      if m.title is null then
        if k.placed_at > now() - interval '1 day' and exists (
            select 1 from private.edition_sources s
            where s.edition_id = k.edition_id and s.state <> 'withdrawn'
              and coalesce(s.settled_for, '-infinity') < k.placed_at) then
          update private.book_checks c set checked_at = now() where c.book_id = k.book_id;
          continue;
        end if;
        v := 'none';
      else
        v := private.bib_verdict(k.title, k.author, m.title, m.subtitle, m.volume,
          m.title_reading, m.creators);
      end if;
    end if;
    held := k.held_work;
    if v = 'apart' and held is null then
      select x.to_work into held
      from private.work_changes x
      join public.works w on w.id = x.to_work
      where x.book_id = k.book_id and x.kind = 'hold' and w.merged_into is null
        and not exists (select 1 from public.books o where o.work_id = x.to_work)
        and not exists (select 1 from public.editions o where o.work_id = x.to_work)
      order by x.changed_at desc
      limit 1;
      if held is null then
        insert into public.works default values returning id into held;
      end if;
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
  -- Judging that fails (it should not) leaves the answers and the
  -- questions to go on; the database's log has the warning.
  begin
    perform private.bib_judge();
  exception when others then
    raise warning 'bib_judge failed: %', sqlstate;
  end;
  perform private.bib_send();
end;
$$;
revoke all on function private.bib_tick() from public, anon, authenticated;

-- Placed again (registered, or moved by an edited ISBN), a book is judged
-- again from the start: not compared yet, no verdict, nothing said by its
-- reader, held nowhere (the move took it to its new edition's work). A book
-- without an ISBN is none at once.
--
-- And it is asked about at its own turn, as before, unless anyone may see
-- already that the edition is someone's: another of its books is a catalog
-- record, or is used where anyone may see it (book_is_listed). Then what the
-- sources said answers it now, as the cache: it shows (from ten minutes
-- after, as for every book) what the master has, and nothing is asked. That
-- tells nobody more than they could see (the owner, 2026-10-17 04:15Z: a
-- cache kept without telling who registered what). A source that has never
-- answered is asked, as before.
create or replace function private.book_checked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.book_checks (book_id, placed_at, checked_at, verdict, judged_at)
  values (new.id, now(), case when new.isbn is null then now() end,
    case when new.isbn is null then 'none' end, case when new.isbn is null then now() end)
  on conflict (book_id) do update set placed_at = excluded.placed_at,
    checked_at = excluded.checked_at, verdict = excluded.verdict,
    judged_at = excluded.judged_at, confirmed_at = null, held_work = null;
  if new.isbn is not null and exists (
      select 1 from public.books o
      where o.edition_id = new.edition_id and o.id <> new.id
        and (o.source <> 'manual' or private.book_is_listed(o.id))) then
    update private.edition_sources s set settled_for = now(),
      tried_for = greatest(s.tried_for, now()),
      found_for = case when s.found_for is not null then now() end,
      title_for = case when s.title_for is not null then now() end
    where s.edition_id = new.edition_id and s.state <> 'withdrawn'
      and s.settled_for is not null;
    update private.edition_sources s set misses = 0, failures = 0,
      next_at = case when s.request_id is null then now() else s.next_at end
    where s.edition_id = new.edition_id and s.state <> 'withdrawn'
      and s.settled_for is null;
  else
    perform private.bib_ask(new.edition_id);
  end if;
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
    title_kept_at = null, found_sent_at = null, title_sent_at = null,
    found_for = null, title_for = null
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

-- As before (works), and not for a held book (its reader answers first).
create or replace function private.keep_apart(book_a uuid, book_b uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a uuid;
  b uuid;
begin
  lock table public.books in share row exclusive mode;
  select x.work_id into a from public.books x where x.id = book_a;
  select x.work_id into b from public.books x where x.id = book_b;
  if a is null or b is null then
    raise exception 'no book has that id' using errcode = 'P0002';
  end if;
  if exists (
      select 1 from private.book_checks c
      where c.book_id in (book_a, book_b) and c.held_work is not null) then
    raise exception 'a held book: its reader answers first, or edits its ISBN';
  end if;
  if a = b then
    raise exception 'the two books are one work; part one out first';
  end if;
  insert into private.works_apart (work_a, work_b)
  values (least(a, b), greatest(a, b))
  on conflict do nothing;
end;
$$;
revoke all on function private.keep_apart(uuid, uuid) from public, anon, authenticated;

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
