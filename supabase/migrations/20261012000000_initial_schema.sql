-- Booktown: the first database schema (stage 2, login and storage).
--
-- Rules every table follows:
-- * Row level security is on. The public (anon) key can only do what a policy allows.
-- * What other people may see is decided here, not in the app. Private shelves,
--   solo reading notes, bookmarks and saved shops never leave their owner.
-- * Follower and reaction counts are not readable by others: only the person who
--   reacted and the person who received it can see a reaction.
-- * Nothing is editable by anyone but its owner, and there is no client path to
--   another person's rows.
-- * A block works both ways: neither person sees the other's shop, posts or
--   reading, and neither can follow or react to the other.

-- Helpers --------------------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Up to five distinct http(s) links of at most 300 characters, without credentials.
create function public.valid_links(links text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(links) <= 5
    and count(distinct link) = cardinality(links)
    and coalesce(bool_and(
      char_length(link) <= 300
      and link ~ '^https?://[^\s/?#@]+\.[^\s/?#@]+([/?#]\S*)?$'
    ), true)
  from unnest(links) as link
$$;

-- ISBN-13 with a correct check digit, the form the app stores.
create function public.isbn13_valid(isbn text) returns boolean
language sql immutable set search_path = '' as $$
  select isbn ~ '^97[89][0-9]{10}$'
    and (
      select sum(substr(isbn, i, 1)::int * case when i % 2 = 0 then 3 else 1 end)
      from generate_series(1, 13) as i
    ) % 10 = 0
$$;

-- People -----------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique
    check (handle ~ '^[a-z0-9_]{3,20}$')
    check (handle not in (
      'admin', 'administrator', 'api', 'booktown', 'help', 'moderator',
      'official', 'root', 'settings', 'staff', 'support', 'system'
    )),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  bio text not null default '' check (char_length(bio) <= 2000),
  color text not null default '#768281' check (color ~ '^#[0-9a-fA-F]{6}$'),
  links text[] not null default '{}' check (public.valid_links(links)),
  compose_icon text not null default 'pen'
    check (compose_icon in ('pen', 'typewriter', 'quill')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Blocks are private to the person who blocked. Policies ask is_blocked_with(),
-- which only answers about the person asking, so nobody can probe who blocked whom.
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked on public.blocks (blocked_id);

create function public.is_blocked_with(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = other)
       or (b.blocker_id = other and b.blocked_id = auth.uid())
  )
$$;

-- Books ------------------------------------------------------------------------

-- 'ndl' rows come from the National Diet Library through a server function and
-- are shared by everyone. 'manual' rows are what a person typed in themselves.
create table public.books (
  id uuid primary key default gen_random_uuid(),
  isbn text check (public.isbn13_valid(isbn)),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  author text not null default '' check (char_length(author) <= 200),
  publisher text not null default '' check (char_length(publisher) <= 200),
  price integer check (price between 1 and 1000000),
  source text not null default 'manual' check (source in ('ndl', 'manual')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One catalog record per ISBN. Manual entries may repeat an ISBN, so a typo in
-- one person's entry never blocks anyone else.
create unique index books_catalog_isbn on public.books (isbn) where source = 'ndl';
create index books_isbn on public.books (isbn) where isbn is not null;

-- 人生の9冊
create table public.profile_nine (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  position smallint not null check (position between 1 and 9),
  book_id uuid not null references public.books (id),
  note text not null default '' check (char_length(note) <= 500),
  primary key (profile_id, position),
  unique (profile_id, book_id)
);

-- Shops ------------------------------------------------------------------------

-- One shop per person for now. The full shelves and scene, private parts
-- included, live in shop_private; the public_ columns hold what visitors see.
-- The owner's app writes both, so a private shelf never reaches this table.
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  tagline text not null default '' check (char_length(tagline) <= 500),
  theme text not null default 'sage' check (theme in ('sage', 'ink', 'ochre', 'rose')),
  -- Only open shops appear to others, in the walk and on their own page.
  is_open boolean not null default false,
  public_shelves jsonb not null default '[]'
    check (jsonb_typeof(public_shelves) = 'array'
      and octet_length(public_shelves::text) <= 262144),
  public_scene jsonb
    check (public_scene is null or (jsonb_typeof(public_scene) = 'object'
      and octet_length(public_scene::text) <= 524288)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shop_private (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  shelves jsonb not null default '[]'
    check (jsonb_typeof(shelves) = 'array' and octet_length(shelves::text) <= 262144),
  scene jsonb
    check (scene is null or (jsonb_typeof(scene) = 'object'
      and octet_length(scene::text) <= 524288)),
  updated_at timestamptz not null default now()
);

-- Following is separate for a shop and for its owner (思想メモ: 関係の深さは本人が決める).
create table public.shop_follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, shop_id)
);
create index shop_follows_shop on public.shop_follows (shop_id);

create table public.profile_follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index profile_follows_followee on public.profile_follows (followee_id);

-- A like or a short message to the owner, left while walking through a shop.
create table public.shop_reactions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  liked boolean not null default false,
  message text not null default '' check (char_length(message) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (user_id, shop_id)
);
create index shop_reactions_shop on public.shop_reactions (shop_id);

-- Shops a reader keeps for later. Private: the owner is not told.
create table public.saved_shops (
  user_id uuid not null references public.profiles (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, shop_id)
);

-- Reactions to one POP. placement_key is the app's key for a book's place in a shop.
create table public.pop_reactions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  placement_key text not null check (char_length(placement_key) between 1 and 300),
  reaction text not null check (reaction in ('like', 'read', 'love')),
  created_at timestamptz not null default now(),
  primary key (user_id, shop_id, placement_key, reaction)
);
create index pop_reactions_shop on public.pop_reactions (shop_id);

-- Posts ------------------------------------------------------------------------

-- One kind of post. A top-level post with a book is also a review of that book.
-- 'solo' reading memos are private notes; 'together' memos are public posts.
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  book_id uuid references public.books (id),
  spoiler boolean not null default false,
  parent_id uuid references public.posts (id) on delete cascade,
  reading_mode text check (reading_mode in ('solo', 'together')),
  created_at timestamptz not null default now(),
  -- A spoiler needs a book (or a parent post) to hide behind.
  check (not spoiler or parent_id is not null or book_id is not null),
  check (reading_mode is null or parent_id is null)
);
create index posts_created on public.posts (created_at desc);
create index posts_author on public.posts (author_id, created_at desc);
create index posts_book on public.posts (book_id) where book_id is not null;
create index posts_parent on public.posts (parent_id) where parent_id is not null;

