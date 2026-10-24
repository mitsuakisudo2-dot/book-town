-- People and genres (item 7 of the plan). けにーさん said to start on
-- 2026-10-24 11:08Z; the design (https://claude.ai/artifact/ESMk188pNhXLYVt2mCwJFg):
-- who made a book is kept as a person, not as the letters of a name, and a
-- book's genre and year are kept; nothing a reader keeps changes, and the
-- author a reader typed (books.author) stays as it is.
--
--   people          a person (or a body: 講談社) BookTown knows: the name
--                   shown, its reading, the library's authority id when
--                   there is one, and where it went when joined to another.
--   edition_people  who made an edition, in order: the name as that book
--                   prints it, the role as the source writes it ("編著"),
--                   its kinds (編, 著), and the person, or none (a name only).
--   person_links    two people who are one under other names (栗本薫 and
--                   中島梓): they stay two people, each with their own books
--                   (けにーさん's choice A, asked on 10-24).
--   edition_facts   an edition's NDC and year, as its bibliography has them;
--                   the genre is the NDC's (private.genre_ndc), and a work's
--                   that of most of its editions (private.work_genre).
--
-- The rules make the same person only of the same authority id: in the
-- production sample (10,051 editions, 10-24) 90% of the people named have
-- one, and the same name is two people when the ids differ (中島敦 of
-- 1909-1942 and of 1964-). A name without an id is a name only; the
-- operator places it on a person, and a name like one person's is a
-- candidate for that (private.people_candidates). What the book prints
-- stays on the book: a person's name is the authority's heading without
-- its years ("さいとうたかを" for "さいとう・たかを" too). The names
-- books print are not made a person's other names here: a body's
-- departments (講談社 printed as ディズニーファン編集部) and statements
-- paired with the wrong heading are among them; search (item 11) decides
-- how to use them.
--
-- An edition is read again when its bibliography changes (a minute's job
-- of 2,000, as the series'); the people and genres are made from it then,
-- with what a person decided (private.people_placed, private.work_genre_fixed,
-- joins and names) kept. A book without an ISBN is its own edition, and its
-- people are the words its reader typed, split at 「、」: names only, never
-- compared with anyone's (no candidate, nothing anyone else reads).
-- Nothing reads the new tables but the two functions anyone may call, and
-- those only for editions anyone may read (a catalog row).
--
-- Rollback: no row of an old table changes. A new migration that runs
--   select cron.unschedule('people-read');
--   drop trigger edition_sources_people on private.edition_sources;
--   drop trigger edition_fixes_people on private.edition_fixes;
--   drop trigger books_people_typed_came on public.books;
--   drop trigger books_people_typed_went on public.books;
--   drop trigger books_people_typed_changed on public.books;
--   drop function public.books_of_person(uuid), public.people_for_isbn(text),
--     private.people_candidates(integer, text), private.genre_fix(uuid, text),
--     private.people_name(uuid, text, text), private.people_unplace(uuid, text),
--     private.people_place(uuid, text, uuid), private.people_unlink(uuid, uuid),
--     private.people_link(uuid, uuid), private.people_join(uuid, uuid),
--     private.people_make(text, text), private.people_read(integer),
--     private.people_read_one(uuid), private.people_for_authority(text, text, text),
--     private.people_mark_stale(), private.work_genre(uuid), private.ndc_genre(text),
--     private.people_roles(text), private.people_now(uuid);
--   drop table public.edition_facts, private.work_genre_fixed, private.genre_ndc,
--     private.genres, private.people_decisions, public.person_links,
--     private.people_placed, public.edition_people, private.people_stale,
--     public.people;

-- People ------------------------------------------------------------------------------

create table public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 300),
  name_reading text check (char_length(name_reading) <= 300),
  -- The name as names are compared (private.bib_key), to find candidates.
  name_key text not null,
  -- The library's authority (http://id.ndl.go.jp/auth/entity/…): one person.
  authority text unique check (char_length(authority) <= 300),
  made_by text not null check (made_by in ('auto', 'human')),
  -- human: the operator named them, and the authority's heading no longer does.
  named_by text not null default 'auto' check (named_by in ('auto', 'human')),
  -- Set when joined to another (two ids of one person): an id that named
  -- them still leads somewhere.
  merged_into uuid references public.people (id),
  created_at timestamptz not null default now(),
  constraint people_not_into_itself check (merged_into is distinct from id),
  constraint people_auto_have_authority check (made_by = 'human' or authority is not null)
);
create index people_merged_into on public.people (merged_into) where merged_into is not null;
create index people_name_key on public.people (name_key) where merged_into is null;
alter table public.people enable row level security;
revoke all on public.people from public, anon, authenticated;

create table public.edition_people (
  edition_id uuid not null references public.editions (id) on delete cascade,
  seq smallint not null check (seq between 1 and 500),
  -- None: a name only.
  person_id uuid references public.people (id),
  -- As this book prints it.
  name text not null check (char_length(name) between 1 and 300),
  name_key text not null,
  reading text check (char_length(reading) <= 300),
  -- As the source writes it: 著, [著], 編著, 作・絵; openBD's codes (A01,B06).
  role text check (char_length(role) <= 100),
  -- Its kinds (private.people_roles): 著, 訳, 編, 絵, 原作, 監修, 写真, その他.
  roles text[] not null default '{}',
  -- bibliography: the library's or openBD's; typed: what the reader of a
  -- book without an ISBN typed, which nothing compares or shows to others.
  source text not null check (source in ('bibliography', 'typed')),
  primary key (edition_id, seq)
);
create index edition_people_person on public.edition_people (person_id) where person_id is not null;
create index edition_people_name on public.edition_people (name_key)
  where person_id is null and source = 'bibliography';
alter table public.edition_people enable row level security;
revoke all on public.edition_people from public, anon, authenticated;

-- What the operator decided of a name on an edition: this person, or a name
-- only (person_id null). Reading the edition again keeps it.
create table private.people_placed (
  edition_id uuid not null references public.editions (id) on delete cascade,
  name_key text not null,
  person_id uuid references public.people (id),
  decided_at timestamptz not null default now(),
  primary key (edition_id, name_key)
);
alter table private.people_placed enable row level security;
revoke all on private.people_placed from public, anon, authenticated;

-- Two people who are one under other names, by the operator only.
create table public.person_links (
  person_id uuid not null references public.people (id),
  other_id uuid not null references public.people (id),
  decided_at timestamptz not null default now(),
  primary key (person_id, other_id),
  constraint person_links_once check (person_id < other_id)
);
create index person_links_other on public.person_links (other_id);
alter table public.person_links enable row level security;
revoke all on public.person_links from public, anon, authenticated;

-- What a person did by hand, written down.
create table private.people_decisions (
  id uuid primary key default gen_random_uuid(),
  op text not null check (op in ('make', 'join', 'link', 'unlink', 'place', 'unplace',
    'name', 'genre')),
  person_id uuid,
  edition_id uuid,
  work_id uuid,
  detail jsonb not null default '{}',
  decided_at timestamptz not null default now()
);
alter table private.people_decisions enable row level security;
revoke all on private.people_decisions from public, anon, authenticated;

-- The person an id names now, after its joins.
create function private.people_now(p uuid) returns uuid
language plpgsql stable set search_path = '' as $$
declare
  here uuid := p;
  next uuid;
begin
  if p is null then
    return null;
  end if;
  for i in 1 .. 50 loop
    select x.merged_into into next from public.people x where x.id = here;
    if next is null then
      return here;
    end if;
    here := next;
  end loop;
  return here;
end;
$$;
revoke all on function private.people_now(uuid) from public, anon, authenticated;

-- A role's kinds. A role names one or more (編著: 編 and 著; 作・絵: 著 and
-- 絵); one the rules do not know is その他, and no role is none.
-- openBD's ONIX codes: A01 著, B01 編, B06 訳, A12 絵, A08 写真.
create function private.people_roles(role text) returns text[]
language sql immutable set search_path = '' as $$
  with words as (
    select w from regexp_split_to_table(
      regexp_replace(normalize(coalesce(role, ''), nfkc), '[\[\]()]', '', 'g'),
      '[・,、/\s]+') w
    where w <> ''
  ), kinds as (
    select x.kind
    from words
    cross join lateral (values
      ('訳', w ~ '訳|^やく$' or w = 'B06'),
      ('原作', w ~ '原作|原著|原案'),
      ('監修', w ~ '監修'),
      ('編', w ~ '[編编](?!曲)|^へん$' or w = 'B01'),
      ('絵', w ~ '(?<!企)画|絵|イラスト|漫画|まんが|^え$' or w = 'A12'),
      ('写真', w ~ '写真|撮影|しゃしん' or w = 'A08'),
      ('著', (w ~ '著|執筆' and w !~ '原著')
        or w in ('作', 'さく', '文', 'ぶん', '作者', 'A01'))
    ) x (kind, yes)
    where x.yes
  )
  select case
    when not exists (select 1 from words) then '{}'::text[]
    when not exists (select 1 from kinds) then array['その他']
    else array(select distinct k.kind from kinds k order by 1)
  end
