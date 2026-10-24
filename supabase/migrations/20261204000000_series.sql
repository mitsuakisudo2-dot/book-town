-- Series and volumes (item 6 of the plan). けにーさん approved the design on
-- 2026-10-24 07:21Z (https://claude.ai/artifact/NX1d5KcqcC6FmdmoBLyoVs):
-- a series sits on top of the works, and nothing a reader keeps moves when
-- the series are made, changed or made again.
--
--   series          進撃の巨人 as a whole; BookTown's own, not a source's.
--   series_lines    the ways it came out, each numbered on its own: 通常版,
--                   愛蔵版, 文庫版. Most series have one, without a name.
--   series_volumes  an edition in a line, at a number (上 1, 中 2, 下 2 or 3,
--                   2026年版 2026), with whether a person or the rules put
--                   it there.
--
-- A number belongs to an edition in a line, not to a work, so 通常版 1 and
-- 愛蔵版 1 are counted apart, and what a reader marked on one edition is
-- never read as read on another: a reader's marks stay on their book, as
-- before, and what is read of a series is counted from them. 年版 and 年度
-- are a series of the yearly kind, not volumes, and each year stays its own
-- work. What one volume of a line holds of another (愛蔵版 1 is 通常版 1 and
-- 2) is not kept yet; it can come as a table of its own.
--
-- The library's series field is mostly a label (岩波文庫, 講談社ノベルス:
-- in the sample, even the 59 names one author's books share are mostly
-- labels), so it never makes a series. It parts lines, and it brings
-- candidates.
--
-- The rules (private.series_plan) put an edition in a series only when it is
-- plain: editions that anyone may read (they have a catalog row: the
-- library's, or one made from a registered book's bibliography, as search
-- has them), with the same title, the same people (the library's authority
-- id, or the name where there is none; every one of them, whatever their
-- roles), the same publisher, the same label and edition words, a volume
-- read plainly (3, 第3巻, [3], 上, 2026年版; not 続, 別巻, 1-2), and no two
-- at one number; of those of one title and people (通常版 and 愛蔵版), the
-- biggest only. Anything else is a candidate (private.series_candidates)
-- for the operator, who places, takes out and joins by hand.
--
-- What a person decided is kept volume by volume (decided = 'human', and
-- private.series_kept_out for an edition taken out), and the rules never
-- change it. Planning again keeps a series' id: a group goes to the series
-- most of it is in already; a series the rules empty points to where its
-- volumes went (merged_into). A plan is written down step by step before
-- anything changes, applied all or nothing (refused when something changed
-- since), and undone run by run, the latest first; an undo leaves alone
-- what a person changed since.
--
-- What the rules read of each edition is kept (private.series_keys), read
-- again when its bibliography changes or a catalog row comes or goes
-- (private.series_stale, a minute's job of 2,000), so a night's run reads only
-- the titles of what is new, by an index, however many books there are.
--
-- This file makes the plan of the first full run and does not apply it: it
-- is read (select) and shown first, and applied by the next migration.
-- After a full run is applied, a nightly run (19:43 UTC, after the catalog's)
-- adds new editions only, without moving or taking out anything, and is
-- written down the same way.
--
-- Also: the bibliography's sources, their order and how long an answer may
-- be kept, as a table (private.bib_providers; AUD-133): the master reads the
-- order from it, and edition_sources' source must be one of them.
--
-- Rollback: nothing else reads the new tables, and no row of an old table
-- changes. A new migration that makes private.edition_bibliography() again
-- as 20261102000000_bibliography_holds.sql has it, and runs
--   select cron.unschedule('series-nightly');
--   select cron.unschedule('series-read');
--   drop trigger edition_sources_series on private.edition_sources;
--   drop trigger edition_fixes_series on private.edition_fixes;
--   drop trigger books_series_came on public.books;
--   drop trigger books_series_went on public.books;
--   drop trigger books_series_moved on public.books;
--   alter table private.edition_sources
--     drop constraint edition_sources_source_fkey,
--     add constraint edition_sources_source_check check (source in ('ndl', 'openbd'));
--   drop function public.series_for_isbn(text), private.series_candidates(),
--     private.series_finish(uuid, boolean), private.series_line_name(uuid, text),
--     private.series_name(uuid, text, text), private.series_join(uuid, uuid),
--     private.series_take_out(uuid, uuid),
--     private.series_place(uuid, uuid, integer, text, uuid),
--     private.series_add_line(uuid, text, text), private.series_make(text, text, text),
--     private.series_nightly(), private.series_undo(uuid), private.series_apply(uuid),
--     private.series_plan(text), private.series_read(integer),
--     private.series_mark_stale(), private.series_now(uuid),
--     private.series_facts(uuid), private.series_number(text), private.series_rule();
--   drop view private.series_last_out;
--   drop table public.series_volumes, public.series_lines, private.series_kept_out,
--     private.series_steps, private.series_decisions, private.series_runs,
--     public.series, private.series_keys, private.series_stale, private.bib_providers;

-- The sources -------------------------------------------------------------------------

-- Where the bibliography comes from, in the order the master takes a field
-- (rank 1 first; an operator's fix comes before them all), and how long an
-- answer may be kept (none: as long as the edition is there). A source with
-- a limit needs its forgetting made with it before it is added.
create table private.bib_providers (
  source text primary key,
  rank smallint not null unique check (rank > 0),
  keep_for interval check (keep_for > interval '0'),
  note text not null
);
insert into private.bib_providers (source, rank, keep_for, note) values
  ('ndl', 1, null, '国立国会図書館。書誌をそのまま残してよい（外部サービス.md）'),
  ('openbd', 2, null, 'openBD。使う所だけを残す（外部サービス.md）');
alter table private.bib_providers enable row level security;
revoke all on private.bib_providers from public, anon, authenticated;

alter table private.edition_sources
  drop constraint edition_sources_source_check,
  add constraint edition_sources_source_fkey foreign key (source)
    references private.bib_providers (source);

-- As before (bibliography_holds), with the sources' order from the table.
create or replace function private.edition_bibliography(ed uuid, since timestamptz default '-infinity')
returns table (title text, title_reading text, subtitle text, volume text, edition text,
  series jsonb, creators jsonb, credits jsonb, publisher text, issued text, ndc text,
  sources jsonb)
language sql stable set search_path = '' as $$
  with picked as (
    select k.field, coalesce(
      (select jsonb_build_array(f.value, 'fix') from private.edition_fixes f
       where f.edition_id = ed and f.field = k.field),
      (select jsonb_build_array(s.fields -> k.field, s.source) from private.edition_sources s
       join private.bib_providers p on p.source = s.source
       where s.edition_id = ed and private.bib_filled(s.fields -> k.field)
         and coalesce(case when k.field = 'title' then s.title_for else s.found_for end,
           '-infinity') >= since
       order by p.rank
       limit 1)) as pick
    from unnest(array['title', 'title_reading', 'subtitle', 'volume', 'edition', 'series',
      'creators', 'credits', 'publisher', 'issued', 'ndc']) k (field)
  ), shown as (
    select
      coalesce(jsonb_object_agg(p.field, p.pick -> 0)
        filter (where private.bib_filled(p.pick -> 0)), '{}') as v,
      coalesce(jsonb_object_agg(p.field, p.pick -> 1)
        filter (where private.bib_filled(p.pick -> 0)), '{}') as sources
    from picked p
  )
  select v ->> 'title', v ->> 'title_reading', v ->> 'subtitle', v ->> 'volume',
    v ->> 'edition', v -> 'series', v -> 'creators', v -> 'credits', v ->> 'publisher',
    v ->> 'issued', v ->> 'ndc', sources
  from shown
$$;
revoke all on function private.edition_bibliography(uuid, timestamptz)
  from public, anon, authenticated;

-- Series, lines and volumes ----------------------------------------------------------

create table public.series (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 300),
  name_reading text check (char_length(name_reading) <= 300),
  kind text not null default 'volumes' check (kind in ('volumes', 'yearly')),
  -- Set by the operator only: the bibliography never says a series is done,
  -- so without it the volumes known are only those known so far.
  finished_at timestamptz,
  -- Set when its volumes went to another series (a join, or a plan that
  -- emptied it): an id that named it still leads somewhere.
  merged_into uuid references public.series (id),
  made_by text not null check (made_by in ('auto', 'human')),
  created_at timestamptz not null default now(),
  constraint series_not_into_itself check (merged_into is distinct from id)
);
create index series_merged_into on public.series (merged_into) where merged_into is not null;
alter table public.series enable row level security;
revoke all on public.series from public, anon, authenticated;

create table public.series_lines (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series (id) on update cascade,
  -- 愛蔵版, 文庫版; none for a series' only line, or its first.
  name text check (char_length(name) between 1 and 100),
  -- The library's series the line's editions share (岩波文庫), when they do.
  label text check (char_length(label) between 1 and 300),
  created_at timestamptz not null default now(),
  constraint series_lines_in_series unique (id, series_id)
);
create index series_lines_series on public.series_lines (series_id);
alter table public.series_lines enable row level security;
revoke all on public.series_lines from public, anon, authenticated;

-- What the rules did, run by run, step by step, so a run is shown before it
-- is applied and can be undone exactly. A step names series and lines it
-- makes before they are there, so they are not foreign keys.
create table private.series_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('add', 'full')),
  -- Which rules made it (private.series_rule()), to tell runs apart when the
  -- rules change.
  rule text not null,
  planned_at timestamptz not null default clock_timestamp(),
  applied_at timestamptz,
  undone_at timestamptz,
  counts jsonb not null default '{}',
  check (undone_at is null or applied_at is not null)
);
alter table private.series_runs enable row level security;
revoke all on private.series_runs from public, anon, authenticated;

