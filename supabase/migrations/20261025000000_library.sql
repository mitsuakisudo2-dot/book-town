-- My library (L1 of the 2026-10-13 review, 5-3) and the encounters behind it
-- (the 2026-10-14 memo review, 2章): every edition a reader has met here, the
-- shelves they name and which of their books are on them, and each いいね,
-- 私も好き！ and 読みたい they pressed, with their own memo of why. All of it
-- is the reader's own. Nobody else reads it: a post's writer and a shop's
-- owner still see the reaction itself (post_reactions, pop_reactions), never
-- this. book_marks stays as it is; what an app without the library writes
-- there is copied in (book_marks_follow, below). The app reads none of it yet.
--
-- The rules of these rows are the app's, as pure functions checked against
-- shared cases (src/lib/library.ts, tests/fixtures/library-cases.json). The
-- database only refuses what no right write could send, since a refused
-- write takes every unsent change with it (src/lib/supabase/sync.ts).
--
-- Rollback: until an app that reads these tables is live, a new migration
-- drops the trigger book_marks_follow, the four tables and the four columns
-- of reader_settings, and puts back book_is_mine as hide_registered_titles
-- wrote it. Once one is live, drop the trigger alone, and the tables only
-- after production runs an app from before it again: a town that cannot read
-- a table it expects does not load (review doc 6-3).

-- Library ------------------------------------------------------------------------

