-- Editions get ids of their own (item 4 of the 2026-10-16 plan; the owner's
-- review of the bibliographic master, 2026-10-16 22:36Z, ⑤). Until now an
-- edition was its ISBN, and a book without one had a work but no edition.
-- From here on an edition is an id: the key books and the master hold, with
-- its ISBN one of its facts. A book without an ISBN is an edition of its own,
-- with no ISBN, as it always was in words (CLAUDE.md, docs/09「作品と版」).
-- So the bibliographic master (the next step) keeps its facts by edition,
-- with an ISBN or without, and a registration it holds back from a work
-- still knows its edition.
--
-- What does not change: the same ISBN is the same edition, at once, and
-- registering never compares titles or waits for anyone but another
-- registration of that ISBN in flight; each edition keeps its ISBN, its work
-- and its age; no book changes a column of its own or its updated_at.
--
-- What moves: every edition gets an id, and every book its edition's
-- (edition_id). Each book without an ISBN gets an edition of its own, in the
-- work it is in, as old as the book. A join remembers the editions it moved
-- (private.work_joins.editions), so its undoing and the operator's parting
-- go by edition, ISBN or not.
--
-- Who reads what: nobody reads editions, nor a book's edition_id, through
-- the API, and readers never write it: books' column grants leave it out,
-- and the database fills it in, as it does work_id.
--
-- The copy (moving_copies): books. Editions change their key here, which
-- check_copy cannot match rows across, so the file compares them with what
-- they were itself. docs/09「作品と版」has the steps and the undoing.
--
-- Rollback: until the app reads edition_id (it does not yet), a new
-- migration undoes this one with
--   drop trigger books_touch on public.books;
--   create trigger books_touch before update on public.books
--     for each row when (old.work_id is not distinct from new.work_id)
--     execute function public.touch_updated_at();
--   alter table private.work_joins drop column editions;
--   alter table public.books drop column edition_id;
--   delete from public.editions where isbn is null;
--   alter table public.editions drop constraint editions_pkey;
--   alter table public.editions drop constraint editions_isbn_key;
--   alter table public.editions alter column isbn set not null;
--   alter table public.editions add constraint editions_pkey primary key (isbn);
--   alter table public.editions drop column id;
--   alter table public.books add constraint books_isbn_fkey foreign key (isbn)
--     references public.editions (isbn) on delete restrict;
--   drop function private.isbn_edition(text);

-- and then makes private.edition_work(text), private.book_work(),
-- private.book_work_edited(), private.join_works(uuid, uuid),
-- private.undo_join(uuid) and private.part_books(uuid[]) again as
-- 20261027000000_works.sql has them, each with create or replace and the
-- revoke after it. pnpm test:db runs exactly that, then drops the copy and
-- runs this file again. The works of the books without an ISBN stay; only
-- their editions go. Should the books need putting back as the copy kept
-- them, after the rollback:
--   select * from private.restore_copy('20261031000000_edition_ids', array['public.books']::regclass[]);

-- Nobody reads or writes a book or an edition until this file is done.
-- Books first, then editions, the order a registration takes them in (it
-- writes its book, and the trigger then its edition), so the two never wait
-- on each other. Nothing else that points at a book changes. In a DO block,
-- because supabase db push sends a file without BEGIN, and a bare LOCK is
-- refused outside a transaction block.
select set_config('lock_timeout', '10s', true);
do $$
begin
  lock table public.books in access exclusive mode;
  lock table public.editions in access exclusive mode;
end;
$$;

select private.keep_copy('20261031000000_edition_ids', array['public.books']::regclass[]);

-- The editions as they were, for the check at the end. Dropped there.
create temporary table editions_before as
  select e.isbn, e.work_id, e.created_at from public.editions e;

-- Editions ------------------------------------------------------------------------

-- An edition is its id. Its ISBN is one of its facts: the same ISBN is
-- still one edition (editions_isbn_key), and an edition without one is the
-- edition of the one book without an ISBN it was made for. isbn13_valid
-- passes a missing ISBN, as a check passes null.
alter table public.editions add column id uuid not null default gen_random_uuid();
alter table public.books drop constraint books_isbn_fkey;
alter table public.editions drop constraint editions_pkey;
alter table public.editions alter column isbn drop not null;
alter table public.editions add constraint editions_pkey primary key (id);
alter table public.editions add constraint editions_isbn_key unique (isbn);