create table private.series_steps (
  run_id uuid not null references private.series_runs (id) on delete cascade,
  seq integer not null,
  op text not null check (op in ('make_series', 'make_line', 'add', 'move', 'remove', 'retire')),
  edition_id uuid,
  -- Where it goes (make_series: the series; retire: where the volumes went).
  series_id uuid,
  line_id uuid,
  number integer,
  shown text,
  -- Where it was (move, remove; retire: the series retired).
  from_series uuid,
  from_line uuid,
  from_number integer,
  from_shown text,
  -- A new series' name, reading and kind; a new line's label.
  name text,
  name_reading text,
  kind text,
  label text,
  primary key (run_id, seq)
);
create index series_steps_edition on private.series_steps (run_id, edition_id);
create index series_steps_from on private.series_steps (run_id, op, from_series);
create index series_steps_out on private.series_steps (edition_id) where op = 'remove';
alter table private.series_steps enable row level security;
revoke all on private.series_steps from public, anon, authenticated;

-- Where the rules last took each edition out, in a run still applied.
create view private.series_last_out as
select distinct on (st.edition_id) st.edition_id, st.from_series
from private.series_steps st
join private.series_runs r on r.id = st.run_id
where st.op = 'remove' and r.applied_at is not null and r.undone_at is null
order by st.edition_id, r.applied_at desc;
revoke all on private.series_last_out from public, anon, authenticated;

create table public.series_volumes (
  series_id uuid not null references public.series (id),
  edition_id uuid not null references public.editions (id) on delete cascade,
  line_id uuid not null,
  number integer not null check (number between 0 and 9999),
  -- How the number is written: 3, 上, 2026年版.
  shown text not null check (char_length(shown) between 1 and 40),
  decided text not null check (decided in ('auto', 'human')),
  -- The run that put it here (decided = 'auto').
  run_id uuid references private.series_runs (id),
  decided_at timestamptz not null default now(),
  primary key (series_id, edition_id),
  constraint series_volumes_line_fkey foreign key (line_id, series_id)
    references public.series_lines (id, series_id) on update cascade,
  check ((decided = 'auto') = (run_id is not null))
);
-- The rules put an edition in one series at most.
create unique index series_volumes_one_auto on public.series_volumes (edition_id)
  where decided = 'auto';
