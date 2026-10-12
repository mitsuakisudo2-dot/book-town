-- Moderation. The operator hides a post, a shop or a person from everyone but
-- its author, and three open reports from different people hide it until the
-- operator looks. Both are done in the Supabase dashboard: a row in
-- moderation_hides hides; setting the reports to 'dismissed' brings it back.

-- Functions the policies use but nobody calls through the API live here.
create schema if not exists private;
grant usage on schema private to anon, authenticated;

create table public.moderation_hides (
  target_kind text not null check (target_kind in ('post', 'shop', 'profile')),
  target_id uuid not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  primary key (target_kind, target_id)
);
-- Only the operator (the service role, in the dashboard) reads and writes it.
alter table public.moderation_hides enable row level security;
revoke all on public.moderation_hides from anon, authenticated;

create index reports_open_target on public.reports (target_kind, target_id)
  where status = 'open';

create function private.is_hidden(kind text, target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.moderation_hides h
    where h.target_kind = kind and h.target_id = target
  ) or (
    select count(*) >= 3 from public.reports r
    where r.target_kind = kind and r.target_id = target and r.status = 'open'
  )
$$;
revoke execute on function private.is_hidden(text, uuid) from public;
grant execute on function private.is_hidden(text, uuid) to anon, authenticated;

-- Each public table keeps its rules and adds: not hidden, nor its person.
drop policy "profiles are public" on public.profiles;
create policy "profiles are public unless hidden" on public.profiles
  for select to anon, authenticated
  using (id = (select auth.uid()) or not private.is_hidden('profile', id));

drop policy "life nine is public" on public.profile_nine;
create policy "life nine is public unless hidden" on public.profile_nine
  for select to anon, authenticated
  using (
    profile_id = (select auth.uid())
    or not private.is_hidden('profile', profile_id)
  );

drop policy "open shops are public, owners see their own" on public.shops;
create policy "open shops are public, owners see their own" on public.shops
  for select to anon, authenticated
  using (
    owner_id = (select auth.uid())
    or (
      is_open
      and not public.is_blocked_with(owner_id)
      and not private.is_hidden('shop', id)
      and not private.is_hidden('profile', owner_id)
    )
  );

drop policy "posts are public except private notes" on public.posts;
create policy "posts are public except private notes" on public.posts
  for select to anon, authenticated
  using (
    author_id = (select auth.uid())
    or (
      reading_mode is distinct from 'solo'
      and not public.is_blocked_with(author_id)
      and not private.is_hidden('post', id)
      and not private.is_hidden('profile', author_id)
    )
  );

drop policy "reading together is public, solo reading is private" on public.reading_sessions;
create policy "reading together is public, solo reading is private" on public.reading_sessions
  for select to anon, authenticated
  using (
    user_id = (select auth.uid())
    or (
      mode = 'together'
      and not public.is_blocked_with(user_id)
      and not private.is_hidden('profile', user_id)
    )
  );

-- Words left at a shop stop reaching its owner once their writer is hidden.
drop policy "readers and shop owners see shop reactions" on public.shop_reactions;
create policy "readers and shop owners see shop reactions" on public.shop_reactions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      exists (
        select 1 from public.shops s
        where s.id = shop_id and s.owner_id = (select auth.uid())
      )
      and not public.is_blocked_with(user_id)
      and not private.is_hidden('profile', user_id)
    )
  );

-- One report per person and thing; a report about yourself is not taken.
drop policy "people file reports" on public.reports;
create policy "people file reports" on public.reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'open'
    and not (target_kind = 'profile' and target_id = (select auth.uid()))
  );
