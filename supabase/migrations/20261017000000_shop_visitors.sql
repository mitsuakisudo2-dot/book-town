-- 立ち寄り便り: how many readers stopped by the caller's own shop in the last
-- few days. Visits stay private to each reader (shop_visits); this only ever
-- tells an owner a number about their own shop, never who came. Their own
-- visits and readers either of them blocked are not counted.

create function public.shop_visitors(days integer) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from public.shop_visits v
  join public.shops s on s.id = v.shop_id
  where s.owner_id = auth.uid()
    and v.user_id <> s.owner_id
    and v.visited_at > now() - make_interval(days => least(greatest(days, 1), 31))
    and not public.is_blocked_with(v.user_id)
$$;
revoke all on function public.shop_visitors(integer) from public, anon;
grant execute on function public.shop_visitors(integer) to authenticated;
