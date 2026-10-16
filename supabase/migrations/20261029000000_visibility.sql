-- 見せる範囲 (item 8 of the 2026-10-16 plan). Until now a reading record was
-- public or private, and the profile kept which one new records started as.
-- From now on each thing a reader keeps is shown as far as they say, in two
-- parts kept apart (the owner's rule, 2026-10-16 05:31Z):
-- * who may read it (audience): everyone, followers (people who follow the
--   reader), or private (the reader alone);
-- * what is shown (detail, 読書の状態 only): the thing itself (content), or
--   only that one more person counts (count, 「人数だけ」).
-- The screens offer four choices made of them: 公開 (everyone, content),
-- フォロワー限定 (followers, content), 人数だけ (everyone, count) and 自分だけ
-- (private). フォロワー限定 is not offered until following people and 鍵
-- come (item 51); the database knows it already, so that item changes who
-- counts as a follower in one place (private.may_see) and nothing else.
--
-- Each kind of thing has the reader's own starting choice, kept in
-- reader_settings (not on profiles, which everyone reads), with the defaults
-- the owner decided: 読書の状態 (読みたい・読書中・読了) 人数だけ; reading
-- records, stats, liked posts, saved POPs and posters, encounters and the
-- library's shelves 自分だけ. Only reading records are shown to others today;
-- the other kinds come with their screens (items 10, 14, 15, 17, 19), which
-- give their rows a column of their own and read the starting choice here.
--
-- A starting choice applies to what is kept afterwards; a record can be set
-- otherwise one by one. Narrowing a starting choice narrows what was kept
-- before at once, exceptions too: this database does it (narrow_past), so no
-- record stays wider whatever the app does. Widening asks the reader whether
-- what was kept before widens too (「これまでの分も広げますか？」); the app
-- widens those records itself, one by one, as the reader's own changes.
--
-- What moves: each reading record's is_public becomes its audience (true:
-- everyone, false: private), and each profile whose reading_visibility was
-- public starts its reading records as everyone in reader_settings. Nothing
-- else changes, and no row is removed.
--
-- Apps from before this file keep working: is_public stays, kept equal to
-- audience = 'everyone' by the database, so whatever reads it (an old app,
-- book_is_listed, work_candidates) still means 「anyone may read」. A record
-- an old app writes with is_public, or turns public or private, takes that
-- as its audience. profiles.reading_visibility is still where a new profile
-- says how its records start (the signup screen, old or new), and where an
-- old app's setting goes; the database copies it into reader_settings when
-- it is written. The app reads reader_settings only.
--
-- The copy (moving_copies): reading_entries and reader_settings, the two
-- tables written to. docs/09「見せる範囲」has the rules and the undoing.
--
-- Rollback: until an app that writes audience is live, a new migration undoes
-- this one with
--   drop policy "books are seen where they are used" on public.books;
--   create policy "books are seen where they are used" on public.books
--     for select to anon, authenticated
--     using (source <> 'manual' or created_by = (select auth.uid())
--       or private.book_is_listed(id) or private.book_is_mine(id));
--   drop policy "reading records are seen as far as their reader lets them"
--     on public.reading_entries;
--   create policy "public reading records are seen, private ones by their reader"
--     on public.reading_entries for select to anon, authenticated
--     using (user_id = (select auth.uid()) or (is_public
--       and not private.is_blocked_with(user_id)
--       and not private.is_hidden('profile', user_id)));
--   drop trigger reader_settings_narrow on public.reader_settings;
--   drop trigger profiles_records_start on public.profiles;
--   drop trigger profiles_records_change on public.profiles;
--   drop trigger reading_entries_audience on public.reading_entries;
--   drop function private.narrow_past(), private.reading_entry_audience(),
--     private.records_start_from_profile(),
--     private.book_is_shared(uuid), private.may_see(uuid, text),
--     private.audience_rank(text);
--   drop index public.reading_entries_followers_book;
--   alter table public.reading_entries drop column audience;
--   alter table public.reader_settings drop column records_audience,
--     drop column status_audience, drop column status_detail,
--     drop column shelves_audience, drop column stats_audience,
--     drop column likes_audience, drop column saves_audience,
--     drop column encounters_audience;
--   comment on column public.profiles.reading_visibility is null;
-- (is_public is kept equal to the audience until then, so the records keep
-- what they showed; a record made followers-only reads as private.)
-- pnpm test:db runs exactly that, then drops the copy and runs this file
-- again. Once an app writes audience, production has to go back to an app
-- from before it first: a town that asks for a column the database lacks
-- does not load.

