-- 不具合と要望 (management table 47). A signed-in reader can tell the
-- operator that something does not work, or what they would like, from the
-- settings (src/components/SiteReport.tsx). Staff read them in the app, the
-- newest first, a page at a time (site_reports), and Claude reads them with a
-- select (docs/09「不具合と要望」).
--
-- What a reader writes is theirs to word, but the database still takes out
-- what should not sit in a table before anything is kept
-- (private.scrub_report_text): keys and tokens, email addresses, an
-- address's query, phone numbers and card-length numbers. The page is a path
-- of the site's own without its query, the device one of the app's labels,
-- never the browser's user agent.
--
-- Only signed-in readers can send (sign-in is by invitation and behind the
-- human check). One person sends at most 10 an hour and 30 a day; everyone
-- together at most 300 new rows an hour and 5,000 kept, so a flood can
-- neither fill the database nor go on unseen. Past that the send is refused
-- with a word the app turns into 「今は送れません」.
--
-- Rows go after 180 days, every night (pg_cron, site-reports) and on each
-- send, and with the reader's account when it is deleted.
--
-- Nothing moves: one table, four functions and one nightly job are added, and
-- nothing else refers to them. 注釈モード (site_notes) is unchanged.
--
-- Rollback (a new migration with these lines; the app's calls then fail and
-- the form says it could not send, keeping what was written):
--   select cron.unschedule('site-reports');
--   drop function public.send_site_report(text, text, text, text, text);
--   drop function public.site_reports(timestamptz);
--   drop function private.forget_site_reports();
--   drop function private.scrub_report_text(text);
--   drop table private.site_reports;

create table private.site_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('bug', 'wish', 'other')),
  body text not null check (char_length(body) between 1 and 2000),
  -- Where the form was opened, in its address's letters.
  page text not null default '' check (page ~ '^(/[A-Za-z0-9_.~%()/-]{0,199})?$'),
  build text not null default '' check (build ~ '^([0-9a-f]{7,40})?$'),
  -- One of the app's few labels, such as "iPhone Safari" (src/lib/site-notes.ts).
  device text not null default '' check (device ~ '^[A-Za-z アプリ内]{0,40}$'),
  created_at timestamptz not null default now()
);
create index site_reports_created on private.site_reports (created_at);
create index site_reports_user_created on private.site_reports (user_id, created_at);
alter table private.site_reports enable row level security;
revoke all on private.site_reports from public, anon, authenticated;

-- What should not be kept, taken out of a reader's words. Full-width letters,
-- digits and ＠－．＿＋ become their half-width selves first, so they are
-- found too. An ISBN (13 digits) and a date stay: a report needs them.
create function private.scrub_report_text(t text)
returns text
language sql immutable set search_path = '' as $$
  select btrim(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      translate(coalesce(t, ''),
        '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ＠－．＿＋',
        '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@-._+'),
      -- Keys and tokens before anything else touches their dots.
      'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?', '(鍵)', 'g'),
      '(sb|sbp|re|vcp)_[A-Za-z0-9_-]{8,}', '(鍵)', 'g'),
      '[A-Za-z0-9_.+-]+(@|%40)[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+', '(メールアドレス)', 'g'),
      -- An address keeps its origin and path, not its query and hash.
      '(https?://[^[:space:]?#"''<>)]+)[?#][^[:space:]"''<>)]*', '\1', 'g'),
      -- A long run of letters with a digit in it is a token, not a word.
      '(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}', '(鍵)', 'g'),
      -- Phone numbers, written with hyphens or spaces or as one run.
      '(?<![0-9+])(\+?81[- ]?|0)[0-9]{1,4}[- ][0-9]{1,4}[- ][0-9]{3,4}(?![0-9])', '(番号)', 'g'),
      '(?<![0-9])0[0-9]{9,10}(?![0-9])', '(番号)', 'g'),
      -- Card numbers: four groups of four, or a run of 14 to 19 digits (an
      -- ISBN has 13, and stays).
      '(?<![0-9])[0-9]{4}([- ][0-9]{4}){3}(?![0-9])', '(番号)', 'g'),
      '(?<![0-9])[0-9]{14,19}(?![0-9])', '(番号)', 'g'),
    E' \t\r\n　')
$$;
revoke all on function private.scrub_report_text(text) from public, anon, authenticated;

-- Sending. What does not fit is refused, so the reader keeps what they wrote.
create function public.send_site_report(
  p_kind text,
  p_body text,
  p_page text default '',
  p_build text default '',
  p_device text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v_body text;
  v_page text := split_part(split_part(coalesce(p_page, ''), '?', 1), '#', 1);
  v_build text := coalesce(p_build, '');
  v_device text := coalesce(p_device, '');
begin
  if me is null then
    raise exception 'sign in to send a report' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('bug', 'wish', 'other') then
    raise exception 'unknown kind' using errcode = '22023';
  end if;
  v_body := private.scrub_report_text(p_body);
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'a report is 1 to 2000 characters' using errcode = '22023';
  end if;
  if v_page !~ '^(/[A-Za-z0-9_.~%()/-]{0,199})?$' then
    v_page := '';
  end if;
  if v_build !~ '^([0-9a-f]{7,40})?$' then
    v_build := '';
  end if;
  if v_device !~ '^[A-Za-z アプリ内]{0,40}$' then
    v_device := '';
  end if;
  -- Sends are counted one at a time, so many at once still see each other.
  perform pg_advisory_xact_lock(hashtext('book-town.site-reports'));
  delete from private.site_reports r where r.created_at < now() - interval '180 days';
  if (
    select count(*) from private.site_reports r
    where r.user_id = me and r.created_at > now() - interval '1 hour'
  ) >= 10 or (
    select count(*) from private.site_reports r
    where r.user_id = me and r.created_at > now() - interval '1 day'
  ) >= 30 or (
    select count(*) from private.site_reports r
    where r.created_at > now() - interval '1 hour'
  ) >= 300 or (select count(*) from private.site_reports) >= 5000 then
    raise exception 'too many site reports' using errcode = '23514';
  end if;
  insert into private.site_reports (user_id, kind, body, page, build, device)
  values (me, p_kind, v_body, v_page, v_build, v_device);
end;
$$;
revoke all on function public.send_site_report(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.send_site_report(text, text, text, text, text)
  to authenticated;

-- Staff read them, the newest first, 30 at a time (before: the created_at of
-- the last one shown). Anyone else gets nothing, and so learns nothing.
create function public.site_reports(p_before timestamptz default null)
returns table (
  id uuid,
  kind text,
  body text,
  page text,
  device text,
  build text,
  created_at timestamptz,
  handle text
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.kind, r.body, r.page, r.device, r.build, r.created_at,
         (select p.handle from public.profiles p where p.id = r.user_id)
  from private.site_reports r
  where (select public.can_annotate())
    and (p_before is null or r.created_at < p_before)
  order by r.created_at desc, r.id
  limit 30
$$;
revoke all on function public.site_reports(timestamptz) from public, anon, authenticated;
grant execute on function public.site_reports(timestamptz) to authenticated;

-- Every night, so rows go after 180 days even when nothing new is sent.
create function private.forget_site_reports() returns void
language sql security definer set search_path = '' as $$
  delete from private.site_reports r where r.created_at < now() - interval '180 days';
$$;
revoke all on function private.forget_site_reports() from public, anon, authenticated;

-- 18:47 UTC is 03:47 in Japan.
select cron.schedule('site-reports', '47 18 * * *', 'select private.forget_site_reports()');
