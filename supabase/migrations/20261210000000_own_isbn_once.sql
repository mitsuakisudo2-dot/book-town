-- A reader keeps one book of their own for an ISBN (AUD-010, 管理表101).
--
-- The app gives every book a reader types in or scans a new id where it is
-- registered, and looks for the reader's book of that ISBN only in the town
-- the page read. A page left open does not know what another page or device
-- registered since, so the same ISBN registered on both went in as two
-- books, and two rows of the library. Now the database refuses the second:
-- the page is told its registration was not saved and reads the town again,
-- where the book registered on the other page is (supabase/sync.ts).
--
-- Only the reader's own books: the catalog's (source 'ndl', no owner) are
-- one per ISBN already (books_catalog_isbn), and a book whose reader left
-- has no owner. Books without an ISBN are left as they are; the one-book
-- form asks 「この本ですか？」 of those (src/lib/same-book.ts).
--
-- No row changes. Production had no reader with two books of one ISBN
-- (2026-10-25, select). Had one come since, the index could not be made:
-- this stops first, naming only how many (the Actions log is public, and
-- Postgres's own error would show the ISBN), and the whole file is undone.
--
-- Rollback (a new migration), which loses no row:
--   drop index public.books_own_isbn;
do $$
declare
  twins bigint;
begin
  select count(*) into twins from (
    select 1 from public.books
    where created_by is not null and isbn is not null
    group by created_by, isbn
    having count(*) > 1
  ) t;
  if twins > 0 then
    raise exception 'readers with two books of one ISBN: %', twins
      using errcode = '23505';
  end if;
end;
$$;

create unique index books_own_isbn on public.books (created_by, isbn)
  where created_by is not null and isbn is not null;
