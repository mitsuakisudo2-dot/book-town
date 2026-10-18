-- Every reader's rows name a book of their own (AUD-001 and AUD-078 of the
-- 2026-10-17 audit; the owner's answer, 2026-10-18 00:28Z: what a reader
-- registered is kept apart from the bibliography everyone shares, so that one
-- reader's edit never reaches another, while the operator's corrections of
-- the bibliography are shared, as they are now through the master).
--
-- Until now a row of books was shared by every reader whose rows named it. A
-- reader registering an ISBN that someone had registered was given that row,
-- and a reader marking, shelving or writing about a book they were shown named
-- the row of whoever typed it in. When its typist edited the title, the author
-- or the ISBN, every other reader's book changed with it, and so it did when
-- the book was held and when its typist answered. The 見本's books were rows
-- made by the first reader who kept one of them, theirs to edit for everyone.
--
-- From here on a book typed in is one reader's: their rows name it, and other
-- readers' rows name copies of their own. A reader whose rows name a book
-- someone else typed in (or nobody now, its typist gone) is given a copy of it
-- (private.give_own_copy): the same columns but its id and whose it is, in the
-- same edition and so the same work (a book without an ISBN, in the edition of
-- the book it was copied from), judged against the master as their own
-- registration, from when that book was placed. Every row of theirs naming
-- the book then names the copy, and the copy is written down
-- (private.book_copies). This is done to what there is now, once, below, and
-- from now on before a book's typist edits it (books_own_copies) and when it
-- is held (work_changes_held): each other reader whose rows name it is given
-- their copy first, as the book was. A reader given a copy of a held book is
-- told of it as of their own. Catalog rows ('ndl') and the 見本's books stay
-- everyone's. The 見本's books are rows made here, with nobody's name
-- (private.is_sample_book), the same row for every reader as before and
-- nobody's to edit; a 見本's book added later needs a migration.
--
-- What does not change: who reads what, and what anyone is shown. A copy is
-- read where it is used, as its book was, and has the same columns, created_at
-- and updated_at included; the rows moved to it keep their own times
-- (touch_updated_at leaves them while a copy is made). The app goes on as it
-- is, reading each reader's books from their rows. Making every registration
-- a row of its reader's own, and gathering a book's readers by its work, are
-- the app's next step.
--
-- Rollback: the copies are their readers' registrations and stay; who made
-- the 見本's rows is not put back. A new migration undoes the rest with
--   drop trigger books_own_copies on public.books;
--   drop trigger work_changes_held on private.work_changes;
--   drop function private.copies_before_edit(), private.copies_before_hold(),
--     private.split_others(uuid, text), private.give_own_copy(uuid, uuid, text),
--     private.book_users(uuid), private.swap_book(jsonb, text, text),
--     private.is_sample_book(uuid);
--   drop table private.book_copies;
--   drop index public.library_entries_book, public.book_marks_book,
--     public.book_encounters_book_id, public.reading_entries_book,
--     public.shop_private_shelves, public.shop_private_scene_books;

-- and then makes public.touch_updated_at() again as
-- 20261012000000_initial_schema.sql has it, with create or replace. pnpm
-- test:db runs exactly that. Should the move itself need undoing (readers'
-- rows naming the books they named before), before the rollback, while no
-- reader has written to the copies since:
--   select * from private.restore_copy('20261105000000_own_book_rows', array[
--     'public.library_entries', 'public.library_shelf_books', 'public.book_marks',
--     'public.book_encounters', 'public.posts', 'public.reading_entries',
--     'public.reading_sessions', 'public.profile_nine', 'public.posters',
--     'public.poster_books', 'public.shop_private', 'public.shops']::regclass[]);
--   delete from public.library_shelf_books s using private.book_copies c
--   where s.book_id = c.book_id and c.reason = 'moved';
--   delete from public.library_entries l using private.book_copies c
--   where l.book_id = c.book_id and c.reason = 'moved';
--   delete from public.book_marks m using private.book_copies c
--   where m.book_id = c.book_id and c.reason = 'moved';
--   delete from public.books b using private.book_copies c
--   where b.id = c.book_id and c.reason = 'moved';
-- docs/09「自分の本の行」has the steps.