create index series_volumes_edition on public.series_volumes (edition_id);
create index series_volumes_line on public.series_volumes (line_id, number);
create index series_volumes_run on public.series_volumes (run_id) where run_id is not null;
alter table public.series_volumes enable row level security;
revoke all on public.series_volumes from public, anon, authenticated;

-- An edition a person took out of a series: the rules never put it back.
create table private.series_kept_out (
  series_id uuid not null references public.series (id),
  edition_id uuid not null references public.editions (id) on delete cascade,
  decided_at timestamptz not null default now(),
  primary key (series_id, edition_id)
);
alter table private.series_kept_out enable row level security;
revoke all on private.series_kept_out from public, anon, authenticated;

-- What a person did by hand, written down.
create table private.series_decisions (
  id uuid primary key default gen_random_uuid(),
  op text not null check (op in ('make', 'line', 'place', 'take_out', 'join', 'name',
    'line_name', 'finish')),
  series_id uuid not null,
  edition_id uuid,
  detail jsonb not null default '{}',
  decided_at timestamptz not null default now()
);
alter table private.series_decisions enable row level security;
revoke all on private.series_decisions from public, anon, authenticated;

-- Reading an edition -----------------------------------------------------------------

-- Changes whenever the rules below change what they put together, so runs
-- made by other rules can be told apart.
create function private.series_rule() returns text
language sql immutable set search_path = '' as $$
  select '2026-10-24'
$$;
revoke all on function private.series_rule() from public, anon, authenticated;