-- Threads are one level deep, and a private note takes no replies. The parent is
-- read with the writer's own permissions, so another person's note is "not found".
create function public.check_reply_parent() returns trigger
language plpgsql set search_path = '' as $$
declare
  parent record;
begin
  if new.parent_id is null then
    return new;
  end if;
  select p.parent_id, p.reading_mode into parent
  from public.posts p where p.id = new.parent_id;
  if not found then
    raise exception 'reply parent not found' using errcode = '23503';
  end if;
  if parent.parent_id is not null then
    raise exception 'replies are one level deep' using errcode = '23514';
  end if;
  if parent.reading_mode = 'solo' then
    raise exception 'private notes take no replies' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger posts_reply_parent before insert on public.posts
  for each row execute function public.check_reply_parent();

create table public.post_reactions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  -- 'want' records that the post made the reader want to read its book.
  kind text not null check (kind in ('like', 'want')),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id, kind)
);
create index post_reactions_post on public.post_reactions (post_id);

create table public.spoiler_reports (
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reporter_id, post_id)
);
create index spoiler_reports_post on public.spoiler_reports (post_id);

-- Reports for the moderators, who read and resolve them in the Supabase dashboard.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_kind text not null check (target_kind in ('post', 'shop', 'profile')),
  target_id uuid not null,
  reason text not null
    check (reason in ('spam', 'harassment', 'spoiler', 'inappropriate', 'other')),
  detail text not null default '' check (char_length(detail) <= 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (reporter_id, target_kind, target_id)
);

-- Reading ----------------------------------------------------------------------

