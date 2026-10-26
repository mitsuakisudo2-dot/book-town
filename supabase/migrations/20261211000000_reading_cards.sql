-- 読書記録の最初の工事のデータの形 (item 18 of the plan, its first part; the
-- basic numbers of item 19 are read from it). The design is in
-- docs/機能/読書記録.md: 1回の読書 makes one card (読書カード, けにーさん
-- 10-25 「B」), every book read in it is on that card (10-25 「どっちにも
-- 入れればいいんじゃない？」, 10-26 「一回の読書で読んだ本は一緒に記録
-- される」), and the reading is data the reader alone keeps. The screens
-- come later; this file is what would mean rebuilding if added after them.
--
--   reading_sessions    kept as it is: one span of reading one book (or
--                       none), its start and end, reading alone or together.
--                       Reading together is seen by others (who is reading
--                       now), so nothing of the reader's own goes on it, not
--                       even which reading it is of. It gains a key
--                       (user_id, id) for the rows below to name.
--   reading_cards       one reading, read by nobody else: the time zone it
--                       was read in (the card's day, weekday, season and
--                       朝・昼・夜 are worked out from the times), whether it
--                       was added afterwards (記録し忘れ), the clock (paused,
--                       the timer or pomodoro chosen), the room and light it
--                       was read in, and the card's own look and what it
--                       shows. Made by the app when the reading starts.
--   reading_card_books  the books of a card, one a session: a book changed
--                       a minute or more into the reading ends its session
--                       and starts the next book's in the same card. Each
--                       its time read as the app counted it, its pages from
--                       and to, paper, e-book or audio, and whether it was
--                       finished. A session from before has none: the app
--                       shows it as a card of its own, from what the session
--                       has (its book and times), as if each choice were the
--                       default.
--   reading_notes       今日のノート: the words looked up, the thoughts and
--                       the favourite lines written while reading, the
--                       reader's own, on the card and the book they were
--                       written at.
--
-- What is worked out, not kept: the card's day, weekday, season and time of
-- day, its start and end and time read (from its books' sessions), each
-- book and which time of reading it this is, the next reading's look, room,
-- light and format (the last card's). What comes later is added beside
-- these without rebuilding them: a reader's own items and their answers (on
-- the card), photos (on the card, item 115), the dictionary's answers (one
-- shared row a word; a looked-up word stays a note), and who read at the
-- same time.
--
-- Nothing moves: no row of reading_sessions or reading_entries is written,
-- and the new tables start empty. So no copy is taken, and the copy of
-- 20261207000000_reading_mode (reading_sessions among it) stays a way back
-- for that file until its own date.
--
-- Rollback (a new migration), once the app that writes these is gone from
-- production again (a town that cannot read a table it expects does not
-- load):
--   drop table public.reading_notes, public.reading_card_books, public.reading_cards;
--   drop function private.reading_card_times(), private.reading_card_book_times(),
--     private.reading_note_times();
--   alter table public.reading_sessions drop constraint reading_sessions_user_id_id_key;
-- Dropping the tables deletes what readers kept in them: ask first.

-- A lock waited on longer than this fails the file, to be sent again, rather
-- than keep the town waiting on reading_sessions behind it.
select set_config('lock_timeout', '10s', true);

-- One session's key with its reader, so a row of a reader's own can only name
-- a session of theirs. Its index also serves reading a reader's own sessions.
alter table public.reading_sessions
  add constraint reading_sessions_user_id_id_key unique (user_id, id);

-- The cards ----------------------------------------------------------------------------