-- A volume as the library writes it: its kind, number, and how it shows.
-- [3] is 3 (the cataloguer's brackets). 上 is 1 and 中 2; 下 is 3 here, and
-- 2 in a series without 中 (private.series_plan). 2026年版 and 2026年度 are
-- the year, of the yearly kind. Nothing for what is not plainly one volume:
-- 1-2, 続, 別巻1, 総集編, or words.
create function private.series_number(v text, out kind text, out number integer,
  out shown text)
language plpgsql immutable set search_path = '' as $$
declare
  s text := btrim(normalize(coalesce(v, ''), nfkc));
  m text[];
  n text;
begin
  s := regexp_replace(s, '^\[\s*(.*?)\s*\]$', '\1');
  if s = '' then
    return;
  end if;
  m := regexp_match(s, '^([0-9]{4})\s*年\s*(版|度版|度)$');
  if m is not null then
    kind := 'yearly';
    number := m[1]::integer;
    shown := m[1] || '年' || m[2];
    return;
  end if;
  if s ~ '^[0-9]+\s*[-‐‑–—―−~〜・,、]\s*[0-9]'
    or s ~ '^(別巻|別冊|続|正|補|外伝|総集|特別|番外|新|完全|上下|全)' then
    return;
  end if;
  n := private.bib_volume_start(s);
  if n is null then
    return;
  end if;
  kind := 'volumes';
  if n in ('上', '中', '下') then
    number := case n when '上' then 1 when '中' then 2 else 3 end;
    shown := n;
  else
    number := n::integer;
    shown := n;
  end if;
end;
$$;
revoke all on function private.series_number(text) from public, anon, authenticated;

-- An edition as the rules see it, from its bibliography (an operator's fix,
-- then the sources in order): the keys it is grouped by, and its volume.
-- people is every person's key, each once, in order: the authority id, or
-- name: and the name folded; roles are left out ("著" on one volume and
-- nothing on the next is the same person).
create function private.series_facts(ed uuid, out title text, out title_reading text,
  out title_key text, out people text, out publisher_key text, out label text,
  out label_key text, out edition_key text, out kind text, out number integer,
  out shown text)
language plpgsql stable set search_path = '' as $$
declare
  b record;
  v record;
begin
  select * into b from private.edition_bibliography(ed);
  title := b.title;
  title_reading := b.title_reading;
  title_key := coalesce(private.bib_key(b.title), '');
  select coalesce(string_agg(k, '|' order by k), '') into people
  from (
    select distinct coalesce(nullif(c ->> 'authority', ''),
      'name:' || nullif(private.bib_key(c ->> 'name'), '')) as k
    from jsonb_array_elements(case when jsonb_typeof(b.creators) = 'array'
      then b.creators else '[]' end) c
  ) x
  where k is not null;
  publisher_key := coalesce(private.bib_key(b.publisher), '');
  select min(s ->> 'name'), coalesce(string_agg(distinct private.bib_key(s ->> 'name'), '|'), '')
  into label, label_key
  from jsonb_array_elements(case when jsonb_typeof(b.series) = 'array'
    then b.series else '[]' end) s
  where coalesce(s ->> 'name', '') <> '';
  edition_key := coalesce(private.bib_key(b.edition), '');
  select * into v from private.series_number(b.volume);
  kind := v.kind;
  number := v.number;
  shown := v.shown;
end;
$$;
revoke all on function private.series_facts(uuid) from public, anon, authenticated;

-- The series an id names now, after its joins.
create function private.series_now(s uuid) returns uuid
language plpgsql stable set search_path = '' as $$
declare
  here uuid := s;
  next uuid;
begin
  for i in 1 .. 50 loop
    select x.merged_into into next from public.series x where x.id = here;
    if next is null then
      return here;
    end if;
    here := next;
  end loop;
  return here;
end;
$$;
revoke all on function private.series_now(uuid) from public, anon, authenticated;

-- What the rules read, kept ---------------------------------------------------------

-- Each edition anyone may read (a catalog row) as the rules read it, kept so
-- that a night's run reads only what changed, and a title's editions are
-- found by an index however many books there are. family: its title and
-- people; group: those and its publisher, label and edition words.
create table private.series_keys (
  edition_id uuid primary key references public.editions (id) on delete cascade,
  family_key text not null,
  group_key text not null,
  title text,
  title_reading text,
  title_key text not null,
  people text not null,
  publisher_key text not null,
  label text,
  label_key text not null,
  edition_key text not null,
  kind text,
  number integer,
  shown text,
  read_at timestamptz not null default now()
);
create index series_keys_family on private.series_keys (family_key);
create index series_keys_read on private.series_keys (read_at);
alter table private.series_keys enable row level security;
revoke all on private.series_keys from public, anon, authenticated;

-- Editions to read again: their bibliography changed, or a catalog row came
-- or went.
create table private.series_stale (
  edition_id uuid primary key references public.editions (id) on delete cascade,
  since timestamptz not null default now()
);
create index series_stale_since on private.series_stale (since, edition_id);
alter table private.series_stale enable row level security;
revoke all on private.series_stale from public, anon, authenticated;

create function private.series_mark_stale() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.series_stale (edition_id)
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
  on conflict (edition_id) do update set since = private.series_stale.since;
  return null;
end;
$$;
revoke all on function private.series_mark_stale() from public, anon, authenticated;
create trigger edition_sources_series after insert or update of fields or delete
  on private.edition_sources for each row execute function private.series_mark_stale();
create trigger edition_fixes_series after insert or update or delete
  on private.edition_fixes for each row execute function private.series_mark_stale();
create trigger books_series_came after insert on public.books
  for each row when (new.source = 'ndl') execute function private.series_mark_stale();
create trigger books_series_went after delete on public.books
  for each row when (old.source = 'ndl') execute function private.series_mark_stale();
create trigger books_series_moved after update of edition_id, source on public.books
  for each row when (old.source = 'ndl' or new.source = 'ndl')
  execute function private.series_mark_stale();

-- Reads again up to this many stale editions, oldest first; returns how
-- many. An edition without a catalog row is not read (and loses its keys).
create function private.series_read(most integer default 500) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  taken uuid[];
begin
  with t as (
    delete from private.series_stale t
    where t.edition_id in (
      select x.edition_id from private.series_stale x
      order by x.since, x.edition_id limit greatest(most, 0)
      for update skip locked)
    returning t.edition_id
  )
  select coalesce(array_agg(t.edition_id), '{}') into taken from t;
  delete from private.series_keys k where k.edition_id = any (taken);
  insert into private.series_keys (edition_id, family_key, group_key, title,
    title_reading, title_key, people, publisher_key, label, label_key, edition_key,
    kind, number, shown)
  select e, concat_ws(chr(31), f.title_key, f.people),
    concat_ws(chr(31), f.title_key, f.people, f.publisher_key, f.label_key, f.edition_key),
    f.title, f.title_reading, f.title_key, f.people, f.publisher_key, f.label,
    f.label_key, f.edition_key, f.kind, f.number, f.shown
  from unnest(taken) e
  cross join lateral private.series_facts(e) f
  where exists (select 1 from public.books b where b.edition_id = e and b.source = 'ndl')
    and f.title_key <> '';
  return cardinality(taken);
end;
$$;
revoke all on function private.series_read(integer) from public, anon, authenticated;
select cron.schedule('series-read', '* * * * *', 'select private.series_read(2000)');

-- Every edition with a catalog row now, read.
insert into private.series_stale (edition_id)
select distinct b.edition_id from public.books b where b.source = 'ndl' and b.edition_id is not null
on conflict do nothing;
select private.series_read(1000000);

-- Planning -----------------------------------------------------------------------

-- Writes down what the rules would change, as a run not yet applied, and
-- returns its id. full: as the rules have it now, moving and taking out
-- what they put elsewhere before. add: only editions in no series yet go
-- in (the nightly run). Nothing a person decided changes.
create function private.series_plan(mode text default 'full') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  run uuid;
  seq integer := 0;
  g record;
  m record;
  main uuid;
  line uuid;
  lead record;
  now_row record;
  since timestamptz;
begin
  if mode is null or mode not in ('add', 'full') then
    raise exception 'series_plan: the mode is add or full';
  end if;
  -- What changed is read before anything waits; then one plan, apply,
  -- undo or operator's tool at a time (a lock of its own, so a reader's
  -- book that takes an edition along waits for none of them).
  perform private.series_read(1000000);
  perform pg_advisory_xact_lock(hashtext('booktown.series'));
  insert into private.series_runs (mode, rule) values (mode, private.series_rule())
  returning id into run;

  -- What the rules read: editions with a volume read plainly and at least
  -- one person, in full; for add, only the titles of those read since the
  -- last run that are in no series yet. placed: a person placed it
  -- somewhere, so the rules leave it where it is (it still tells which
  -- series its group is).
  -- Ten minutes back: an edition read by the minute's job while the last
  -- run was planned is looked at again (adding is the same twice).
  since := coalesce((select max(x.planned_at) from private.series_runs x
    where x.applied_at is not null and x.id <> run), '-infinity') - interval '10 minutes';
  drop table if exists pg_temp.series_seen_now;
  create temp table series_seen_now on commit drop as
  select k.edition_id, k.title, k.title_reading, k.label, k.family_key, k.group_key,
    k.kind, k.number, k.shown,
    exists (select 1 from public.series_volumes v
      where v.edition_id = k.edition_id and v.decided = 'human') as placed
  from private.series_keys k
  where k.kind is not null and k.people <> ''
    and (mode = 'full' or k.family_key in (
      select n.family_key from private.series_keys n
      where n.read_at >= since and n.kind is not null and n.people <> ''
        and not exists (select 1 from public.series_volumes v where v.edition_id = n.edition_id)));
  create index on series_seen_now (group_key);
  create index on series_seen_now (edition_id);
  analyze series_seen_now;
  -- 下 is 2 in a group without 中.
  update series_seen_now s set number = 2
  where s.shown = '下' and not exists (
    select 1 from series_seen_now o where o.group_key = s.group_key and o.shown = '中');

  -- The plain groups: the same publisher, label and edition words, two
  -- editions or more, one kind, no number twice, not 上下 with numbers. Of
  -- the plain groups of one title and people (通常版 and 愛蔵版, 単行本 and
  -- 文庫), only the biggest, when it is the only one that big: the others
  -- are candidates, for the operator to make lines of.
  drop table if exists pg_temp.series_groups_now;
  create temp table series_groups_now on commit drop as
  with plain as (
    select s.group_key, min(s.family_key) as family_key, count(*) as n
    from series_seen_now s
    group by s.group_key
    having count(*) >= 2
      and count(distinct s.number) = count(*)
      and count(distinct s.kind) = 1
      and not (bool_or(s.shown in ('上', '中', '下')) and bool_or(s.shown not in ('上', '中', '下')))
  )
  select p.group_key from plain p
  where not exists (select 1 from plain o
    where o.family_key = p.family_key and o.group_key <> p.group_key and o.n >= p.n);
  analyze series_groups_now;

  -- Where each edition of a plain group goes.
  drop table if exists pg_temp.series_wanted;
  create temp table series_wanted (edition_id uuid primary key, series_id uuid,
    line_id uuid, number integer, shown text) on commit drop;

  for g in select x.group_key from series_groups_now x order by x.group_key loop
    -- The series most of the group is in already (the oldest of those
    -- equally many), so planning again keeps its id.
    -- An edition the rules took out counts for the series it was in, so a
    -- series emptied and filled again keeps its id.
    main := (
      select x.id
      from series_seen_now s
      cross join lateral (
        select v.series_id from public.series_volumes v where v.edition_id = s.edition_id
        union all
        select o.from_series from private.series_last_out o
        where o.edition_id = s.edition_id
          and not exists (select 1 from public.series_volumes v
            where v.edition_id = s.edition_id)) w
      join public.series x on x.id = private.series_now(w.series_id)
      where s.group_key = g.group_key
      group by x.id, x.created_at
      order by count(*) desc, x.created_at, x.id
      limit 1);
    line := null;
    select s.* into lead from series_seen_now s
    where s.group_key = g.group_key order by s.number, s.edition_id limit 1;
    if main is null then
      main := gen_random_uuid();
      line := gen_random_uuid();
      seq := seq + 1;
      insert into private.series_steps (run_id, seq, op, series_id, name, name_reading, kind)
      values (run, seq, 'make_series', main, left(lead.title, 300),
        left(lead.title_reading, 300), lead.kind);
      seq := seq + 1;
      insert into private.series_steps (run_id, seq, op, series_id, line_id, label)
      values (run, seq, 'make_line', main, line, left(lead.label, 300));
    else
      -- The line most of the group is in there, else the series' first.
      select v.line_id into line
      from series_seen_now s
      join public.series_volumes v on v.edition_id = s.edition_id
      join public.series_lines l on l.id = v.line_id
      where s.group_key = g.group_key and v.series_id = main
      group by v.line_id, l.created_at
      order by count(*) desc, l.created_at, v.line_id
      limit 1;
      if line is null then
        select l.id into line from public.series_lines l
        where l.series_id = main order by l.created_at, l.id limit 1;
      end if;
    end if;
    -- A night's run adds only where nothing else would change (中 coming
    -- between 上 and 下 makes 下 3): the next full run does that.
    if mode = 'add' and exists (
        select 1 from series_seen_now s
        join public.series_volumes v on v.edition_id = s.edition_id and v.decided = 'auto'
        where s.group_key = g.group_key
          and (v.series_id, v.line_id, v.number, v.shown)
            is distinct from (main, line, s.number, s.shown)) then
      continue;
    end if;
    insert into series_wanted (edition_id, series_id, line_id, number, shown)
    select s.edition_id, main, line, s.number, s.shown
    from series_seen_now s
    where s.group_key = g.group_key and not s.placed
      and not exists (select 1 from private.series_kept_out k
        where k.edition_id = s.edition_id and private.series_now(k.series_id) = main);
  end loop;

  -- The steps, edition by edition.
  for m in
    select w.*, v.series_id as at_series, v.line_id as at_line, v.number as at_number,
      v.shown as at_shown
    from series_wanted w
    left join public.series_volumes v on v.edition_id = w.edition_id and v.decided = 'auto'
    order by w.series_id, w.number, w.edition_id
  loop
    if m.at_series is null then
      if not exists (select 1 from public.series_volumes v
          where v.edition_id = m.edition_id and v.series_id = m.series_id) then
        seq := seq + 1;
        insert into private.series_steps (run_id, seq, op, edition_id, series_id, line_id,
          number, shown)
        values (run, seq, 'add', m.edition_id, m.series_id, m.line_id, m.number, m.shown);
      end if;
    elsif mode = 'full' and (m.at_series, m.at_line, m.at_number, m.at_shown)
        is distinct from (m.series_id, m.line_id, m.number, m.shown) then
      seq := seq + 1;
      insert into private.series_steps (run_id, seq, op, edition_id, series_id, line_id,
        number, shown, from_series, from_line, from_number, from_shown)
      values (run, seq, 'move', m.edition_id, m.series_id, m.line_id, m.number, m.shown,
        m.at_series, m.at_line, m.at_number, m.at_shown);
    end if;
  end loop;

  if mode = 'full' then
    -- What the rules put somewhere before and would not now.
    for now_row in
      select v.* from public.series_volumes v
      where v.decided = 'auto'
        and not exists (select 1 from series_wanted w where w.edition_id = v.edition_id)
      order by v.series_id, v.number, v.edition_id
    loop
      seq := seq + 1;
      insert into private.series_steps (run_id, seq, op, edition_id, from_series, from_line,
        from_number, from_shown)
      values (run, seq, 'remove', now_row.edition_id, now_row.series_id, now_row.line_id,
        now_row.number, now_row.shown);
    end loop;
    -- A series the rules made that this run empties points to where most of
    -- its volumes went; one whose volumes only went out stays, empty.
    for now_row in
      select x.id,
        (select st.series_id from private.series_steps st
         where st.run_id = run and st.op = 'move' and st.from_series = x.id
         group by st.series_id order by count(*) desc, st.series_id limit 1) as went
      from public.series x
      where x.made_by = 'auto' and x.merged_into is null
        and exists (select 1 from public.series_volumes v where v.series_id = x.id)
        and not exists (
          select 1 from public.series_volumes v
          where v.series_id = x.id
            and not exists (select 1 from private.series_steps st
              where st.run_id = run and st.op in ('move', 'remove')
                and st.edition_id = v.edition_id and st.from_series = x.id))
        and not exists (select 1 from private.series_steps st
          where st.run_id = run and st.op in ('add', 'move') and st.series_id = x.id)
      order by x.id
    loop
      if now_row.went is not null then
        seq := seq + 1;
        insert into private.series_steps (run_id, seq, op, series_id, from_series)
        values (run, seq, 'retire', now_row.went, now_row.id);
      end if;
    end loop;
  end if;

  update private.series_runs r set counts = (
    select jsonb_build_object(
      'series', count(*) filter (where st.op = 'make_series'),
      'add', count(*) filter (where st.op = 'add'),
      'move', count(*) filter (where st.op = 'move'),
      'remove', count(*) filter (where st.op = 'remove'),
      'retire', count(*) filter (where st.op = 'retire'),
      'groups', (select count(*) from series_groups_now),
      'seen', (select count(*) from series_seen_now))
    from private.series_steps st where st.run_id = run)
  where r.id = run;
  return run;