$$;
revoke all on function private.people_roles(text) from public, anon, authenticated;

-- Genres -----------------------------------------------------------------------------

-- BookTown's genres, in the order they are shown (a first list, 10-24: the
-- names can change when a screen shows them).
create table private.genres (
  genre text primary key check (char_length(genre) between 1 and 40),
  ord smallint not null unique
);
insert into private.genres (genre, ord) values
  ('日本の小説', 1), ('海外の小説', 2), ('エッセイ', 3), ('詩と短歌と俳句', 4),
  ('文学の評論と戯曲', 5), ('マンガ', 6), ('絵本', 7), ('芸術と写真', 8),
  ('趣味とスポーツ', 9), ('歴史と地理', 10), ('哲学と宗教と心理', 11),
  ('社会とビジネスと教育', 12), ('科学と医学', 13), ('技術と暮らし', 14), ('言葉', 15),
  ('そのほか', 16);
alter table private.genres enable row level security;
revoke all on private.genres from public, anon, authenticated;

-- The NDC (the library's classification) a genre takes, the first pattern
-- that matches by rank: 726.1 マンガ before 7 芸術と写真. To change the
-- genres, change these rows: an edition's genre is worked out from its NDC
-- when it is read (private.work_genre), so nothing is read again.
create table private.genre_ndc (
  pattern text primary key,
  genre text not null references private.genres (genre) on update cascade,
  rank smallint not null unique
);
insert into private.genre_ndc (pattern, genre, rank) values
  ('^726\.1', 'マンガ', 1),
  ('^726\.6', '絵本', 2),
  ('^913', '日本の小説', 3),
  ('^9[1-9]3', '海外の小説', 4),
  ('^9[1-9][456]', 'エッセイ', 5),
  ('^9[1-9]1', '詩と短歌と俳句', 6),
  ('^9', '文学の評論と戯曲', 7),
  ('^7[89]', '趣味とスポーツ', 8),
  ('^7', '芸術と写真', 9),
  ('^67', '社会とビジネスと教育', 10),
  ('^007', '技術と暮らし', 11),
  ('^0', 'そのほか', 12),
  ('^1', '哲学と宗教と心理', 13),
  ('^2', '歴史と地理', 14),
  ('^3', '社会とビジネスと教育', 15),
  ('^4', '科学と医学', 16),
  ('^[56]', '技術と暮らし', 17),
  ('^8', '言葉', 18);
alter table private.genre_ndc enable row level security;
revoke all on private.genre_ndc from public, anon, authenticated;

create function private.ndc_genre(ndc text) returns text
language sql stable set search_path = '' as $$
  select g.genre from private.genre_ndc g
  where btrim(coalesce(ndc, '')) ~ g.pattern
  order by g.rank
  limit 1
$$;
revoke all on function private.ndc_genre(text) from public, anon, authenticated;

-- What an edition's bibliography says of its genre and year, kept so a
-- person's books are found newest first by an index, and a work's genre
-- without reading every edition's bibliography.
create table public.edition_facts (
  edition_id uuid primary key references public.editions (id) on delete cascade,
  ndc text check (char_length(ndc) between 1 and 40),
  -- 2014 or 2014-06, as the bibliography has it.
  issued text check (char_length(issued) <= 20),
  check (ndc is not null or issued is not null)
);
alter table public.edition_facts enable row level security;
revoke all on public.edition_facts from public, anon, authenticated;

-- A work's genre as the operator set it, before its editions'.
create table private.work_genre_fixed (
  work_id uuid primary key references public.works (id) on delete cascade,
  genre text not null references private.genres (genre) on update cascade,
  decided_at timestamptz not null default now()
);
alter table private.work_genre_fixed enable row level security;
revoke all on private.work_genre_fixed from public, anon, authenticated;

-- A work's genre: the operator's, else that of most of its editions (of as
-- many, the one shown first).
create function private.work_genre(work uuid) returns text
language sql stable set search_path = '' as $$
  select coalesce(
    (select f.genre from private.work_genre_fixed f where f.work_id = work),
    (select x.genre
     from public.editions e
     join public.edition_facts f on f.edition_id = e.id
     join private.genres x on x.genre = private.ndc_genre(f.ndc)
     where e.work_id = work
     group by x.genre, x.ord
     order by count(*) desc, x.ord
     limit 1))
$$;
revoke all on function private.work_genre(uuid) from public, anon, authenticated;

-- Reading an edition -----------------------------------------------------------------

-- Editions to read again: their bibliography changed, or the author of a
-- book without an ISBN.
create table private.people_stale (
  edition_id uuid primary key references public.editions (id) on delete cascade,
  since timestamptz not null default now()
);
create index people_stale_since on private.people_stale (since, edition_id);
alter table private.people_stale enable row level security;
revoke all on private.people_stale from public, anon, authenticated;

create function private.people_mark_stale() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The stale row before the typed people: the minute's job takes them in
  -- that order, so the two never wait on each other in a circle.
  insert into private.people_stale (edition_id)
  select x.edition_id from (
    select (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end
      ->> 'edition_id')::uuid as edition_id
    union
    select (to_jsonb(old) ->> 'edition_id')::uuid where tg_op = 'UPDATE'
  ) x
  where x.edition_id is not null
    and exists (select 1 from public.editions e where e.id = x.edition_id)
  -- Updated, not passed over: it waits for a read taking the row right now,
  -- and is written again after it, so the change is read.
  on conflict (edition_id) do update set since = private.people_stale.since;
  -- A reader's words go with their book now (the account deleted, the
  -- author changed), not at the next read.
  if tg_table_name = 'books' and tg_op in ('DELETE', 'UPDATE') then
    delete from public.edition_people p
    where p.edition_id = old.edition_id and p.source = 'typed';
  end if;
  return null;