create table public.reading_cards (
  -- Made by the device, so sending it again writes the same row. The reader
  -- is in the key, so an id taken by someone else first takes nothing of
  -- theirs (sent again with nothing written, a card would seem saved).
  id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The zone the device was in (Intl), so the card's day and hour are the
  -- reader's own: a name, or an offset such as +09:00 (east of Greenwich,
  -- as Intl gives it; at time zone reads it the other way round, so reading
  -- one turns its sign). Only its form is kept to: a name this database
  -- does not know (Etc/Unknown) is still kept, and read as Japan's; none
  -- (an old browser) or another form is made Japan's, and refuses nothing.
  time_zone text not null default 'Asia/Tokyo'
    check (time_zone ~ '^([A-Za-z][A-Za-z0-9_+/-]{0,63}|[+-][0-9]{2}:[0-9]{2})$'),
  -- 記録し忘れた日を、あとから足す: the times are the reader's, not a clock's.
  added_later boolean not null default false,
  -- The clock, by the device's time as the sessions' starts and ends are,
  -- so the app's sums of them hold with its clock running ahead. While
  -- paused, since when; the pauses before it, in seconds. A book changed
  -- keeps the clock going.
  paused_at timestamptz,
  paused_seconds integer not null default 0 check (paused_seconds >= 0),
  -- 決めない (none), タイマー or ポモドーロ, the minutes chosen (to read, for
  -- pomodoro) and to rest, and when the one now chosen began: changing it
  -- counts again from then. The app keeps the ranges (タイマー 1〜300分,
  -- 読む 1〜120分, 休む 1〜30分); the database only a day's worth.
  timer text not null default 'none' check (timer in ('none', 'timer', 'pomodoro')),
  timer_minutes smallint check (timer_minutes between 1 and 1440),
  rest_minutes smallint check (rest_minutes between 1 and 1440),
  timer_at timestamptz,
  -- What the app names them by: the room and light read in (部屋の見た目,
  -- 光の気分) and the card's look. Only their form is checked, so a look
  -- added later is never refused; one the app no longer has is drawn as
  -- its default.
  room text check (room ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  light text check (light ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  look text check (look ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  -- What this card shows and how, as the app keeps it (which items are on
  -- it, the order of its pages, a layout moved by hand). The app's own
  -- shape; here only an object, and not a large one (half a poster; the
  -- app measures it as the database writes it, with its spaces).
  shown jsonb not null default '{}'
    check (jsonb_typeof(shown) = 'object' and octet_length(shown::text) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create trigger reading_cards_touch before update on public.reading_cards
  for each row execute function public.touch_updated_at();

-- The books of a card -----------------------------------------------------------------

create table public.reading_card_books (
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The span of reading the book (or none), in one card only. The reader is
  -- in the key: a key of the session alone would be checked before the
  -- foreign key, and someone who sees a session read together could ask
  -- whether it is on a card.
  session_id uuid not null,
  card_id uuid not null,
  -- The time read, as the app counted it when this book's span ended
  -- (pauses and rests left out). Null while reading it, and when the app
  -- could not count it: then the session's end less its start. A reading
  -- left running for months is kept as long as it was; a sum below
  -- nothing is nothing, so a device's clock refuses no reading.
  read_seconds integer check (read_seconds >= 0),
  -- 何ページから, どこまで読んだ, and what they count: pages (the first), a
  -- percentage or locations of an e-book, or seconds into an audiobook.
  -- Which the screens offer is not decided; the book's pages count only
  -- pages.
  page_from integer check (page_from between 0 and 1000000),
  page_to integer check (page_to between 0 and 1000000),
  page_unit text not null default 'page'
    check (page_unit in ('page', 'percent', 'location', 'second')),
  -- 紙・電子・音声; null: not said.
  format text check (format in ('paper', 'ebook', 'audio')),
  -- 「この本を読み終えた」 in this reading: the reader's finishing of the
  -- book, each time (a reread too). The book's status is the library's.
  finished boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, session_id),
  -- So a note names a book of its own card. Its index serves the card's
  -- books too.
  unique (user_id, card_id, session_id),
  -- A book goes from the card with its session (記録しない, or the book
  -- taken out), and with its card.
  foreign key (user_id, session_id)
    references public.reading_sessions (user_id, id) on delete cascade,
  foreign key (user_id, card_id)
    references public.reading_cards (user_id, id) on delete cascade
);
create trigger reading_card_books_touch before update on public.reading_card_books
  for each row execute function public.touch_updated_at();

-- 今日のノート ------------------------------------------------------------------------

create table public.reading_notes (
  -- Made by the device, so sending it again writes the same row; the reader
  -- in the key, as a card's.
  id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  card_id uuid not null,
  -- The book it was written at, one of the card's: none when the reading
  -- had no book, or the book has gone from the card (the note stays on it).
  session_id uuid,
  -- 言葉を調べる (the word), 思ったこと, 好きな一文.
  kind text not null check (kind in ('word', 'thought', 'quote')),
  -- Not blank, a full-width space as blank as any (the app trims more).
  body text not null
    check (char_length(body) <= 2000 and btrim(body, E' \t\r\n　') <> ''),
  -- The page it was written at, when said.
  page integer check (page between 0 and 1000000),
  -- When it was written, by the device's clock (kept while offline).
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, card_id)
    references public.reading_cards (user_id, id) on delete cascade,
  foreign key (user_id, card_id, session_id)
    references public.reading_card_books (user_id, card_id, session_id)
    on delete set null (session_id)
);
create index reading_notes_card on public.reading_notes (user_id, card_id, session_id);
create trigger reading_notes_touch before update on public.reading_notes
  for each row execute function public.touch_updated_at();

-- Times ---------------------------------------------------------------------------

-- A device clock running ahead cannot date a row in the future. The clock's
-- own times stay the device's (above), and what would refuse a reading is
-- set as the comments above say. Rows sent together (postgrest-js) send
-- null for a column some of them leave out: its default stands in, rather
-- than refuse the queue behind it.
create function private.reading_card_times() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := least(coalesce(new.created_at, now()), now());
  new.added_later := coalesce(new.added_later, false);
  new.timer := coalesce(new.timer, 'none');
  new.shown := coalesce(new.shown, '{}');
  if new.time_zone is null or new.time_zone
      !~ '^([A-Za-z][A-Za-z0-9_+/-]{0,63}|[+-][0-9]{2}:[0-9]{2})$' then
    new.time_zone := 'Asia/Tokyo';
  end if;
  if new.paused_seconds is null or new.paused_seconds < 0 then
    new.paused_seconds := 0;
  end if;
  return new;
end;
$$;
revoke all on function private.reading_card_times() from public, anon, authenticated;
create trigger reading_cards_clamp before insert or update on public.reading_cards
  for each row execute function private.reading_card_times();

create function private.reading_card_book_times() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := least(coalesce(new.created_at, now()), now());
  new.page_unit := coalesce(new.page_unit, 'page');
  new.finished := coalesce(new.finished, false);
  if new.read_seconds < 0 then new.read_seconds := 0; end if;
  return new;
end;
$$;
revoke all on function private.reading_card_book_times() from public, anon, authenticated;
create trigger reading_card_books_clamp before insert or update on public.reading_card_books
  for each row execute function private.reading_card_book_times();

-- A note written at a book taken out of its card meanwhile (on another
-- device) stays on the card at no book, as it would had it come first. A
-- book of another card of the reader's is still refused: no app sends it.
create function private.reading_note_times() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := least(coalesce(new.created_at, now()), now());
  if new.session_id is not null and not exists (
      select 1 from public.reading_card_books b
      where b.user_id = new.user_id and b.session_id = new.session_id) then
    new.session_id := null;
  end if;
  return new;
end;
$$;
revoke all on function private.reading_note_times() from public, anon, authenticated;
create trigger reading_notes_clamp before insert on public.reading_notes
  for each row execute function private.reading_note_times();

-- Who may do what -----------------------------------------------------------------

-- The reader's own, read by nobody else and never by anon. Closed to start
-- with, as every new table is; only what the app uses is opened. A card is
-- inserted (ignoring one already there), its changes updated, and deleted
-- (記録しない, after its sessions). A book of it is inserted and changed; it
-- goes with its session or its card, never alone. A note is inserted,
-- changed and deleted.
alter table public.reading_cards enable row level security;
alter table public.reading_card_books enable row level security;
alter table public.reading_notes enable row level security;
revoke all on public.reading_cards, public.reading_card_books, public.reading_notes
  from anon, authenticated;
grant select on public.reading_cards, public.reading_card_books, public.reading_notes
  to authenticated;
grant insert (id, user_id, time_zone, added_later, paused_at, paused_seconds, timer,
    timer_minutes, rest_minutes, timer_at, room, light, look, shown, created_at),
  update (time_zone, added_later, paused_at, paused_seconds, timer, timer_minutes,
    rest_minutes, timer_at, room, light, look, shown),
  delete
  on public.reading_cards to authenticated;
grant insert (user_id, session_id, card_id, read_seconds, page_from, page_to, page_unit,
    format, finished, created_at),
  update (read_seconds, page_from, page_to, page_unit, format, finished)
  on public.reading_card_books to authenticated;
grant insert (id, user_id, card_id, session_id, kind, body, page, created_at),
  update (kind, body, page),
  delete
  on public.reading_notes to authenticated;
create policy "reading cards are their reader's own" on public.reading_cards
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "the books of a reading card are its reader's own" on public.reading_card_books
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "reading notes are their reader's own" on public.reading_notes
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
