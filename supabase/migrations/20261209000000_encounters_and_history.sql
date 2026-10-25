-- 出会いの記録と操作の履歴 (item 9 of the plan). The design is in
-- docs/機能/本棚とライブラリ.md (「出会いの記録」 and 「操作の履歴」).
--
--   book_encounters   kept as 20261025000000_library.sql made it (no row
--                     yet anywhere), with one more place a book is met:
--                     'shop', a 読みたい pressed on a book in another
--                     reader's shop that has no POP. It names the shop and
--                     whose it was, as a POP's does, and nothing else.
--   library_events    what the reader did with their library, one row a
--                     change, written by the database after each write of
--                     library_entries and library_shelf_books, never by the
--                     app: a book coming in (and how), taken out, brought
--                     back, its status, 読みたい and 持っている changed, put
--                     on and taken off a shelf of their own. The reader's
--                     alone, read by nobody else. Kept a year (every night,
--                     pg_cron 'library-events'). Merely opening or looking
--                     at anything writes nothing. In manage mode (item 98)
--                     the row says so, so counts of the town (item 105)
--                     can leave it out.
--
-- library_events names its book through the reader's own library row
-- (user_id, book_id), not public.books: it goes when that row goes (a later
-- migration moving rows to a reader's own copy of a book, as give_own_copy
-- does, moves these first). A foreign key to books would count as a use of
-- the book in
-- private.catalog_used and private.book_used_besides_own (AUD-055), and keep
-- a book taken back in the scanner from being forgotten.
--
-- A write is never refused for its history: when a reader has written more
-- than LIBRARY_EVENTS_PER_DAY rows today (a script, not a person), the rest
-- of the day's changes are simply not kept, and the library write goes on.
--
-- Rollback (a new migration):
--   select cron.unschedule('library-events');
--   drop trigger library_entries_events on public.library_entries;
--   drop trigger library_shelf_books_events on public.library_shelf_books;
--   drop table public.library_events, private.library_event_days;
--   drop function private.forget_library_events(), private.library_entry_events(),
--     private.library_shelf_book_events(), private.note_library_event(uuid, uuid, text,
--     text, text, uuid, timestamptz);
--   and, while no row has via 'shop':
--   drop index public.book_encounters_shop;
--   alter table public.book_encounters drop constraint book_encounters_shop_kind,
--     drop constraint book_encounters_via_check,
--     add constraint book_encounters_via_check check (via in ('post', 'pop', 'book'));
--   and private.check_book_encounter() again as 20261106000000_own_books_only.sql has it.
-- No data moves either way: library_events starts empty, as book_encounters is.

-- Encounters in a shop ---------------------------------------------------------------

alter table public.book_encounters drop constraint book_encounters_via_check,
  add constraint book_encounters_via_check
    check (via in ('post', 'pop', 'book', 'shop')),
  -- Only 読みたい is pressed on a shop's book that has no POP.
  add constraint book_encounters_shop_kind check (via <> 'shop' or kind = 'want');
-- One of each, as a POP's: the shop and the book. A shop gone leaves its
-- encounters standing alone.
create unique index book_encounters_shop
  on public.book_encounters (user_id, kind, shop_id, book_id) where via = 'shop';

-- As 20261106000000_own_books_only.sql has it, and a shop's encounter names
-- its shop alone, as seen by the reader (a closed shop is not found), and is
-- never their own.
create or replace function private.check_book_encounter() returns trigger
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
  elsif new.via in ('pop', 'shop') then
    if new.via = 'pop' and (new.shop_id is null or new.placement_key is null
      or new.post_id is not null) then
      raise exception 'an encounter on a POP names its shop and place'
        using errcode = '23514';
    end if;
    if new.via = 'shop' and (new.shop_id is null or new.placement_key is not null
      or new.post_id is not null) then
      raise exception 'an encounter in a shop names the shop alone'
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
  if new.via = 'post' and met is distinct from new.book_id
    and not private.is_my_book_of(met, new.book_id) then
    raise exception 'an encounter on a post meets the post''s own book'
      using errcode = '23514';
  end if;
  new.other_reader_id := owner;
  return new;
end;
$$;

-- The history -------------------------------------------------------------------------

create table public.library_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id uuid not null,
  -- added: came into the library (became: how, library_entries.source);
  -- removed, restored: taken out, brought back; status: 積読・読書中・読了
  -- (was, became: the status, null for none); wanted, unwanted: 読みたい
  -- on and off; owned: 持っている (was, became: 'yes', 'no' or null);
  -- shelved, unshelved: put on, taken off one of their own shelves.
  kind text not null check (kind in (
    'added', 'removed', 'restored', 'status', 'wanted', 'unwanted', 'owned',
    'shelved', 'unshelved'
  )),
  was text check (char_length(was) <= 32),
  became text check (char_length(became) <= 32),
  -- The shelf, for shelved and unshelved; never deleted but with the account.
  shelf_id uuid,
  -- Done in 読書管理モード (item 98).
  manage boolean not null default false,
  at timestamptz not null default now(),
  constraint library_events_shelf check ((shelf_id is not null) = (kind in ('shelved', 'unshelved'))),
  foreign key (user_id, book_id)
    references public.library_entries (user_id, book_id)
    on delete cascade on update cascade,
  foreign key (shelf_id, user_id)
    references public.library_shelves (id, user_id) on delete cascade
);
-- A reader's history, the newest first; and the rows going after a year.
create index library_events_reader on public.library_events (user_id, at desc);
create index library_events_book on public.library_events (user_id, book_id);
create index library_events_at on public.library_events (at);
create index library_events_shelf on public.library_events (shelf_id, user_id)
  where shelf_id is not null;

