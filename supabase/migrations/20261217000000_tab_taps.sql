-- タブが押された回数を数える (けにーさん 11-01 11:45Z: the six tabs at the
-- bottom stay for now, and the β counts which tab is pressed how often).
-- Made like the stumble counts (20261213000000_stumble_counts): the app
-- counts on the reader's own device and sends counts now and then
-- (src/lib/tab-taps.ts). Kept is only the day in Japan, the mode, the tab
-- and how many times: no reader, no time of day, no order of taps, no page
-- the reader came from.
--
-- That holds by shape, not by care: the function takes lists of words from
-- fixed lists and small numbers, and has nowhere to put anything else. A day
-- is at most 2 modes × 9 tabs = 18 rows, however many readers there are.
--
-- Counted are taps on the phone's row of tabs at the bottom (home … profile)
-- and on the three buttons of the bar at the top (top_add 本を登録,
-- top_bell お知らせ, top_me the reader's face), so that わたし and the face
-- that opens the same page can be weighed against each other. A wide screen's
-- side bar is not counted: the question is the phone's row. The mode tells
-- 読書管理モード (manage, five tabs, no 書店めぐり) from the town (town).
-- A tab added later is one more word in the two lists below, in a new
-- migration.
--
-- Only a signed-in reader may send (granted to authenticated alone). One
-- call adds at most 200 to a row; a row stops at a hundred million. Nobody
-- reads the table through the API: Claude reads weekly sums with a select
-- (docs/09「タブの回数」), where a cell under 20 taps shows no number. Rows
-- go after 90 days, every night (pg_cron, tab-taps) and on each call.
--
-- Nothing moves: one table, two functions and one nightly job are added,
-- and nothing else refers to them.
--
-- Rollback (a new migration with these lines; the app's sends then fail
-- and the counts are dropped without a word):
--   select cron.unschedule('tab-taps');
--   drop function public.count_tab_taps(text[], text[], integer[]);
--   drop function private.forget_tab_taps();
--   drop table private.tab_taps;

create table private.tab_taps (
  -- The day in Japan the taps were sent on.
  day date not null,
  mode text not null check (mode in ('town', 'manage')),
  tab text not null check (tab in (
    'home', 'search', 'walk', 'library', 'reading', 'profile',
    'top_add', 'top_bell', 'top_me'
  )),
  times integer not null default 0 check (times between 0 and 100000000),
  primary key (day, mode, tab)
);
alter table private.tab_taps enable row level security;
revoke all on private.tab_taps from public, anon, authenticated;

-- What a signed-in reader's device counted since it last sent: in the n-th
-- mode the n-th tab was pressed the n-th number of times. What does not fit
-- is dropped without a word, so a caller learns nothing.
create function public.count_tab_taps(
  modes text[],
  tabs text[],
  times integer[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if auth.uid() is null
     or modes is null or tabs is null or times is null
     or cardinality(tabs) not between 1 and 18
     or cardinality(modes) <> cardinality(tabs)
     or cardinality(times) <> cardinality(tabs) then
    return;
  end if;
  delete from private.tab_taps t where t.day < today - 90;
  insert into private.tab_taps as t (day, mode, tab, times)
  select today, c.mode, c.tab, least(sum(least(c.n, 200)), 200)
  from unnest(modes, tabs, times) as c(mode, tab, n)
  where c.mode in ('town', 'manage')
    and c.tab in (
      'home', 'search', 'walk', 'library', 'reading', 'profile',
      'top_add', 'top_bell', 'top_me'
    )
    and c.n >= 1
  group by c.mode, c.tab
  on conflict (day, mode, tab)
  do update set times = least(t.times + excluded.times, 100000000);
end;
$$;
revoke all on function public.count_tab_taps(text[], text[], integer[])
  from public, anon, authenticated;
grant execute on function public.count_tab_taps(text[], text[], integer[])
  to authenticated;

-- Every night, so rows go after 90 days even when nobody sends.
create function private.forget_tab_taps() returns void
language sql security definer set search_path = '' as $$
  delete from private.tab_taps t
  where t.day < (now() at time zone 'Asia/Tokyo')::date - 90;
$$;
revoke all on function private.forget_tab_taps() from public, anon, authenticated;

-- 18:49 UTC is 03:49 in Japan, after the stumbles' 18:47.
select cron.schedule('tab-taps', '49 18 * * *', 'select private.forget_tab_taps()');