-- Nobody writes a book or a reader's row naming one until this file is done;
-- reading goes on. keep_copy holds the tables it copies in the order given:
-- each before the ones a write to it goes on to (a mark to its library row, a
-- shelf's book to that row, an encounter to its post, a poster to its list of
-- books, a shop's private part to its public copy, and every one of them to
-- the book it names), so a reader's write already under way finishes first
-- and the two never wait on each other. Books come last of them, and then
-- the tables a registration goes on to from its book, in its order.
select set_config('lock_timeout', '10s', true);
select private.keep_copy('20261105000000_own_book_rows', array[
  'public.book_marks', 'public.library_shelf_books', 'public.library_entries',
  'public.book_encounters', 'public.posts', 'public.reading_entries',
  'public.reading_sessions', 'public.profile_nine', 'public.posters',
  'public.poster_books', 'public.shop_private', 'public.shops', 'public.books'
]::regclass[]);
do $$
begin
  lock table public.works in share row exclusive mode;
  lock table public.editions in share row exclusive mode;
  lock table private.edition_sources in share row exclusive mode;
  lock table private.book_checks in share row exclusive mode;
  lock table private.work_changes in share row exclusive mode;
end;
$$;

-- Times --------------------------------------------------------------------------

-- A row moved to a reader's copy of a book has not changed for them: while a
-- copy is made (private.copying, set by give_own_copy for itself only), a
-- row's updated_at stays.
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('private.copying', true) = 'on' then
    new.updated_at := old.updated_at;
    return new;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- The 見本's books ---------------------------------------------------------------

-- The rows the app names the 見本's books by: sampleBookRowId (src/lib/samples.ts)
-- of each book of src/lib/data.ts. Everyone's, like a catalog row: nobody
-- gets a copy of one.
create function private.is_sample_book(b uuid) returns boolean
language sql immutable set search_path = '' as $$
  select b = any ('{
    b36e28bd-a2d0-461a-896a-b7e4e8d49943, b007fdc0-45e4-4ca7-8061-d6690582770e,
    e5fca121-85d5-43c3-8b2d-e04f7b04b2ad, 21c7ab23-acc9-421e-866a-8de4fb64e4d9,
    117e8206-84e3-425c-85d4-9dfcb0496da6, 96602a60-381a-487e-8556-6db62b2c1fa8,
    3ee8d0cd-6e4c-4028-8f48-587e9fecc89b, 49993128-eef0-4677-82f6-2f88a59fc8d7,
    590e7de4-044b-4f36-88be-18b115fb1a63, 0b36c225-0f2b-47eb-8803-4dd56c1e081b,
    08bc967f-5750-43a9-8e51-3139c1bd24ef, b8b49c95-ed0e-45cb-8dcd-e1f9b877b8a7,
    40a09bf2-1faa-450f-8f20-3c57802a52aa, 48115895-9dbc-4c98-8c9d-69bd59305db0,
    d1a68e36-33f6-4058-82d2-5a444082542a, e8295d40-c116-471d-8033-250e290cff53,
    3a22d18a-d217-4788-88b0-0a626085ec60, 30f10b4f-1c20-48b7-87ff-04313b2e37c9,
    5afea479-17f5-4684-8f46-53ded24d2123, 20431da2-af05-4903-8567-a4c02a218061,
    ecd4c13c-b988-4846-8077-1e3a852ba740, 95559836-e68d-465c-861b-45d1c5c3ebbb,
    4a72eed4-7258-4c4b-88ea-90dbc0c0e244, 5ae59e33-c80d-4946-8c12-54c83efa63bd
  }'::uuid[])
$$;
revoke all on function private.is_sample_book(uuid) from public, anon, authenticated;