end;
$$;
revoke all on function private.series_plan(text) from public, anon, authenticated;

-- Applies a planned run, all of it or none: if anything a step expects has
-- changed since it was planned (a person placed or took out an edition,
-- another run was applied), nothing changes, and it is planned again.
create function private.series_apply(which uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  st record;
  missed integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('booktown.series'));
  select * into r from private.series_runs x where x.id = which for update;
  if not found or r.applied_at is not null then
    raise exception 'series_apply: no run to apply';
  end if;
  if exists (select 1 from private.series_runs x
      where x.applied_at > r.planned_at or (x.undone_at > r.planned_at)) then
    raise exception 'series_apply: another run changed things since; plan again';
  end if;
  for st in select * from private.series_steps x where x.run_id = which order by x.seq loop
    if st.op = 'make_series' then
      insert into public.series (id, name, name_reading, kind, made_by)
      values (st.series_id, st.name, st.name_reading, st.kind, 'auto');
    elsif st.op = 'make_line' then
      insert into public.series_lines (id, series_id, label) values (st.line_id, st.series_id, st.label);
    elsif st.op = 'add' then
      if exists (select 1 from public.series_volumes v where v.edition_id = st.edition_id)
          or private.series_now(st.series_id) <> st.series_id
          or exists (select 1 from private.series_kept_out k
            where k.edition_id = st.edition_id
              and private.series_now(k.series_id) = st.series_id) then
        missed := missed + 1;
      else
        insert into public.series_volumes (series_id, edition_id, line_id, number, shown,
          decided, run_id)
        values (st.series_id, st.edition_id, st.line_id, st.number, st.shown, 'auto', which);
      end if;
    elsif st.op = 'move' then
      delete from public.series_volumes v
      where v.edition_id = st.edition_id and v.decided = 'auto'
        and v.series_id = st.from_series and v.line_id = st.from_line
        and v.number = st.from_number and v.shown = st.from_shown;
      if not found or exists (select 1 from public.series_volumes v
          where v.edition_id = st.edition_id)
          or private.series_now(st.series_id) <> st.series_id
          or exists (select 1 from private.series_kept_out k
            where k.edition_id = st.edition_id
              and private.series_now(k.series_id) = st.series_id) then
        missed := missed + 1;
      else
        insert into public.series_volumes (series_id, edition_id, line_id, number, shown,
          decided, run_id)
        values (st.series_id, st.edition_id, st.line_id, st.number, st.shown, 'auto', which);
      end if;
    elsif st.op = 'remove' then
      delete from public.series_volumes v
      where v.edition_id = st.edition_id and v.decided = 'auto'
        and v.series_id = st.from_series and v.line_id = st.from_line
        and v.number = st.from_number and v.shown = st.from_shown;
      if not found then
        missed := missed + 1;
      end if;
    elsif st.op = 'retire' then
      update public.series x set merged_into = st.series_id
      where x.id = st.from_series and x.merged_into is null
        and not exists (select 1 from public.series_volumes v where v.series_id = x.id);
      if not found then
        missed := missed + 1;
      end if;
    end if;
  end loop;
  if missed > 0 then
    raise exception 'series_apply: % steps no longer match; plan again', missed;
  end if;
  update private.series_runs x set applied_at = clock_timestamp() where x.id = which;
  return r.counts;
