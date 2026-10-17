-- 自分の本棚 (item 15 of the 2026-10-16 plan), its second part: each shelf
-- of the library has who may see it, and a shelf can gather its books by
-- conditions instead of by hand (スマート本棚).
--
-- * library_shelves.audience: who may see the shelf the reader made, as in
--   見せる範囲 (visibility): everyone, followers or private. Shelves made
--   before this file are private, as every shelf has been.
-- * library_shelves.rule: a smart shelf's conditions, as the app's library
--   filter keeps them (src/lib/library.ts SmartRule); null for a shelf the
--   reader fills by hand. A smart shelf holds no rows in
--   library_shelf_books: its books are whichever of the library meet it.
-- * reader_settings.shelf_audiences: who may see each of the shelves every
--   library has (読了, 積読, …), by the app's key (DEFAULT_SHELVES). One
--   not named follows the starting choice, shelves_audience.
--
-- Nothing shows a shelf to anyone else yet: the owner chose 「まだ見せない」
-- (2026-10-17 04:47Z). So the shelves stay their reader's own to read, and
-- no book on a shelf is readable by more people because of it
-- (book_is_listed and book_is_shared are unchanged). The page that shows
-- shelves to others reads them through a function of its own, with
-- private.may_see, and widens those two with it.
--
-- As every starting choice does (visibility), a narrower shelves_audience
-- narrows the shelves kept before at once: here by the database, whatever
-- the app does. A wider one widens nothing; the app asks.
--
-- Nothing moves: two columns are added to library_shelves (every row
-- private, no rule) and one to reader_settings (empty).
--
-- Rollback: a new migration with
--   drop trigger reader_settings_narrow_shelves on public.reader_settings;
--   alter table public.library_shelves drop column audience, drop column rule;
--   alter table public.reader_settings drop column shelf_audiences;
--   drop function private.narrow_shelves(), private.is_shelf_audiences(jsonb);
-- An app that sends these columns has to go first: a town that writes a
-- column the database lacks is refused.

-- The shelves the reader made ---------------------------------------------------------

alter table public.library_shelves
  add column audience text not null default 'private'
    check (audience in ('everyone', 'followers', 'private')),
  -- An object, small: the app checks what is in it.
  add column rule jsonb
    check (rule is null or (jsonb_typeof(rule) = 'object'
      and octet_length(rule::text) <= 4096));
grant insert (audience, rule), update (audience, rule)
  on public.library_shelves to authenticated;

-- The shelves every library has ---------------------------------------------------------

-- Each key is one of the app's DEFAULT_SHELVES, each value an audience.
create function private.is_shelf_audiences(audiences jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(audiences) = 'object'
    and not exists (
      select 1 from jsonb_each(audiences) a
      where a.key not in ('all', 'finished', 'tsundoku', 'reading', 'want',
          'liked', 'favorite')
        or a.value not in ('"everyone"', '"followers"', '"private"')
    )
$$;
revoke all on function private.is_shelf_audiences(jsonb) from public, anon, authenticated;
-- The check runs as whoever writes the row.
grant execute on function private.is_shelf_audiences(jsonb) to authenticated;

alter table public.reader_settings
  add column shelf_audiences jsonb not null default '{}'
    check (private.is_shelf_audiences(shelf_audiences));
grant insert (shelf_audiences), update (shelf_audiences)
  on public.reader_settings to authenticated;

-- A narrower starting choice ------------------------------------------------------------

-- Every shelf wider than the new starting choice, made by the reader or one
-- every library has, is set to it. Run as the reader, on their own rows.
create function private.narrow_shelves() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.audience_rank(new.shelves_audience)
      < private.audience_rank(old.shelves_audience) then
    update public.library_shelves s
    set audience = new.shelves_audience
    where s.user_id = new.user_id
      and private.audience_rank(s.audience)
        > private.audience_rank(new.shelves_audience);
    update public.reader_settings r
    set shelf_audiences = (
      select coalesce(jsonb_object_agg(a.key,
        case when private.audience_rank(a.value #>> '{}')
            > private.audience_rank(new.shelves_audience)
          then to_jsonb(new.shelves_audience) else a.value end), '{}')
      from jsonb_each(r.shelf_audiences) a)
    where r.user_id = new.user_id;
  end if;
  return null;
end;
$$;
revoke all on function private.narrow_shelves() from public, anon, authenticated;
create trigger reader_settings_narrow_shelves after update of shelves_audience
  on public.reader_settings
  for each row execute function private.narrow_shelves();