alter table public.books add column edition_id uuid;

-- Being given an edition is not a change to a book, as being moved to
-- another work is not (works): it keeps its updated_at. An edited ISBN still
-- counts, since books_touch fires before books_work_edited moves the book.
drop trigger books_touch on public.books;
create trigger books_touch before update on public.books
  for each row when (old.work_id is not distinct from new.work_id
    and old.edition_id is not distinct from new.edition_id)
  execute function public.touch_updated_at();

-- The books there are now: those with an ISBN in its edition, and each one
-- without in an edition of its own, in its work, as old as it.
update public.books b set edition_id = e.id
from public.editions e where e.isbn = b.isbn;
update public.books b set edition_id = gen_random_uuid() where b.isbn is null;
insert into public.editions (id, work_id, created_at)
select b.edition_id, b.work_id, b.created_at from public.books b where b.isbn is null;

-- A book is never without an edition, and an edition with books is never
-- deleted.
alter table public.books
  alter column edition_id set not null,
  add constraint books_edition_id_fkey foreign key (edition_id)
    references public.editions (id) on delete restrict;
create index books_edition on public.books (edition_id);

-- A new book's edition and work --------------------------------------------------------

-- The edition of this ISBN and its work, made with a work of its own the
-- first time the ISBN is registered. As edition_work did (works): a
-- registration holds the edition's row until it is saved, locking it when
-- the edition is there and owning it when it makes it, so a second
-- registration of the ISBN in flight waits for the first alike either way,
-- and two first registrations at once meet in one edition. Security
-- definer: readers can neither read nor make editions and works.
create function private.isbn_edition(isbn text, out found_edition uuid, out found_work uuid)
language plpgsql security definer set search_path = '' as $$
declare
  made uuid;
begin
  select e.id, e.work_id into found_edition, found_work from public.editions e
  where e.isbn = isbn_edition.isbn for no key update;
  if found then
    return;
  end if;
  insert into public.works default values returning id into made;
  insert into public.editions (isbn, work_id) values (isbn_edition.isbn, made)
  on conflict on constraint editions_isbn_key do nothing
  returning id into found_edition;
  if found then
    found_work := made;
    return;
  end if;
  -- Another registration made the edition meanwhile: its edition, not this one.
  delete from public.works w where w.id = made;
  select e.id, e.work_id into found_edition, found_work from public.editions e
  where e.isbn = isbn_edition.isbn for no key update;
end;
$$;
revoke all on function private.isbn_edition(text) from public, anon, authenticated;

-- Before a book is inserted, it is given its edition and work: its ISBN's,
-- or for a book without one, an edition and a work of its own. A book sent
-- again (the app's upsert passes over duplicates) meets its own row and is
-- given that row's, so nothing is made for nothing (two sends of one book at
-- once, from two requests, may leave an edition and a work without a book,
-- which nobody reads). Whatever edition_id or
-- work_id an insert names is replaced: only this decides them. What it
-- writes is ids, which show nothing.
create or replace function private.book_work() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.isbn is not null then
    select f.found_edition, f.found_work into new.edition_id, new.work_id
    from private.isbn_edition(new.isbn) f;
    return new;
  end if;
  select b.edition_id, b.work_id into new.edition_id, new.work_id
  from public.books b where b.id = new.id;
  if not found then
    insert into public.works default values returning id into new.work_id;
    insert into public.editions (work_id) values (new.work_id)
    returning id into new.edition_id;
  end if;
  return new;
end;
$$;

-- A book whose ISBN is changed goes to that ISBN's edition and work, or,
-- with its ISBN taken off, to an edition and a work of its own; a change of
-- work is written down. The edition it leaves stays (with its ISBN's other
-- books, or, made for it alone, with none, which nobody reads), as the work
-- it leaves does.
create or replace function private.book_work_edited() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.isbn is not null then
    select f.found_edition, f.found_work into new.edition_id, new.work_id
    from private.isbn_edition(new.isbn) f;
  else
    insert into public.works default values returning id into new.work_id;
    insert into public.editions (work_id) values (new.work_id)
    returning id into new.edition_id;
  end if;
  if new.work_id <> old.work_id then
    insert into private.work_changes (book_id, from_work, to_work, kind)
    values (old.id, old.work_id, new.work_id, 'edited');
  end if;
  return new;
end;
$$;

drop function private.edition_work(text);

-- The operator's tools, by edition ------------------------------------------------------

