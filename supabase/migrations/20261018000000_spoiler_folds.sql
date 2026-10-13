-- Spoiler folds. When three readers ask 「ネタバレでは？」 about a post, it folds
-- for everyone, the way a marked spoiler does: covered on the timeline, behind
-- the door on the book page. Nothing is deleted. Who asked stays private to
-- each of them; the post only carries whether it is folded.

alter table public.posts
  add column spoiler_folded boolean not null default false;

create function private.refold_spoiler() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target uuid;
begin
  if tg_op = 'DELETE' then
    target := old.post_id;
  else
    target := new.post_id;
  end if;
  update public.posts p
  set spoiler_folded = (
    select count(*) >= 3 from public.spoiler_reports r where r.post_id = target
  )
  where p.id = target;
  return null;
end;
$$;
revoke execute on function private.refold_spoiler() from public;

-- Withdrawing a question (or the operator deleting one) can unfold it again.
create trigger spoiler_reports_fold after insert or delete on public.spoiler_reports
  for each row execute function private.refold_spoiler();

-- A writer can put the spoiler mark on their own post afterwards (one way: a
-- mark is not taken off). Nothing else about a post changes after it is
-- written, and a new post never starts folded.
revoke insert, update on public.posts from authenticated;
grant insert (id, author_id, body, book_id, spoiler, parent_id, reading_mode, created_at)
  on public.posts to authenticated;
grant update (spoiler) on public.posts to authenticated;

create policy "writers mark their own posts as spoilers" on public.posts
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()) and spoiler);

-- A report of a spoiler is for the operator to read; it folds through
-- 「ネタバレでは？」 above and never hides a post outright.
create or replace function private.is_hidden(kind text, target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.moderation_hides h
    where h.target_kind = kind and h.target_id = target
  ) or (
    select count(*) >= 3 from public.reports r
    where r.target_kind = kind and r.target_id = target and r.status = 'open'
      and r.reason <> 'spoiler'
  )
$$;
