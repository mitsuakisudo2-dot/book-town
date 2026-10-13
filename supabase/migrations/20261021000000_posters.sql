-- Posters: what a reader makes about books. A poster is kept as data, never
-- as a picture: a template, a look chosen from the presets, and pages of
-- blocks (a heading, words, a row of books). Its words can be read, searched
-- and set again for every screen. A draft is its maker's alone.

create table public.posters (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  -- Later templates (a ranking, photos) are added here.
  template text not null check (template in ('one_book', 'lineup', 'text')),
  -- Only the presets: no colors or fonts of the maker's own.
  theme text not null default 'kinari'
    check (theme in ('kinari', 'navy', 'kosho', 'wakakusa', 'usubeni', 'sumi')),
  font text not null default 'mincho' check (font in ('mincho', 'gothic')),
  -- [{"blocks": [{"type": "heading" | "text", "text": "…"} | {"type": "books", "book_ids": ["…"]}]}]
  -- Ten full pages take about 70 kB; the cap keeps a town light to load.
  pages jsonb not null check (octet_length(pages::text) <= 131072),
  spoiler boolean not null default false,
  show_in_timeline boolean not null default false,
  -- Whether others may hang it in their shops (a later phase); the maker can refuse.
  allow_display boolean not null default true,
  status text not null default 'published' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index posters_author on public.posters (author_id);
-- A town loads the newest posters first, as it does posts.
create index posters_created on public.posters (created_at desc);

-- Which books each poster shows, so a book's page finds its posters. Written
-- by the database from the pages, never by hand.
create table public.poster_books (
  poster_id uuid not null references public.posters (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  -- The first page a book appears on; books on page 1 lead on their page.
  first_page integer not null check (first_page between 1 and 10),
  primary key (poster_id, book_id)
);
create index poster_books_book on public.poster_books (book_id);

-- The same limits as the app (src/lib/posters.ts): 10 pages, at most one
-- heading, one text and one row of books a page, 9 books a page (1 for a
-- one-book poster, none for words alone) and 100 a poster, a heading of 60
-- characters and words of 2000. Nothing else is kept in a page.
create function private.check_poster() returns trigger
language plpgsql set search_path = '' as $$
declare
  page jsonb;
  block jsonb;
  kinds text[];
  on_page integer;
  total integer := 0;
  most integer := case new.template when 'one_book' then 1 when 'text' then 0 else 9 end;
begin
  if jsonb_typeof(new.pages) is distinct from 'array'
    or jsonb_array_length(new.pages) not between 1 and 10 then
    raise exception 'a poster has 1 to 10 pages' using errcode = '23514';
  end if;
  for page in select value from jsonb_array_elements(new.pages) loop
    if jsonb_typeof(page) is distinct from 'object'
      or page - 'blocks' <> '{}'::jsonb
      or jsonb_typeof(page -> 'blocks') is distinct from 'array'
      or jsonb_array_length(page -> 'blocks') > 3 then
      raise exception 'a poster page is a list of blocks' using errcode = '23514';
    end if;
    on_page := 0;
    kinds := '{}';
    for block in select value from jsonb_array_elements(page -> 'blocks') loop
      if jsonb_typeof(block) is distinct from 'object'
        or (block ->> 'type') = any (kinds) then
        raise exception 'a poster page has one block of each kind' using errcode = '23514';
      end if;
      kinds := kinds || (block ->> 'type');
      if block ->> 'type' = 'heading'
        and block - 'type' - 'text' = '{}'::jsonb
        and jsonb_typeof(block -> 'text') = 'string'
        and char_length(block ->> 'text') <= 60 then
        continue;
      elsif block ->> 'type' = 'text'
        and block - 'type' - 'text' = '{}'::jsonb
        and jsonb_typeof(block -> 'text') = 'string'
        and char_length(block ->> 'text') <= 2000 then
        continue;
      elsif block ->> 'type' = 'books'
        and block - 'type' - 'book_ids' = '{}'::jsonb
        and jsonb_typeof(block -> 'book_ids') = 'array' then
        on_page := on_page + jsonb_array_length(block -> 'book_ids');
      else
        raise exception 'a poster block is a heading, words or books' using errcode = '23514';
      end if;
    end loop;
    if on_page > 9 then
      raise exception 'a poster page shows at most 9 books' using errcode = '23514';
    end if;
    if on_page > most then
      raise exception 'this kind of poster shows fewer books a page' using errcode = '23514';
    end if;
    total := total + on_page;
  end loop;
  if total > 100 then
    raise exception 'a poster shows at most 100 books' using errcode = '23514';
  end if;
  -- A draft put up is new on the board from then on.
  if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'published' then
    new.created_at := clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function private.check_poster() from public, anon, authenticated;

create trigger posters_check before insert or update on public.posters
  for each row execute function private.check_poster();
-- Dated by the database, like posts.
create trigger posters_stamp_time before insert on public.posters
  for each row execute function public.stamp_post_time();
create trigger posters_touch before update on public.posters
  for each row execute function public.touch_updated_at();

-- Rebuilds a poster's list of books from its pages. A book id that is not a
-- book in the catalog refuses the whole save.
create function private.list_poster_books() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.poster_books where poster_id = new.id;
  insert into public.poster_books (poster_id, book_id, first_page)
  select new.id, (book.value #>> '{}')::uuid, min(page.n)::integer
  from jsonb_array_elements(new.pages) with ordinality as page (value, n),
    jsonb_array_elements(page.value -> 'blocks') as block (value),
    jsonb_array_elements(block.value -> 'book_ids') as book (value)
  where block.value ->> 'type' = 'books'
  group by (book.value #>> '{}')::uuid;
  return null;
end;
$$;
revoke all on function private.list_poster_books() from public, anon, authenticated;

create trigger posters_list_books after insert or update of pages on public.posters
  for each row execute function private.list_poster_books();

alter table public.posters enable row level security;
alter table public.poster_books enable row level security;
grant select on public.posters to anon, authenticated;
grant insert, delete on public.posters to authenticated;
grant update (template, theme, font, pages, spoiler, show_in_timeline, allow_display, status)
  on public.posters to authenticated;
grant select on public.poster_books to anon, authenticated;

create policy "posters put up are seen, drafts by their maker" on public.posters
  for select to anon, authenticated
  using (
    author_id = (select auth.uid())
    or (
      status = 'published'
      and not private.is_blocked_with(author_id)
      and not private.is_hidden('poster', id)
      and not private.is_hidden('profile', author_id)
    )
  );
create policy "readers make their own posters" on public.posters
  for insert to authenticated with check (author_id = (select auth.uid()));
create policy "readers change their own posters" on public.posters
  for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "readers take down their own posters" on public.posters
  for delete to authenticated using (author_id = (select auth.uid()));

-- A poster's books are seen by whoever may see the poster.
create policy "a poster's books are seen with the poster" on public.poster_books
  for select to anon, authenticated
  using (exists (select 1 from public.posters p where p.id = poster_id));

-- A poster can be reported, and hidden by the operator, like a post.
alter table public.reports drop constraint reports_target_kind_check;
alter table public.reports add constraint reports_target_kind_check
  check (target_kind in ('post', 'shop', 'profile', 'poster'));
alter table public.moderation_hides drop constraint moderation_hides_target_kind_check;
alter table public.moderation_hides add constraint moderation_hides_target_kind_check
  check (target_kind in ('post', 'shop', 'profile', 'poster'));
