-- 読書管理モードの土台 (item 98 of the plan). The design is
-- 読書管理モード_基本設計_2026-10-18 (decided by けにーさん 10-18 02:06Z,
-- 02:09Z, 02:11Z and 02:16Z), the conditions those of item 98. The screens
-- (item 99) come later; this file is what would mean rebuilding if added
-- after them: the data, who has a public profile, and what the database
-- refuses.
--
--   reader_settings.mode    'normal' or 'manage' (読書管理モード), the
--                           reader's own, on the server, the same on every
--                           device and readable by nobody else. Switching
--                           writes this one column and touches nothing else.
--   profiles.published      whether the reader has a public profile. Every
--                           profile there is now is published, and stays
--                           so. One made unpublished (someone who only keeps
--                           their reading) has no handle and may have no
--                           name, is read by nobody but its reader, and may
--                           be published later, never taken back here.
--                           private.is_hidden('profile', id) is true of it,
--                           so every policy and function that leaves out
--                           a person the operator hid leaves it out too:
--                           the town, the search, counts, records, shops,
--                           posters, the nine, reading together.
--   private.reaches_people  published and in normal mode. Only then does the
--                           database take a new write that reaches people:
--                           a 便り or reply (a private note is not one), a
--                           like or 読みたくなった, a reaction to a POP, a
--                           follow of a person or a shop, a like or ひとこと
--                           to a shop, opening a shop or changing what an
--                           open one shows, putting up or changing a put-up
--                           poster, reading together, and widening who sees
--                           a record, a book's status or a shelf. Taking
--                           things back is never refused: deleting,
--                           narrowing, closing, unfollowing, blocking,
--                           reporting, leaving. A refusal is 42501 with the
--                           hint 'booktown:reading_mode' (or
--                           'booktown:no_public_profile'), so an app can say
--                           why; it changes no row.
--   made in which mode      library_entries.added_mode, reading_entries,
--                           reading_sessions and library_shelves.made_mode:
--                           the mode the row was made in, written by the
--                           database, never by the app. A row made in manage
--                           mode, or by someone without a public profile,
--                           starts private whatever the app sent.
--   a book's status         library_entries.audience and detail: who sees the
--                           book's 読みたい・読書中・読了 (as 見せる範囲: 自分だけ,
--                           人数だけ, フォロワー限定, 公開), each book its own,
--                           starting from the reader's status_audience and
--                           status_detail. Every row there now is 人数だけ, as
--                           every reader's starting choice is (production,
--                           10-24: no reader changed it, and no screen offers
--                           it yet). A narrower starting choice narrows the
--                           books kept before, as records do.
--   shown to others         library_entries.status_held and wanted_held, with
--                           shown_status and shown_wanted_at: a change made in
--                           manage mode to a book's status or 読みたい is
--                           kept from others, who go on seeing what normal
--                           mode last showed (02:16Z). The next change of
--                           the book's status or 読みたい made in normal mode
--                           shows the book as it is now. A book taken out
--                           (removed_at) is out at once in either mode; one
--                           brought back in manage mode shows nothing.
--   counted                 private.status_counted(entry): the one rule for
--                           whether, and as what, a book's status counts in
--                           a number others see (読了 N人 of item 17).
--                           Never a row made in manage mode, even made public
--                           by hand (02:11Z); a row of normal mode while it is
--                           人数だけ or wider; never a person without a public
--                           profile or hidden by the operator. A block does
--                           not change it. private.reading_counts(works)
--                           counts each person once a work.
--   terms                   private.terms_versions (written by the operator
--                           when the terms are published, item 44; none yet)
--                           and public.terms_consents, each reader's consent
--                           to a version with being 13 or older, kept by
--                           version so a large change asks again
--                           (public.terms_to_agree()).
--
-- Nothing moves: the new columns are added with constant defaults (normal,
-- published, made in normal mode, 人数だけ, nothing held), no row is
-- rewritten, and each new rule is a trigger or a policy. The tables are
-- copied all the same (private.keep_copy), as item 98 asks, and checked.
--
-- Rollback: a new migration with
--   drop trigger library_entries_reading_mode on public.library_entries;
--   drop trigger reading_entries_reading_mode on public.reading_entries;
--   drop trigger reading_sessions_reading_mode on public.reading_sessions;
--   drop trigger library_shelves_reading_mode on public.library_shelves;
--   drop trigger reader_settings_narrow_status on public.reader_settings;
--   drop trigger profiles_publishing on public.profiles;
--   drop trigger posts_reaching on public.posts;
--   drop trigger post_reactions_reaching on public.post_reactions;
--   drop trigger pop_reactions_reaching on public.pop_reactions;
--   drop trigger shop_reactions_reaching on public.shop_reactions;
--   drop trigger profile_follows_reaching on public.profile_follows;
--   drop trigger shop_follows_reaching on public.shop_follows;
--   drop trigger shops_reaching on public.shops;
--   drop trigger posters_reaching on public.posters;
--   drop table public.terms_consents, private.terms_versions;
--   drop function private.library_entry_mode(), private.reading_entry_mode(),
--     private.reading_session_mode(), private.library_shelf_mode(),
--     private.narrow_status(), private.profile_publishing(),
--     private.post_reaching(), private.reaction_reaching(),
--     private.shop_reaction_reaching(), private.follow_reaching(),
--     private.shop_reaching(), private.poster_reaching(),
--     private.reading_counts(uuid[]), private.status_counted(public.library_entries),
--     private.status_rank(text, text), private.refuse_unless_reaching(uuid),
--     private.reaches_people(uuid), private.reader_mode(uuid),
--     private.asked_by_reader(), public.terms_to_agree(), private.current_terms();
--   create or replace function private.is_hidden(kind text, target uuid)
--     returns boolean language sql stable security definer set search_path = '' as $$
--     select exists (
--       select 1 from public.moderation_hides h
--       where h.target_kind = kind and h.target_id = target
--     ) or exists (
--       select 1 from public.moderation_folds f
--       where f.target_kind = kind and f.target_id = target and f.state = 'held'
--     ) $$;
--   alter table public.library_entries drop column added_mode, drop column audience,
--     drop column detail, drop column status_held, drop column shown_status,
--     drop column wanted_held, drop column shown_wanted_at;
--   alter table public.reading_entries drop column made_mode;
--   alter table public.reading_sessions drop column made_mode;
--   alter table public.library_shelves drop column made_mode;
--   alter table public.reader_settings drop column mode;
--   alter table public.profiles drop constraint profiles_published_named,
--     drop constraint profiles_name_check,
--     add constraint profiles_name_check
--       check (char_length(btrim(name)) between 1 and 80),
--     alter column handle set not null, drop column published;
-- Only while no profile is unpublished (otherwise its handle is empty and the
-- constraints refuse it): until then nobody can have one, as no screen makes
-- one. An app that writes mode, published or a book's audience has to go
-- back first: a write naming a column the database lacks is refused.

