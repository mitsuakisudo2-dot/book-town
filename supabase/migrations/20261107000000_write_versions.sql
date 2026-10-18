-- What a reader saves whole is written only over the version it began from
-- (AUD-003; docs/09「版を確かめて書く」). Their shop's shelves, their store
-- scene, 人生の9冊 and each of their posters are each written as one thing,
-- so a device that read them yesterday (a phone left open) and changes them
-- today would write its old copy over what another device saved since. Each
-- of these now has a version the database counts, going up with every change
-- however it was written:
--
--   shop_private.shelves_version  the shop's shelves
--   shop_private.scene_version    the store scene
--   profiles.nine_version         人生の9冊 (its rows are in profile_nine)
--   posters.version               a poster's template, look, pages, spoiler
--                                 mark, timeline choice and status
--
-- The app reads the version with the thing and writes through save_shelves,
-- save_scene, save_nine or save_poster, naming the version it began from
-- (base). The database writes only when it still holds that version; when it
-- already holds exactly what is sent (sent again, its answer lost on the way)
-- it writes nothing; otherwise it writes nothing and answers PT409 (HTTP
-- 409), and the app reads again and tells the reader it changed on another
-- device. Each answers the version it holds now. A thing never saved is at
-- version 0 (a shop with no private row, a nine never kept). The old ways
-- of writing (an upsert of shop_private, an update of posters,
-- replace_profile_nine) still work for an app from before this file, and
-- still count a version, so a newer app's device sees their change; sent
-- again with what is already held, they write nothing and count nothing.
-- Nobody can write a version themselves.
--
-- No row changes: the new columns begin at 0. The copy the last move kept
-- (20261106000000_own_books_only, checked in production on 2026-10-18) is let
-- go, as that file planned; once let go it cannot be restored.
--
-- Rollback: a new migration with
--   drop trigger shop_private_versions on public.shop_private;
--   drop trigger posters_versions on public.posters;
--   drop trigger profile_nine_versions_insert on public.profile_nine;
--   drop trigger profile_nine_versions_update on public.profile_nine;
--   drop trigger profile_nine_versions_delete on public.profile_nine;
--   drop trigger profiles_keep_nine_version on public.profiles;
--   drop function public.save_shelves(uuid, jsonb, bigint),
--     public.save_scene(uuid, jsonb, bigint),
--     public.save_nine(uuid[], text[], bigint),
--     public.save_poster(uuid, jsonb, bigint),
--     private.count_shop_versions(), private.count_poster_version(),
--     private.count_nine_version(), private.keep_nine_version();
--   create or replace function public.replace_profile_nine(book_ids uuid[], notes text[])
--   returns void
--   language plpgsql security invoker set search_path = '' as $$
--   begin
--     if (select auth.uid()) is null then
--       raise exception 'not signed in' using errcode = '42501';
--     end if;
--     if coalesce(array_length(book_ids, 1), 0) > 9
--       or coalesce(array_length(book_ids, 1), 0) <> coalesce(array_length(notes, 1), 0)
--     then
--       raise exception 'the nine takes up to nine books, each with a note'
--         using errcode = '22023';
--     end if;
--     delete from public.profile_nine where profile_id = (select auth.uid());
--     insert into public.profile_nine (profile_id, position, book_id, note)
--     select (select auth.uid()), entry.position, entry.book_id, notes[entry.position]
--     from unnest(book_ids) with ordinality as entry(book_id, position);
--   end;
--   $$;
--   drop function private.holds_nine(uuid, uuid[], text[]);
--   alter table public.shop_private drop column shelves_version,
--     drop column scene_version;
--   alter table public.posters drop column version;
--   alter table public.profiles drop column nine_version;
-- An app that reads versions then finds none and writes the old way again
-- (pnpm test:db runs the rollback, pnpm test:town-sync the app without them).

select private.drop_copy('20261106000000_own_books_only');

-- Each table's writes wait while its column is added. A long write already
-- holding one stops this file after 10s, rather than every write to the
-- table waiting behind it.
select set_config('lock_timeout', '10s', true);
alter table public.shop_private
  add column shelves_version bigint not null default 0,
  add column scene_version bigint not null default 0;
alter table public.posters add column version bigint not null default 0;
alter table public.profiles add column nine_version bigint not null default 0;

-- Counting ---------------------------------------------------------------------

-- Each part goes one up when it changes. A shop with no private row has empty
-- shelves and no scene at version 0, so a row made with shelves or a scene
-- begins that part at 1: made meanwhile on another device, it is a change
-- from what a device that found no row began from. What a writer sends for
-- a version is never taken.
create function private.count_shop_versions() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.shelves_version := (new.shelves is distinct from '[]'::jsonb)::integer;
    new.scene_version := (new.scene is not null)::integer;
  else
    new.shelves_version := old.shelves_version
      + (new.shelves is distinct from old.shelves)::integer;
    new.scene_version := old.scene_version
      + (new.scene is distinct from old.scene)::integer;
  end if;
  return new;
