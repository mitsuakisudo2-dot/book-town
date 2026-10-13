-- 注釈モード: notes the operator leaves on the live site by tapping a place on
-- a page, for Claude to read and act on. Only staff accounts can leave them,
-- and each staff member sees and takes back only their own. Nobody else,
-- signed in or not, can read the notes or learn that there are any. Claude
-- reads them with a select through the Supabase connection (docs/09「注釈モード」).

-- Who is staff. The private schema is not served by the API; the operator
-- adds and removes people in the dashboard.
create table private.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.staff enable row level security;
revoke all on private.staff from public, anon, authenticated;

-- The first staff member is the project's first account, the owner's (it was
-- the only account when this was written). A new database, like the one CI
-- starts, has no accounts yet and so no staff.
insert into private.staff (user_id)
select id from auth.users order by created_at, id limit 1
on conflict do nothing;

-- Whether the signed-in person may leave notes. The site shows its 注釈
-- button only when this says so, and the policies below ask it too.
create function public.can_annotate() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.staff where user_id = (select auth.uid())
  )
$$;
revoke all on function public.can_annotate() from public, anon, authenticated;
grant execute on function public.can_annotate() to authenticated;

create table public.site_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The page's path and the query the app reads (/shop/?id=…), and on the
  -- walk the shop in view after #. Never any other part after #, which can
  -- carry a sign-in link's keys or what was typed in the street's search.
  page text not null check (char_length(page) between 1 and 500 and left(page, 1) = '/'),
  -- Where the finger landed, in the page's CSS pixels from its top left
  -- (scrolling included), and the window it was seen in.
  x integer not null check (x between 0 and 100000),
  y integer not null check (y between 0 and 10000000),
  viewport_w integer not null check (viewport_w between 1 and 20000),
  viewport_h integer not null check (viewport_h between 1 and 20000),
  scroll_y integer not null check (scroll_y between 0 and 10000000),
  -- What was under the finger, in words: ボタン「好き」 / 見出し「軌道書房」.
  -- Copied from the page, so it can quote other readers' words.
  target text not null default '' check (char_length(target) <= 300),
  -- The title of the dialog or book in hand it was left on; null on the page.
  layer text check (char_length(layer) between 1 and 120),
  -- A CSS path to that element, and where on it the finger landed (0 to 1
  -- across and down), so the pin finds its place again at another width and
  -- Claude finds the component.
  anchor text not null default '' check (char_length(anchor) <= 500),
  anchor_x real check (anchor_x between 0 and 1),
  anchor_y real check (anchor_y between 0 and 1),
  body text not null check (
    char_length(body) between 1 and 2000 and body = btrim(body, E' \t\r\n　')
  ),
  -- A short label such as 'iPhone Safari', never the browser's user agent.
  device text not null default '' check (char_length(device) <= 40),
  -- The deployed commit, when the build knew it.
  build text check (build ~ '^[0-9a-f]{7,40}$'),
  created_at timestamptz not null default now(),
  -- Set when the note is taken back. Claude reads only notes without it; the
  -- row stays until the operator clears taken-back notes in the dashboard.
  removed_at timestamptz,
  constraint site_notes_anchor_point check ((anchor_x is null) = (anchor_y is null))
);
create index site_notes_user_created on public.site_notes (user_id, created_at);

-- A page gone wrong cannot fill the table: sixty notes an hour per person.
create function private.limit_site_notes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (
    select count(*) from public.site_notes n
    where n.user_id = new.user_id and n.created_at > now() - interval '1 hour'
  ) >= 60 then
    raise exception 'at most 60 site notes an hour' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.limit_site_notes() from public, anon, authenticated;
create trigger site_notes_limit before insert on public.site_notes
  for each row execute function private.limit_site_notes();

-- Taking a note back, or undoing that, is dated by the database: removed_at
-- becomes now, or empty again, never another time.
create function private.stamp_site_note_removal() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.removed_at := case
    when new.removed_at is null then null
    when old.removed_at is null then now()
    else old.removed_at
  end;
  return new;
end;
$$;
revoke all on function private.stamp_site_note_removal() from public, anon, authenticated;
create trigger site_notes_stamp_removal before update of removed_at on public.site_notes
  for each row execute function private.stamp_site_note_removal();

alter table public.site_notes enable row level security;
revoke all on public.site_notes from public, anon, authenticated;
grant select on public.site_notes to authenticated;
-- user_id comes from its default (the signed-in person), created_at and
-- removed_at from the database.
grant insert (page, x, y, viewport_w, viewport_h, scroll_y, target, layer, anchor,
              anchor_x, anchor_y, body, device, build)
  on public.site_notes to authenticated;
grant update (removed_at) on public.site_notes to authenticated;

create policy "staff read their own notes" on public.site_notes
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.can_annotate()));
create policy "staff leave notes as themselves" on public.site_notes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.can_annotate()));
create policy "staff take back their own notes" on public.site_notes
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.can_annotate()))
  with check (user_id = (select auth.uid()) and (select public.can_annotate()));
