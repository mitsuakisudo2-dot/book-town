-- 退会 from the web (item 45 of the 2026-10-16 plan). The site is static, so
-- the reader's browser has no server to ask: it calls this function, which
-- deletes the caller's own account. Everything they owned goes with
-- auth.users through the cascades that 「アカウント削除の型」 (item 2,
-- tests/fixtures/account-tables.ts) keeps whole, in this one statement: all
-- of it goes, or, refused, none of it does.
--
-- Only the caller's own row: the id comes from their session, never from an
-- argument. Asked again once it has gone (an answer lost on the way back,
-- while the session's token is still good), it deletes nothing and returns
-- as before, so the app can finish. Without a session it refuses.
--
-- security definer: the reader has no rights in auth. The function's owner
-- (the role that applies migrations) may delete from auth.users, and its
-- deletion fires the same cascades and triggers as Supabase's own.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'sign in to delete an account' using errcode = '42501';
  end if;
  delete from auth.users where id = me;
end;
$$;
revoke all on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
