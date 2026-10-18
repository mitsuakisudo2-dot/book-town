-- 画面のエラーの記録 (management table 46, AUD-032). The site is static, so an
-- error on a reader's phone reached no one. The app now sends each error it
-- hears, once per page, with what could name a reader already taken out
-- (src/lib/screen-errors.ts): the kind, the error's words, the page's path,
-- a few script positions of the site's own, the build and a short device
-- label. Never who the reader is.
--
-- The same error on the same page, build and device on the same day (Japan
-- time) is one row with a count, so a busy day is a few rows. Nobody reads
-- the table through the API: the morning watch counts it with a read-only
-- query and Claude reads it with a select (docs/09「画面のエラーの記録」).
-- Rows go after 30 days. A page gone wrong, or someone calling the function
-- by hand, can add at most 200 new rows an hour; past that it is quietly
-- dropped, and a row's count stops at a million.
--
-- Nothing moves: one table and one function are added.
--
-- Rollback: a new migration that drops public.report_screen_error(text,
-- text, text, text, text, text) and private.screen_errors. The app's calls
-- then answer 404 and are dropped as before.

create table private.screen_errors (
  -- The day in Japan the error was first heard on.
  day date not null,
  kind text not null check (kind in ('error', 'rejection')),
  message text not null check (char_length(message) between 1 and 300),
  place text not null check (
    char_length(place) between 1 and 200 and left(place, 1) = '/'
  ),
  stack text not null default '' check (char_length(stack) <= 600),
  build text not null default '' check (build ~ '^([0-9a-f]{7,40})?$'),
  device text not null default '' check (char_length(device) <= 40),
  times integer not null default 1 check (times between 1 and 1000000),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (day, kind, message, place, build, device)
);
create index screen_errors_first_at on private.screen_errors (first_at);
alter table private.screen_errors enable row level security;
revoke all on private.screen_errors from public, anon, authenticated;

-- Anyone may report, signed in or not: the error happened on their screen.
-- What does not fit is dropped without a word, so a caller learns nothing.
create function public.report_screen_error(
  p_kind text,
  p_message text,
  p_place text,
  p_stack text default '',
  p_build text default '',
  p_device text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Tokyo')::date;
  v_stack text := left(coalesce(p_stack, ''), 600);
  v_build text := coalesce(p_build, '');
  v_device text := left(coalesce(p_device, ''), 40);
begin
  if p_kind is null or p_kind not in ('error', 'rejection')
     or p_message is null or char_length(p_message) not between 1 and 300
     or p_place is null or char_length(p_place) not between 1 and 200
     or left(p_place, 1) <> '/' then
    return;
  end if;
  if v_build !~ '^([0-9a-f]{7,40})?$' then
    v_build := '';
  end if;
  -- Reports are taken one at a time, so many at once still see each other
  -- and the 200 an hour holds.
  perform pg_advisory_xact_lock(hashtext('book-town.screen-errors'));
  update private.screen_errors e
  set times = least(e.times + 1, 1000000), last_at = now()
  where e.day = today and e.kind = p_kind and e.message = p_message
    and e.place = p_place and e.build = v_build and e.device = v_device;
  if found then
    return;
  end if;
  if (
    select count(*) from private.screen_errors e
    where e.first_at > now() - interval '1 hour'
  ) >= 200 then
    return;
  end if;
  delete from private.screen_errors e where e.day < today - 30;
  insert into private.screen_errors (day, kind, message, place, stack, build, device)
  values (today, p_kind, p_message, p_place, v_stack, v_build, v_device);
end;
$$;
revoke all on function public.report_screen_error(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.report_screen_error(text, text, text, text, text, text)
  to anon, authenticated;