select private.keep_copy('20261207000000_reading_mode',
  array['public.profiles', 'public.reader_settings', 'public.library_entries',
    'public.reading_entries', 'public.reading_sessions',
    'public.library_shelves']::regclass[]);

-- The mode -------------------------------------------------------------------------

-- No row still means the defaults: normal.
alter table public.reader_settings
  add column mode text not null default 'normal' check (mode in ('normal', 'manage'));
grant insert (mode), update (mode) on public.reader_settings to authenticated;

-- A public profile -------------------------------------------------------------------

alter table public.profiles
  add column published boolean not null default true;
alter table public.profiles alter column handle drop not null;
alter table public.profiles drop constraint profiles_name_check,
  add constraint profiles_name_check check (char_length(btrim(name)) <= 80
    and (not published or char_length(btrim(name)) >= 1)),
  -- Others find a published profile by its handle. An unpublished one has
  -- none, so no handle taken tells anyone it is there.
  add constraint profiles_published_named check (not published or handle is not null);

-- Asked by a reader through the API (not by the database's own work, a
-- migration or a nightly job, nor while give_own_copy moves a reader's rows
-- to their own copy of a book). Only such writes are refused or stamped
-- from the reader's state.
create function private.asked_by_reader() returns boolean
language sql stable set search_path = '' as $$
  select (select auth.uid()) is not null
    and current_setting('private.copying', true) is distinct from 'on'
