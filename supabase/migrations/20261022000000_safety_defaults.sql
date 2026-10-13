-- Safer defaults (2026-10-13).
--
-- * Reports fold instead of hiding. Three people's worth of reports fold a
--   post, a poster, or a shop's or person's words: still there, opened with a
--   tap, until the operator checks. Only the serious reasons (personal
--   information, threats) act at once. Reports from very new accounts, and
--   from accounts made at about the same time, weigh less, so a few throwaway
--   accounts cannot fold or hide an ordinary post.
-- * The reporter hears 受け付けました, 確認中 and 確認しました, never what was
--   done about the other person: they read `progress`, never `status`.
-- * A rights holder can ask for a book's cover to be taken down (a report
--   about a book); the operator then refuses that cover source for the ISBN.
-- * Each reader keeps their own settings (for now, how spoilers are shown).
--
-- Works whether or not 20261021000000_posters.sql ran first: every list of
-- kinds includes 'poster', and the posters table is only ever named by text.

-- Reports: kinds, reasons, statuses ------------------------------------------------

alter table public.reports drop constraint if exists reports_target_kind_check;
alter table public.reports add constraint reports_target_kind_check
  check (target_kind in ('post', 'shop', 'profile', 'poster', 'book'));
alter table public.moderation_hides drop constraint if exists moderation_hides_target_kind_check;
alter table public.moderation_hides add constraint moderation_hides_target_kind_check
  check (target_kind in ('post', 'shop', 'profile', 'poster'));

-- 'spoiler' stays for rows filed before 2026-10-13; the app no longer sends it.
alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports add constraint reports_reason_check
  check (reason in ('spam', 'harassment', 'inappropriate', 'other', 'spoiler',
                    'personal_info', 'threat', 'cover'));
-- A cover removal request is the only report about a book, and says who asks.
alter table public.reports add constraint reports_cover_is_about_a_book
  check ((target_kind = 'book') = (reason = 'cover'));
alter table public.reports add constraint reports_cover_says_who
  check (reason <> 'cover' or char_length(btrim(detail)) > 0);

-- open: just filed (受け付けました). checking: the operator is looking (確認中).
-- resolved / dismissed: done, acted or not (both are 確認しました to the reporter).
-- Only the operator changes it, in the dashboard.
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check
  check (status in ('open', 'checking', 'resolved', 'dismissed'));

alter table public.reports
  -- When the reporter's progress last changed, for their notices.
  add column status_at timestamptz not null default now(),
  -- Set by the database at filing: a serious report that acts at once.
  add column urgent boolean not null default false,
  -- What the reporter may read: resolved and dismissed are both 'checked',
  -- so nobody learns from the API which way it went.
  add column progress text not null generated always as (
    case when status in ('open', 'checking') then status else 'checked' end
  ) stored;
update public.reports set status_at = created_at;

-- Only a change the reporter can see moves status_at; resolved to dismissed
-- (or back) would otherwise tell them something happened after 確認しました.
create function private.stamp_report_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status
     and (old.status in ('open', 'checking') or new.status in ('open', 'checking')) then
    new.status_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_report_status() from public, anon, authenticated;
create trigger reports_stamp_status before update of status on public.reports
  for each row execute function private.stamp_report_status();

-- How old an account is ------------------------------------------------------------

-- A profile is dated by the database when it is made, and keeps that date:
-- a reader cannot move it, older or newer (newer dates spaced a day apart
-- would split accounts made together into many 'people'). The operator, in
-- the dashboard, still can.
create function private.stamp_profile_time() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.created_at := now();
    else
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_profile_time() from public, anon, authenticated;
create trigger profiles_stamp_created before insert or update on public.profiles
  for each row execute function private.stamp_profile_time();