end;
$$;
revoke all on function private.series_apply(uuid) from public, anon, authenticated;

-- Undoes the latest applied run: each step back, last first, where it is
-- still as the run left it. What a person changed since stays as they left
-- it; it is counted as kept. Series and lines the run made stay (empty),
-- so an id that named them still leads somewhere.
create function private.series_undo(which uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  st record;
  back integer := 0;
  kept integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('booktown.series'));
  select * into r from private.series_runs x where x.id = which for update;
  if not found or r.applied_at is null or r.undone_at is not null then
    raise exception 'series_undo: no applied run to undo';
  end if;
  if exists (select 1 from private.series_runs x
      where x.id <> which and x.applied_at > r.applied_at and x.undone_at is null) then
    raise exception 'series_undo: undo the later runs first';
  end if;
  for st in select * from private.series_steps x where x.run_id = which order by x.seq desc loop
    if st.op in ('add', 'move') then
      delete from public.series_volumes v
      where v.edition_id = st.edition_id and v.series_id = st.series_id
        and v.decided = 'auto' and v.run_id = which;
      if not found then
        kept := kept + 1;
        continue;
      end if;
      back := back + 1;
    end if;
    if st.op in ('move', 'remove') then
      -- Not where a person put it since, nor into a series a person joined
      -- into another (its line went along).
      if exists (select 1 from public.series_volumes v where v.edition_id = st.edition_id)
          or private.series_now(st.from_series) <> st.from_series
          or not exists (select 1 from public.series_lines l
            where l.id = st.from_line and l.series_id = st.from_series)
          or exists (select 1 from private.series_kept_out k
            where k.edition_id = st.edition_id
              and private.series_now(k.series_id) = st.from_series) then
        kept := kept + 1;
      else
        -- Back as it was, with the run that had put it there.
        insert into public.series_volumes (series_id, edition_id, line_id, number, shown,
          decided, run_id)
        select st.from_series, st.edition_id, st.from_line, st.from_number, st.from_shown,
          'auto', coalesce((
            select x.id from private.series_runs x
            join private.series_steps y on y.run_id = x.id
            where x.applied_at < r.applied_at and y.edition_id = st.edition_id
              and y.op in ('add', 'move') and y.series_id = st.from_series
            order by x.applied_at desc limit 1), which);
        if st.op = 'remove' then
          back := back + 1;
        end if;
      end if;
    elsif st.op = 'retire' then
      update public.series x set merged_into = null
      where x.id = st.from_series and x.merged_into = st.series_id;
    end if;
  end loop;
  update private.series_runs x set undone_at = clock_timestamp(),
    counts = x.counts || jsonb_build_object('undone', back, 'kept', kept)
  where x.id = which;
  return jsonb_build_object('undone', back, 'kept', kept);