select private.keep_copy('20261029000000_visibility',
  array['public.reading_entries', 'public.reader_settings']::regclass[]);

-- Who may read ---------------------------------------------------------------------

-- From the narrowest: 自分だけ, フォロワー限定, 公開.
create function private.audience_rank(audience text) returns integer
language sql immutable set search_path = '' as $$
  select case audience
    when 'private' then 0 when 'followers' then 1 when 'everyone' then 2
  end
$$;
revoke all on function private.audience_rank(text) from public, anon, authenticated;
grant execute on function private.audience_rank(text) to authenticated;

-- Whether the asker may read what owner keeps as far as audience. The owner
-- always; others never across a block, nor what the operator hid of them
-- (or a serious report holds), as the records' policy asked before; for
-- followers, only someone following the owner. Following is open to anyone
-- until 鍵 comes (item 51), which narrows it here to followers the owner let
-- in. Signed out, only everyone.
create function private.may_see(owner uuid, audience text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(owner = (select auth.uid()), false)
    or (
      audience in ('everyone', 'followers')
      and not private.is_blocked_with(owner)
      and not private.is_hidden('profile', owner)
      and (
        audience = 'everyone'
        or exists (
          select 1 from public.profile_follows f
          where f.follower_id = (select auth.uid()) and f.followee_id = owner
        )
      )
    )
$$;
revoke all on function private.may_see(uuid, text) from public, anon, authenticated;
grant execute on function private.may_see(uuid, text) to anon, authenticated;

-- The starting choices ---------------------------------------------------------------

-- No row still means the defaults. The app saves the columns it changed.
alter table public.reader_settings
  -- 読み終えた本の記録 and, with item 18, the rest of 読書記録 and its progress.
  add column records_audience text not null default 'private'
    check (records_audience in ('everyone', 'followers', 'private')),
  -- 読書の状態: 読みたい・読書中・読了 (library_entries, items 14 and 17).
  add column status_audience text not null default 'everyone'
    check (status_audience in ('everyone', 'followers', 'private')),
  add column status_detail text not null default 'count'
    check (status_detail in ('content', 'count')),
  -- The library's shelves, each its own (item 15).
  add column shelves_audience text not null default 'private'
    check (shelves_audience in ('everyone', 'followers', 'private')),
  -- 読書の統計 (item 19).
  add column stats_audience text not null default 'private'
    check (stats_audience in ('everyone', 'followers', 'private')),
  -- いいねした感想 (item 10).
  add column likes_audience text not null default 'private'
    check (likes_audience in ('everyone', 'followers', 'private')),
  -- 保存した POP とポスター (item 10).
  add column saves_audience text not null default 'private'
    check (saves_audience in ('everyone', 'followers', 'private')),
  -- 本との出会い (book_encounters, items 9 and 17).
  add column encounters_audience text not null default 'private'
    check (encounters_audience in ('everyone', 'followers', 'private'));
grant insert (records_audience, status_audience, status_detail,
    shelves_audience, stats_audience, likes_audience, saves_audience,
    encounters_audience),
  update (records_audience, status_audience, status_detail,
    shelves_audience, stats_audience, likes_audience, saves_audience,
    encounters_audience)
  on public.reader_settings to authenticated;

-- Readers who chose public records keep starting them so.
insert into public.reader_settings (user_id, records_audience)
select p.id, 'everyone' from public.profiles p where p.reading_visibility = 'public'
on conflict (user_id) do update set records_audience = 'everyone';

comment on column public.profiles.reading_visibility is
  'How records start, as the signup screen and apps from before 20261029000000_visibility write it; copied into reader_settings.records_audience, which the app reads.';

-- Reading records --------------------------------------------------------------------

alter table public.reading_entries
  add column audience text check (audience in ('everyone', 'followers', 'private'));
-- Without touching updated_at: the record itself did not change.
alter table public.reading_entries disable trigger reading_entries_touch;
update public.reading_entries
set audience = case when is_public then 'everyone' else 'private' end;
alter table public.reading_entries enable trigger reading_entries_touch;
alter table public.reading_entries alter column audience set not null;
grant update (audience) on public.reading_entries to authenticated;

-- is_public follows audience. A record sent without an audience, or whose
-- is_public alone is changed, is an old app's: it takes is_public's word.
-- The new app sends audience and leaves is_public out.
create function private.reading_entry_audience() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.audience is null then
      new.audience := case when new.is_public then 'everyone' else 'private' end;
    end if;
  elsif new.audience is not distinct from old.audience
    and new.is_public is distinct from old.is_public then
    new.audience := case when new.is_public then 'everyone' else 'private' end;
  end if;
  new.is_public := new.audience = 'everyone';
  return new;
end;
$$;
revoke all on function private.reading_entry_audience() from public, anon, authenticated;
create trigger reading_entries_audience before insert or update on public.reading_entries
  for each row execute function private.reading_entry_audience();

drop policy "public reading records are seen, private ones by their reader"
  on public.reading_entries;
create policy "reading records are seen as far as their reader lets them"
  on public.reading_entries for select to anon, authenticated
  using (
    user_id = (select auth.uid())
    or (audience <> 'private' and private.may_see(user_id, audience))
  );

-- A narrower starting choice narrows the records kept before, at once:
-- every record wider than it, set one by one or not, is set to it. Run as
-- the reader, on their own rows (the records' update policy). Widening
-- changes nothing here; the app asks and sends each record it widens.
create function private.narrow_past() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.audience_rank(new.records_audience)
      < private.audience_rank(old.records_audience) then
    update public.reading_entries e
    set audience = new.records_audience
    where e.user_id = new.user_id
      and private.audience_rank(e.audience)
        > private.audience_rank(new.records_audience);
  end if;
  return null;
end;
$$;
revoke all on function private.narrow_past() from public, anon, authenticated;
-- A new row starts from the defaults, and records start from the narrowest,
-- so only an update can narrow them.
create trigger reader_settings_narrow after update of records_audience
  on public.reader_settings
  for each row execute function private.narrow_past();

-- What a profile says, at signup or from an old app's setting, becomes the
-- starting choice for records. A new profile starts private without a row.
-- Run as the reader, on their own settings; an old app's 自分だけ narrows
-- the records kept before like any narrower choice.
create function private.records_start_from_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.reader_settings (user_id, records_audience)
  values (new.id,
    case when new.reading_visibility = 'public' then 'everyone' else 'private' end)
  on conflict (user_id) do update set records_audience = excluded.records_audience;
  return null;
end;
$$;
revoke all on function private.records_start_from_profile() from public, anon, authenticated;
create trigger profiles_records_start after insert on public.profiles
  for each row when (new.reading_visibility = 'public')
  execute function private.records_start_from_profile();
create trigger profiles_records_change after update of reading_visibility
  on public.profiles
  for each row when (new.reading_visibility is distinct from old.reading_visibility)
  execute function private.records_start_from_profile();

-- Books shown to followers -----------------------------------------------------------

-- A typed-in book in a record shown to followers is read by those who may
-- read the record, so the record does not lose its book. Asked about the
-- asker only, like book_is_mine; book_is_listed stays for what anyone may
-- read (work_candidates builds on it).
create index reading_entries_followers_book on public.reading_entries (book_id)
  where audience = 'followers';
create function private.book_is_shared(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.reading_entries e
    where e.book_id = b
      and e.audience = 'followers'
      and private.may_see(e.user_id, e.audience)
  )
$$;
revoke all on function private.book_is_shared(uuid) from public, anon, authenticated;
grant execute on function private.book_is_shared(uuid) to anon, authenticated;

drop policy "books are seen where they are used" on public.books;
create policy "books are seen where they are used" on public.books
  for select to anon, authenticated
  using (
    source <> 'manual'
    or created_by = (select auth.uid())
    or private.book_is_listed(id)
    or private.book_is_mine(id)
    or private.book_is_shared(id)
  );

-- The check ---------------------------------------------------------------------------

-- Besides check_copy's rows and links: every record shows what it showed,
-- and every reader who chose public records still starts them so. Counts
-- only in the messages: they land in public Actions logs.
do $$
declare
  copy_table text;
  changed bigint;
begin
  select c.copy_name into copy_table from keep.copies c
  where c.label = '20261029000000_visibility' and c.source = 'public.reading_entries';
  execute format(
    'select count(*) from keep.%I c join public.reading_entries e on e.id = c.id
     where to_jsonb(e) - ''audience'' is distinct from to_jsonb(c) - ''keep_owners''
        or e.audience is distinct from case when c.is_public then ''everyone'' else ''private'' end',
    copy_table) into changed;
  if changed > 0 then
    raise exception 'the move changed % reading records', changed;
  end if;
  select count(*) into changed from public.profiles p
  left join public.reader_settings s on s.user_id = p.id
  where coalesce(s.records_audience, 'private')
    <> case when p.reading_visibility = 'public' then 'everyone' else 'private' end;
  if changed > 0 then
    raise exception '% readers start their records otherwise', changed;
  end if;
end;
$$;

select private.check_copy('20261029000000_visibility');
