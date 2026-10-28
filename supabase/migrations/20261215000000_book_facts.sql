-- 読書の統計 (management table 19, けにーさん 10-28 09:05Z「とりあえずベータ前に
-- 入れる統計はこれかな」): the reading statistics need a book's pages (読んだ
-- ページ, the pages left of a book being read, これからの楽しみ, 積んだ高さ)
-- and its genre (よく読むジャンル, 見る本). Both are kept already, where no
-- app reads them: the pages the library gives (private.edition_sources.
-- fields.pages, 20261202000000_book_extent.sql) and BookTown's genre of the
-- book's work (private.work_genre, 20261206000000_people.sql), else of its
-- own edition's NDC.
--
-- public.book_facts(ids) gives them for books its caller may already read
-- the bibliography of, on the same terms as public.book_bibliography: the
-- book checked as this edition's, and asked after it was placed, and a
-- reader's own book (or one listed in a public place) unless it is the
-- library's. Nothing is written, and nothing about a reader goes into it:
-- the pages and the genre are the edition's and the work's, the same for
-- every reader. 200 ids an ask, as book_bibliography.
--
-- Pages are the source's that ranks first (private.bib_providers) and has
-- them; the operator's fixes have no pages to fix. A number outside 1–100000
-- is not given.
--
-- Rollback (a new migration with these lines; nothing kept is lost):
--   drop function public.book_facts(uuid[]);
--   drop function private.edition_pages(uuid, timestamptz);

create function private.edition_pages(ed uuid, since timestamptz)
returns integer
language sql stable set search_path = '' as $$
  select (s.fields ->> 'pages')::integer
  from private.edition_sources s
  join private.bib_providers p on p.source = s.source
  where s.edition_id = ed
    and jsonb_typeof(s.fields -> 'pages') = 'number'
    and (s.fields ->> 'pages')::numeric between 1 and 100000
    and (s.fields ->> 'pages')::numeric = trunc((s.fields ->> 'pages')::numeric)
    and coalesce(s.found_for, '-infinity') >= since
  order by p.rank
  limit 1
$$;
revoke all on function private.edition_pages(uuid, timestamptz)
  from public, anon, authenticated;

create function public.book_facts(ids uuid[])
returns table (book_id uuid, pages integer, genre text)
language sql stable security definer set search_path = '' as $$
  select b.id,
    private.edition_pages(b.edition_id, c.placed_at),
    coalesce(private.work_genre(b.work_id), private.ndc_genre(d.ndc))
  from public.books b
  join private.book_checks c on c.book_id = b.id
  cross join lateral private.edition_bibliography(b.edition_id, c.placed_at) d
  where b.id = any ((book_facts.ids)[1:200])
    and c.placed_at <= now() - interval '10 minutes'
    and (c.verdict in ('same', 'close') or c.confirmed_at is not null)
    and d.sources <> '{}'
    and case when b.source = 'ndl' then true
      else b.created_by = (select auth.uid())
        or private.book_is_listed(b.id)
        or private.book_is_mine(b.id) end
$$;
revoke all on function public.book_facts(uuid[]) from public, anon, authenticated;
grant execute on function public.book_facts(uuid[]) to anon, authenticated;
