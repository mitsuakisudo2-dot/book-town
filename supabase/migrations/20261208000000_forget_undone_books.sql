-- A book taken back in the scanner goes when its scan ends (AUD-055, item
-- 102 of the plan). ［登録を取り消す］ takes the book out of the library and
-- keeps its row, so ［元に戻す］ can bring it back as it was while the scan
-- is open. The book's own row stayed too: its reader still read it (the
-- books' policy lets the one who typed a book read it), so it was found in
-- their search as 登録した本 and offered for their shop, as if registered.
--
-- When the scan ends (完了, or closed), the app asks forget_books for the
-- books it made in that scan and that are still taken back, with the scan's
-- id and when each was taken out as the app last saved it. A book goes only
-- when:
--   * it is the caller's own typed book (source 'manual', created_by them)
--     with an ISBN (a book without one is its own edition, kept with it);
--   * the caller's library row of it came in with that scan (batch_id) and
--     is taken out, at the very time the app says (removed_at), and was
--     never used (ever_used): a book brought back and taken out again since,
--     on another device or by hand, is kept with what its row was given;
--   * nothing else names it: of the foreign keys in public to public.books,
--     only the caller's own library row and library mark may
--     (private.catalog_used's sweep, so a table added later is counted too),
--     and no shop's shelves or scene, no copy made from it or that it is
--     (private.book_copies), no catalog's taking of it, nor an operator's
--     change of works.
-- With it go the caller's library mark, shelf places and library row of it, and
-- the rows that follow a book (its checks, grams). Its edition and work
-- stay, as when the catalog drops a row (private.catalog_gone). A book taken
-- out of the library by hand is never asked about: its row keeps what it
-- was given, for when it comes back.
--
-- The caller's shop rows are held while it runs, so a save of their shelves
-- or scene waits for it and cannot come to name a book between the look and
-- the delete. At most 200 books a call, given as one list (the app asks in
-- parts).
--
-- Nothing else changes: two new functions, one the app calls.
--
-- Rollback: a new migration with
--   drop function public.forget_books(uuid[], timestamptz[], uuid);
--   drop function private.book_used_besides_own(uuid, uuid);

-- Whether anyone but `reader`'s own library row and library mark names book `b`.
create function private.book_used_besides_own(b uuid, reader uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  link record;
  hit boolean;
begin
  for link in
    select c.conrelid::regclass as tab, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and c.confrelid = 'public.books'::regclass
      and n.nspname = 'public' and cardinality(c.conkey) = 1
  loop
    if link.tab = 'public.library_entries'::regclass then
      select exists (
        select 1 from public.library_entries l where l.book_id = b and l.user_id <> reader)
        into hit;
    elsif link.tab = 'public.book_marks'::regclass then
      -- A wish, a favorite or 読了 is the reader's own use of it.
      select exists (
        select 1 from public.book_marks m
        where m.book_id = b and (m.user_id <> reader or m.kind <> 'library'))
        into hit;
    else
      execute format('select exists (select 1 from %s where %I = $1)', link.tab, link.col)
        into hit using b;
    end if;
    if hit then
      return true;
    end if;
  end loop;
  return exists (
      select 1 from public.shops s
      where s.public_scene_books @> jsonb_build_array(b::text)
        or s.public_shelves @> jsonb_build_array(jsonb_build_object(
          'items', jsonb_build_array(jsonb_build_object('bookId', b::text)))))
    or exists (
      select 1 from public.shop_private p
      where p.scene_books @> jsonb_build_array(b::text)
        or p.shelves @> jsonb_build_array(jsonb_build_object(
          'items', jsonb_build_array(jsonb_build_object('bookId', b::text)))))
    or exists (select 1 from private.work_changes w where w.book_id = b)
    or exists (
      select 1 from private.book_copies c where c.book_id = b or c.copied_from = b)
    or exists (select 1 from private.catalog_imports i where i.book_id = b);
end;
$$;
revoke all on function private.book_used_besides_own(uuid, uuid) from public, anon, authenticated;

-- Forgets the caller's books of scan `batch` that are still taken back
-- (above): `ids` with, at the same place in `removed`, when each was taken
-- out. Answers the ids that went; the others stay as they are.
create function public.forget_books(ids uuid[], removed timestamptz[], batch uuid)
returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  b uuid;
  out_at timestamptz;
  gone uuid[] := '{}';
begin
  if me is null or batch is null or ids is null or removed is null
      or array_ndims(ids) <> 1 or array_ndims(removed) <> 1
      or cardinality(ids) <> cardinality(removed) or cardinality(ids) > 200 then
    return gone;
  end if;
  perform 1 from public.shops s where s.owner_id = me for update;
  perform 1 from public.shop_private p
  join public.shops s on s.id = p.shop_id
  where s.owner_id = me
  for update of p;
  for b, out_at in
    select distinct on (x.id) x.id, x.at from unnest(ids, removed) x (id, at)
    where x.id is not null and x.at is not null
    order by x.id
  loop
    -- Held until the end, so no row of a foreign key can come to name it
    -- meanwhile (nor the shop, held above).
    perform 1 from public.books k
    where k.id = b and k.created_by = me and k.source = 'manual'
      and k.isbn is not null
    for update;
    continue when not found;
    perform 1 from public.library_entries l
    where l.user_id = me and l.book_id = b and l.batch_id = forget_books.batch
      and l.removed_at = out_at and not l.ever_used
    for update;
    continue when not found;
    continue when private.book_used_besides_own(b, me);
    delete from public.library_shelf_books s where s.user_id = me and s.book_id = b;
    delete from public.book_marks m where m.user_id = me and m.book_id = b;
    delete from public.library_entries l where l.user_id = me and l.book_id = b;
    delete from public.books k where k.id = b;
    gone := gone || b;
  end loop;
  return gone;
end;
$$;
revoke all on function public.forget_books(uuid[], timestamptz[], uuid)
  from public, anon, authenticated;
grant execute on function public.forget_books(uuid[], timestamptz[], uuid) to authenticated;