-- The editions each join moved. A join before this file wrote down the ISBNs
-- it moved and, in work_changes, every book; its editions are those of the
-- ISBNs and of the books without one that it moved.
alter table private.work_joins add column editions uuid[] not null default '{}';
update private.work_joins j set editions = array(
  select e.id from public.editions e where e.isbn = any (j.isbns)
  union
  select b.edition_id from private.work_changes c
  join public.books b on b.id = c.book_id
  where c.join_id = j.id and c.kind = 'join' and b.isbn is null
  order by 1);

-- As before (works), and the join writes down the editions it moves as well
-- as their ISBNs.
create or replace function private.join_works(stays_with uuid, goes_with uuid)
returns table (join_id uuid, moved integer)
language plpgsql security definer set search_path = '' as $$
declare
  kept uuid;
  gone uuid;
  made uuid;
  n integer;
begin
  lock table public.books in share row exclusive mode;
  select b.work_id into kept from public.books b where b.id = stays_with;
  select b.work_id into gone from public.books b where b.id = goes_with;
  if kept is null or gone is null then
    raise exception 'no book has that id' using errcode = 'P0002';
  end if;
  if kept = gone then
    raise exception 'the two books are one work already';
  end if;
  insert into private.work_joins (kept, gone, isbns, editions, led_here)
  values (kept, gone,
    array(select e.isbn from public.editions e
      where e.work_id = gone and e.isbn is not null order by e.isbn),
    array(select e.id from public.editions e where e.work_id = gone order by e.id),
    array(select w.id from public.works w where w.merged_into = gone order by w.id))
  returning id into made;
  insert into private.work_changes (book_id, from_work, to_work, kind, join_id)
  select b.id, gone, kept, 'join', made from public.books b where b.work_id = gone;
  update public.editions e set work_id = kept where e.work_id = gone;
  update public.books b set work_id = kept where b.work_id = gone;
  get diagnostics n = row_count;
  -- Works joined into the one that goes now lead to the one that stays, and
  -- so does what was decided about them (works_apart).
  update public.works w set merged_into = kept where w.id = gone or w.merged_into = gone;
  return query select made, n;
end;
$$;