-- When the account was made: the later of its sign-up and its first profile.
-- Neither can be written by the person (above). Invited accounts are all
-- made by the operator, often on one day; their profiles are made at each
-- reader's first sign-in, which keeps them apart.
create function private.account_born(person uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(u.created_at, p.created_at)
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = person
$$;
revoke all on function private.account_born(uuid) from public, anon, authenticated;

-- The rule, in people:
--   1. A report counts as one person.
--   2. From an account less than 7 days old, as half a person.
--   3. Accounts made within 24 hours of one another (one after another)
--      count together as one person at most, however many they are.
--   4. Three people's worth folds it (a tap opens it). Nothing disappears;
--      the operator setting the reports to 'dismissed' unfolds it.
--   5. personal_info and threat, from an account 7 days old or more, act at
--      once: a post or a poster is seen only by its writer ('held'), a shop's
--      or a person's words fold. An account acts at once on 3 reports in 24
--      hours at most; a newer account's, or a 4th, counts as an ordinary one
--      and still comes first in the operator's queue.
-- In points: one person = 2, half = 1, a cluster at most 2, fold at 6.

-- Decides at filing whether a report acts at once.
create function private.weigh_report() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.status_at := now();
  -- One reporter's serious reports are weighed one at a time, so many sent
  -- at once still see each other and only three act at once.
  if new.reason in ('personal_info', 'threat') then
    perform pg_advisory_xact_lock(hashtext('book-town.urgent-reports'),
                                  hashtext(new.reporter_id::text));
  end if;
  new.urgent := new.reason in ('personal_info', 'threat')
    and new.target_kind in ('post', 'poster', 'profile', 'shop')
    and coalesce(private.account_born(new.reporter_id) <= now() - interval '7 days', false)
    and (
      select count(*) from public.reports r
      where r.reporter_id = new.reporter_id
        and r.urgent
        and r.created_at > now() - interval '24 hours'
    ) < 3;
  return new;
end;
$$;
revoke all on function private.weigh_report() from public, anon, authenticated;
create trigger reports_weigh before insert on public.reports
  for each row execute function private.weigh_report();

-- What is folded or held: moderation_folds ---------------------------------------

-- Kept by the database from the reports (below), like posts.spoiler_folded,
-- but for every kind, so posters need no column of their own.
create table public.moderation_folds (
  target_kind text not null check (target_kind in ('post', 'shop', 'profile', 'poster')),
  target_id uuid not null,
  -- folded: everyone sees it folded. held: hidden from all but its owner until checked.
  state text not null check (state in ('folded', 'held')),
  -- Whose it is, so its owner (and only its owner) is told, and sees a held one.
  owner_id uuid references public.profiles (id) on delete cascade,
  since timestamptz not null default now(),
  primary key (target_kind, target_id)
);
alter table public.moderation_folds enable row level security;
revoke all on public.moderation_folds from anon, authenticated;
-- Only triggers (and the operator) write it. A reporter never sees a held
-- row, so nobody learns that their report hid something.
grant select (target_kind, target_id, state, since) on public.moderation_folds
  to anon, authenticated;
create policy "folds are seen by all, held things by their owner" on public.moderation_folds
  for select to anon, authenticated
  using (state = 'folded' or owner_id = (select auth.uid()));

-- Whose a reported thing is. The posters table is named by text, so this
-- works with or without it.
create function private.owner_of(kind text, target uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  found uuid;
begin
  if kind = 'post' then
    select author_id into found from public.posts where id = target;
  elsif kind = 'profile' then
    select id into found from public.profiles where id = target;
  elsif kind = 'shop' then
    select owner_id into found from public.shops where id = target;
  elsif kind = 'poster' and to_regclass('public.posters') is not null then
    execute 'select author_id from public.posters where id = $1' into found using target;
  end if;
  return found;
end;
$$;
revoke all on function private.owner_of(text, uuid) from public, anon, authenticated;

-- The state one thing should be in now, by the rule above; null for neither.
-- Each report's weight is measured against its own filing time, so nothing
-- changes as time passes.
create function private.review_state(kind text, target uuid) returns text
language sql stable security definer set search_path = '' as $$
  with live as (
    select r.id, r.urgent, r.created_at,
           private.account_born(r.reporter_id) as born
    from public.reports r
    where r.target_kind = kind
      and r.target_id = target
      and r.status in ('open', 'checking')
      and r.reason not in ('spoiler', 'cover')
  ), weighed as (
    select id, born,
           case when coalesce(born > created_at - interval '7 days', true)
                then 1 else 2 end as points
    from live
  ), gaps as (
    select id, born, points,
           lag(born) over (order by born, id) as before
    from weighed
  ), clusters as (
    select points,
           sum(case when before is null or born - before > interval '24 hours'
                    then 1 else 0 end)
             over (order by born, id rows between unbounded preceding and current row)
             as cluster
    from gaps
  ), score as (
    select coalesce(sum(capped), 0) as total
    from (
      select least(2, sum(points)) as capped from clusters group by cluster
    ) c
  )
  select case
    when exists (select 1 from live where urgent) and kind in ('post', 'poster')
      then 'held'
    when exists (select 1 from live where urgent) then 'folded'
    when (select total from score) >= 6 then 'folded'
  end
$$;
revoke all on function private.review_state(text, uuid) from public, anon, authenticated;

-- Brings one thing's row up to date. Something gone (its writer took it
-- down) keeps no row: nothing is left folded, and nobody is told it is held.
create function private.refold_review(kind text, target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  next text;
  owner uuid;
begin
  if kind not in ('post', 'shop', 'profile', 'poster') then
    return;
  end if;
  next := private.review_state(kind, target);
  owner := private.owner_of(kind, target);
  if next is null or owner is null then
    delete from public.moderation_folds
    where target_kind = kind and target_id = target;
  else
    insert into public.moderation_folds (target_kind, target_id, state, owner_id)
    values (kind, target, next, owner)
    on conflict (target_kind, target_id) do update
      set state = excluded.state,
          owner_id = excluded.owner_id,
          since = case when moderation_folds.state = excluded.state
                       then moderation_folds.since else now() end;
  end if;
end;
$$;
revoke all on function private.refold_review(text, uuid) from public, anon, authenticated;

-- A post, a poster or a shop taken down takes its fold along (target_id
-- has no foreign key, since it names rows of several tables). Its reports
-- stay for the operator.
create function private.refold_taken_down() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.refold_review(tg_argv[0], old.id);
  return null;
end;
$$;
revoke all on function private.refold_taken_down() from public, anon, authenticated;
create trigger posts_refold_taken_down after delete on public.posts
  for each row execute function private.refold_taken_down('post');
create trigger shops_refold_taken_down after delete on public.shops
  for each row execute function private.refold_taken_down('shop');
do $$
begin
  if to_regclass('public.posters') is not null then
    create trigger posters_refold_taken_down after delete on public.posters
      for each row execute function private.refold_taken_down('poster');
  end if;
end;
$$;

-- A report filed, checked, dismissed or removed (a reporter's account deleted
-- takes its reports along) refolds what it was about.
create function private.refold_reports() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    perform private.refold_review(old.target_kind, old.target_id);
  end if;
  if tg_op <> 'DELETE' then
    perform private.refold_review(new.target_kind, new.target_id);
  end if;
  return null;
end;
$$;
revoke all on function private.refold_reports() from public, anon, authenticated;
create trigger reports_refold after insert or delete or update of status on public.reports
  for each row execute function private.refold_reports();

drop index if exists public.reports_open_target;
create index reports_live_target on public.reports (target_kind, target_id)
  where status in ('open', 'checking');

-- Hidden is now only what the operator hid, or what a serious report holds.
-- Every policy that asks keeps asking; the answer changes here alone. A
-- person is never held, so no report can erase someone.
create or replace function private.is_hidden(kind text, target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.moderation_hides h
    where h.target_kind = kind and h.target_id = target
  ) or exists (
    select 1 from public.moderation_folds f
    where f.target_kind = kind and f.target_id = target and f.state = 'held'
  )
$$;

-- Who may do what with reports, column by column. A reporter reads how far
-- along their own reports are (progress), never status (which way it went),
-- whether one acted at once, or reporter_id (the policy already keeps the
-- rows their own; a filter on it is refused).
revoke all on public.reports from anon, authenticated;
grant select (id, target_kind, target_id, reason, progress, created_at, status_at)
  on public.reports to authenticated;
grant insert (reporter_id, target_kind, target_id, reason, detail)
  on public.reports to authenticated;

-- Covers a rights holder asked us not to show --------------------------------------

-- Keyed by ISBN, because covers are looked up by ISBN; one row per source.
-- Written by the operator only. Images are never altered or replaced: a
-- refused source is simply not asked for that book.
create table public.cover_refusals (
  isbn text not null check (public.isbn13_valid(isbn)),
  source text not null check (source in ('openbd', 'google')),
  note text not null default '',
  created_at timestamptz not null default now(),
  primary key (isbn, source)
);
alter table public.cover_refusals enable row level security;
revoke all on public.cover_refusals from anon, authenticated;
grant select (isbn, source) on public.cover_refusals to anon, authenticated;
create policy "everyone knows which covers are not shown" on public.cover_refusals
  for select to anon, authenticated using (true);

-- The reader's own settings -------------------------------------------------------

-- Not on profiles, which everyone reads. No row means the defaults.
create table public.reader_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- 「ネタバレの表示」: show_all すべて表示する, fold_possible たたんで表示する
  -- (three readers asked 「ネタバレでは？」), leave_out 出さない.
  spoiler_display text not null default 'fold_possible'
    check (spoiler_display in ('show_all', 'fold_possible', 'leave_out')),
  updated_at timestamptz not null default now()
);
create trigger reader_settings_touch before update on public.reader_settings
  for each row execute function public.touch_updated_at();
alter table public.reader_settings enable row level security;
revoke all on public.reader_settings from anon, authenticated;
grant select on public.reader_settings to authenticated;
-- The app saves with an upsert, which sets every sent column on conflict, so
-- user_id is updatable too; the policies keep it the reader's own.
grant insert (user_id, spoiler_display), update (user_id, spoiler_display)
  on public.reader_settings to authenticated;
create policy "readers see their settings" on public.reader_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy "readers keep their settings" on public.reader_settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "readers change their settings" on public.reader_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- What three reports hid until today is folded from now on.
select private.refold_review(target_kind, target_id)
from (
  select distinct target_kind, target_id from public.reports
  where status = 'open' and target_kind <> 'book'
) t;