-- A reader's own lists. Private for now; stage 5 decides what becomes shareable.
create table public.book_marks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  kind text not null check (kind in ('wish', 'favorite', 'library', 'finished')),
  created_at timestamptz not null default now(),
  primary key (user_id, book_id, kind)
);

-- 'together' sessions are public so others can see who is reading right now.
create table public.reading_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id uuid references public.books (id),
  mode text not null check (mode in ('solo', 'together')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create unique index reading_sessions_one_running
  on public.reading_sessions (user_id) where ended_at is null;
create index reading_sessions_together
  on public.reading_sessions (started_at desc) where mode = 'together';

-- A new block ends any following between the two people, in both directions.
create function public.end_follows_on_block() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.profile_follows f
  where (f.follower_id = new.blocker_id and f.followee_id = new.blocked_id)
     or (f.follower_id = new.blocked_id and f.followee_id = new.blocker_id);
  delete from public.shop_follows f
  using public.shops s
  where f.shop_id = s.id
    and ((f.follower_id = new.blocked_id and s.owner_id = new.blocker_id)
      or (f.follower_id = new.blocker_id and s.owner_id = new.blocked_id));
  return new;
end;
$$;
create trigger blocks_end_follows after insert on public.blocks
  for each row execute function public.end_follows_on_block();

-- updated_at ---------------------------------------------------------------------

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger books_touch before update on public.books
  for each row execute function public.touch_updated_at();
create trigger shops_touch before update on public.shops
  for each row execute function public.touch_updated_at();
create trigger shop_private_touch before update on public.shop_private
  for each row execute function public.touch_updated_at();
create trigger shop_reactions_touch before update on public.shop_reactions
  for each row execute function public.touch_updated_at();

-- Privileges -------------------------------------------------------------------

-- Start from nothing, then grant. Visitors who are not logged in may only read
-- the public tables; logged-in people get table access that the policies narrow.
revoke all on all tables in schema public from anon, authenticated;
grant select on
  public.profiles, public.books, public.profile_nine, public.shops,
  public.posts, public.reading_sessions
  to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

alter table public.profiles enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.books enable row level security;
alter table public.profile_nine enable row level security;
alter table public.shops enable row level security;
alter table public.shop_private enable row level security;
alter table public.shop_follows enable row level security;
alter table public.profile_follows enable row level security;
alter table public.shop_reactions enable row level security;
alter table public.saved_shops enable row level security;
alter table public.pop_reactions enable row level security;
alter table public.posts enable row level security;
alter table public.post_reactions enable row level security;
alter table public.spoiler_reports enable row level security;
alter table public.book_marks enable row level security;
alter table public.reading_sessions enable row level security;

-- Policies ---------------------------------------------------------------------
-- (select auth.uid()) is evaluated once per query instead of once per row.

create policy "profiles are public" on public.profiles
  for select to anon, authenticated using (true);
create policy "people create their own profile" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy "people edit their own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "people see whom they blocked" on public.blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
create policy "people block others" on public.blocks
  for insert to authenticated with check (blocker_id = (select auth.uid()));
create policy "people unblock" on public.blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));

-- Reports are only ever opened by the reporter; moderators change their status.
create policy "reporters see their reports" on public.reports
  for select to authenticated using (reporter_id = (select auth.uid()));
create policy "people file reports" on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'open');

create policy "books are public" on public.books
  for select to anon, authenticated using (true);
create policy "people add books by hand" on public.books
  for insert to authenticated
  with check (source = 'manual' and created_by = (select auth.uid()));
create policy "people fix the books they typed in" on public.books
  for update to authenticated
  using (source = 'manual' and created_by = (select auth.uid()))
  with check (source = 'manual' and created_by = (select auth.uid()));

create policy "life nine is public" on public.profile_nine
  for select to anon, authenticated using (true);
create policy "people add to their own nine" on public.profile_nine
  for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "people change their own nine" on public.profile_nine
  for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy "people remove from their own nine" on public.profile_nine
  for delete to authenticated using (profile_id = (select auth.uid()));

create policy "open shops are public, owners see their own" on public.shops
  for select to anon, authenticated
  using (
    owner_id = (select auth.uid())
    or (is_open and not public.is_blocked_with(owner_id))
  );