-- Undoes a join exactly: the editions it moved go back, with every book of
-- them still in the work that stayed (those registered since too); the
-- works that led to the one that went lead there again, and with them what
-- was decided about them. The two works are then kept apart. A join whose
-- work was joined into another since waits until that join is undone.
-- Returns how many books moved back.
create or replace function private.undo_join(which uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  j private.work_joins%rowtype;
  n integer;
begin
  lock table public.books in share row exclusive mode;
  select * into j from private.work_joins x where x.id = which for update;
  if not found then
    raise exception 'no join has that id' using errcode = 'P0002';
  end if;
  if j.undone_at is not null then
    raise exception 'that join is undone already';
  end if;
  if exists (select 1 from public.works w where w.id = j.kept and w.merged_into is not null) then
    raise exception 'the work that stayed was joined into another since; undo that join first';
  end if;
  insert into private.work_changes (book_id, from_work, to_work, kind, join_id)
  select b.id, j.kept, j.gone, 'unjoin', j.id from public.books b
  where b.work_id = j.kept and b.edition_id = any (j.editions);
  update public.books b set work_id = j.gone
  where b.work_id = j.kept and b.edition_id = any (j.editions);
  get diagnostics n = row_count;
  update public.editions e set work_id = j.gone where e.work_id = j.kept and e.id = any (j.editions);
  update public.works w set merged_into = null where w.id = j.gone;
  update public.works w set merged_into = j.gone
  where w.id = any (j.led_here) and w.merged_into = j.kept;
  insert into private.works_apart (work_a, work_b)
  values (least(j.kept, j.gone), greatest(j.kept, j.gone))
  on conflict do nothing;
  update private.work_joins x set undone_at = now() where x.id = j.id;
  return n;
end;
$$;

-- Takes books out of their work into one new work of their own, with all
-- that points at them: the whole edition of each, ISBN or not, every book of
-- it in that work. They must all be in one work, and not all of it. The new
-- work is kept apart from the old, so the pair does not come back as a
-- candidate. Returns the new work. Undo: join_works again.
create or replace function private.part_books(book_ids uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  old uuid;
  fresh uuid;
  parting uuid[];
begin
  lock table public.books in share row exclusive mode;
  if coalesce(cardinality(book_ids), 0) = 0 then
    raise exception 'name the books to part';
  end if;
  if exists (
    select 1 from unnest(book_ids) given (id)
    where not exists (select 1 from public.books b where b.id = given.id)
  ) then
    raise exception 'no book has that id' using errcode = 'P0002';
  end if;
  if (select count(distinct b.work_id) from public.books b where b.id = any (book_ids)) > 1 then
    raise exception 'the books are in more than one work; part them one work at a time';
  end if;
  select b.work_id into old from public.books b where b.id = book_ids[1];
  parting := array(
    select b.id from public.books b
    where b.work_id = old
      and b.edition_id in (select x.edition_id from public.books x where x.id = any (book_ids)));
  if not exists (
    select 1 from public.books b where b.work_id = old and b.id <> all (parting)
  ) then
    raise exception 'those are all the books of their work; nothing to part';
  end if;
  insert into public.works default values returning id into fresh;
  insert into private.work_changes (book_id, from_work, to_work, kind)
  select p.id, old, fresh, 'part' from unnest(parting) p (id);
  update public.editions e set work_id = fresh
  where e.work_id = old
    and e.id in (select x.edition_id from public.books x where x.id = any (book_ids));
  update public.books b set work_id = fresh where b.id = any (parting);
  insert into private.works_apart (work_a, work_b)
  values (least(fresh, old), greatest(fresh, old));
  return fresh;
end;
$$;

-- The check ---------------------------------------------------------------------------

-- Besides check_copy's rows and links: every book kept its own columns;
-- every edition its ISBN, work and age, and no edition with an ISBN came
-- from nowhere; each book with an ISBN is in that ISBN's edition, and each
-- without alone in an edition without one, as old as the book; every book
-- is in its edition's work; and each join knows an edition for every ISBN
-- it moved. Counts only in the messages: they land in public Actions logs.
do $$
declare
  copy_table text;
  changed bigint;
begin
  select c.copy_name into copy_table from keep.copies c
  where c.label = '20261031000000_edition_ids' and c.source = 'public.books';
  execute format(
    'select count(*) from keep.%I c join public.books b on b.id = c.id
     where to_jsonb(b) - ''edition_id'' is distinct from to_jsonb(c) - ''keep_owners''',
    copy_table) into changed;
  if changed > 0 then
    raise exception 'the move changed % books', changed;
  end if;
  select count(*) into changed from editions_before o
  where not exists (
    select 1 from public.editions e
    where e.isbn = o.isbn and e.work_id = o.work_id and e.created_at = o.created_at);
  if changed > 0 then
    raise exception '% editions changed', changed;
  end if;
  select count(*) into changed from public.editions e
  where e.isbn is not null and not exists (select 1 from editions_before o where o.isbn = e.isbn);
  if changed > 0 then
    raise exception '% editions with an ISBN are new', changed;
  end if;
  select count(*) into changed from public.books b
  join public.editions e on e.id = b.edition_id
  where b.isbn is not null and e.isbn is distinct from b.isbn;
  if changed > 0 then
    raise exception '% books are not in their ISBN''s edition', changed;
  end if;
  select count(*) into changed from public.books b
  join public.editions e on e.id = b.edition_id
  where b.isbn is null and (
    e.isbn is not null
    or e.created_at <> b.created_at
    or exists (select 1 from public.books o where o.edition_id = b.edition_id and o.id <> b.id));
  if changed > 0 then
    raise exception '% books without an ISBN are not alone in an edition of their own', changed;
  end if;
  select count(*) into changed from public.editions e
  where e.isbn is null and not exists (select 1 from public.books b where b.edition_id = e.id);
  if changed > 0 then
    raise exception '% editions without an ISBN have no book', changed;
  end if;
  select count(*) into changed from public.books b
  join public.editions e on e.id = b.edition_id
  where e.work_id <> b.work_id;
  if changed > 0 then
    raise exception '% books are not in their edition''s work', changed;
  end if;
  select count(*) into changed from private.work_joins j
  where exists (
    select 1 from unnest(j.isbns) i (isbn)
    where not exists (
      select 1 from public.editions e where e.isbn = i.isbn and e.id = any (j.editions)));
  if changed > 0 then
    raise exception '% joins lack the edition of an ISBN they moved', changed;
  end if;
end;
$$;

drop table editions_before;

select private.check_copy('20261031000000_edition_ids');
