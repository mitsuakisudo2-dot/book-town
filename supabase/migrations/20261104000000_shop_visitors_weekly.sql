-- 立ち寄り便り, counted once a week. An owner hears how many readers stopped
-- by their shop in the last week (Monday to Sunday, Japan time), and never
-- who. The number is now settled by the database when the week ends and
-- stays the same all the next week:
--
-- * The caller no longer chooses the span; there is one week, the one that
--   just ended.
-- * The number is taken once, at the turn of the week, so asking again during
--   the week, a reader coming back, or a reader removing their walk history
--   does not move it.
-- * Every reader who came is counted, blocked or not: a block leaves the
--   number as it is. A shop is out of reach to readers its owner blocked (or
--   who blocked the owner), so no visit is made after a block; the ones made
--   before stay in that week's number, as a number.
-- * A visit dated after the week (shop_visits.visited_at comes from the
--   reader's device) is not counted in it.
--
-- private.shop_visitor_weeks keeps the last week's number for each shop that
-- had a visitor; nobody reads it but shop_visitors(), which answers the owner
-- only. Shops with nobody have no row, so the app shows nothing for them.
--
-- Nothing moves: one table is added (empty until the first Monday), the old
-- shop_visitors(days) is replaced, and one weekly job is scheduled.
--
-- Rollback: a new migration that drops public.shop_visitors(), the job
-- (cron.unschedule('shop-visitors')), private.count_shop_visitors(),
-- private.last_visit_week() and private.shop_visitor_weeks, and creates
-- shop_visitors(days integer) again as 20261020000000_privacy_locks.sql has it
-- (the app then needs its call back to rpc("shop_visitors", { days: 7 })).

create table private.shop_visitor_weeks (
  shop_id uuid not null references public.shops (id) on delete cascade,
  -- The Monday (Japan time) the counted week began.
  week date not null,
  visitors integer not null check (visitors > 0),
  primary key (shop_id, week)
);
alter table private.shop_visitor_weeks enable row level security;
revoke all on private.shop_visitor_weeks from public, anon, authenticated;

-- The Monday, in Japan, of the week that last ended.
create function private.last_visit_week() returns date
language sql stable set search_path = '' as $$
  select (date_trunc('week', now() at time zone 'Asia/Tokyo'))::date - 7
$$;
revoke all on function private.last_visit_week() from public, anon, authenticated;

-- Runs once a week, just after Monday 00:00 in Japan. Running it again in the
-- same week leaves the shops already counted as they are.
create function private.count_shop_visitors() returns void
language sql security definer set search_path = '' as $$
  delete from private.shop_visitor_weeks where week < private.last_visit_week();
  insert into private.shop_visitor_weeks (shop_id, week, visitors)
  select s.id, private.last_visit_week(), count(*)::integer
  from public.shop_visits v
  join public.shops s on s.id = v.shop_id
  where v.user_id <> s.owner_id
    and v.visited_at >= private.last_visit_week()::timestamp at time zone 'Asia/Tokyo'
    and v.visited_at < (private.last_visit_week() + 7)::timestamp at time zone 'Asia/Tokyo'
  group by s.id
  on conflict (shop_id, week) do nothing;
$$;
revoke all on function private.count_shop_visitors() from public, anon, authenticated;

-- Sunday 15:00 UTC is Monday 00:00 in Japan.
select cron.schedule('shop-visitors', '0 15 * * 0', 'select private.count_shop_visitors()');

drop function public.shop_visitors(integer);

-- The caller's own shop, the week that last ended: how many came, and when
-- that week ended. No row when nobody came or the week is not counted yet.
create function public.shop_visitors()
returns table (visitors integer, week_end timestamptz)
language sql stable security definer set search_path = '' as $$
  select w.visitors, (w.week + 7)::timestamp at time zone 'Asia/Tokyo'
  from private.shop_visitor_weeks w
  join public.shops s on s.id = w.shop_id
  where s.owner_id = auth.uid()
    and w.week = private.last_visit_week()
$$;
revoke all on function public.shop_visitors() from public, anon;
grant execute on function public.shop_visitors() to authenticated;