end;
$$;
revoke all on function private.count_shop_versions() from public, anon, authenticated;
create trigger shop_private_versions before insert or update on public.shop_private
  for each row execute function private.count_shop_versions();

-- What the app writes of a poster. Whether others may hang it in their shops
-- (allow_display) is not the app's to write yet, and is not counted.
create function private.count_poster_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.version := 0;
  else
    new.version := old.version + ((new.template, new.theme, new.font, new.pages,
      new.spoiler, new.show_in_timeline, new.status)
      is distinct from (old.template, old.theme, old.font, old.pages,
      old.spoiler, old.show_in_timeline, old.status))::integer;
  end if;
  return new;
end;
$$;
revoke all on function private.count_poster_version() from public, anon, authenticated;
create trigger posters_versions before insert or update on public.posters
  for each row execute function private.count_poster_version();

-- The nine is up to nine rows of profile_nine, so its version is kept on the
-- reader's profile: one up for each statement that changed any of their rows
-- (replace_profile_nine takes the old rows out, then puts the new ones in).
create function private.count_nine_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p set nine_version = p.nine_version + 1
  where p.id in (select c.profile_id from changed c);
  return null;
end;
$$;
revoke all on function private.count_nine_version() from public, anon, authenticated;
create trigger profile_nine_versions_insert after insert on public.profile_nine
  referencing new table as changed
  for each statement execute function private.count_nine_version();
create trigger profile_nine_versions_update after update on public.profile_nine
  referencing new table as changed
  for each statement execute function private.count_nine_version();
create trigger profile_nine_versions_delete after delete on public.profile_nine
  referencing old table as changed
  for each statement execute function private.count_nine_version();

-- Whether the reader's nine is already these books with these notes, in
-- this order.
create function private.holds_nine(reader uuid, book_ids uuid[], notes text[])
returns boolean
language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(n.book_id order by n.position), '{}')
      = coalesce(book_ids, '{}')
    and coalesce(array_agg(n.note order by n.position), '{}')
      = coalesce(notes, '{}')
  from public.profile_nine n where n.profile_id = reader;
$$;
revoke all on function private.holds_nine(uuid, uuid[], text[]) from public, anon, authenticated;
grant execute on function private.holds_nine(uuid, uuid[], text[]) to authenticated;

-- The old way of keeping the nine, for an app from before this file: as
-- before, but it takes the profile first, as save_nine does (so the two
-- never wait on each other), and writes nothing when the nine is already
-- what it sends (sent again, its answer lost), so its version stays.
create or replace function public.replace_profile_nine(book_ids uuid[], notes text[])
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  reader uuid := (select auth.uid());
begin
  if reader is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if coalesce(array_length(book_ids, 1), 0) > 9
    or coalesce(array_length(book_ids, 1), 0) <> coalesce(array_length(notes, 1), 0)
  then
    raise exception 'the nine takes up to nine books, each with a note'
      using errcode = '22023';
  end if;
  perform 1 from public.profiles p where p.id = reader for no key update;
  if private.holds_nine(reader, book_ids, notes) then
    return;
  end if;
  delete from public.profile_nine where profile_id = reader;
  insert into public.profile_nine (profile_id, position, book_id, note)
  select reader, entry.position, entry.book_id, notes[entry.position]
  from unnest(book_ids) with ordinality as entry(book_id, position);
end;
$$;

