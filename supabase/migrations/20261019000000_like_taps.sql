-- A like can be pressed again, up to ten times per person and post, so one
-- reader's "this was really good" reaches the writer in full. How many is
-- still the writer's to know (post_reactions is seen by the reactor and the
-- author only); the cap keeps one person from pressing without end.

alter table public.post_reactions
  add column taps smallint not null default 1,
  add constraint post_reactions_taps
    check (taps between 1 and 10 and (kind = 'like' or taps = 1));

-- Pressing again changes only the count of one's own like.
revoke update on public.post_reactions from authenticated;
grant update (taps) on public.post_reactions to authenticated;

create policy "people press their likes again" on public.post_reactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