$$;
revoke all on function private.asked_by_reader() from public, anon, authenticated;
grant execute on function private.asked_by_reader() to authenticated;

create function private.reader_mode(reader uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.mode from public.reader_settings s where s.user_id = reader), 'normal')
$$;
revoke all on function private.reader_mode(uuid) from public, anon, authenticated;
grant execute on function private.reader_mode(uuid) to authenticated;

create function private.reaches_people(reader uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.published from public.profiles p where p.id = reader), false)
    and private.reader_mode(reader) = 'normal'
$$;
revoke all on function private.reaches_people(uuid) from public, anon, authenticated;
grant execute on function private.reaches_people(uuid) to authenticated;

-- Refuses, as the reader's request, a write that would reach people. Only
-- the table and the reason are in the error, never a row's value.
create function private.refuse_unless_reaching(reader uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  if private.asked_by_reader() and not private.reaches_people(reader) then
    raise exception 'this reaches people, which the reader has turned off'
      using errcode = '42501',
        hint = case when private.reader_mode(reader) = 'manage'
          then 'booktown:reading_mode' else 'booktown:no_public_profile' end;
  end if;
end;
$$;
revoke all on function private.refuse_unless_reaching(uuid) from public, anon, authenticated;
grant execute on function private.refuse_unless_reaching(uuid) to authenticated;

-- A profile is published once, by its reader; never unpublished by a
-- request (the screens decide in item 99 whether anything should).
create function private.profile_publishing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.published and not new.published and private.asked_by_reader() then
    raise exception 'a public profile is not taken back here'
      using errcode = '42501', hint = 'booktown:published';
  end if;
  return new;
end;
$$;
revoke all on function private.profile_publishing() from public, anon, authenticated;
create trigger profiles_publishing before update of published on public.profiles
  for each row execute function private.profile_publishing();

-- An unpublished profile is left out wherever a hidden person is. Every
-- policy that asks keeps asking; the answer changes here alone.
create or replace function private.is_hidden(kind text, target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.moderation_hides h
    where h.target_kind = kind and h.target_id = target
  ) or exists (
    select 1 from public.moderation_folds f
    where f.target_kind = kind and f.target_id = target and f.state = 'held'
  ) or (
    kind = 'profile' and exists (
      select 1 from public.profiles p where p.id = target and not p.published
    )
  )
$$;

-- Writes that reach people -----------------------------------------------------------

-- A 便り, a reply or a 一緒に読む memo reaches people; a private note does not.
create function private.post_reaching() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.reading_mode is distinct from 'solo' then
    perform private.refuse_unless_reaching(new.author_id);
  end if;
  return new;
end;
$$;
revoke all on function private.post_reaching() from public, anon, authenticated;
create trigger posts_reaching before insert on public.posts
  for each row execute function private.post_reaching();

-- A like, 読みたくなった (pressed again too) or a reaction to a POP.
create function private.reaction_reaching() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform private.refuse_unless_reaching(new.user_id);
  return new;
end;
$$;
revoke all on function private.reaction_reaching() from public, anon, authenticated;
create trigger post_reactions_reaching before insert or update on public.post_reactions
  for each row execute function private.reaction_reaching();
create trigger pop_reactions_reaching before insert or update on public.pop_reactions
  for each row execute function private.reaction_reaching();

-- A shop's like and ひとこと: taking either back is not refused.
create function private.shop_reaction_reaching() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.liked or new.message <> '' then
      perform private.refuse_unless_reaching(new.user_id);
    end if;
  elsif (new.liked and not old.liked)
      or (new.message <> '' and new.message is distinct from old.message) then
    perform private.refuse_unless_reaching(new.user_id);
  end if;
  return new;
end;
$$;
revoke all on function private.shop_reaction_reaching() from public, anon, authenticated;
create trigger shop_reactions_reaching before insert or update on public.shop_reactions
  for each row execute function private.shop_reaction_reaching();

create function private.follow_reaching() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform private.refuse_unless_reaching(new.follower_id);
  return new;
end;
$$;
revoke all on function private.follow_reaching() from public, anon, authenticated;
create trigger profile_follows_reaching before insert or update on public.profile_follows
  for each row execute function private.follow_reaching();
create trigger shop_follows_reaching before insert or update on public.shop_follows
  for each row execute function private.follow_reaching();

-- An open shop shows its name, words, look, public shelves and public scene.
-- Opening one, or changing what an open one shows (the database's copy of
-- the shelves and scene a save makes), reaches people; closing does not,
-- nor what a closed shop keeps.
create function private.shop_reaching() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.is_open and (
    tg_op = 'INSERT' or not old.is_open
    or new.name is distinct from old.name
    or new.description is distinct from old.description
    or new.tagline is distinct from old.tagline
    or new.theme is distinct from old.theme
    or new.public_shelves is distinct from old.public_shelves
    or new.public_scene is distinct from old.public_scene
  ) then
    perform private.refuse_unless_reaching(new.owner_id);
  end if;
  return new;
end;
$$;
revoke all on function private.shop_reaching() from public, anon, authenticated;
create trigger shops_reaching before insert or update on public.shops
  for each row execute function private.shop_reaching();

-- A poster put up, or changed while up. Taking it down is not refused.
create function private.poster_reaching() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'published' and (
    tg_op = 'INSERT'
    or (to_jsonb(new) - 'updated_at' - 'version') is distinct from
       (to_jsonb(old) - 'updated_at' - 'version')
  ) then
    perform private.refuse_unless_reaching(new.author_id);
  end if;
  return new;
end;
$$;
revoke all on function private.poster_reaching() from public, anon, authenticated;
create trigger posters_reaching before insert or update on public.posters
  for each row execute function private.poster_reaching();

-- Who sees, from the narrowest: 自分だけ, 人数だけ, フォロワー限定, 公開.
create function private.status_rank(audience text, detail text) returns integer
language sql immutable set search_path = '' as $$
  select case
    when audience = 'private' then 0
    when audience = 'everyone' and detail = 'count' then 1
    when audience = 'followers' then 2
    when audience = 'everyone' then 3
  end
$$;
revoke all on function private.status_rank(text, text) from public, anon, authenticated;
grant execute on function private.status_rank(text, text) to authenticated;

-- Records ----------------------------------------------------------------------------

alter table public.reading_entries
  add column made_mode text not null default 'normal'
    check (made_mode in ('normal', 'manage'));

-- Runs after reading_entries_audience (triggers run by name), which has
-- settled audience from what the app sent.
create function private.reading_entry_mode() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if private.asked_by_reader() then
      new.made_mode := private.reader_mode(new.user_id);
      if not private.reaches_people(new.user_id) then
        new.audience := 'private';
      end if;
    end if;
  else
    new.made_mode := old.made_mode;
    if private.audience_rank(new.audience) > private.audience_rank(old.audience) then
      perform private.refuse_unless_reaching(new.user_id);
    end if;
  end if;
  new.is_public := new.audience = 'everyone';
  return new;
end;
$$;
revoke all on function private.reading_entry_mode() from public, anon, authenticated;
create trigger reading_entries_reading_mode before insert or update on public.reading_entries
  for each row execute function private.reading_entry_mode();

-- Reading ------------------------------------------------------------------------------

alter table public.reading_sessions
  add column made_mode text not null default 'normal'
    check (made_mode in ('normal', 'manage'));

-- Reading together is seen by everyone; reading alone by nobody else.
create function private.reading_session_mode() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if private.asked_by_reader() then
      new.made_mode := private.reader_mode(new.user_id);
    end if;
    if new.mode = 'together' then
      perform private.refuse_unless_reaching(new.user_id);
    end if;
  else
    new.made_mode := old.made_mode;
    if new.mode = 'together' and old.mode is distinct from 'together' then
      perform private.refuse_unless_reaching(new.user_id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.reading_session_mode() from public, anon, authenticated;
create trigger reading_sessions_reading_mode before insert or update on public.reading_sessions
  for each row execute function private.reading_session_mode();

-- Shelves of the library ----------------------------------------------------------------

alter table public.library_shelves
  add column made_mode text not null default 'normal'
    check (made_mode in ('normal', 'manage'));

create function private.library_shelf_mode() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if private.asked_by_reader() then
      new.made_mode := private.reader_mode(new.user_id);
      if not private.reaches_people(new.user_id) then
        new.audience := 'private';
      end if;
    end if;
  else
    new.made_mode := old.made_mode;
    if private.audience_rank(new.audience) > private.audience_rank(old.audience) then
      perform private.refuse_unless_reaching(new.user_id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.library_shelf_mode() from public, anon, authenticated;
create trigger library_shelves_reading_mode before insert or update on public.library_shelves
  for each row execute function private.library_shelf_mode();

-- A book's status ------------------------------------------------------------------------

alter table public.library_entries
  add column added_mode text not null default 'normal'
    check (added_mode in ('normal', 'manage')),
  add column audience text not null default 'everyone'
    check (audience in ('everyone', 'followers', 'private')),
  add column detail text not null default 'count'
    check (detail in ('content', 'count')),
  -- Held: others see shown_status (null: none) instead of status, as normal
  -- mode last showed it; the same for 読みたい.
  add column status_held boolean not null default false,
  add column shown_status text
    check (shown_status in ('tsundoku', 'reading', 'finished')),
  add column wanted_held boolean not null default false,
  add column shown_wanted_at timestamptz;
-- The reader sets a book's own audience; the rest is the database's.
grant update (audience, detail) on public.library_entries to authenticated;

create function private.library_entry_mode() returns trigger
language plpgsql set search_path = '' as $$
declare
  mode text;
  start record;
begin
  if not private.asked_by_reader() then
    return new;
  end if;
  mode := private.reader_mode(new.user_id);
  if tg_op = 'INSERT' then
    new.added_mode := mode;
    new.status_held := false;
    new.shown_status := null;
    new.wanted_held := false;
    new.shown_wanted_at := null;
    if private.reaches_people(new.user_id) then
      select coalesce(s.status_audience, 'everyone') as audience,
          coalesce(s.status_detail, 'count') as detail
        into start
        from (select 1) one
        left join public.reader_settings s on s.user_id = new.user_id;
      new.audience := start.audience;
      new.detail := start.detail;
    else
      new.audience := 'private';
      new.detail := 'count';
    end if;
    return new;
  end if;

  new.added_mode := old.added_mode;
  if private.status_rank(new.audience, new.detail)
      > private.status_rank(old.audience, old.detail) then
    perform private.refuse_unless_reaching(new.user_id);
  end if;

  if mode = 'manage' then
    -- Brought back in manage mode: nothing of it shows until normal mode
    -- changes it.
    if old.removed_at is not null and new.removed_at is null then
      new.status_held := true;
      new.shown_status := null;
      new.wanted_held := true;
      new.shown_wanted_at := null;
    else
      if new.status is distinct from old.status and not old.status_held then
        new.status_held := true;
        new.shown_status := old.status;
      end if;
      if new.wanted_at is distinct from old.wanted_at and not old.wanted_held then
        new.wanted_held := true;
        new.shown_wanted_at := old.wanted_at;
      end if;
    end if;
  elsif new.status is distinct from old.status
      or new.status_at is distinct from old.status_at
      or new.wanted_at is distinct from old.wanted_at then
    -- Normal mode changing the book's status or 読みたい shows the book as it
    -- is now, both of them: what the reader sees is what others see.
    new.status_held := false;
    new.shown_status := null;
    new.wanted_held := false;
    new.shown_wanted_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.library_entry_mode() from public, anon, authenticated;
create trigger library_entries_reading_mode before insert or update on public.library_entries
  for each row execute function private.library_entry_mode();

-- A narrower starting choice narrows the books kept before, at once, as
-- records do (private.narrow_past). Widening changes nothing; the app asks.
create function private.narrow_status() returns trigger
language plpgsql set search_path = '' as $$
declare
  rank integer := private.status_rank(new.status_audience, new.status_detail);
begin
  if rank < private.status_rank(old.status_audience, old.status_detail) then
    update public.library_entries e
    set audience = new.status_audience, detail = new.status_detail
    where e.user_id = new.user_id
      and private.status_rank(e.audience, e.detail) > rank;
  end if;
  return null;
end;
$$;
revoke all on function private.narrow_status() from public, anon, authenticated;
create trigger reader_settings_narrow_status
  after update of status_audience, status_detail on public.reader_settings
  for each row execute function private.narrow_status();

-- The one rule for numbers others see: as what the book counts (status, and
-- whether it is wanted), or nothing. Read by the functions that will show
-- numbers (item 17), not by readers.
create function private.status_counted(e public.library_entries,
    out status text, out wanted boolean)
language sql stable security definer set search_path = '' as $$
  select
    case when counted then
      case when e.status_held then e.shown_status else e.status end
    end,
    counted and (case when e.wanted_held then e.shown_wanted_at
      else e.wanted_at end) is not null
  from (select e.added_mode = 'normal'
      and e.removed_at is null
      and private.status_rank(e.audience, e.detail) >= 1
      and not private.is_hidden('profile', e.user_id) as counted) c
$$;
revoke all on function private.status_counted(public.library_entries)
  from public, anon, authenticated;

-- How many people want, are reading and have read each work, each person once
-- a work, whichever of its editions they keep (the furthest along of them).
create function private.reading_counts(works uuid[])
returns table (work_id uuid, wanted integer, reading integer, finished integer)
language sql stable security definer set search_path = '' as $$
  with counted as (
    select b.work_id, e.user_id, c.status, c.wanted
    from public.library_entries e
    join public.books b on b.id = e.book_id
    cross join lateral private.status_counted(e) c
    where b.work_id = any (works)
  ), per_person as (
    select k.work_id, k.user_id,
      bool_or(k.wanted) as wanted,
      max(case k.status when 'finished' then 2 when 'reading' then 1 else 0 end) as furthest
    from counted k
    group by k.work_id, k.user_id
  )
  select p.work_id,
    (count(*) filter (where p.wanted))::integer,
    (count(*) filter (where p.furthest = 1))::integer,
    (count(*) filter (where p.furthest = 2))::integer
  from per_person p
  group by p.work_id
$$;
revoke all on function private.reading_counts(uuid[]) from public, anon, authenticated;

-- Terms ----------------------------------------------------------------------------------

-- The terms' versions, as the operator publishes them (item 44). One that
-- asks_again asks everyone who agreed only to an older one.
create table private.terms_versions (
  version text primary key check (char_length(version) between 1 and 40),
  published_at timestamptz not null default now(),
  asks_again boolean not null default true
);
revoke all on private.terms_versions from public, anon, authenticated;

create function private.current_terms() returns text
language sql stable security definer set search_path = '' as $$
  select t.version from private.terms_versions t
  order by t.published_at desc, t.version desc limit 1
$$;
revoke all on function private.current_terms() from public, anon, authenticated;
grant execute on function private.current_terms() to authenticated;

-- Each reader's consent, once a version, with being 13 or older. Kept, not
-- changed; it goes with the account.
create table public.terms_consents (
  user_id uuid not null references public.profiles (id) on delete cascade,
  version text not null references private.terms_versions (version),
  agreed_at timestamptz not null default now(),
  thirteen_or_older boolean not null check (thirteen_or_older),
  primary key (user_id, version)
);
alter table public.terms_consents enable row level security;
revoke all on public.terms_consents from anon, authenticated;
grant select on public.terms_consents to authenticated;
grant insert (user_id, version, thirteen_or_older) on public.terms_consents to authenticated;
create policy "readers see what they agreed to" on public.terms_consents
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "readers agree to the terms now published" on public.terms_consents
  for insert to authenticated
  with check (user_id = (select auth.uid()) and version = private.current_terms());

-- The version the reader is to agree to now, or null: none published, or
-- they agreed to it, or to one after the last that asks again.
create function public.terms_to_agree() returns text
language sql stable security definer set search_path = '' as $$
  select private.current_terms()
  where (select auth.uid()) is not null
    and private.current_terms() is not null
    and not exists (
      select 1 from public.terms_consents c
      join private.terms_versions agreed on agreed.version = c.version
      where c.user_id = (select auth.uid())
        and agreed.published_at >= coalesce((
          select max(t.published_at) from private.terms_versions t where t.asks_again
        ), '-infinity')
    )
$$;
revoke all on function public.terms_to_agree() from public, anon, authenticated;
grant execute on function public.terms_to_agree() to authenticated;

select private.check_copy('20261207000000_reading_mode');
