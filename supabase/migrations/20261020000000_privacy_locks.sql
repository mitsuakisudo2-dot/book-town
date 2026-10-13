-- A second lock behind the row policies (the review of 2026-10-12). Nothing a
-- reader sees changes; these close doors the policies already kept shut.
--
-- * Whether someone blocked you is not a question to put to the database:
--   is_blocked_with() leaves the public API for the private schema, where the
--   policies still call it (they point at the function, not at its name).
-- * Who typed a book in by hand is no longer readable, so a book on a private
--   shelf cannot be traced back to the reader who registered it.
-- * Tables made after the first schema received Supabase's default grants.
--   From here on a new table, view or function in public is reachable only
--   once a migration grants it, as the first schema intended.

alter function public.is_blocked_with(uuid) set schema private;
revoke all on function private.is_blocked_with(uuid) from public, anon, authenticated;
grant execute on function private.is_blocked_with(uuid) to anon, authenticated;

-- The one function that asked for it by name.
create or replace function public.shop_visitors(days integer) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from public.shop_visits v
  join public.shops s on s.id = v.shop_id
  where s.owner_id = auth.uid()
    and v.user_id <> s.owner_id
    and v.visited_at > now() - make_interval(days => least(greatest(days, 1), 31))
    and not private.is_blocked_with(v.user_id)
$$;

-- Runs only as the trigger on blocks; nobody calls it.
alter function public.end_follows_on_block() set schema private;
revoke all on function private.end_follows_on_block() from public, anon, authenticated;

revoke select on public.books from anon, authenticated;
grant select (id, isbn, title, author, publisher, price, source, created_at, updated_at)
  on public.books to anon, authenticated;

revoke all on public.shop_visits from anon, authenticated;
grant select, insert, update, delete on public.shop_visits to authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- Postgres lets everyone run a new function unless told otherwise; that default
-- is set for all schemas at once.
alter default privileges revoke execute on functions from public;