create policy "people open their own shop" on public.shops
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "owners edit their shop" on public.shops
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owners close their shop" on public.shops
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "only the owner reaches the private shop data" on public.shop_private
  for all to authenticated
  using (exists (
    select 1 from public.shops s
    where s.id = shop_id and s.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.shops s
    where s.id = shop_id and s.owner_id = (select auth.uid())
  ));

create policy "followers and shop owners see shop follows" on public.shop_follows
  for select to authenticated
  using (
    follower_id = (select auth.uid())
    or exists (
      select 1 from public.shops s
      where s.id = shop_id and s.owner_id = (select auth.uid())
    )
  );
-- The shop must be visible to the follower, i.e. open (or their own).
create policy "people follow visible shops" on public.shop_follows
  for insert to authenticated
  with check (
    follower_id = (select auth.uid())
    and exists (select 1 from public.shops s where s.id = shop_id)
  );
create policy "people unfollow shops" on public.shop_follows
  for delete to authenticated using (follower_id = (select auth.uid()));

create policy "followers and followees see person follows" on public.profile_follows
  for select to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));
create policy "people follow people" on public.profile_follows
  for insert to authenticated
  with check (
    follower_id = (select auth.uid()) and not public.is_blocked_with(followee_id)
  );
create policy "people unfollow people" on public.profile_follows
  for delete to authenticated using (follower_id = (select auth.uid()));

create policy "readers and shop owners see shop reactions" on public.shop_reactions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.shops s
      where s.id = shop_id and s.owner_id = (select auth.uid())
    )
  );
create policy "readers react to visible shops" on public.shop_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.shops s where s.id = shop_id)
  );
create policy "readers change their shop reactions" on public.shop_reactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.shops s where s.id = shop_id)
  );
create policy "readers remove their shop reactions" on public.shop_reactions
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "saved shops are private" on public.saved_shops
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.shops s where s.id = shop_id)
  );

create policy "readers and shop owners see pop reactions" on public.pop_reactions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.shops s
      where s.id = shop_id and s.owner_id = (select auth.uid())
    )
  );
create policy "readers react to pops in visible shops" on public.pop_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.shops s where s.id = shop_id)
  );
create policy "readers take back pop reactions" on public.pop_reactions
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "posts are public except private notes" on public.posts
  for select to anon, authenticated
  using (
    author_id = (select auth.uid())
    or (reading_mode is distinct from 'solo' and not public.is_blocked_with(author_id))
  );
create policy "people post as themselves" on public.posts
  for insert to authenticated with check (author_id = (select auth.uid()));
create policy "people delete their posts" on public.posts
  for delete to authenticated using (author_id = (select auth.uid()));

create policy "reactors and authors see post reactions" on public.post_reactions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.posts p
      where p.id = post_id and p.author_id = (select auth.uid())
    )
  );
-- A like goes on any visible post; a want only on someone else's post about a book.
create policy "people react to visible posts" on public.post_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.posts p
      where p.id = post_id
        and (kind = 'like'
          or (p.book_id is not null and p.author_id <> (select auth.uid())))
    )
  );
create policy "people take back post reactions" on public.post_reactions
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "reporters see their reports" on public.spoiler_reports
  for select to authenticated using (reporter_id = (select auth.uid()));
create policy "people report others' unmarked posts" on public.spoiler_reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and exists (
      select 1 from public.posts p
      where p.id = post_id and not p.spoiler and p.author_id <> (select auth.uid())
    )
  );
create policy "people withdraw reports" on public.spoiler_reports
  for delete to authenticated using (reporter_id = (select auth.uid()));

create policy "book lists are private" on public.book_marks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "reading together is public, solo reading is private" on public.reading_sessions
  for select to anon, authenticated
  using (
    user_id = (select auth.uid())
    or (mode = 'together' and not public.is_blocked_with(user_id))
  );
create policy "people log their own reading" on public.reading_sessions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "people update their own reading" on public.reading_sessions
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "people delete their own reading" on public.reading_sessions
  for delete to authenticated using (user_id = (select auth.uid()));
