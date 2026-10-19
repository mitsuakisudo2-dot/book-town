-- The library's catalog in the database (item 5 of the plan, 図書館から探す;
-- the owner's decisions of 2026-10-19, docs/09「図書館の目録」). The
-- National Diet Library's records of the books with an ISBN are taken in
-- bulk (its OAI-PMH all-records files once, then each day's changes) by
-- GitHub Actions (scripts/catalog-import.mjs), read there with this
-- database's own private.ndl_answer, and only the fields it reads come here:
-- the record itself is not kept. Each book becomes a catalog row of
-- public.books (source 'ndl', no owner, one per ISBN: books_catalog_isbn), as
-- the first migration made room for: everyone may read it, use it on a shelf,
-- a post or a record as it is, and find it in the search. Its edition and
-- work are the ISBN's, as for any book: a reader who registers that ISBN
-- later is in the same edition and work.
--
--   * A catalog row comes in with its edition's answer from the library
--     already kept: private.catalog_take writes the fields into the
--     edition's 'ndl' source as found, now, and judges the row against them
--     as 'same' (its title is the master's own). Neither source is asked
--     about an edition only catalog rows are in: what the library says comes
--     with each day's changes, and openBD is asked when a reader's book
--     comes in (then the cache answers the library's part at once).
--   * A reader's book placed in an edition that has a catalog row is shown
--     its bibliography at once, judged at the next tick (20 seconds) instead
--     of ten minutes after (the wait hid whether someone had registered the
--     ISBN before; the owner let that go, 10-19 11:55Z, and a catalog row is
--     everyone's anyway).
--   * Catalog rows are in the search, not in the town: the town's newest
--     books (newest_book_ids) are the books readers registered, and the
--     operator's candidates for joining works leave out a catalog row alone
--     in its edition. Counts never counted books, only 便り and shelves.
--   * Every row taken is written down (private.catalog_imports: the batch,
--     the library's record) so a batch can be taken out again
--     (private.catalog_drop): the rows nobody uses go, a row a reader uses
--     stays a catalog row. A record the library deletes takes its unused
--     rows with it (private.catalog_gone).
--   * How many rows may come in is capped here (private.catalog_settings,
--     10,000 while the project is on Supabase's free plan; a later migration
--     raises it once the owner has said yes to the paid plan).
--   * When the library has two records for one ISBN (an old and a new
--     edition sharing it), the one kept is chosen the same way whatever the
--     order they come in: finished before in the making, fewer ISBNs (a
--     volume before its set), the later issued, the larger record id.
--   * A book registered by ISBN whose bibliography came from openBD (or from
--     the library before its records were taken) becomes a catalog row the
--     next day (private.catalog_promote, every night): the owner's card of
--     10-19 11:55Z, "出す": registered books, private ones too, are found by
--     their bibliography. Only the bibliography's words come out: not who
--     registered it, what they typed, or how many did.
--   * ISBNs searched for and not found are counted by day, the ISBN alone
--     (public.note_missing_isbn; no person, no other words), for choosing
--     what to take first; kept 90 days.
--   * The search (private.found_book_ids) at millions of rows: an ISBN's
--     first digits by range, each step capped, near titles looked up by
--     their rarest pairs; each slice read by its ids (below). With the same
--     books it answers the same.
--
-- Nothing is moved: no row of any table changes. New tables, functions and
-- a nightly job; the functions below are made again with what they gain.
--
-- Rollback: a new migration with
--   select cron.unschedule('catalog-nightly');
--   select private.catalog_drop(batch) from (select distinct batch from private.catalog_imports) b;
--   drop function public.note_missing_isbn(text);
--   drop function private.catalog_take(jsonb, text), private.catalog_gone(text[]),
--     private.catalog_drop(text), private.catalog_promote(integer),
--     private.catalog_nightly(), private.catalog_used(uuid), private.catalog_words(jsonb),
--     private.catalog_better(text, smallint, text, text, text, smallint, text, text);
--   drop table private.catalog_imports, private.catalog_progress,
--     private.catalog_settings, private.missing_isbns;
--   drop index public.books_registered_newest, public.books_isbn_bytes;
-- and then makes private.book_checked() and private.edition_asked() again as
-- 20261119000000_bibliography_fetching.sql and 20261101000000_bibliography.sql
-- have them, public.book_bibliography(uuid[]) and private.work_candidates()
-- as 20261102000000_bibliography_holds.sql has them, and
-- private.newest_book_ids(integer) and private.found_book_ids(jsonb, text,
-- text, integer) as 20261122000000_seen_in_one_question.sql has them, each
-- with its revoke and grants. The catalog rows a reader uses
-- stay (catalog_drop keeps them). pnpm test:db runs exactly that.

select set_config('lock_timeout', '10s', true);

-- What was taken ------------------------------------------------------------------

create table private.catalog_imports (
  book_id uuid primary key references public.books (id) on delete cascade,
  -- Which taking it came with: 'files-20261003', 'oai', 'trial', 'registered'.
  batch text not null check (batch ~ '^[a-z0-9-]{1,40}$'),
  -- The library's record (its OAI identifier's last part, R100000002-I…),
  -- null for a row made from a registered book's bibliography.
  record text check (char_length(record) <= 64),
  -- What chooses between two records of one ISBN (catalog_better).
  status text check (char_length(status) <= 8),
  isbns smallint,
  issued text check (char_length(issued) <= 7),
  taken_at timestamptz not null default now(),
  changed_at timestamptz not null default now()
);
create index catalog_imports_batch on private.catalog_imports (batch);
create index catalog_imports_record on private.catalog_imports (record) where record is not null;
alter table private.catalog_imports enable row level security;
revoke all on private.catalog_imports from public, anon, authenticated;

-- How far each way of taking has come: a file's place in the month's list, a
-- day of the changes. No ISBN or title.
create table private.catalog_progress (
  name text primary key check (name ~ '^[a-z0-9-]{1,60}$'),
  mark text not null check (char_length(mark) <= 200),
  updated_at timestamptz not null default now()
);
alter table private.catalog_progress enable row level security;
revoke all on private.catalog_progress from public, anon, authenticated;

create table private.catalog_settings (
  one boolean primary key default true check (one),
  -- At most this many catalog rows (the free plan's 500MB: 10,000).
  most integer not null check (most >= 0),
  taken integer not null default 0 check (taken >= 0)
);
insert into private.catalog_settings (most) values (10000);
alter table private.catalog_settings enable row level security;
revoke all on private.catalog_settings from public, anon, authenticated;

-- ISBNs searched for and not found, counted by day.
create table private.missing_isbns (
  isbn text not null check (public.isbn13_valid(isbn)),
  day date not null default current_date,
  times integer not null default 1 check (times > 0),
  primary key (isbn, day)
);
create index missing_isbns_day on private.missing_isbns (day);
alter table private.missing_isbns enable row level security;
revoke all on private.missing_isbns from public, anon, authenticated;

-- The town's newest books are the readers' (newest_book_ids, below).
create index books_registered_newest on public.books (created_at desc, id desc)
  where source = 'manual';

-- A catalog row's words --------------------------------------------------------------

-- What a catalog row holds, from the master's fields: the title with its
-- volume (so 「進撃の巨人 1」 is found as one), the people as books print
-- them, joined by 「、」, and the publisher, each cut to what a book holds.
create function private.catalog_words(fields jsonb,
  out title text, out author text, out publisher text)
language sql immutable set search_path = '' as $$
  select left(private.bib_text(concat_ws(' ', fields ->> 'title',
      case when coalesce(fields ->> 'volume', '') <> ''
        and position(fields ->> 'volume' in fields ->> 'title') = 0
        then fields ->> 'volume' end)), 200),
    left(coalesce((
      select string_agg(c ->> 'name', '、' order by n)
      from jsonb_array_elements(case when jsonb_typeof(fields -> 'creators') = 'array'
        then fields -> 'creators' else '[]' end) with ordinality x (c, n)
      where coalesce(c ->> 'name', '') <> ''), ''), 200),
    left(coalesce(fields ->> 'publisher', ''), 200)
$$;
revoke all on function private.catalog_words(jsonb) from public, anon, authenticated;

-- Whether record a is to be kept over record b for one ISBN.
create function private.catalog_better(a_status text, a_isbns smallint, a_issued text,
  a_record text, b_status text, b_isbns smallint, b_issued text, b_record text)
returns boolean
language sql immutable set search_path = '' as $$
  select (a_status is distinct from 'C3', -coalesce(a_isbns, 1), coalesce(a_issued, ''),
      coalesce(a_record, ''))
    >= (b_status is distinct from 'C3', -coalesce(b_isbns, 1), coalesce(b_issued, ''),
      coalesce(b_record, ''))
$$;
revoke all on function private.catalog_better(text, smallint, text, text, text, smallint, text, text)
  from public, anon, authenticated;

-- Whether any reader's row names the book: a row of a public table with a
-- foreign key to it, or a shop's shelves or scene.
create function private.catalog_used(b uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  link record;
  hit boolean;
begin
  for link in
    select c.conrelid::regclass as tab, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and c.confrelid = 'public.books'::regclass
      and n.nspname = 'public' and cardinality(c.conkey) = 1
  loop
    execute format('select exists (select 1 from %s where %I = $1)', link.tab, link.col)
      into hit using b;
    if hit then
      return true;
    end if;
  end loop;
  return exists (
      select 1 from public.shops s
      where s.public_scene_books @> jsonb_build_array(b::text)
        or s.public_shelves @> jsonb_build_array(jsonb_build_object(
          'items', jsonb_build_array(jsonb_build_object('bookId', b::text)))))
    or exists (
      select 1 from public.shop_private p
      where p.scene_books @> jsonb_build_array(b::text)
        or p.shelves @> jsonb_build_array(jsonb_build_object(
          'items', jsonb_build_array(jsonb_build_object('bookId', b::text)))));
end;
$$;
revoke all on function private.catalog_used(uuid) from public, anon, authenticated;

-- Taking -------------------------------------------------------------------------------

-- Rows of what the library said, one per ISBN, as the importer read them with
-- private.ndl_answer:
--   [{"isbn": "978…", "record": "R100000002-I…", "status": "C7",
--     "isbns": 1, "fields": {...}}]
-- Each ISBN not in the catalog yet gets its catalog row (while fewer than
-- the cap are); one that is, gets the fields when its record is the one to
-- keep. Answers how many came in, changed, were left (an older record) and
-- were refused for the cap. Called by the importer only (as postgres).
create function private.catalog_take(given jsonb, batch text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  w record;
  had record;
  book uuid;
  ed uuid;
  room integer;
  added integer := 0;
  changed integer := 0;
  kept integer := 0;
  refused integer := 0;
  wrong integer := 0;
begin
  if batch is null or batch !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'catalog_take: a batch is a short name';
  end if;
  select s.most - s.taken into room from private.catalog_settings s for update;
  perform set_config('private.importing', 'on', true);
  for r in
    select private.isbn13(x ->> 'isbn') as isbn, x ->> 'record' as record,
      nullif(x ->> 'status', '') as status,
      least(greatest(coalesce((x ->> 'isbns')::int, 1), 1), 1000)::smallint as isbns,
      x -> 'fields' as fields
    from jsonb_array_elements(case when jsonb_typeof(given) = 'array' then given else '[]' end) x
    order by 1
  loop
    if r.isbn is null or jsonb_typeof(r.fields) is distinct from 'object'
        or coalesce(r.fields ->> 'title', '') = '' or char_length(r.record) > 64
        or char_length(r.status) > 8 then
      wrong := wrong + 1;
      continue;
    end if;
    select * into w from private.catalog_words(r.fields);
    select b.id, b.edition_id, i.record, i.status, i.isbns, i.issued, (i.book_id is not null) as ours
    into had
    from public.books b
    left join private.catalog_imports i on i.book_id = b.id
    where b.isbn = r.isbn and b.source = 'ndl';
    if had.id is null then
      if room <= 0 then
        refused := refused + 1;
        continue;
      end if;
      insert into public.books (isbn, title, author, publisher, source, created_by)
      values (r.isbn, w.title, w.author, w.publisher, 'ndl', null)
      returning id, edition_id into book, ed;
      insert into private.catalog_imports (book_id, batch, record, status, isbns, issued)
      values (book, catalog_take.batch, r.record, r.status, r.isbns,
        left(r.fields ->> 'issued', 7));
      room := room - 1;
      added := added + 1;
    elsif had.ours and (not private.catalog_better(r.status, r.isbns,
          left(r.fields ->> 'issued', 7), r.record,
          had.status, had.isbns, had.issued, had.record)
        or (had.record is not distinct from r.record and exists (
          select 1 from private.edition_sources s
          where s.edition_id = had.edition_id and s.source = 'ndl' and s.state = 'found'
            and s.fields = r.fields and s.status is not distinct from r.status))) then
      -- An older record of the ISBN, or the same one saying the same.
      kept := kept + 1;
      continue;
    else
      book := had.id;
      ed := had.edition_id;
      update public.books b set title = w.title, author = w.author, publisher = w.publisher
      where b.id = book
        and (b.title, b.author, b.publisher) is distinct from (w.title, w.author, w.publisher);
      insert into private.catalog_imports as i (book_id, batch, record, status, isbns, issued)
      values (book, catalog_take.batch, r.record, r.status, r.isbns,
        left(r.fields ->> 'issued', 7))
      on conflict (book_id) do update set record = excluded.record, status = excluded.status,
        isbns = excluded.isbns, issued = excluded.issued, changed_at = now();
      changed := changed + 1;
    end if;
    -- The library's answer, kept as found now. An edition only catalog rows
    -- are in is not asked again (the day's changes keep it); one with a
    -- reader's book is asked as before by need, the library's part kept
    -- fresh the same way.
    update private.edition_sources s set
      state = 'found', record = null, record_id = r.record, status = r.status,
      fields = r.fields, answered_at = now(), found_at = now(), found_sent_at = now(),
      title_sent_at = now(), found_for = now(), title_for = now(),
      settled_for = now(), tried_for = greatest(s.tried_for, now()), settled_at = now(),
      misses = 0, failures = 0, lost = 0, lost_at = null, title_kept_at = null,
      owed = false, next_at = 'infinity'
    where s.edition_id = ed and s.source = 'ndl' and s.state <> 'withdrawn'
      and s.request_id is null;
    -- The row is the master's own words.
    update private.book_checks c set placed_at = least(c.placed_at, now() - interval '10 minutes'),
      checked_at = now(), verdict = 'same', judged_at = now(), confirmed_at = null, held_work = null
    where c.book_id = book;
    delete from private.book_rechecks k where k.book_id = book;
  end loop;
  update private.catalog_settings s set taken = s.taken + added;
  perform set_config('private.importing', '', true);
  return jsonb_build_object('added', added, 'changed', changed, 'kept', kept,
    'refused', refused, 'wrong', wrong);
end;
$$;
revoke all on function private.catalog_take(jsonb, text) from public, anon, authenticated;

-- Takes out the catalog rows of a batch that no reader uses. Answers how
-- many went.
create function private.catalog_drop(batch text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b uuid;
  gone integer := 0;
begin
  for b in
    select i.book_id from private.catalog_imports i where i.batch = catalog_drop.batch
  loop
    continue when private.catalog_used(b);
    delete from public.books x where x.id = b and x.source = 'ndl';
    gone := gone + 1;
  end loop;
  update private.catalog_settings s set taken = (select count(*) from private.catalog_imports);
  return gone;
end;
$$;
revoke all on function private.catalog_drop(text) from public, anon, authenticated;

-- Records the library deleted (OAI-PMH says so with the record's
-- identifier): their catalog rows nobody uses go. Answers how many went.
create function private.catalog_gone(records text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b uuid;
  gone integer := 0;
begin
  for b in
    select i.book_id from private.catalog_imports i where i.record = any (records)
  loop
    continue when private.catalog_used(b);
    delete from public.books x where x.id = b and x.source = 'ndl';
    gone := gone + 1;
  end loop;
  update private.catalog_settings s set taken = (select count(*) from private.catalog_imports);
  return gone;
end;
$$;
revoke all on function private.catalog_gone(text[]) from public, anon, authenticated;

-- A registered book's ISBN whose bibliography has a title, with no catalog
-- row yet, gets one made from the bibliography (all answers the edition has),
-- once its books have been there a day: up to `most` a night.
create function private.catalog_promote(most integer default 2000) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  e record;
  m record;
  w record;
  book uuid;
  room integer;
  made integer := 0;
begin
  select s.most - s.taken into room from private.catalog_settings s for update;
  perform set_config('private.importing', 'on', true);
  for e in
    select d.id, d.isbn from public.editions d
    where d.isbn is not null
      and not exists (select 1 from public.books c where c.isbn = d.isbn and c.source = 'ndl')
      and exists (
        select 1 from private.edition_sources s
        where s.edition_id = d.id and s.state = 'found' and s.fields ? 'title')
      and exists (select 1 from public.books b where b.edition_id = d.id)
      and not exists (
        select 1 from public.books b
        join private.book_checks c on c.book_id = b.id
        where b.edition_id = d.id and c.placed_at > now() - interval '1 day')
    order by d.id
    limit least(greatest(coalesce(catalog_promote.most, 0), 0), 20000)
  loop
    exit when room <= 0;
    select * into m from private.edition_bibliography(e.id);
    continue when m.title is null;
    select * into w from private.catalog_words(jsonb_strip_nulls(jsonb_build_object(
      'title', m.title, 'volume', m.volume, 'creators', m.creators, 'publisher', m.publisher)));
    insert into public.books (isbn, title, author, publisher, source, created_by)
    values (e.isbn, w.title, w.author, w.publisher, 'ndl', null)
    returning id into book;
    insert into private.catalog_imports (book_id, batch, issued)
    values (book, 'registered', left(m.issued, 7));
    -- It shows the bibliography the edition has, as its own words.
    update private.book_checks c set placed_at = '-infinity', checked_at = now(),
      verdict = 'same', judged_at = now()
    where c.book_id = book;
    room := room - 1;
    made := made + 1;
  end loop;
  update private.catalog_settings s set taken = s.taken + made;
  perform set_config('private.importing', '', true);
  return made;
end;
$$;
revoke all on function private.catalog_promote(integer) from public, anon, authenticated;

create function private.catalog_nightly() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.catalog_promote();
  delete from private.missing_isbns m where m.day < current_date - 90;
end;
$$;
revoke all on function private.catalog_nightly() from public, anon, authenticated;
select cron.schedule('catalog-nightly', '13 19 * * *', 'select private.catalog_nightly()');

-- An ISBN searched for and not found. Counted by day; at most 5,000 ISBNs a
-- day are written down, so a flood of made-up ISBNs fills nothing.
create function public.note_missing_isbn(isbn text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  key text := private.isbn13(note_missing_isbn.isbn);
begin
  if key is null or exists (select 1 from public.books b where b.isbn = key and b.source = 'ndl') then
    return;
  end if;
  update private.missing_isbns m set times = least(m.times + 1, 1000000)
  where m.isbn = key and m.day = current_date;
  if found or (select count(*) from private.missing_isbns m where m.day = current_date) >= 5000 then
    return;
  end if;
  insert into private.missing_isbns (isbn) values (key) on conflict do nothing;
end;
$$;
revoke all on function public.note_missing_isbn(text) from public, anon, authenticated;
grant execute on function public.note_missing_isbn(text) to anon, authenticated;

-- What changes for the rest -------------------------------------------------------------

-- As before (bibliography), but an edition a catalog row brings is not asked
-- about: catalog_take keeps its library's answer, and openBD is asked when a
-- reader's book comes (book_checked).
create or replace function private.edition_asked() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  at timestamptz := case when current_setting('private.importing', true) = 'on'
    then 'infinity' else now() end;
begin
  if new.isbn is not null then
    insert into private.edition_sources (edition_id, source, next_at)
    values (new.id, 'ndl', at), (new.id, 'openbd', at)
    on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function private.edition_asked() from public, anon, authenticated;

-- As before (fetching), and: a catalog row taken in is placed without
-- asking (catalog_take keeps its answer and judges it); a book coming into
-- an edition with a catalog row is placed ten minutes back, so it is judged
-- at the next tick and shows its bibliography at once. The wait hides
-- whether someone had registered the ISBN before; a catalog row is for
-- anyone to find, so there is nothing to hide. A book the cache answers
-- for a book in a public place alone waits as before.
create or replace function private.book_checked() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  cached boolean;
  catalogued boolean;
  placed timestamptz := now();
begin
  if current_setting('private.importing', true) = 'on' and new.source = 'ndl'
      and new.created_by is null then
    insert into private.book_checks (book_id, placed_at)
    values (new.id, now() - interval '10 minutes')
    on conflict (book_id) do nothing;
    return null;
  end if;
  cached := new.isbn is not null and exists (
    select 1 from public.books o
    where o.edition_id = new.edition_id and o.id <> new.id
      and (o.source <> 'manual' or private.book_is_listed(o.id)));
  catalogued := cached and exists (
    select 1 from public.books o
    where o.edition_id = new.edition_id and o.id <> new.id and o.source <> 'manual');
  if new.isbn is not null and not cached and new.created_by is not null
      and current_setting('private.copying', true) is distinct from 'on' then
    insert into private.bib_pace as p (reader, next_at)
    values (new.created_by, now() + interval '20 seconds')
    on conflict (reader) do update set next_at = greatest(p.next_at, now()) + interval '20 seconds'
    returning greatest(now(), p.next_at - interval '200 seconds') into placed;
  end if;
  if catalogued then
    placed := now() - interval '10 minutes';
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

-- As before (holds), and a catalog row's bibliography is everyone's.
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
    and case when b.source = 'ndl' then true
      else b.created_by = (select auth.uid())
        or private.book_is_listed(b.id)
        or private.book_is_mine(b.id) end
$$;
revoke all on function public.book_bibliography(uuid[]) from public, anon, authenticated;
grant execute on function public.book_bibliography(uuid[]) to anon, authenticated;

-- As in 20261122000000_seen_in_one_question.sql, over the books readers
-- registered: the library's catalog is not the town's.
create or replace function private.newest_book_ids(wanted integer)
returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  most integer := least(greatest(coalesce(wanted, 0), 0), 1000);
  size integer := 500;
  last_at timestamptz := 'infinity';
  last_id uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  slice uuid[];
  ordered uuid[];
  kept uuid[] := '{}';
begin
  while cardinality(kept) < most loop
    -- The next books, newest first, after the last slice's oldest.
    slice := array(
      select b.id from public.books b
      where b.source = 'manual'
        and b.created_at <= last_at
        and (b.created_at < last_at or b.id < last_id)
      order by b.created_at desc, b.id desc
      limit size
    );
    exit when cardinality(slice) = 0;
    select b.created_at, b.id into last_at, last_id
    from public.books b where b.id = slice[cardinality(slice)];
    ordered := array(
      select c.id from private.search_candidates(slice) c
      join public.books b on b.id = c.id
      order by b.created_at desc, b.id desc
    );
    select k.kept into kept
    from private.keep_seen_books(ordered, most, kept, null) k;
    exit when cardinality(slice) < size;
    size := least(size * 2, 8000);
  end loop;
  return kept;
end;
$$;
revoke all on function private.newest_book_ids(integer) from public, anon, authenticated;
grant execute on function private.newest_book_ids(integer) to anon, authenticated;

-- As before (holds), leaving out a catalog row alone in its edition.
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
    -- A catalog row alone in its edition is the library's, not the town's.
    where case when b.source <> 'manual' then exists (
        select 1 from public.books o where o.edition_id = b.edition_id and o.id <> b.id)
      else private.book_is_listed(b.id) end
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

-- The search at the catalog's size -------------------------------------------------

-- An ISBN's first digits are looked up by range, on an index in byte order
-- (the database's collation does not order digits for LIKE).
create index books_isbn_bytes on public.books ((isbn collate "C")) where isbn is not null;

-- As in 20261122000000_seen_in_one_question.sql, with what millions of
-- catalog rows need:
-- * An ISBN or its first digits: the reader's own books, then at most 1,000
--   books in ISBN order (an ISBN's whole number: its books best first).
-- * The books holding every pair of a form: the reader's own, then at most
--   2,000 more, those with the fewest pairs first (the shortest titles, the
--   nearest to what was typed).
-- * Near titles: a book holding `need` of a form's pairs holds at least one
--   of any (pairs - need + 1) of them, so only the rarest of those are looked
--   up (by the planner's statistics); the reader's own and at most 2,000
--   more are weighed and go on, nearest first.
-- * Sequential scans are off: each question's pairs come as parameters, and
--   a plan made for any pairs would read the whole table to stop early.
-- * Every slice is read by its ids, in the order found, and what the reader
--   may see of it is asked a chunk at a time (keep_seen_books).
create or replace function private.found_book_ids(
  forms jsonb,
  whole_isbn text,
  isbn_start text,
  wanted integer
) returns uuid[]
language plpgsql stable security definer set search_path = '' set enable_seqscan = off as $$
declare
  me uuid := (select auth.uid());
  most integer := least(greatest(coalesce(wanted, 0), 0), 200);
  asked jsonb := case when jsonb_typeof(forms) = 'array' then forms else '[]'::jsonb end;
  form jsonb;
  form_grams text[];
  form_need integer;
  forms_seen integer := 0;
  pair_text text[] := '{}';
  pair_form integer[] := '{}';
  form_size integer[] := '{}';
  form_needs integer[] := '{}';
  all_grams text[] := '{}';
  probe text[] := '{}';
  common text[];
  common_share real[];
  found uuid[] := '{}';
  near uuid[];
  by_isbn boolean := false;
  low text;
  slice integer;
  size integer;
  kept uuid[] := '{}';
  editions uuid[] := '{}';
  ordered uuid[];
begin
  if most = 0 then
    return kept;
  end if;

  if whole_isbn is not null and whole_isbn ~ '^[0-9]{12}[0-9X]$' then
    found := array(
      select b.id from public.books b where b.isbn = whole_isbn
      order by (b.created_by = me) desc nulls last, (b.source <> 'manual') desc,
        b.created_at, b.id
      limit 1000);
    by_isbn := true;
  else
    if isbn_start is not null and isbn_start ~ '^[0-9]{5,12}$' then
      if me is not null then
        found := array(
          select b.id from public.books b
          where b.created_by = me
            and (b.isbn like isbn_start || '%'
              or (char_length(isbn_start) <= 9 and b.isbn like '978' || isbn_start || '%')));
      end if;
      foreach low in array case when char_length(isbn_start) <= 9
          then array[isbn_start, '978' || isbn_start] else array[isbn_start] end loop
        found := found || array(
          select b.id from public.books b
          where b.isbn is not null
            and (b.isbn collate "C") >= low and (b.isbn collate "C") < low || ':'
          order by (b.isbn collate "C"), b.id
          limit 1000);
      end loop;
      by_isbn := true;
    end if;
    select coalesce(s.most_common_elems::text::text[], '{}'),
      coalesce(s.most_common_elem_freqs, '{}')
    into common, common_share
    from pg_catalog.pg_stats s
    where s.schemaname = 'private' and s.tablename = 'book_grams' and s.attname = 'grams';
    -- The books holding every pair of a form, form by form.
    for form in select f from jsonb_array_elements(asked) f limit 20 loop
      form_grams := array(
        select distinct g from jsonb_array_elements_text(
          case when jsonb_typeof(form -> 'grams') = 'array' then form -> 'grams' else '[]'::jsonb end
        ) g limit 200
      );
      continue when cardinality(form_grams) = 0;
      form_need := least(greatest(coalesce((form ->> 'need')::integer, 1), 1),
        cardinality(form_grams));
      all_grams := all_grams || form_grams;
      forms_seen := forms_seen + 1;
      pair_text := pair_text || form_grams;
      pair_form := pair_form || array_fill(forms_seen, array[cardinality(form_grams)]);
      form_size := form_size || cardinality(form_grams);
      form_needs := form_needs || form_need;
      probe := probe || array(
        select g from unnest(form_grams) g
        order by coalesce(common_share[array_position(common, g)], 0), g
        limit cardinality(form_grams) - form_need + 1);
      if me is not null then
        found := found || array(
          select b.id from public.books b
          join private.book_grams g on g.book_id = b.id
          where b.created_by = me and g.grams @> form_grams);
      end if;
      found := found || array(
        select g.book_id from private.book_grams g
        where g.grams @> form_grams
        order by cardinality(g.grams), g.book_id
        limit 2000
      );
    end loop;
  end if;

  -- The books found by their pairs alone each hold all of a form's, so they
  -- come in the order of the rest of the keys, which no other book changes:
  -- they are taken a slice at a time in that order (each slice twice the
  -- one before), until enough are kept.
  if not by_isbn then
    found := array(
      select b.id from public.books b
      where b.id = any(found)
      order by (b.created_by = me) desc nulls last, (b.source <> 'manual') desc,
        b.created_at, b.id
    );
    slice := 1;
    size := 500;
    while slice <= cardinality(found) and cardinality(kept) < most loop
      ordered := array(
        select b.id
        from private.search_candidates(found[slice:slice + size - 1]) c
        join lateral (select x.id, x.created_by, x.source, x.created_at
                      from public.books x where x.id = c.id) b on true
        order by (b.created_by = me) desc nulls last, (b.source <> 'manual') desc,
          b.created_at, b.id
      );
      select k.kept, k.editions into kept, editions
      from private.keep_seen_books(ordered, most, kept, editions) k;
      slice := slice + size;
      size := size * 2;
    end loop;
  end if;

  -- Found by ISBN too: all of them, best first.
  if by_isbn then
    ordered := array(
      select b.id
      from private.search_candidates(found) c
      join lateral (select x.id, x.edition_id, x.created_by, x.source, x.created_at
                    from public.books x where x.id = c.id) b on true
      left join lateral (select y.grams from private.book_grams y where y.book_id = c.id) g
        on true
      order by
        -- Most of a form's pairs held first; the reader's own, then a book
        -- from a catalog, then the oldest, among equals.
        coalesce((
          select max(
            cardinality(array(
              select unnest(g.grams)
              intersect
              select jsonb_array_elements_text(f -> 'grams')
            ))::numeric
            / greatest(jsonb_array_length(f -> 'grams'), 1)
          )
          from jsonb_array_elements(asked) f
          where jsonb_typeof(f -> 'grams') = 'array'
        ), 1) desc,
        (b.created_by = me) desc nulls last,
        (b.source <> 'manual') desc,
        b.created_at,
        b.id
    );
    select k.kept, k.editions into kept, editions
    from private.keep_seen_books(ordered, most, kept, editions) k;
  end if;

  -- Then, if fewer than asked were kept, the books sharing enough pairs with
  -- a form (near titles): the reader's own and at most 2,000 more holding a
  -- probe pair are weighed, and go on in order of the share of a form's
  -- pairs they hold.
  if cardinality(kept) < most and forms_seen > 0 then
    near := array(
      select w.book_id
      from (
        (select n.book_id, n.grams from private.book_grams n
         join public.books o on o.id = n.book_id
         where me is not null and o.created_by = me
           and n.grams && probe and not (n.book_id = any(found)))
        union all
        (select n.book_id, n.grams from private.book_grams n
         where n.grams && probe and not (n.book_id = any(found))
         limit 2000)
      ) w
      cross join lateral (
        select max(h.held::numeric / form_size[h.n]) as share
        from (
          select p.n, count(*) as held
          from unnest(w.grams) held_pair
          join unnest(pair_text, pair_form) p (pair, n) on p.pair = held_pair
          group by p.n
        ) h
        where h.held >= form_needs[h.n]
      ) s
      join public.books b on b.id = w.book_id
      where s.share is not null
      -- The reader's own, then a book from a catalog, then the oldest, among
      -- equals.
      order by s.share desc, (b.created_by = me) desc nulls last,
        (b.source <> 'manual') desc, b.created_at, b.id);
    ordered := array(
      select u.id
      from private.search_candidates(near) c
      join unnest(near) with ordinality u (id, place) on u.id = c.id
      order by u.place
    );
    select k.kept, k.editions into kept, editions
    from private.keep_seen_books(ordered, most, kept, editions) k;
  end if;
  return kept;
end;
$$;
revoke all on function private.found_book_ids(jsonb, text, text, integer)
  from public, anon, authenticated;
grant execute on function private.found_book_ids(jsonb, text, text, integer)
  to anon, authenticated;
