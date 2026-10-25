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
-- The history is written once a write (statement triggers), and a write is
-- never refused for it: when a reader has kept LIBRARY_EVENTS_PER_DAY rows
-- in the last day (a script, not a person), further changes are simply not
-- kept, and the library write goes on. Nothing is locked for it.
--
-- Rollback (a new migration):
--   select cron.unschedule('library-events');
--   drop trigger library_entries_added on public.library_entries;
--   drop trigger library_entries_changed on public.library_entries;
--   drop trigger library_shelf_books_added on public.library_shelf_books;
--   drop trigger library_shelf_books_taken on public.library_shelf_books;
--   drop table public.library_events;
--   drop function private.forget_library_events(), private.library_entries_added(),
--     private.library_entries_changed(), private.library_shelf_books_added(),
--     private.library_shelf_books_taken(), private.keeps_library_events(uuid);
--   and, while no row has via 'shop' (any there are readers' own: ask first):
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
  -- A uuid, not a running number: a number would tell a reader how much
  -- everyone else did between two of their own changes.
  id uuid primary key default gen_random_uuid(),
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
  -- When the database took the change, never a time the row carries: an
  -- undo writes a row back with its old times, and its history must still
  -- come last. The changes of one write are a microsecond apart, in order,
  -- and the clock moves on within a transaction (clock_timestamp).
  at timestamptz not null default clock_timestamp(),
  constraint library_events_shelf check ((shelf_id is not null) = (kind in ('shelved', 'unshelved'))),
  foreign key (user_id, book_id)
    references public.library_entries (user_id, book_id)
    on delete cascade on update cascade,
  foreign key (shelf_id, user_id)
    references public.library_shelves (id, user_id) on delete cascade
);
-- A reader's history, the newest first (and today's rows, counted below);
-- a book's; the rows going after a year.
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

-- Whether this write's history is kept: only a reader's own request (not the
-- database's own work, a migration, a nightly job, moving rows to a reader's
-- own copy of a book, nor an account being deleted), and only while the
-- reader has kept fewer than LIBRARY_EVENTS_PER_DAY rows in the last day.
-- Counted from the table itself, once a write: no row is locked, so no two
-- writes wait on each other for it. Two at once may each pass the limit by a
-- write's worth; it bounds a script, not a person.
create function private.keeps_library_events(reader uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select reader is not null and private.asked_by_reader()
    -- LIBRARY_EVENTS_PER_DAY: some fifty times a busy day's (a series of 200
    -- volumes registered, sorted and shelved is about a thousand rows).
    and (select count(*) from (
      select 1 from public.library_events e
      where e.user_id = reader and e.at > now() - interval '1 day'
      limit 50000) today) < 50000
$$;
revoke all on function private.keeps_library_events(uuid) from public, anon, authenticated;

-- After each write of library rows, once for the whole write: what came in.
create function private.library_entries_added() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t0 timestamptz := clock_timestamp();
  manage boolean;
begin
  if not private.keeps_library_events(me) then
    return null;
  end if;
  manage := private.reader_mode(me) = 'manage';
  insert into public.library_events (user_id, book_id, kind, was, became, manage, at)
  select me, k.book_id, k.kind, null, k.became, manage,
    t0 + make_interval(secs => (row_number() over (order by k.nth, k.step)) / 1e6)
  from (
    select e.book_id, e.nth, x.step, x.kind, x.became
    from (select n.*, row_number() over () as nth from added n where n.user_id = me) e
    cross join lateral (values
      (1, 'added', e.source, true),
      (2, 'removed', null, e.removed_at is not null),
      (3, 'status', e.status, e.status is not null),
      (4, 'wanted', null, e.wanted_at is not null),
      (5, 'owned', e.owned, e.owned is not null)
    ) x (step, kind, became, happened)
    where x.happened) k;
  return null;
end;
$$;
revoke all on function private.library_entries_added() from public, anon, authenticated;
create trigger library_entries_added after insert on public.library_entries
  referencing new table as added
  for each statement execute function private.library_entries_added();