-- Each of them, as the app writes it (withSampleRows in src/lib/town-remote.ts:
-- its title and author, nothing else), with nobody's name. The ones a reader
-- made before lose theirs and anything edited since.
insert into public.books (id, title, author, source, created_by) values
  ('b36e28bd-a2d0-461a-896a-b7e4e8d49943', 'ソラリス', 'スタニスワフ・レム', 'manual', null),
  ('b007fdc0-45e4-4ca7-8061-d6690582770e', '闇の左手', 'アーシュラ・K・ル＝グウィン', 'manual', null),
  ('e5fca121-85d5-43c3-8b2d-e04f7b04b2ad', '所有せざる人々', 'アーシュラ・K・ル＝グウィン', 'manual', null),
  ('21c7ab23-acc9-421e-866a-8de4fb64e4d9', '華氏451度', 'レイ・ブラッドベリ', 'manual', null),
  ('117e8206-84e3-425c-85d4-9dfcb0496da6', 'モモ', 'ミヒャエル・エンデ', 'manual', null),
  ('96602a60-381a-487e-8556-6db62b2c1fa8', '見えない都市', 'イタロ・カルヴィーノ', 'manual', null),
  ('3ee8d0cd-6e4c-4028-8f48-587e9fecc89b', '伝奇集', 'ホルヘ・ルイス・ボルヘス', 'manual', null),
  ('49993128-eef0-4677-82f6-2f88a59fc8d7', '散歩', 'ローベルト・ヴァルザー', 'manual', null),
  ('590e7de4-044b-4f36-88be-18b115fb1a63', '不安の書', 'フェルナンド・ペソア', 'manual', null),
  ('0b36c225-0f2b-47eb-8803-4dd56c1e081b', '百年の孤独', 'ガブリエル・ガルシア＝マルケス', 'manual', null),
  ('08bc967f-5750-43a9-8e51-3139c1bd24ef', '心は孤独な狩人', 'カーソン・マッカラーズ', 'manual', null),
  ('b8b49c95-ed0e-45cb-8dcd-e1f9b877b8a7', '老人と海', 'アーネスト・ヘミングウェイ', 'manual', null),
  ('40a09bf2-1faa-450f-8f20-3c57802a52aa', '夜と霧', 'ヴィクトール・E・フランクル', 'manual', null),
  ('48115895-9dbc-4c98-8c9d-69bd59305db0', 'イメージ', 'ジョン・バージャー', 'manual', null),
  ('d1a68e36-33f6-4058-82d2-5a444082542a', '森の生活', 'ヘンリー・D・ソロー', 'manual', null),
  ('e8295d40-c116-471d-8033-250e290cff53', 'ユートピア', 'トマス・モア', 'manual', null),
  ('3a22d18a-d217-4788-88b0-0a626085ec60', '老子', '老子', 'manual', null),
  ('30f10b4f-1c20-48b7-87ff-04313b2e37c9', '詩学', 'アリストテレス', 'manual', null),
  ('5afea479-17f5-4684-8f46-53ded24d2123', '銀河鉄道の夜', '宮沢賢治', 'manual', null),
  ('20431da2-af05-4903-8567-a4c02a218061', '夢十夜', '夏目漱石', 'manual', null),
  ('ecd4c13c-b988-4846-8077-1e3a852ba740', '沈黙', '遠藤周作', 'manual', null),
  ('95559836-e68d-465c-861b-45d1c5c3ebbb', '石の来歴', '奥泉光', 'manual', null),
  ('4a72eed4-7258-4c4b-88ea-90dbc0c0e244', '旅をする木', '星野道夫', 'manual', null),
  ('5ae59e33-c80d-4946-8c12-54c83efa63bd', '秘密の花園', 'フランシス・ホジソン・バーネット', 'manual', null)
on conflict (id) do update set isbn = null, title = excluded.title, author = excluded.author,
  publisher = '', price = null, source = 'manual', created_by = null
where (books.isbn, books.title, books.author, books.publisher, books.price, books.source,
    books.created_by)
  is distinct from (null, excluded.title, excluded.author, '', null, 'manual', null);

-- Copies --------------------------------------------------------------------------

