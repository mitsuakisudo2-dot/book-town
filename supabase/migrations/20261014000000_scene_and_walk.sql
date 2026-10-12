-- Booktown 段階2その3b: the store scene and the bookshop walk move to the database.
-- docs/09_段階2_ログインと保存.md explains the design.

-- Public scene -------------------------------------------------------------------

-- The part of a store scene a visitor may see, the same rule as
-- publicStoreScene() in src/lib/store-customization.ts: unplaced objects,
-- shelf rows not marked public, private or unplaced books, and everything
-- standing on them (POPs) are left out. The scene is labelled with its shop.
create function public.public_scene_of(scene jsonb, shop uuid) returns jsonb
language sql immutable set search_path = '' as $$
  with recursive objects as (
    select entry.object, entry.position,
      entry.object ->> 'id' as id,
      entry.object ->> 'parentId' as parent_id
    from jsonb_array_elements(
      case when jsonb_typeof(scene -> 'objects') = 'array'
        then scene -> 'objects' else '[]'::jsonb end
    ) with ordinality as entry(object, position)
    where jsonb_typeof(entry.object) = 'object'
  ),
  hidden (id) as (
    select id from objects
    where id is not null and (
      object -> 'placed' = 'false'::jsonb
      or (object ->> 'kind' = 'row'
        and object -> 'isPublic' is distinct from 'true'::jsonb)
      or (object ->> 'kind' = 'book'
        and (object -> 'isPublic' = 'false'::jsonb or parent_id is null))
    )
    union
    select child.id from objects child join hidden on child.parent_id = hidden.id
  )
  select jsonb_set(scene, '{storeId}', to_jsonb(shop::text)) || jsonb_build_object(
    'objects', coalesce((
      select jsonb_agg(object order by position) from objects
      where id is not null and not exists (
        select 1 from hidden where hidden.id = objects.id
      )
    ), '[]'::jsonb)
  )
$$;
revoke execute on function public.public_scene_of(jsonb, uuid) from public, anon, authenticated;

-- The owner's app writes the whole scene to shop_private only; the database
-- copies the public part to shops.public_scene, as it does for the shelves.
create function public.copy_public_scene() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.shops
  set public_scene = case when new.scene is null then null
    else public.public_scene_of(new.scene, new.shop_id) end
  where id = new.shop_id;
  return new;
end;
$$;
revoke execute on function public.copy_public_scene() from public, anon, authenticated;

create trigger shop_private_copy_public_scene
  after insert or update of scene on public.shop_private
  for each row execute function public.copy_public_scene();

update public.shop_private set scene = scene where scene is not null;

-- The books a scene shows, so the town can load them without reading every
-- scene. Visitors need them to see the shop; the owner needs them to edit it.
alter table public.shops add column public_scene_books jsonb not null
  generated always as (coalesce(jsonb_path_query_array(
    public_scene, '$.objects[*] ? (@.kind == "book").bookId'), '[]')) stored;
alter table public.shop_private add column scene_books jsonb not null
  generated always as (coalesce(jsonb_path_query_array(
    scene, '$.objects[*] ? (@.kind == "book").bookId'), '[]')) stored;

-- Walk -------------------------------------------------------------------------

-- Which bookshops a reader has been to on the walk, and when. Only they see it.
create table public.shop_visits (
  user_id uuid not null references public.profiles (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  visited_at timestamptz not null default now(),
  primary key (user_id, shop_id)
);
create index shop_visits_shop on public.shop_visits (shop_id);

alter table public.shop_visits enable row level security;
grant select, insert, update, delete on public.shop_visits to authenticated;

create policy "visits are private" on public.shop_visits
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.shops s where s.id = shop_id)
  );

-- Shop reactions now carry words to the owner. Once either of them blocks the
-- other, the owner no longer sees what that reader left.
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
    )
  );