end;
$$;
revoke all on function private.series_undo(uuid) from public, anon, authenticated;

-- Each night, new editions in: only after a full run was applied (the first
-- one is read and shown before it is). Nothing moves or goes out.
create function private.series_nightly() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  run uuid;
begin
  if not exists (select 1 from private.series_runs x
      where x.mode = 'full' and x.applied_at is not null and x.undone_at is null) then
    return null;
  end if;
  run := private.series_plan('add');
  if (select (x.counts ->> 'add')::integer + (x.counts ->> 'series')::integer
      from private.series_runs x where x.id = run) = 0 then
    -- Nothing to add: the run is not kept.
    delete from private.series_runs x where x.id = run;
    return null;
  end if;
  perform private.series_apply(run);
  return run;
end;
$$;
revoke all on function private.series_nightly() from public, anon, authenticated;
select cron.schedule('series-nightly', '43 19 * * *', 'select private.series_nightly()');

-- The operator's tools -----------------------------------------------------------

-- A series made by hand, with its first line.
create function private.series_make(name text, name_reading text default null,
  kind text default 'volumes') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  made uuid;
begin
  insert into public.series (name, name_reading, kind, made_by)
  values (series_make.name, series_make.name_reading, series_make.kind, 'human')
  returning id into made;
  insert into public.series_lines (series_id) values (made);
  insert into private.series_decisions (op, series_id, detail)
  values ('make', made, jsonb_build_object('kind', series_make.kind));
  return made;
end;
$$;
revoke all on function private.series_make(text, text, text) from public, anon, authenticated;