end;
$$;
revoke all on function private.people_mark_stale() from public, anon, authenticated;
create trigger edition_sources_people after insert or update of fields or delete
  on private.edition_sources for each row execute function private.people_mark_stale();
create trigger edition_fixes_people after insert or update or delete
  on private.edition_fixes for each row execute function private.people_mark_stale();
create trigger books_people_typed_came after insert on public.books
  for each row when (new.isbn is null) execute function private.people_mark_stale();
create trigger books_people_typed_went after delete on public.books
  for each row when (old.isbn is null) execute function private.people_mark_stale();
create trigger books_people_typed_changed after update of author, edition_id, isbn on public.books
  for each row when (old.isbn is null or new.isbn is null)
  execute function private.people_mark_stale();

-- The person of an authority, made the first time it is read; named by its
-- heading until the operator names them.
create function private.people_for_authority(authority text, name text, reading text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p record;
  made uuid;
begin
  select x.id, x.name, x.name_reading, x.named_by into p
  from public.people x where x.authority = people_for_authority.authority;
  if not found then
    insert into public.people (name, name_reading, name_key, authority, made_by)
    values (left(people_for_authority.name, 300), left(people_for_authority.reading, 300),
      coalesce(private.bib_key(people_for_authority.name), ''),
      people_for_authority.authority, 'auto')
    on conflict on constraint people_authority_key do nothing
    returning id into made;
    if made is null then
      select x.id into made from public.people x where x.authority = people_for_authority.authority;
    end if;
    return private.people_now(made);
  end if;
  -- The heading's name only (the same in every edition of the authority);
  -- the reading stays the first one's. Never over the operator's name.
  if p.named_by = 'auto' and p.name is distinct from left(people_for_authority.name, 300) then
    update public.people x set name = left(people_for_authority.name, 300),
      name_key = coalesce(private.bib_key(people_for_authority.name), ''),
      name_reading = coalesce(x.name_reading, left(people_for_authority.reading, 300))
    where x.id = p.id and x.named_by = 'auto';
  end if;
  return private.people_now(p.id);
end;
$$;
revoke all on function private.people_for_authority(text, text, text)
  from public, anon, authenticated;

-- Makes an edition's people and genre again from its bibliography (an
-- operator's fix, then the sources in order), with what the operator
-- decided. A book without an ISBN, its own edition, gives the words its
-- reader typed.
create function private.people_read_one(ed uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b record;
  c record;
  people jsonb;
  src text := 'bibliography';
  typed text;
  shown text;
  k text;
  a text;
  who uuid;
  placed record;
  n integer := 0;
begin
  delete from public.edition_people p where p.edition_id = ed;
  delete from public.edition_facts f where f.edition_id = ed;
  if not exists (select 1 from public.editions e where e.id = ed) then
    return;
  end if;
  select * into b from private.edition_bibliography(ed);
  people := case when jsonb_typeof(b.creators) = 'array' then b.creators end;
  if people is null and (select e.isbn from public.editions e where e.id = ed) is null then
    -- Only an edition of one book: never one reader's words on another's.
    select min(x.author) into typed from public.books x where x.edition_id = ed
    having count(*) = 1;
    src := 'typed';
    select coalesce(jsonb_agg(jsonb_build_object('name', w) order by i), '[]') into people
    from regexp_split_to_table(coalesce(typed, ''), '\s*[、，,]\s*') with ordinality s (w, i)
    where btrim(w) <> '';
  end if;
  for c in
    select x.value as v from jsonb_array_elements(coalesce(people, '[]')) with ordinality x
    where jsonb_typeof(x.value) = 'object'
    order by x.ordinality
  loop
    shown := private.bib_text(c.v ->> 'name');
    continue when shown is null;
    n := n + 1;
    exit when n > 500;
    k := coalesce(private.bib_key(shown), '');
    a := case when src = 'bibliography' then nullif(btrim(c.v ->> 'authority'), '') end;
    who := null;
    select x.person_id into placed from private.people_placed x
    where x.edition_id = ed and x.name_key = k;
    if found then
      who := private.people_now(placed.person_id);
    elsif a is not null then
      who := private.people_for_authority(a,
        coalesce(private.bib_person(c.v ->> 'heading'), shown), c.v ->> 'reading');
    end if;
    insert into public.edition_people (edition_id, seq, person_id, name, name_key, reading,
      role, roles, source)
    values (ed, n, who, left(shown, 300), k, left(private.bib_text(c.v ->> 'reading'), 300),
      left(private.bib_text(c.v ->> 'role'), 100), private.people_roles(c.v ->> 'role'), src);
  end loop;
  if private.bib_text(b.ndc) is not null or private.bib_text(b.issued) is not null then
    insert into public.edition_facts (edition_id, ndc, issued)
    values (ed, left(private.bib_text(b.ndc), 40), left(private.bib_text(b.issued), 20));
  end if;
end;
$$;
revoke all on function private.people_read_one(uuid) from public, anon, authenticated;

-- Reads again up to this many stale editions, oldest first; returns how
-- many. One read or operator's tool at a time (a lock of its own, so a
-- reader's book waits for none of them).
create function private.people_read(most integer default 500) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  taken uuid[];
  e uuid;
begin
  perform pg_advisory_xact_lock(hashtext('booktown.people'));
  with t as (
    delete from private.people_stale t
    where t.edition_id in (
      select x.edition_id from private.people_stale x
      order by x.since, x.edition_id limit greatest(most, 0)
      for update skip locked)
    returning t.edition_id
  )
  select coalesce(array_agg(t.edition_id order by t.edition_id), '{}') into taken from t;
  foreach e in array taken loop
    perform private.people_read_one(e);
  end loop;
  return cardinality(taken);
end;
$$;
revoke all on function private.people_read(integer) from public, anon, authenticated;
select cron.schedule('people-read', '* * * * *', 'select private.people_read(2000)');

-- The operator's tools -------------------------------------------------------------

-- A person made by hand (one the library has no authority for).
create function private.people_make(name text, name_reading text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  made uuid;
begin
  insert into public.people (name, name_reading, name_key, made_by, named_by)
  values (people_make.name, people_make.name_reading,
    coalesce(private.bib_key(people_make.name), ''), 'human', 'human')
  returning id into made;
  insert into private.people_decisions (op, person_id) values ('make', made);
  return made;
end;
$$;
revoke all on function private.people_make(text, text) from public, anon, authenticated;

-- Joins two people who are one (the library has two authorities of them):
-- the one that goes points to the one that stays, and its books, names
-- placed and links go along.
create function private.people_join(stays uuid, goes uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s uuid;
  g uuid;
begin
  -- The lock first: two joins at once never make a circle.
  perform pg_advisory_xact_lock(hashtext('booktown.people'));
  s := private.people_now(people_join.stays);
  g := private.people_now(people_join.goes);
  if s is null or g is null or s = g then
    raise exception 'people_join: two people';
  end if;
  update public.people x set merged_into = s where x.id = g;
  update public.edition_people p set person_id = s where p.person_id = g;
  update private.people_placed p set person_id = s where p.person_id = g;
  insert into public.person_links (person_id, other_id, decided_at)
  select least(s, o), greatest(s, o), l.decided_at
  from public.person_links l
  cross join lateral (select case when l.person_id = g then l.other_id else l.person_id end as o) x
  where (l.person_id = g or l.other_id = g) and x.o <> s
  on conflict do nothing;
  delete from public.person_links l where l.person_id = g or l.other_id = g;
  insert into private.people_decisions (op, person_id, detail)
  values ('join', s, jsonb_build_object('gone', g));
end;
$$;
revoke all on function private.people_join(uuid, uuid) from public, anon, authenticated;

-- Two people who are one under other names (栗本薫 and 中島梓): they stay
-- two, linked.
create function private.people_link(person uuid, other uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a uuid;
  b uuid;
begin
  perform pg_advisory_xact_lock(hashtext('booktown.people'));
  a := private.people_now(people_link.person);
  b := private.people_now(people_link.other);
  if a is null or b is null or a = b then
    raise exception 'people_link: two people';
  end if;
  insert into public.person_links (person_id, other_id) values (least(a, b), greatest(a, b))
  on conflict do nothing;
  insert into private.people_decisions (op, person_id, detail)
  values ('link', a, jsonb_build_object('other', b));
end;
$$;
revoke all on function private.people_link(uuid, uuid) from public, anon, authenticated;

create function private.people_unlink(person uuid, other uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a uuid;
  b uuid;
begin
  perform pg_advisory_xact_lock(hashtext('booktown.people'));
  a := private.people_now(people_unlink.person);
  b := private.people_now(people_unlink.other);
  delete from public.person_links l where l.person_id = least(a, b) and l.other_id = greatest(a, b);
  insert into private.people_decisions (op, person_id, detail)
  values ('unlink', a, jsonb_build_object('other', b));
end;
$$;
revoke all on function private.people_unlink(uuid, uuid) from public, anon, authenticated;

-- Places a name on an edition on a person, or (person null) leaves it a
-- name only, whatever its authority says; kept when it is read again.
create function private.people_place(edition uuid, name text, person uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k text := coalesce(private.bib_key(private.bib_text(people_place.name)), '');
begin
  perform pg_advisory_xact_lock(hashtext('booktown.people'));
  if not exists (select 1 from public.edition_people p
      where p.edition_id = people_place.edition and p.name_key = k and p.source = 'bibliography') then
    raise exception 'people_place: no such name on the edition';
  end if;
  insert into private.people_placed (edition_id, name_key, person_id)
  values (people_place.edition, k, private.people_now(people_place.person))
  on conflict (edition_id, name_key) do update
    set person_id = excluded.person_id, decided_at = now();
  insert into private.people_decisions (op, person_id, edition_id, detail)
  values ('place', private.people_now(people_place.person), people_place.edition,
    jsonb_build_object('name', k));
  perform private.people_read_one(people_place.edition);
end;
$$;
revoke all on function private.people_place(uuid, text, uuid) from public, anon, authenticated;

-- Takes back what people_place decided: the rules again.
create function private.people_unplace(edition uuid, name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k text := coalesce(private.bib_key(private.bib_text(people_unplace.name)), '');
begin
  perform pg_advisory_xact_lock(hashtext('booktown.people'));
  delete from private.people_placed p where p.edition_id = people_unplace.edition and p.name_key = k;
  insert into private.people_decisions (op, edition_id, detail)
  values ('unplace', people_unplace.edition, jsonb_build_object('name', k));
  perform private.people_read_one(people_unplace.edition);
end;
$$;
revoke all on function private.people_unplace(uuid, text) from public, anon, authenticated;

create function private.people_name(person uuid, name text, name_reading text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('booktown.people'));
  update public.people x set name = people_name.name, name_reading = people_name.name_reading,
    name_key = coalesce(private.bib_key(people_name.name), ''), named_by = 'human'
  where x.id = private.people_now(people_name.person);
  insert into private.people_decisions (op, person_id)
  values ('name', private.people_now(people_name.person));
end;
$$;
revoke all on function private.people_name(uuid, text, text) from public, anon, authenticated;

-- Sets a work's genre by hand, or (genre null) leaves it to its editions.
create function private.genre_fix(work uuid, genre text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if genre_fix.genre is null then
    delete from private.work_genre_fixed f where f.work_id = genre_fix.work;
  else
    insert into private.work_genre_fixed (work_id, genre) values (genre_fix.work, genre_fix.genre)
    on conflict (work_id) do update set genre = excluded.genre, decided_at = now();
  end if;
  insert into private.people_decisions (op, work_id, detail)
  values ('genre', genre_fix.work, jsonb_build_object('genre', genre_fix.genre));
end;
$$;
revoke all on function private.genre_fix(uuid, text) from public, anon, authenticated;

-- Names only, on editions anyone may read, of the name of a person, for the
-- operator to place: one (one person of that name) or several (people of
-- one name: 中島敦). Names the operator decided are left out.
create function private.people_candidates(most integer default 500, after text default '')
returns table (reason text, edition_id uuid, seq smallint, name text, people uuid[])
language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then 'one' else 'several' end, p.edition_id, p.seq, p.name,
    array_agg(x.id order by x.created_at, x.id)
  from public.edition_people p
  join public.people x on x.name_key = p.name_key and x.merged_into is null
  where p.person_id is null and p.source = 'bibliography' and p.name_key > coalesce(after, '')
    and exists (select 1 from public.books b where b.edition_id = p.edition_id and b.source = 'ndl')
    and not exists (select 1 from private.people_placed d
      where d.edition_id = p.edition_id and d.name_key = p.name_key)
  group by p.name_key, p.edition_id, p.seq, p.name
  -- A page at a time, by the name as it is compared: the next page starts
  -- after the last page's last name.
  order by p.name_key, p.edition_id, p.seq
  limit greatest(least(most, 5000), 0)
$$;
revoke all on function private.people_candidates(integer, text) from public, anon, authenticated;

-- What anyone reads ------------------------------------------------------------------

-- Who made an ISBN's edition, in order, as the book prints them, with the
-- person when there is one, their name, and the other names they wrote
-- under. Editions anyone may read (a catalog row) only.
create function public.people_for_isbn(isbn text) returns table (seq smallint, name text,
  role text, roles text[], person_id uuid, person_name text, person_reading text,
  other_people jsonb)
language sql stable security definer set search_path = '' as $$
  select p.seq, p.name, p.role, p.roles, x.id, x.name, x.name_reading,
    coalesce((
      select jsonb_agg(jsonb_build_object('person_id', o.id, 'name', o.name) order by o.name, o.id)
      from public.person_links l
      join public.people o on o.id = case when l.person_id = x.id then l.other_id else l.person_id end
      where l.person_id = x.id or l.other_id = x.id), '[]')
  from public.editions e
  join public.edition_people p on p.edition_id = e.id and p.source = 'bibliography'
  left join public.people x on x.id = private.people_now(p.person_id)
  where e.isbn = private.isbn13(people_for_isbn.isbn)
    and exists (select 1 from public.books b where b.edition_id = e.id and b.source = 'ndl')
  order by p.seq
  limit 500
$$;
revoke all on function public.people_for_isbn(text) from public, anon, authenticated;
grant execute on function public.people_for_isbn(text) to anon, authenticated;

-- A person's books anyone may read (their catalog rows), newest first: the
-- book, its title, ISBN, when it came out, the roles, and the name it
-- prints. Nothing about who has which.
create function public.books_of_person(person uuid) returns table (book_id uuid, title text,
  isbn text, issued text, roles text[], printed_name text)
language sql stable security definer set search_path = '' as $$
  with mine as (
    -- Joins move the books along, so a person's books are under their id.
    select p.edition_id, min(p.seq) as seq
    from public.edition_people p
    where p.person_id = private.people_now(books_of_person.person)
      and exists (select 1 from public.books k where k.edition_id = p.edition_id and k.source = 'ndl')
    group by p.edition_id
  ), newest as (
    select m.edition_id, m.seq, f.issued from mine m
    left join public.edition_facts f on f.edition_id = m.edition_id
    order by f.issued desc nulls last, m.edition_id
    limit 500
  )
  select b.id, b.title, e.isbn, n.issued,
    array(select distinct r from public.edition_people q cross join lateral unnest(q.roles) r
      where q.edition_id = n.edition_id
        and q.person_id = private.people_now(books_of_person.person) order by 1),
    (select p.name from public.edition_people p where p.edition_id = n.edition_id and p.seq = n.seq)
  from newest n
  join public.editions e on e.id = n.edition_id
  cross join lateral (
    select k.id, k.title from public.books k
    where k.edition_id = e.id and k.source = 'ndl' order by k.created_at, k.id limit 1) b
  order by n.issued desc nulls last, b.title, b.id
$$;
revoke all on function public.books_of_person(uuid) from public, anon, authenticated;
grant execute on function public.books_of_person(uuid) to anon, authenticated;

-- Every edition now, read: those with a source's answer or a fix, and the
-- books without an ISBN.
insert into private.people_stale (edition_id)
select s.edition_id from private.edition_sources s
union
select f.edition_id from private.edition_fixes f
union
select e.id from public.editions e where e.isbn is null
on conflict do nothing;
select private.people_read(1000000);