alter table public.library_events enable row level security;
revoke all on public.library_events from anon, authenticated;
grant select on public.library_events to authenticated;
create policy "a library's history is its reader's own" on public.library_events
  for select to authenticated using (user_id = (select auth.uid()));

-- How many rows each reader's history took each day (UTC), so a script
-- writing without end keeps only the day's first rows. Nobody reads it.
create table private.library_event_days (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  rows integer not null,
  primary key (user_id, day)
);
revoke all on private.library_event_days from public, anon, authenticated;

-- Keeps one row of `reader`'s history, unless the day's rows are used up.
-- Only a reader's own request is kept: the database's own work (a
-- migration, a nightly job, moving rows to the reader's own copy of a book)
-- and an account being deleted write nothing.
create function private.note_library_event(reader uuid, book uuid, what text,
  was text, became text, shelf uuid, happened timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'utc')::date;
  used integer;
begin
  if not private.asked_by_reader() or reader is distinct from (select auth.uid()) then
    return;
  end if;
  insert into private.library_event_days as d (user_id, day, rows)
  values (reader, today, 1)
  on conflict (user_id, day) do update set rows = d.rows + 1
  returning d.rows into used;
  -- LIBRARY_EVENTS_PER_DAY: some fifty times a busy day's (a series of 200
  -- volumes registered, sorted and shelved is about a thousand rows).
  if used > 50000 then
    return;
  end if;
  insert into public.library_events (user_id, book_id, kind, was, became, shelf_id,
    manage, at)
  values (reader, book, what, was, became, shelf,
    private.reader_mode(reader) = 'manage',
    least(coalesce(happened, now()), now()));
end;
$$;
revoke all on function private.note_library_event(uuid, uuid, text, text, text, uuid,
  timestamptz) from public, anon, authenticated;

-- After each write of a library row: what changed in it.
create function private.library_entry_events() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.note_library_event(new.user_id, new.book_id, 'added', null,
      new.source, null, new.added_at);
    if new.removed_at is not null then
      perform private.note_library_event(new.user_id, new.book_id, 'removed', null,
        null, null, new.removed_at);
    end if;
    if new.status is not null then
      perform private.note_library_event(new.user_id, new.book_id, 'status', null,
        new.status, null, new.status_at);
    end if;
    if new.wanted_at is not null then
      perform private.note_library_event(new.user_id, new.book_id, 'wanted', null,
        null, null, new.wanted_at);
    end if;
    if new.owned is not null then
      perform private.note_library_event(new.user_id, new.book_id, 'owned', null,
        new.owned, null, null);
    end if;
    return null;
  end if;
  if old.removed_at is null and new.removed_at is not null then
    perform private.note_library_event(new.user_id, new.book_id, 'removed', null,
      null, null, new.removed_at);
  elsif old.removed_at is not null and new.removed_at is null then
    perform private.note_library_event(new.user_id, new.book_id, 'restored', null,
      null, null, null);
  end if;
  if old.status is distinct from new.status then
    perform private.note_library_event(new.user_id, new.book_id, 'status', old.status,
      new.status, null, new.status_at);
  end if;
  if old.wanted_at is null and new.wanted_at is not null then
    perform private.note_library_event(new.user_id, new.book_id, 'wanted', null,
      null, null, new.wanted_at);
  elsif old.wanted_at is not null and new.wanted_at is null then
    perform private.note_library_event(new.user_id, new.book_id, 'unwanted', null,
      null, null, null);
  end if;
  if old.owned is distinct from new.owned then
    perform private.note_library_event(new.user_id, new.book_id, 'owned', old.owned,
      new.owned, null, null);
  end if;
  return null;
end;
$$;
revoke all on function private.library_entry_events() from public, anon, authenticated;
create trigger library_entries_events
  after insert or update of removed_at, status, wanted_at, owned
  on public.library_entries
  for each row execute function private.library_entry_events();

-- After a book is put on or taken off one of the reader's shelves. A place
-- taken off along with its library row (forget_books, AUD-055) is kept only
-- while the row is there; the row going takes its history with it.
create function private.library_shelf_book_events() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.note_library_event(new.user_id, new.book_id, 'shelved', null,
      null, new.shelf_id, new.added_at);
  elsif exists (
      select 1 from public.library_entries e
      where e.user_id = old.user_id and e.book_id = old.book_id)
    and exists (
      select 1 from public.library_shelves s
      where s.id = old.shelf_id and s.user_id = old.user_id) then
    perform private.note_library_event(old.user_id, old.book_id, 'unshelved', null,
      null, old.shelf_id, null);
  end if;
  return null;
end;
$$;
revoke all on function private.library_shelf_book_events() from public, anon, authenticated;
create trigger library_shelf_books_events after insert or delete
  on public.library_shelf_books
  for each row execute function private.library_shelf_book_events();

-- Every night: rows go after a year, and the days counted before yesterday.
create function private.forget_library_events() returns void
language sql security definer set search_path = '' as $$
  delete from public.library_events e where e.at < now() - interval '1 year';
  delete from private.library_event_days d
  where d.day < (now() at time zone 'utc')::date - 1;
$$;
revoke all on function private.forget_library_events() from public, anon, authenticated;

-- 19:31 UTC is 04:31 in Japan, clear of the other nightly work (18:40, 18:47, 19:13).
select cron.schedule('library-events', '31 19 * * *', 'select private.forget_library_events()');
