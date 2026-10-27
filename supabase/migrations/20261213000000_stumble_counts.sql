-- 機能ごとのつまずきを数える (management table 110, けにーさん 10-18 12:02Z).
-- To know which feature readers stumble on, the app counts how each try of a
-- few features went, on the reader's own device, and sends the counts now
-- and then (src/lib/stumbles.ts). Kept is only the day in Japan, the
-- feature, how it went and how many times: no reader, no time of day, no
-- address, nothing typed, no book.
--
-- That holds by shape, not by care: the function takes three lists of
-- words from fixed lists and small numbers, and has nowhere to put anything
-- else. A day is at most 4 features × 5 results = 20 rows, however many
-- readers there are; only the counts grow.
--
-- Only a signed-in reader may send (the function is granted to
-- authenticated alone), so a stranger cannot swell the counts from outside.
-- One call adds at most 100 to a row; a row stops at a hundred million. A
-- reader in manage mode is counted too (けにーさん 10-18 12:07Z): this is
-- whether a feature worked, not what anyone read.
--
-- Nobody reads the table through the API. Claude reads the weekly and
-- monthly sums with a select (private.stumble_totals, docs/09「つまずきの
-- 数」), where a cell tried fewer than 20 times shows no numbers, so a few
-- readers' tries are never told apart. Rows go after 90 days, every night
-- (pg_cron, stumbles) and on each call.
--
-- Nothing moves: one table, three functions and one nightly job are added,
-- and nothing else refers to them.
--
-- Rollback (a new migration with these lines; the app's calls then fail and
-- the counts are dropped, as they are when a call fails now):
--   select cron.unschedule('stumbles');
--   drop function public.count_stumbles(text[], text[], integer[]);
--   drop function private.stumble_totals(text);
--   drop function private.forget_stumbles();
--   drop table private.stumbles;

create table private.stumbles (
  -- The day in Japan the tries were sent on.
  day date not null,
  feature text not null
    check (feature in ('search', 'register', 'barcode', 'shelf')),
  result text not null
    check (result in ('ok', 'not_found', 'refused', 'offline', 'other')),
  times integer not null default 0 check (times between 0 and 100000000),
  primary key (day, feature, result)
);
alter table private.stumbles enable row level security;
revoke all on private.stumbles from public, anon, authenticated;

-- What a signed-in reader's device counted since it last sent: the n-th
-- feature went the n-th way the n-th number of times. What does not fit is
-- dropped without a word, so a caller learns nothing.
create function public.count_stumbles(
  features text[],
  results text[],
  times integer[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if auth.uid() is null
     or features is null or results is null or times is null
     or cardinality(features) not between 1 and 20
     or cardinality(results) <> cardinality(features)
     or cardinality(times) <> cardinality(features) then
    return;
  end if;
  delete from private.stumbles s where s.day < today - 90;
  insert into private.stumbles as s (day, feature, result, times)
  select today, c.feature, c.result, sum(least(c.n, 100))
  from unnest(features, results, times) as c(feature, result, n)
  where c.feature in ('search', 'register', 'barcode', 'shelf')
    and c.result in ('ok', 'not_found', 'refused', 'offline', 'other')
    and c.n >= 1
  group by c.feature, c.result
  on conflict (day, feature, result)
  do update set times = least(s.times + excluded.times, 100000000);
end;
$$;
revoke all on function public.count_stumbles(text[], text[], integer[])
  from public, anon, authenticated;
grant execute on function public.count_stumbles(text[], text[], integer[])
  to authenticated;

-- The sums Claude reads at the weekly check ('week', from Monday in Japan)
-- or over months ('month'). Days are never shown alone. A cell tried fewer
-- than 20 times in the period says so and no more: its numbers are null.
-- 見つからない is not a failure (a book the town does not hold yet), so it
-- is told apart from the failures and left out of their share.
create function private.stumble_totals(period text default 'week')
returns table (
  starts date,
  feature text,
  tries bigint,
  ok bigint,
  not_found bigint,
  failed bigint,
  failed_share numeric,
  under_20 boolean
)
language sql stable set search_path = '' as $$
  with sums as (
    select
      date_trunc(case when period = 'month' then 'month' else 'week' end,
        s.day)::date as starts,
      s.feature,
      sum(s.times) as tries,
      sum(s.times) filter (where s.result = 'ok') as ok,
      sum(s.times) filter (where s.result = 'not_found') as not_found,
      sum(s.times) filter (where s.result not in ('ok', 'not_found'))
        as failed
    from private.stumbles s
    group by 1, 2
  )
  select
    sums.starts,
    sums.feature,
    case when sums.tries >= 20 then sums.tries end,
    case when sums.tries >= 20 then coalesce(sums.ok, 0) end,
    case when sums.tries >= 20 then coalesce(sums.not_found, 0) end,
    case when sums.tries >= 20 then coalesce(sums.failed, 0) end,
    case when sums.tries >= 20
           and sums.tries - coalesce(sums.not_found, 0) > 0
      then round(coalesce(sums.failed, 0)::numeric
        / (sums.tries - coalesce(sums.not_found, 0)), 3)
    end,
    sums.tries < 20
  from sums
  order by sums.starts desc, sums.feature
$$;
revoke all on function private.stumble_totals(text)
  from public, anon, authenticated;

-- Every night, so rows go after 90 days even when nobody sends.
create function private.forget_stumbles() returns void
language sql security definer set search_path = '' as $$
  delete from private.stumbles s
  where s.day < (now() at time zone 'Asia/Tokyo')::date - 90;
$$;
revoke all on function private.forget_stumbles() from public, anon, authenticated;

-- 18:47 UTC is 03:47 in Japan, after the screen errors' 18:43.
select cron.schedule('stumbles', '47 18 * * *', 'select private.forget_stumbles()');