-- Which book each copy was made from, and why: moved (by this file), edited
-- (its typist edited it) or held. Nobody reads it through the API; it names
-- books only (whose a copy is, is the copy's created_by).
create table private.book_copies (
  book_id uuid primary key references public.books (id) on delete cascade,
  copied_from uuid not null references public.books (id) on delete cascade,
  reason text not null check (reason in ('moved', 'edited', 'held')),
  copied_at timestamptz not null default now()
);
create index book_copies_from on private.book_copies (copied_from);
alter table private.book_copies enable row level security;
revoke all on private.book_copies from public, anon, authenticated;

-- A shop's shelves or scene, or a poster's pages, with one book's id put in
-- place of another's wherever it names the book: an item's or an object's
-- bookId, a row of books' book_ids.
create function private.swap_book(doc jsonb, was text, put text) returns jsonb
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(doc) = 'object' then
    return (
      select coalesce(jsonb_object_agg(o.k, case
          when o.k = 'bookId' and o.v = to_jsonb(was) then to_jsonb(put)
          when o.k = 'book_ids' and jsonb_typeof(o.v) = 'array' then (
            select coalesce(jsonb_agg(
                case when i.v = to_jsonb(was) then to_jsonb(put) else i.v end order by i.n),
              '[]'::jsonb)
            from jsonb_array_elements(o.v) with ordinality as i (v, n))
          else private.swap_book(o.v, was, put) end), '{}'::jsonb)
      from jsonb_each(doc) as o (k, v));
  elsif jsonb_typeof(doc) = 'array' then
    return (
      select coalesce(jsonb_agg(private.swap_book(e.v, was, put) order by e.n), '[]'::jsonb)
      from jsonb_array_elements(doc) with ordinality as e (v, n));
  end if;
  return doc;
end;
$$;
revoke all on function private.swap_book(jsonb, text, text) from public, anon, authenticated;

-- The readers whose rows name a book: every use book_is_mine asks about (a
-- shelf of their library is a row of it).
create function private.book_users(b uuid) returns setof uuid
language sql stable set search_path = '' as $$
  select m.user_id from public.book_marks m where m.book_id = b
  union select l.user_id from public.library_entries l where l.book_id = b
  union select c.user_id from public.book_encounters c where c.book_id = b
  union select p.author_id from public.posts p where p.book_id = b
  union select e.user_id from public.reading_entries e where e.book_id = b
  union select r.user_id from public.reading_sessions r where r.book_id = b
  union select n.profile_id from public.profile_nine n where n.book_id = b
  union select p.author_id from public.poster_books pb
    join public.posters p on p.id = pb.poster_id where pb.book_id = b
  union select s.owner_id from public.shop_private sp
    join public.shops s on s.id = sp.shop_id
    where sp.scene_books @> jsonb_build_array(b::text)
      or sp.shelves @> jsonb_build_array(jsonb_build_object(
        'items', jsonb_build_array(jsonb_build_object('bookId', b::text))))
$$;
revoke all on function private.book_users(uuid) from public, anon, authenticated;

-- Gives a reader a copy of a book and moves every row of theirs naming it to
-- the copy; returns the copy. The copy has the book's columns but its id and
-- whose it is, its ISBN's edition (a book without an ISBN: the book's own
-- edition, so it stays in that work when the operator joins or parts it),
-- and the book's place there: it is shown the master the book was shown,
-- and judged again on the next tick, as its own registration, from when the
-- book was placed. One the book was apart from, or held (reason held), starts
-- with no verdict, so its reader is told when it is held. The rows moved keep
-- their times.
create function private.give_own_copy(original uuid, reader uuid, reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  x public.books%rowtype;
  own uuid := gen_random_uuid();
  made record;
  was text := current_setting('private.copying', true);
begin
  select * into x from public.books b where b.id = original;
  if not found then
    raise exception 'no book has that id' using errcode = 'P0002';
  end if;
  perform set_config('private.copying', 'on', true);
  insert into public.books (id, isbn, title, author, publisher, price, source, created_by,
    created_at, updated_at)
  values (own, x.isbn, x.title, x.author, x.publisher, x.price, 'manual', reader,
    x.created_at, x.updated_at)
  returning edition_id, work_id into made;
  if x.isbn is null then
    update public.books b set edition_id = x.edition_id, work_id = x.work_id
    where b.id = own;
    delete from public.editions e where e.id = made.edition_id;
    delete from public.works w where w.id = made.work_id;
  end if;
  update private.book_checks c set placed_at = o.placed_at,
    checked_at = case when x.isbn is null then o.checked_at end,
    verdict = case when x.isbn is null then o.verdict
      when give_own_copy.reason = 'held' or o.verdict = 'apart' then null
      else o.verdict end,
    judged_at = case when x.isbn is null then o.judged_at
      when give_own_copy.reason = 'held' or o.verdict = 'apart' then null
      else o.judged_at end,
    confirmed_at = null, held_work = null
  from private.book_checks o
  where c.book_id = own and o.book_id = original;
  insert into private.book_copies (book_id, copied_from, reason)
  values (own, original, give_own_copy.reason);

  -- The library row's key is the book, and its shelves point at the row: a
  -- row for the copy first, then the shelves, then the old row goes.
  insert into public.library_entries (user_id, book_id, status, status_at, wanted_at,
    liked_at, owned, source, batch_id, added_at, removed_at, like_restored, ever_used,
    updated_at)
  select l.user_id, own, l.status, l.status_at, l.wanted_at, l.liked_at, l.owned,
    l.source, l.batch_id, l.added_at, l.removed_at, l.like_restored, l.ever_used,
    l.updated_at
  from public.library_entries l where l.user_id = reader and l.book_id = original;
  update public.library_shelf_books s set book_id = own
  where s.user_id = reader and s.book_id = original;
  delete from public.library_entries l where l.user_id = reader and l.book_id = original;
  update public.book_marks m set book_id = own
  where m.user_id = reader and m.book_id = original;
  update public.book_encounters c set book_id = own
  where c.user_id = reader and c.book_id = original;
  update public.posts p set book_id = own
  where p.author_id = reader and p.book_id = original;
  update public.reading_entries e set book_id = own
  where e.user_id = reader and e.book_id = original;
  update public.reading_sessions r set book_id = own
  where r.user_id = reader and r.book_id = original;
  update public.profile_nine n set book_id = own
  where n.profile_id = reader and n.book_id = original;
  -- Their posters' lists of books follow the pages (list_poster_books).
  update public.posters p set pages = private.swap_book(p.pages, original::text, own::text)
  where p.author_id = reader and exists (
    select 1 from public.poster_books pb where pb.poster_id = p.id and pb.book_id = original);
  -- And their shop's public copies follow its shelves and scene.
  update public.shop_private sp set
    shelves = private.swap_book(sp.shelves, original::text, own::text),
    scene = case when sp.scene is not null
      then private.swap_book(sp.scene, original::text, own::text) end
  where sp.shop_id = any (array(select s.id from public.shops s where s.owner_id = reader))
    and (sp.scene_books @> jsonb_build_array(original::text)
      or sp.shelves @> jsonb_build_array(jsonb_build_object(
        'items', jsonb_build_array(jsonb_build_object('bookId', original::text)))));
  perform set_config('private.copying', coalesce(was, ''), true);
  return own;
end;
$$;
revoke all on function private.give_own_copy(uuid, uuid, text) from public, anon, authenticated;

-- Gives every reader but its typist whose rows name a book their copy of it,
-- as it is now; returns how many. A catalog row or a 見本's book is
-- everyone's and gives none.
create function private.split_others(book uuid, reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  x record;
  reader uuid;
  n integer := 0;
begin
  select b.created_by, b.source into x from public.books b where b.id = book;
  if not found or x.source <> 'manual' or private.is_sample_book(book) then
    return 0;
  end if;
  for reader in
    select u.id from private.book_users(book) u (id)
    where u.id is distinct from x.created_by
    order by u.id
  loop
    perform private.give_own_copy(book, reader, split_others.reason);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function private.split_others(uuid, text) from public, anon, authenticated;

-- Each reader's rows of a book, found by the book: who uses it (book_users).
create index library_entries_book on public.library_entries (book_id);
create index book_marks_book on public.book_marks (book_id);
create index book_encounters_book_id on public.book_encounters (book_id);
create index reading_entries_book on public.reading_entries (book_id);
create index shop_private_shelves on public.shop_private using gin (shelves jsonb_path_ops);
create index shop_private_scene_books on public.shop_private
  using gin (scene_books jsonb_path_ops);

-- The move ----------------------------------------------------------------------

-- Every reader whose rows name a book typed in by someone else, or by nobody
-- now, is given their copy of it.
create temporary table own_copies_made as
select distinct b.id as original, u.id as reader, null::uuid as own
from public.books b
cross join lateral private.book_users(b.id) u (id)
where b.source = 'manual' and not private.is_sample_book(b.id)
  and u.id is distinct from b.created_by;
update own_copies_made m set own = private.give_own_copy(m.original, m.reader, 'moved');

-- Besides check_copy's rows and links: no reader's row names a book typed in
-- by anyone else; every copy is its book but its id and whose it is, in its
-- book's edition and that edition's work; the 見本's books are the app's,
-- with nobody's name; every other book is as it was; and every row of the
-- tables copied is as it was, the copies read as the books they were made
-- from (a copy's id is new, so it is found only where the move wrote it).
-- Counts only in the messages: they land in public Actions logs.
create function pg_temp.copies_undone(r jsonb) returns jsonb
language plpgsql as $$
declare
  m record;
  t text := r::text;
begin
  for m in select own, original from own_copies_made loop
    t := replace(t, m.own::text, m.original::text);
  end loop;
  return t::jsonb;
end;
$$;
do $$
declare
  copied record;
  changed bigint;
begin
  select count(*) into changed
  from public.books b
  cross join lateral private.book_users(b.id) u (id)
  where b.source = 'manual' and not private.is_sample_book(b.id)
    and u.id is distinct from b.created_by;
  if changed > 0 then
    raise exception '% readers still name a book typed in by someone else', changed;
  end if;
  select count(*) into changed
  from own_copies_made m
  join public.books c on c.id = m.own
  join public.books o on o.id = m.original
  join public.editions e on e.id = c.edition_id
  where to_jsonb(c) - array['id', 'created_by', 'work_id']
      is distinct from to_jsonb(o) - array['id', 'created_by', 'work_id']
    or c.created_by is distinct from m.reader
    or c.work_id is distinct from e.work_id
    or not exists (
      select 1 from private.book_copies k
      where k.book_id = m.own and k.copied_from = m.original and k.reason = 'moved');
  if changed > 0 then
    raise exception '% copies are not their books', changed;
  end if;
  select count(*) into changed from public.books b
  where private.is_sample_book(b.id)
    and (b.created_by is not null or b.isbn is not null or b.source <> 'manual'
      or b.publisher <> '' or b.price is not null);
  if changed > 0 then
    raise exception '% of the 見本''s books are someone''s', changed;
  end if;
  if (select count(*) from public.books b where private.is_sample_book(b.id)) <> 24 then
    raise exception 'the 見本''s books are not all there';
  end if;
  for copied in
    select c.source, c.copy_name from keep.copies c
    where c.label = '20261105000000_own_book_rows'
  loop
    if copied.source = 'public.books' then
      execute format(
        'select count(*) from (
           (select to_jsonb(b) from public.books b
            where not private.is_sample_book(b.id)
              and not exists (select 1 from own_copies_made m where m.own = b.id)
            except all
            select to_jsonb(k) - ''keep_owners'' from keep.%1$I k
            where not private.is_sample_book(k.id))
           union all
           (select to_jsonb(k) - ''keep_owners'' from keep.%1$I k
            where not private.is_sample_book(k.id)
            except all
            select to_jsonb(b) from public.books b
            where not private.is_sample_book(b.id)
              and not exists (select 1 from own_copies_made m where m.own = b.id))
         ) d',
        copied.copy_name) into changed;
    else
      execute format(
        'select count(*) from (
           (select pg_temp.copies_undone(to_jsonb(t)) from %1$s t
            except all
            select to_jsonb(k) - ''keep_owners'' from keep.%2$I k)
           union all
           (select to_jsonb(k) - ''keep_owners'' from keep.%2$I k
            except all
            select pg_temp.copies_undone(to_jsonb(t)) from %1$s t)
         ) d',
        copied.source, copied.copy_name) into changed;
    end if;
    if changed > 0 then
      raise exception 'the move changed % rows of %', changed, copied.source;
    end if;
  end loop;
end;
$$;
drop function pg_temp.copies_undone(jsonb);
drop table own_copies_made;

-- Rows keyed by their book are written again under the copy, and the 見本's
-- books lose whose they were: both measured above.
select private.check_copy('20261105000000_own_book_rows',
  links_may_go => array['public.books']::regclass[],
  rows_may_go => array[
    'public.library_entries', 'public.library_shelf_books', 'public.book_marks',
    'public.poster_books'
  ]::regclass[]);

-- From now on --------------------------------------------------------------------

-- Before a book's typist changes what they typed (its title, author, ISBN,
-- publisher or price), every other reader whose rows name it is given their
-- copy of it as it is.
create function private.copies_before_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.split_others(old.id, 'edited');
  return new;
end;
$$;
revoke all on function private.copies_before_edit() from public, anon, authenticated;
create trigger books_own_copies before update of isbn, title, author, publisher, price
  on public.books
  for each row when ((old.isbn, old.title, old.author, old.publisher, old.price)
    is distinct from (new.isbn, new.title, new.author, new.publisher, new.price))
  execute function private.copies_before_edit();

-- When a book is held (bib_judge), every other reader whose rows name it is
-- given their copy, judged on the next tick as their own: they are told if
-- it is held too, and answer for their own; what its typist answers is
-- theirs. Should giving them their copies fail (it should not), the hold
-- goes on and the database's log has the warning.
create function private.copies_before_hold() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.split_others(new.book_id, 'held');
  exception when others then
    raise warning 'copies of a held book failed: %', sqlstate;
  end;
  return null;
end;
$$;
revoke all on function private.copies_before_hold() from public, anon, authenticated;
create trigger work_changes_held after insert on private.work_changes
  for each row when (new.kind = 'hold')
  execute function private.copies_before_hold();
