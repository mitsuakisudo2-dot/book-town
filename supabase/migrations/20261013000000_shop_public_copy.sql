-- Booktown 段階2その3: the app starts saving to the database.
-- docs/09_段階2_ログインと保存.md explains the design.

-- Public shelves --------------------------------------------------------------

-- The owner's app writes the whole shop, private shelves included, to
-- shop_private only. The database copies the public shelves to
-- shops.public_shelves, so a private shelf cannot reach visitors even if the
-- app gets it wrong. Owners can no longer write the public copies themselves.
create function public.copy_public_shelves() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.shops
  set public_shelves = coalesce((
    select jsonb_agg(shelf order by position)
    from jsonb_array_elements(new.shelves) with ordinality as entry(shelf, position)
    where jsonb_typeof(shelf) = 'object' and shelf -> 'isPublic' = 'true'::jsonb
  ), '[]'::jsonb)
  where id = new.shop_id;
  return new;
end;
$$;
revoke execute on function public.copy_public_shelves() from public, anon, authenticated;

create trigger shop_private_copy_public_shelves
  after insert or update of shelves on public.shop_private
  for each row execute function public.copy_public_shelves();

-- Shops saved before this file (from the preview of this change) get their
-- public copy now. Naming the column in SET fires the trigger for every row.
update public.shop_private set shelves = shelves;

-- public_shelves and public_scene are written by the database only.
-- (public_scene gets the same treatment when the store scene moves here.)
revoke insert, update on public.shops from authenticated;
grant insert (id, owner_id, name, description, tagline, theme, is_open)
  on public.shops to authenticated;
grant update (name, description, tagline, theme, is_open)
  on public.shops to authenticated;

-- 人生の9冊 ---------------------------------------------------------------------

-- Replaces the caller's nine in one transaction, so reordering never trips the
-- (profile_id, book_id) uniqueness halfway and a failed save loses nothing.
-- Runs with the caller's own rights: the policies on profile_nine still apply.
create function public.replace_profile_nine(book_ids uuid[], notes text[])
returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if coalesce(array_length(book_ids, 1), 0) > 9
    or coalesce(array_length(book_ids, 1), 0) <> coalesce(array_length(notes, 1), 0)
  then
    raise exception 'the nine takes up to nine books, each with a note'
      using errcode = '22023';
  end if;
  delete from public.profile_nine where profile_id = (select auth.uid());
  insert into public.profile_nine (profile_id, position, book_id, note)
  select (select auth.uid()), entry.position, entry.book_id, notes[entry.position]
  from unnest(book_ids) with ordinality as entry(book_id, position);
end;
$$;
revoke execute on function public.replace_profile_nine(uuid[], text[]) from public, anon;
grant execute on function public.replace_profile_nine(uuid[], text[]) to authenticated;

-- Post times ---------------------------------------------------------------------

-- Posts are dated by the database, so nobody can post into the past or the
-- future to sit at the top of the timeline. Posts saved together keep their order.
create function public.stamp_post_time() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := clock_timestamp();
  return new;
end;
$$;

create trigger posts_stamp_time before insert on public.posts
  for each row execute function public.stamp_post_time();