create table public.library_entries (
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- An operator deleting a book is stopped rather than let through to drop
  -- readers' records of it (as profile_nine, posts and reading_sessions do).
  book_id uuid not null references public.books (id) on delete restrict,
  status text check (status in ('tsundoku', 'reading', 'finished')),
  status_at timestamptz,
  wanted_at timestamptz,
  -- Set while a いいね or 私も好き！ of the book stands, from the first.
  liked_at timestamptz,
  owned text check (owned in ('yes', 'no')),
  -- How the book first came in; never changed afterwards. post, poster and
  -- nine: used in the reader's own post, poster or 人生の9冊; shop: placed
  -- in their own shop (decided 2026-10-14, N19 and N20).
  source text not null check (source in (
    'scan', 'isbn', 'manual', 'search', 'want', 'reading', 'record', 'shop',
    'legacy', 'like', 'pop', 'favorite', 'post', 'poster', 'nine'
  )),
  -- The scanning session that first brought it in (今回追加).
  batch_id uuid,
  added_at timestamptz not null default now(),
  -- Taken out of the library: kept, with its shelves, so it can come back.
  removed_at timestamptz,
  -- Brought back by a like and untouched since, so taking the like back
  -- takes it out again.
  like_restored boolean not null default false,
  -- Placed in the reader's own shop, or used in their own post, poster or
  -- 人生の9冊, at least once, taken out or not; never cleared. Taking a
  -- like back then leaves the book in, though the shop or the post holds it
  -- no more (N19, N20). Whether, not when: nothing is ordered by it, and the
  -- nine keep no date to give it.
  ever_used boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
-- Nothing here ties status, wanted and owned together: those rules are the
-- app's, so a refused write never strands a change.
create index library_entries_recent
  on public.library_entries (user_id, added_at desc, book_id);
create trigger library_entries_touch before update on public.library_entries
  for each row execute function public.touch_updated_at();

create table public.library_shelves (
  -- Made by the device, so sending it again writes the same row.
  id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Names may repeat: two devices offline may each make an 「SF」, and a
  -- unique name would refuse one of them with its unsent books.
  name text not null check (char_length(btrim(name)) between 1 and 40),
  note text not null default '' check (char_length(note) <= 500),
  -- A fractional key, compared byte by byte as the app compares it.
  position text collate "C" not null check (position ~ '^[0-9A-Za-z]{1,64}$'),
  -- Whether the reader's own view of the shelf shows books only wanted.
  show_wanted boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Put away: kept, with its books, so it can come back.
  deleted_at timestamptz,
  unique (id, user_id)
);
create index library_shelves_owner on public.library_shelves (user_id);
create trigger library_shelves_touch before update on public.library_shelves
  for each row execute function public.touch_updated_at();

create table public.library_shelf_books (
  shelf_id uuid not null,
  user_id uuid not null,
  book_id uuid not null,
  added_at timestamptz not null default now(),
  -- Only for books moved by hand; the others go by added_at.
  position text collate "C" check (position ~ '^[0-9A-Za-z]{1,64}$'),
  -- The reader is in the key: a key of the shelf and the book alone would
  -- be checked before the foreign keys, and someone who knows a shelf's id
  -- could ask, book by book, whether it is on that shelf.
  primary key (user_id, shelf_id, book_id),
  -- Only the reader's own shelf and a book of their own library can be
  -- joined. The cascades run only when an account goes: the app deletes
  -- neither shelves nor rows.
  foreign key (shelf_id, user_id)
    references public.library_shelves (id, user_id) on delete cascade,
  foreign key (user_id, book_id)
    references public.library_entries (user_id, book_id) on delete cascade
);
create index library_shelf_books_entry
  on public.library_shelf_books (user_id, book_id);

-- Encounters (この本との出会い) ------------------------------------------------------

create table public.book_encounters (
  -- Made by the device, so sending it again writes the same row and a memo
  -- being written keeps its place.
  id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete restrict,
  -- いいね, 私も好き！ (a POP's love) and 読みたい.
  kind text not null check (kind in ('like', 'love', 'want')),
  -- Pressed on a post, on a POP, or on the book's own page (読みたい only).
  via text not null check (via in ('post', 'pop', 'book')),
  -- When the post or the shop goes, the encounter and its memo stay, and so
  -- does whose it was, until that reader's account goes too.
  post_id uuid references public.posts (id) on delete set null,
  shop_id uuid references public.shops (id) on delete set null,
  -- Where the POP stood, to find it again. Never part of what makes two the
  -- same: a shop's page and the walk name one POP two ways.
  placement_key text check (char_length(placement_key) between 1 and 300),
  -- Whose post or shop it was: copied by the database from the post or the
  -- shop, never taken from the device.
  other_reader_id uuid references public.profiles (id) on delete set null,
  memo text check (memo is null or char_length(memo) between 1 and 255),
  memo_at timestamptz,
  -- Taken back, and kept for its memo: one taken back without a memo is
  -- deleted. Pressed again, the same row comes back.
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  constraint book_encounters_book_page_kind check (via <> 'book' or kind = 'want'),
  constraint book_encounters_post_kind check (via <> 'post' or kind in ('like', 'want'))
);
-- One of each press. A POP is one per shop and book, whichever way its
-- place is named; a post or shop gone leaves its encounters standing alone.
create unique index book_encounters_post
  on public.book_encounters (user_id, kind, post_id) where via = 'post';
create unique index book_encounters_pop
  on public.book_encounters (user_id, kind, shop_id, book_id) where via = 'pop';
create unique index book_encounters_book
  on public.book_encounters (user_id, book_id, kind) where via = 'book';
-- A reader's encounters of a book (book_is_mine, the memo a row keeps), and
-- the rows a post, a shop or an account going sets free.
create index book_encounters_reader_book
  on public.book_encounters (user_id, book_id);
create index book_encounters_post_id on public.book_encounters (post_id)
  where post_id is not null;
create index book_encounters_shop_id on public.book_encounters (shop_id)
  where shop_id is not null;
create index book_encounters_other_reader on public.book_encounters (other_reader_id)
  where other_reader_id is not null;

-- What the reader pressed, checked as they see it (security invoker, so the
-- posts' and shops' own policies answer): a post or shop they cannot read is
-- refused exactly as one that does not exist, before its foreign key is
-- looked at, so the refusal tells nothing about it. Their own post or shop
-- is no encounter. A post's encounter meets the post's own book (a reply's,
-- never its parent's); a POP's names its shop and its place; a book page's
-- names neither. Whose it was is copied from the post or the shop.
-- One already saved, sent again after its answer was lost, is left to the
-- insert's conflict on its id, whatever has become of its post or shop
-- since: refused, it would take every unsent change with it. Only the
-- reader's own rows are seen, so this tells nothing of anyone else's. The
-- row is held until the insert is done, so it cannot be deleted in between
-- and let one in unchecked.
create function private.check_book_encounter() returns trigger
language plpgsql set search_path = '' as $$
declare
  owner uuid;
  met uuid;
begin
  perform 1 from public.book_encounters c
  where c.id = new.id and c.user_id = new.user_id
  for key share;
  if found then
    return new;
  end if;
  if new.via = 'post' then
    if new.post_id is null or new.shop_id is not null
      or new.placement_key is not null then
      raise exception 'an encounter on a post names the post alone'
        using errcode = '23514';
    end if;
    select p.author_id, p.book_id into owner, met
    from public.posts p where p.id = new.post_id;
    if not found then
      raise exception 'the post met is not found' using errcode = '23503';
    end if;
  elsif new.via = 'pop' then
    if new.shop_id is null or new.placement_key is null
      or new.post_id is not null then
      raise exception 'an encounter on a POP names its shop and place'
        using errcode = '23514';
    end if;
    select s.owner_id into owner from public.shops s where s.id = new.shop_id;
    if not found then
      raise exception 'the shop met is not found' using errcode = '23503';
    end if;
  elsif new.post_id is not null or new.shop_id is not null
    or new.placement_key is not null then
    raise exception 'an encounter on a book''s page names no post or shop'
      using errcode = '23514';
  end if;
  if owner = new.user_id then
    raise exception 'a reader''s own post or shop is no encounter'
      using errcode = '23514';
  end if;
  if new.via = 'post' and met is distinct from new.book_id then
    raise exception 'an encounter on a post meets the post''s own book'
      using errcode = '23514';
  end if;
  new.other_reader_id := owner;
  return new;
end;
$$;
revoke all on function private.check_book_encounter() from public, anon, authenticated;
create trigger book_encounters_check before insert on public.book_encounters
  for each row execute function private.check_book_encounter();

-- The reader's settings ---------------------------------------------------------

-- The default shelves the reader hides, by key. The shelves themselves are
-- the app's (DEFAULT_SHELVES), so only the keys' form and number are checked
-- here, and the app ignores keys it does not know. A key has no comma, so the
-- joined keys have exactly one comma fewer than the array has keys.
alter table public.reader_settings
  add column library_hidden text[] not null default '{}'
    check (library_hidden = '{}' or (
      array_ndims(library_hidden) = 1
      and cardinality(library_hidden) <= 20
      and array_to_string(library_hidden, ',', '*') ~ (
        '^[a-z_]{1,32}(,[a-z_]{1,32}){' || cardinality(library_hidden) - 1 || '}$'
      )
    ));
-- 「いいねした本をライブラリに入れる」: whether books only liked show in the
-- library (いいねした本 shows them anyway).
alter table public.reader_settings
  add column likes_in_library boolean not null default true;
-- 「読み始めたら『読みたい』から外す」. The owner allowed the setting (問い3);
-- keeping it here is a proposal not yet settled. Only the app reads it; the
-- trigger below copies an old app's marks the same way whatever it says.
alter table public.reader_settings
  add column wanted_clears_on_status boolean not null default false;
-- 「メモの案内を出す」: the small note offering a memo after a いいね or a
-- 読みたい, shown every time unless the reader turns it off.
alter table public.reader_settings
  add column memo_hint boolean not null default true;
-- The old app's upsert sends user_id and spoiler_display only, so it never
-- changes these four.
grant insert (library_hidden, likes_in_library, wanted_clears_on_status, memo_hint),
  update (library_hidden, likes_in_library, wanted_clears_on_status, memo_hint)
  on public.reader_settings to authenticated;

-- Times ---------------------------------------------------------------------------

-- A device clock running ahead cannot date a row in the future. Null stays null.
create function private.library_clamp_times() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.added_at > now() then new.added_at := now(); end if;
  if new.status_at > now() then new.status_at := now(); end if;
  if new.wanted_at > now() then new.wanted_at := now(); end if;
  if new.liked_at > now() then new.liked_at := now(); end if;
  return new;
end;
$$;
revoke all on function private.library_clamp_times() from public, anon, authenticated;
create trigger library_entries_clamp before insert or update on public.library_entries
  for each row execute function private.library_clamp_times();

create function private.encounter_clamp_times() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.created_at > now() then new.created_at := now(); end if;
  if new.memo_at > now() then new.memo_at := now(); end if;
  return new;
end;
$$;
revoke all on function private.encounter_clamp_times() from public, anon, authenticated;
create trigger book_encounters_clamp before insert or update on public.book_encounters
  for each row execute function private.encounter_clamp_times();

-- Who may do what -----------------------------------------------------------------

-- Closed to start with, as every new table is; only what the app uses is
-- opened, and nothing to anon. New rows are inserted (ignoring duplicates)
-- and changed rows updated: a partial upsert is never sent. Rows and shelves
-- are never deleted, only marked; a book's place on a shelf and an
-- encounter taken back without a memo are.
alter table public.library_entries enable row level security;
alter table public.library_shelves enable row level security;
alter table public.library_shelf_books enable row level security;
alter table public.book_encounters enable row level security;
revoke all on public.library_entries, public.library_shelves,
  public.library_shelf_books, public.book_encounters
  from anon, authenticated;
grant select on public.library_entries, public.library_shelves,
  public.library_shelf_books, public.book_encounters
  to authenticated;
grant insert (user_id, book_id, status, status_at, wanted_at, liked_at, owned, source,
  batch_id, added_at, removed_at, like_restored, ever_used)
  on public.library_entries to authenticated;
-- A use marks a row already there, so ever_used is updated too.
grant update (status, status_at, wanted_at, liked_at, owned, removed_at, like_restored,
  ever_used) on public.library_entries to authenticated;
grant insert (id, user_id, name, note, position, show_wanted, created_at, deleted_at)
  on public.library_shelves to authenticated;
grant update (name, note, position, show_wanted, deleted_at)
  on public.library_shelves to authenticated;
-- Undoing a book taken off a shelf puts it back as it was.
grant insert (shelf_id, user_id, book_id, added_at, position), update (position), delete
  on public.library_shelf_books to authenticated;
-- The device may send the whole row it keeps: other_reader_id is replaced by
-- the check above. Only the memo and the taking back change afterwards.
grant insert (id, user_id, book_id, kind, via, post_id, shop_id, placement_key,
  other_reader_id, memo, memo_at, undone_at, created_at),
  update (memo, memo_at, undone_at), delete
  on public.book_encounters to authenticated;
create policy "a library is its reader's own" on public.library_entries
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "library shelves are their reader's own" on public.library_shelves
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "shelf books are their reader's own" on public.library_shelf_books
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "encounters are their reader's own" on public.book_encounters
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- An old app's marks ------------------------------------------------------------

-- Marks written by an app that does not know the library (a tab left open, an
-- app rolled back) are copied to that reader's row. The new app sends the
-- header x-booktown-library: 1 and writes its rows itself, so its marks are
-- left alone; faking the header only changes the faker's own copy. followMarks
-- in src/lib/library.ts is this function's twin, checked against the same
-- cases (tests/fixtures/library-cases.json).
-- Security definer: an account's deletion reaches book_marks through the
-- cascade from auth.users, whose triggers run as supabase_auth_admin, which
-- has no rights on the library; as invoker the whole deletion fails. Like
-- refold_*, it only ever touches the rows of the mark's own reader, and the
-- marks a reader can write are their own (book_marks' policy).
create function private.library_follows_marks() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.book_marks;
begin
  if coalesce(nullif(current_setting('request.headers', true), '')::json
      ->> 'x-booktown-library', '') = '1' then
    return null;
  end if;
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  -- Nothing to keep while the account itself is being deleted.
  if not exists (select 1 from public.profiles p where p.id = r.user_id) then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into public.library_entries (user_id, book_id, source, added_at)
    values (r.user_id, r.book_id, 'legacy', r.created_at)
    on conflict (user_id, book_id) do nothing;
    -- library, wish and favorite bring a row taken out back, as in the app
    -- (review doc 4-2's 戻す規則, a proposal). A mark the reader wrote is
    -- their own doing, so a row brought back by a like is no longer only that.
    update public.library_entries e set
      removed_at = case when r.kind in ('library', 'wish', 'favorite') then null
                        else e.removed_at end,
      like_restored = false,
      wanted_at = case when r.kind = 'wish' then coalesce(e.wanted_at, r.created_at)
                       else e.wanted_at end,
      status = case when r.kind = 'finished' then 'finished' else e.status end,
      status_at = case when r.kind = 'finished' and e.status is distinct from 'finished'
                       then r.created_at else e.status_at end
    where e.user_id = r.user_id and e.book_id = r.book_id
      and ((r.kind in ('library', 'wish', 'favorite') and e.removed_at is not null)
           or (r.kind = 'wish' and e.wanted_at is null)
           or (r.kind = 'finished' and e.status is distinct from 'finished')
           or e.like_restored);
  else
    -- The old app takes the finished mark off only when a book is read again
    -- (startReading in src/lib/store.ts).
    update public.library_entries e set
      wanted_at = case when r.kind = 'wish' then null else e.wanted_at end,
      status = case when r.kind = 'finished' then 'reading' else e.status end,
      status_at = case when r.kind = 'finished' then now() else e.status_at end
    where e.user_id = r.user_id and e.book_id = r.book_id
      and ((r.kind = 'wish' and e.wanted_at is not null)
           or (r.kind = 'finished' and e.status = 'finished'));
    -- A row with nothing left leaves the library. Kept by: a status, wanted,
    -- owned, a like, a shelf not put away, a library or favorite mark, the
    -- reader's own record, and a memo on any of their encounters of it (one
    -- taken back too). Shop shelves, posts, posters and the nine are not
    -- looked at. That a wish or favorite taken off does it too, not only the
    -- library mark, is a proposal not yet settled (review doc 4-2's last
    -- row); if it is not taken, only r.kind = 'library' takes a row out.
    update public.library_entries e set removed_at = now()
    where e.user_id = r.user_id and e.book_id = r.book_id and e.removed_at is null
      and r.kind in ('library', 'wish', 'favorite')
      and e.status is null and e.wanted_at is null and e.owned is null
      and e.liked_at is null
      and not exists (
        select 1 from public.library_shelf_books s
        join public.library_shelves h on h.id = s.shelf_id and h.user_id = s.user_id
        where s.user_id = e.user_id and s.book_id = e.book_id and h.deleted_at is null
      )
      and not exists (
        select 1 from public.book_marks m
        where m.user_id = e.user_id and m.book_id = e.book_id
          and m.kind in ('library', 'favorite')
      )
      and not exists (
        select 1 from public.reading_entries x
        where x.user_id = e.user_id and x.book_id = e.book_id
      )
      and not exists (
        select 1 from public.book_encounters c
        where c.user_id = e.user_id and c.book_id = e.book_id
          and c.memo is not null
      );
  end if;
  return null;
end;
$$;
revoke all on function private.library_follows_marks() from public, anon, authenticated;
-- Marks are upserted ignoring duplicates, so a mark already there inserts
-- nothing and fires nothing.
create trigger book_marks_follow after insert or delete on public.book_marks
  for each row execute function private.library_follows_marks();

-- The library every reader already has ----------------------------------------------

-- From what they did before it (review doc 4-8): their marks, records and
-- reading, and the books of their own posts, posters (drafts too), nine and
-- shop (every shelf, private ones too, and its scene). Nothing new is
-- guessed: only a finished mark or a reading still running gives a status,
-- and owning is never set. Each step adds the books the steps before it did
-- not, dated by its own earliest time, as legacyToLibrary in
-- src/lib/library.ts does; the last marks every row of a book so used as
-- used (ever_used), whichever step made it. Likes are not copied, and no
-- encounter is made: the encounters start empty (memo review, 2章).
-- Run once here, after the trigger above holds book_marks, so the copy is
-- consistent; running it again changes nothing (pnpm test:db runs it twice).
create function private.library_backfill() returns void
language sql set search_path = '' as $$
  insert into public.library_entries
    (user_id, book_id, source, added_at, wanted_at, status, status_at)
  select user_id, book_id, 'legacy', min(created_at),
         min(created_at) filter (where kind = 'wish'),
         case when bool_or(kind = 'finished') then 'finished' end,
         min(created_at) filter (where kind = 'finished')
  from public.book_marks where kind in ('library', 'wish', 'finished', 'favorite')
  group by user_id, book_id
  on conflict (user_id, book_id) do nothing;
  insert into public.library_entries (user_id, book_id, source, added_at)
  select user_id, book_id, 'legacy', min(created_at) from public.reading_entries
  where kind = 'finished' group by user_id, book_id
  on conflict (user_id, book_id) do nothing;
  -- A reader runs one reading at a time (reading_sessions_one_running).
  insert into public.library_entries (user_id, book_id, source, added_at, status, status_at)
  select user_id, book_id, 'legacy', started_at, 'reading', started_at
  from public.reading_sessions where ended_at is null and book_id is not null
  on conflict (user_id, book_id) do update
    set status = 'reading', status_at = excluded.status_at
    where public.library_entries.status is null;
  insert into public.library_entries (user_id, book_id, source, added_at)
  select user_id, book_id, 'legacy', min(started_at) from public.reading_sessions
  where ended_at is not null and book_id is not null group by user_id, book_id
  on conflict (user_id, book_id) do nothing;
  insert into public.library_entries (user_id, book_id, source, added_at, ever_used)
  select user_id, book_id, 'legacy', min(at), true
  from (
    select p.author_id as user_id, p.book_id, p.created_at as at
    from public.posts p where p.book_id is not null
    union all
    select p.author_id, pb.book_id, p.created_at
    from public.poster_books pb join public.posters p on p.id = pb.poster_id
    union all
    -- The nine keep no date of their own: the profile's stands in.
    select n.profile_id, n.book_id, p.created_at
    from public.profile_nine n join public.profiles p on p.id = n.profile_id
    union all
    -- The shop's date stands in for its shelves and scene. Ids that are not
    -- a book here (a 見本's, a broken one) are passed over.
    select s.owner_id, b.id, s.created_at
    from public.shops s
    join public.shop_private sp on sp.shop_id = s.id
    cross join lateral (
      select jsonb_array_elements_text(sp.scene_books) as id
      union
      select item ->> 'bookId'
      from jsonb_array_elements(sp.shelves) shelf,
        jsonb_array_elements(case when jsonb_typeof(shelf -> 'items') = 'array'
                                  then shelf -> 'items' else '[]' end) item
    ) placed
    join public.books b on b.id::text = placed.id
  ) uses
  group by user_id, book_id
  on conflict (user_id, book_id) do update set ever_used = true
    where not public.library_entries.ever_used;
$$;
revoke all on function private.library_backfill() from public, anon, authenticated;
select private.library_backfill();

-- Who reads a typed-in book ------------------------------------------------------

-- A book in a reader's library is theirs to read while it is in it, and so is
-- a book they met (an encounter, kept for its memo even once its post is
-- gone). A row taken out is no longer a use: a reader who takes a book out
-- stops reading what someone else typed in. The rest is
-- hide_registered_titles' body, unchanged; book_is_listed is unchanged too,
-- as the library is never public.
create or replace function private.book_is_mine(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1 from public.book_marks m
      where m.user_id = (select auth.uid()) and m.book_id = b
    )
    or exists (
      select 1 from public.library_entries l
      where l.user_id = (select auth.uid()) and l.book_id = b
        and l.removed_at is null
    )
    or exists (
      select 1 from public.book_encounters c
      where c.user_id = (select auth.uid()) and c.book_id = b
    )
    or exists (
      select 1 from public.posts p
      where p.author_id = (select auth.uid()) and p.book_id = b
    )
    or exists (
      select 1 from public.reading_entries e
      where e.user_id = (select auth.uid()) and e.book_id = b
    )
    or exists (
      select 1 from public.reading_sessions r
      where r.user_id = (select auth.uid()) and r.book_id = b
    )
    or exists (
      select 1 from public.profile_nine n
      where n.profile_id = (select auth.uid()) and n.book_id = b
    )
    or exists (
      select 1 from public.poster_books pb
      join public.posters p on p.id = pb.poster_id
      where pb.book_id = b and p.author_id = (select auth.uid())
    )
    -- Their shop's id is found first, so only its row of shop_private is
    -- opened. Joined to shops instead, the planner may search every shop's
    -- private shelves for each book and keep the reader's own afterwards.
    or exists (
      select 1 from public.shop_private sp
      where sp.shop_id = any (array(
          select s.id from public.shops s where s.owner_id = (select auth.uid())
        ))
        and (
          sp.scene_books @> jsonb_build_array(b::text)
          or sp.shelves @> jsonb_build_array(jsonb_build_object(
            'items', jsonb_build_array(jsonb_build_object('bookId', b::text))))
        )
    )
  )
$$;