-- Another line of a series (愛蔵版).
create function private.series_add_line(series uuid, name text, label text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  made uuid;
begin
  insert into public.series_lines (series_id, name, label)
  values (private.series_now(series_add_line.series), series_add_line.name, series_add_line.label)
  returning id into made;
  insert into private.series_decisions (op, series_id, detail)
  values ('line', private.series_now(series_add_line.series), jsonb_build_object('line', made));
  return made;
end;
$$;
revoke all on function private.series_add_line(uuid, text, text) from public, anon, authenticated;

-- Puts an edition in a series at a number, by hand (11巻 added to 1-10):
-- it is the person's from now on, and the rules take it out of wherever
-- they had put it. Its line: the one named, else the series' first.
create function private.series_place(edition uuid, series uuid, number integer,
  shown text default null, line uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s uuid := private.series_now(series_place.series);
  l uuid := series_place.line;
begin
  perform pg_advisory_xact_lock(hashtext('booktown.series'));
  if l is null then
    select x.id into l from public.series_lines x where x.series_id = s
    order by x.created_at, x.id limit 1;
  end if;
  delete from public.series_volumes v where v.edition_id = series_place.edition
    and (v.decided = 'auto' or v.series_id = s);
  delete from private.series_kept_out k where k.edition_id = series_place.edition
    and private.series_now(k.series_id) = s;
  insert into public.series_volumes (series_id, edition_id, line_id, number, shown, decided)
  values (s, series_place.edition, l, series_place.number,
    coalesce(series_place.shown, series_place.number::text), 'human');
  insert into private.series_decisions (op, series_id, edition_id, detail)
  values ('place', s, series_place.edition,
    jsonb_build_object('line', l, 'number', series_place.number, 'shown', series_place.shown));
end;
$$;
revoke all on function private.series_place(uuid, uuid, integer, text, uuid)
  from public, anon, authenticated;

-- Takes an edition out of a series, by hand: the rules never put it back.
create function private.series_take_out(edition uuid, series uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s uuid := private.series_now(series_take_out.series);
begin
  perform pg_advisory_xact_lock(hashtext('booktown.series'));
  delete from public.series_volumes v
  where v.edition_id = series_take_out.edition and v.series_id = s;
  insert into private.series_kept_out (series_id, edition_id)
  values (s, series_take_out.edition) on conflict do nothing;
  insert into private.series_decisions (op, series_id, edition_id)
  values ('take_out', s, series_take_out.edition);
end;
$$;
revoke all on function private.series_take_out(uuid, uuid) from public, anon, authenticated;

-- Joins two series, by hand: the lines and volumes of the one that goes
-- move to the one that stays, as the person's, and it points there. An
-- edition in both keeps its place in the one that stays.
create function private.series_join(stays uuid, goes uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s uuid := private.series_now(series_join.stays);
  g uuid := private.series_now(series_join.goes);
begin
  if s = g then
    raise exception 'series_join: the same series';
  end if;
  perform pg_advisory_xact_lock(hashtext('booktown.series'));
  -- An edition in both keeps its place in the one that stays; one a
  -- person took out of the one that stays stays out.
  delete from public.series_volumes v
  where v.series_id = g
    and (exists (select 1 from public.series_volumes o
        where o.series_id = s and o.edition_id = v.edition_id)
      or exists (select 1 from private.series_kept_out k
        where k.series_id = s and k.edition_id = v.edition_id));
  update public.series_volumes v set decided = 'human', run_id = null, decided_at = now()
  where v.series_id = g;
  -- The lines take their volumes along (on update cascade).
  update public.series_lines l set series_id = s where l.series_id = g;
  insert into private.series_kept_out (series_id, edition_id, decided_at)
  select s, k.edition_id, k.decided_at from private.series_kept_out k where k.series_id = g
  on conflict do nothing;
  update public.series x set merged_into = s where x.id = g;
  insert into private.series_decisions (op, series_id, detail)
  values ('join', s, jsonb_build_object('gone', g));
end;
$$;
revoke all on function private.series_join(uuid, uuid) from public, anon, authenticated;

create function private.series_name(series uuid, name text, name_reading text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.series x set name = series_name.name, name_reading = series_name.name_reading
  where x.id = private.series_now(series_name.series);
  insert into private.series_decisions (op, series_id)
  values ('name', private.series_now(series_name.series));
end;
$$;
revoke all on function private.series_name(uuid, text, text) from public, anon, authenticated;

create function private.series_line_name(line uuid, name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s uuid;
begin
  update public.series_lines l set name = series_line_name.name
  where l.id = series_line_name.line returning l.series_id into s;
  insert into private.series_decisions (op, series_id, detail)
  values ('line_name', s, jsonb_build_object('line', series_line_name.line));
end;
$$;
revoke all on function private.series_line_name(uuid, text) from public, anon, authenticated;

-- Whether the series is done, as the operator says (the bibliography never
-- does).
create function private.series_finish(series uuid, done boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.series x set finished_at = case when series_finish.done then now() end
  where x.id = private.series_now(series_finish.series);
  insert into private.series_decisions (op, series_id, detail)
  values ('finish', private.series_now(series_finish.series),
    jsonb_build_object('done', series_finish.done));
end;
$$;
revoke all on function private.series_finish(uuid, boolean) from public, anon, authenticated;

-- What may be a series and is not plain, for the operator to decide:
--   unclear  the same title and people, with two editions or more, some
--            the rules leave out (another publisher, label or edition words:
--            愛蔵版, 文庫; a number twice; 上下 with numbers; years with
--            numbers)
--   volume   an edition of such a title whose volume is not plainly one
--            (続, 別巻1, 1-2)
--   people   the same title and publisher with volumes, people differing
--            (a translator on one volume), or nobody named
--   label    one person's books under one library series, with different
--            titles (ハリー・ポッター型), a label used by nobody else
-- Editions a person placed are left out.
create function private.series_candidates() returns table (reason text,
  editions uuid[], titles text[])
language sql stable security definer set search_path = '' as $$
  with seen as (
    select k.*,
      exists (select 1 from public.series_volumes v
        where v.edition_id = k.edition_id and v.decided = 'human') as placed,
      exists (select 1 from public.series_volumes v where v.edition_id = k.edition_id)
        as in_series
    from private.series_keys k
  ), free as (
    select * from seen where not placed
  ), c_unclear as (
    select 'unclear'::text as reason, array_agg(o.edition_id order by o.number, o.edition_id) as editions,
      array_agg(o.title order by o.number, o.edition_id) as titles
    from free o
    where o.kind is not null and o.people <> ''
    group by o.family_key
    having count(*) >= 2 and not bool_and(o.in_series)
      and (count(distinct o.group_key) > 1
        or count(distinct o.number) < count(*)
        or count(distinct o.kind) > 1
        or (bool_or(o.shown in ('上', '中', '下'))
          and bool_or(o.shown not in ('上', '中', '下'))))
  ), c_volume as (
    select 'volume', array_agg(o.edition_id order by o.edition_id), array_agg(o.title order by o.edition_id)
    from free o
    where o.kind is null and o.people <> ''
      and exists (select 1 from seen s where s.family_key = o.family_key and s.kind is not null)
    group by o.family_key
  ), c_people as (
    select 'people', array_agg(o.edition_id order by o.number, o.edition_id),
      array_agg(o.title order by o.number, o.edition_id)
    from free o
    where o.kind is not null
    group by o.title_key, o.publisher_key
    having count(distinct o.people) > 1 or (count(*) >= 2 and bool_or(o.people = ''))
  ), c_label as (
    select 'label', array_agg(o.edition_id order by o.title_key, o.edition_id),
      array_agg(o.title order by o.title_key, o.edition_id)
    from free o
    where o.label_key <> '' and o.people <> '' and not o.in_series
      and not exists (select 1 from seen s where s.label_key = o.label_key and s.people <> o.people)
    group by o.label_key
    having count(distinct o.title_key) >= 2
  )
  select * from c_unclear
  union all select * from c_volume
  union all select * from c_people
  union all select * from c_label
$$;
revoke all on function private.series_candidates() from public, anon, authenticated;

-- What anyone reads ------------------------------------------------------------------

-- The series an ISBN's edition is in, with each line and each volume known
-- of it: editions anyone may read (a catalog row) only, and their catalog
-- row to open and register. The volumes known are only those known so far
-- (finished: the operator said it is done). Nothing about who has which.
create function public.series_for_isbn(isbn text) returns table (series_id uuid,
  series_name text, series_reading text, kind text, finished boolean, line_id uuid,
  line_name text, line_label text, number integer, shown text, volume_isbn text,
  book_id uuid, title text)
language sql stable security definer set search_path = '' as $$
  with mine as (
    select distinct private.series_now(v.series_id) as s
    from public.editions e
    join public.series_volumes v on v.edition_id = e.id
    where e.isbn = private.isbn13(series_for_isbn.isbn)
      and exists (select 1 from public.books b where b.edition_id = e.id and b.source = 'ndl')
    limit 20
  )
  select x.id, x.name, x.name_reading, x.kind, x.finished_at is not null, l.id, l.name, l.label,
    v.number, v.shown, e.isbn, b.id, b.title
  from mine m
  join public.series x on x.id = m.s
  join public.series_volumes v on v.series_id = x.id
  join public.series_lines l on l.id = v.line_id
  join public.editions e on e.id = v.edition_id
  cross join lateral (
    select k.id, k.title from public.books k
    where k.edition_id = e.id and k.source = 'ndl' order by k.created_at, k.id limit 1) b
  order by x.id, l.created_at, l.id, v.number, e.isbn
  limit 2000
$$;
revoke all on function public.series_for_isbn(text) from public, anon, authenticated;
grant execute on function public.series_for_isbn(text) to anon, authenticated;

-- The first full run, planned and not applied: read and shown first.
select private.series_plan('full');