-- After each update of library rows: what changed in them.
create function private.library_entries_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t0 timestamptz := clock_timestamp();
  manage boolean;
begin
  if not private.keeps_library_events(me) then
    return null;
  end if;
  manage := private.reader_mode(me) = 'manage';
  insert into public.library_events (user_id, book_id, kind, was, became, manage, at)
  select me, k.book_id, k.kind, k.was, k.became, manage,
    t0 + make_interval(secs => (row_number() over (order by k.nth, k.step)) / 1e6)
  from (
  select n.book_id, n.nth, x.step, x.kind, x.was, x.became
  from (select n.*, row_number() over () as nth from after_rows n where n.user_id = me) n
  join before_rows o on o.user_id = n.user_id and o.book_id = n.book_id
  cross join lateral (values
    (1, case when o.removed_at is null and n.removed_at is not null then 'removed'
             when o.removed_at is not null and n.removed_at is null then 'restored' end,
     null, null),
    (2, case when o.status is distinct from n.status then 'status' end, o.status, n.status),
    (3, case when o.wanted_at is null and n.wanted_at is not null then 'wanted'
             when o.wanted_at is not null and n.wanted_at is null then 'unwanted' end,
     null, null),
    (4, case when o.owned is distinct from n.owned then 'owned' end, o.owned, n.owned)
  ) x (step, kind, was, became)
  where x.kind is not null) k;
  return null;
end;
$$;
revoke all on function private.library_entries_changed() from public, anon, authenticated;
create trigger library_entries_changed after update on public.library_entries
  referencing old table as before_rows new table as after_rows
  for each statement execute function private.library_entries_changed();

-- After books are put on one of the reader's shelves.
create function private.library_shelf_books_added() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t0 timestamptz := clock_timestamp();
begin
  if not private.keeps_library_events(me) then
    return null;
  end if;
  insert into public.library_events (user_id, book_id, kind, shelf_id, manage, at)
  select me, a.book_id, 'shelved', a.shelf_id, private.reader_mode(me) = 'manage',
    t0 + make_interval(secs => (row_number() over ()) / 1e6)
  from added a where a.user_id = me;
  return null;
end;
$$;
revoke all on function private.library_shelf_books_added() from public, anon, authenticated;
create trigger library_shelf_books_added after insert on public.library_shelf_books
  referencing new table as added
  for each statement execute function private.library_shelf_books_added();

-- After books are taken off. A place taken off along with its library row or
-- its shelf (forget_books, AUD-055; an account going) is kept only while the
-- row and the shelf are there; the row going takes its history with it.
create function private.library_shelf_books_taken() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t0 timestamptz := clock_timestamp();
begin
  if not private.keeps_library_events(me) then
    return null;
  end if;
  insert into public.library_events (user_id, book_id, kind, shelf_id, manage, at)
  select me, t.book_id, 'unshelved', t.shelf_id, private.reader_mode(me) = 'manage',
    t0 + make_interval(secs => (row_number() over ()) / 1e6)
  from taken t
  where t.user_id = me
    and exists (select 1 from public.library_entries e
                where e.user_id = t.user_id and e.book_id = t.book_id)
    and exists (select 1 from public.library_shelves s
                where s.id = t.shelf_id and s.user_id = t.user_id);
  return null;
end;
$$;
revoke all on function private.library_shelf_books_taken() from public, anon, authenticated;
create trigger library_shelf_books_taken after delete on public.library_shelf_books
  referencing old table as taken
  for each statement execute function private.library_shelf_books_taken();

-- Every night: rows go after a year.
create function private.forget_library_events() returns void
language sql security definer set search_path = '' as $$
  delete from public.library_events e where e.at < now() - interval '1 year';
$$;
revoke all on function private.forget_library_events() from public, anon, authenticated;

-- 19:31 UTC is 04:31 in Japan, clear of the other nightly work (18:40, 18:47, 19:13).
select cron.schedule('library-events', '31 19 * * *', 'select private.forget_library_events()');
