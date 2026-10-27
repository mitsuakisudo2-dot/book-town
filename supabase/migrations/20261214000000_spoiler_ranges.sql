-- ネタバレの範囲を手で選ぶ (management table 22 ①, けにーさん 10-16 05:33Z,
-- 10-25 00:24Z). A writer who marks a post as a spoiler may say how far it
-- goes in the series its book is in: 「3巻まで」, or the whole series as it
-- stands (「全巻」, kept as the last volume then known, as a post cannot
-- spoil a volume that came out after it). A reader who has finished that
-- far in the same line reads it as it is (src/lib/spoiler-range.ts).
--
-- One column is added and nothing moves. A post without it (every post
-- now, a book in no series, a reply to one, a post marked afterwards) means
-- what a spoiler mark means today. The number is the volume's number in
-- the line of the post's book (series_volumes.number), read by the app with
-- series_for_isbn; no one's reading is sent or kept for it.
--
-- Written with the post and never changed: the writer may still put the
-- mark on afterwards (update (spoiler) only), which leaves the range empty,
-- the widest. A range needs the mark, and a book or a post it answers to
-- be about (the check below and posts' own).
--
-- Rollback (a new migration with this line; the app reads a post without
-- it as it does now, and the ranges written are lost, each post then a
-- spoiler of the whole):
--   alter table public.posts drop column spoiler_through;

alter table public.posts
  add column spoiler_through integer
    check (spoiler_through between 1 and 9999),
  add constraint posts_spoiler_through_marked
    check (spoiler_through is null or spoiler);

grant insert (spoiler_through) on public.posts to authenticated;