-- Only count_nine_version moves the version (it runs as the table's owner);
-- a reader's own update of their profile leaves it as it is.
create function private.keep_nine_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.nine_version := 0;
    else
      new.nine_version := old.nine_version;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.keep_nine_version() from public, anon, authenticated;
create trigger profiles_keep_nine_version before insert or update on public.profiles
  for each row execute function private.keep_nine_version();

-- Writing over a version ---------------------------------------------------------

-- Each runs with the reader's own rights: the policies and the checks on the
-- tables apply as to any other write. A refusal names no value. The row is
-- held while it is compared and written (for no key update: rows that point
-- at it, a follow or a poster's books, are still written meanwhile).

-- The shop's shelves. A shop with no private row yet gets one.
create function public.save_shelves(shop uuid, value jsonb, base bigint)
returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  held record;
  now_at bigint;
begin
  select sp.shelves, sp.shelves_version into held
  from public.shop_private sp where sp.shop_id = shop for no key update;
  if not found then
    insert into public.shop_private as sp (shop_id, shelves) values (shop, value)
    on conflict (shop_id) do nothing
    returning sp.shelves_version into now_at;
    if now_at is not null then
      return now_at;
    end if;
    -- Made meanwhile, from another page: written over its version as any is.
    select sp.shelves, sp.shelves_version into held
    from public.shop_private sp where sp.shop_id = shop for no key update;
    if not found then
      raise exception 'only the owner writes a shop''s shelves' using errcode = '42501';
    end if;
  end if;
  if held.shelves = value then
    return held.shelves_version;
  end if;
  if held.shelves_version is distinct from base then
    raise exception 'the shelves changed since' using errcode = 'PT409';
  end if;
  update public.shop_private sp set shelves = value where sp.shop_id = shop
  returning sp.shelves_version into now_at;
  return now_at;
end;
$$;
revoke all on function public.save_shelves(uuid, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.save_shelves(uuid, jsonb, bigint) to authenticated;

-- The store scene; null takes it down.
create function public.save_scene(shop uuid, value jsonb, base bigint)
returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  held record;
  now_at bigint;
begin
  select sp.scene, sp.scene_version into held
  from public.shop_private sp where sp.shop_id = shop for no key update;
  if not found then
    insert into public.shop_private as sp (shop_id, scene) values (shop, value)
    on conflict (shop_id) do nothing
    returning sp.scene_version into now_at;
    if now_at is not null then
      return now_at;
    end if;
    select sp.scene, sp.scene_version into held
    from public.shop_private sp where sp.shop_id = shop for no key update;
    if not found then
      raise exception 'only the owner writes a shop''s scene' using errcode = '42501';
    end if;
  end if;
  if held.scene is not distinct from value then
    return held.scene_version;
  end if;
  if held.scene_version is distinct from base then
    raise exception 'the scene changed since' using errcode = 'PT409';
  end if;
  update public.shop_private sp set scene = value where sp.shop_id = shop
  returning sp.scene_version into now_at;
  return now_at;
end;
$$;
revoke all on function public.save_scene(uuid, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.save_scene(uuid, jsonb, bigint) to authenticated;

-- The reader's nine, in order, each with its note (as replace_profile_nine).
create function public.save_nine(book_ids uuid[], notes text[], base bigint)
returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  reader uuid := (select auth.uid());
  held bigint;
begin
  if reader is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select p.nine_version into held from public.profiles p
  where p.id = reader for no key update;
  if not found then
    raise exception 'only a reader keeps a nine' using errcode = '42501';
  end if;
  if private.holds_nine(reader, book_ids, notes) then
    return held;
  end if;
  if held is distinct from base then
    raise exception 'the nine changed since' using errcode = 'PT409';
  end if;
  perform public.replace_profile_nine(book_ids, notes);
  return (select p.nine_version from public.profiles p where p.id = reader);
end;
$$;
revoke all on function public.save_nine(uuid[], text[], bigint) from public, anon, authenticated;
grant execute on function public.save_nine(uuid[], text[], bigint) to authenticated;

-- One of the reader's posters, by the fields the app writes (template, theme,
-- font, pages, spoiler, show_in_timeline, status). A poster made here comes
-- with no base: it is made if it is not there yet, and one already there (an
-- earlier try whose answer was lost, or one still on its way) is written
-- over as at version 0. A poster known saved (with a base) that is gone was
-- taken down elsewhere.
create function public.save_poster(poster uuid, value jsonb, base bigint default null)
returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  reader uuid := (select auth.uid());
  held public.posters%rowtype;
  now_at bigint;
begin
  if reader is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into held from public.posters p
  where p.id = poster and p.author_id = reader for no key update;
  if not found then
    if base is not null then
      raise exception 'the poster was taken down' using errcode = 'PT409';
    end if;
    insert into public.posters as p (id, author_id, template, theme, font,
      pages, spoiler, show_in_timeline, status)
    values (poster, reader, value ->> 'template', value ->> 'theme',
      value ->> 'font', value -> 'pages', (value ->> 'spoiler')::boolean,
      (value ->> 'show_in_timeline')::boolean, value ->> 'status')
    on conflict (id) do nothing
    returning p.version into now_at;
    if now_at is not null then
      return now_at;
    end if;
    select * into held from public.posters p
    where p.id = poster and p.author_id = reader for no key update;
    if not found then
      raise exception 'only its maker writes a poster' using errcode = '42501';
    end if;
  end if;
  if (held.template, held.theme, held.font, held.pages, held.spoiler,
      held.show_in_timeline, held.status)
    is not distinct from (value ->> 'template', value ->> 'theme',
      value ->> 'font', value -> 'pages', (value ->> 'spoiler')::boolean,
      (value ->> 'show_in_timeline')::boolean, value ->> 'status') then
    return held.version;
  end if;
  if held.version is distinct from coalesce(base, 0) then
    raise exception 'the poster changed since' using errcode = 'PT409';
  end if;
  update public.posters p set
    template = value ->> 'template',
    theme = value ->> 'theme',
    font = value ->> 'font',
    pages = value -> 'pages',
    spoiler = (value ->> 'spoiler')::boolean,
    show_in_timeline = (value ->> 'show_in_timeline')::boolean,
    status = value ->> 'status'
  where p.id = poster
  returning p.version into now_at;
  return now_at;
end;
$$;
revoke all on function public.save_poster(uuid, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.save_poster(uuid, jsonb, bigint) to authenticated;
