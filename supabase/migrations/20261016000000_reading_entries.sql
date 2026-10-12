-- Reading records: what a reader felt when they finished a book, instead of a
-- star rating. Each record is public or the reader's own; the profile keeps
-- which one new records start as, chosen when the reader signs up.

alter table public.profiles
  add column reading_visibility text not null default 'private'
    check (reading_visibility in ('public', 'private'));

create table public.reading_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  -- Only 'finished' is written for now; the others are kept for later records.
  kind text not null default 'finished'
    check (kind in ('opened', 'bought', 'note', 'finished', 'reread')),
  body text not null default '' check (char_length(body) <= 255),
  -- 読後の気持ち. The words on screen can change; these ids stay.
  feelings text[] not null default '{}'
    check (feelings <@ array[
      'cried', 'quiet', 'sleepless', 'warm', 'laughed', 'scared',
      'shaken', 'again', 'recommend', 'talk', 'lingering', 'not_now'
    ]::text[]),
  spoiler boolean not null default false,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reading_entries_user on public.reading_entries (user_id);
create index reading_entries_public_book on public.reading_entries (book_id)
  where is_public;

-- Dated by the database, like posts. A record can be rewritten later, but
-- stays about the same book and the same reader.
create trigger reading_entries_stamp_time before insert on public.reading_entries
  for each row execute function public.stamp_post_time();
create trigger reading_entries_touch before update on public.reading_entries
  for each row execute function public.touch_updated_at();

alter table public.reading_entries enable row level security;
revoke all on public.reading_entries from anon, authenticated;
grant select on public.reading_entries to anon;
grant select, insert, delete on public.reading_entries to authenticated;
grant update (body, feelings, spoiler, is_public) on public.reading_entries
  to authenticated;

create policy "public reading records are seen, private ones by their reader" on public.reading_entries
  for select to anon, authenticated
  using (
    user_id = (select auth.uid())
    or (
      is_public
      and not public.is_blocked_with(user_id)
      and not private.is_hidden('profile', user_id)
    )
  );
create policy "readers keep their own records" on public.reading_entries
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "readers change their own records" on public.reading_entries
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "readers remove their own records" on public.reading_entries
  for delete to authenticated using (user_id = (select auth.uid()));
