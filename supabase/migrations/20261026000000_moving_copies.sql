-- Copies taken before a migration moves existing data (item 3 of the
-- 2026-10-16 plan), so that a move found wrong later can be undone.
--
-- A migration that changes rows people already have (not one that only adds
-- tables or columns) does, in one file:
--
--   select private.keep_copy('20261101000000_works',
--     array['public.books', 'public.posts']::regclass[]);
--   ... the move ...
--   select private.check_copy('20261101000000_works');
--
-- keep_copy copies each table into the keep schema as it is now and holds
-- writes to it until the migration ends. check_copy compares the tables with
-- their copies and raises when a row or a link the copy had is gone, which
-- rolls back the whole file: production stays as it was. A file runs as one
-- transaction (supabase db push sends it as one batch) unless it holds a
-- statement that cannot, such as create index concurrently; pnpm test:db
-- refuses those next to keep_copy.
--
-- The copies never leave the database: no row goes to the repository or to
-- GitHub Actions, and nobody reaches the keep schema through the API. An
-- account deleted while a copy is kept leaves no row naming it there
-- (forget_in_copies). Undoing a move is a new migration that calls
-- restore_copy; dropping the copies once production is checked is another
-- that calls drop_copy. docs/09「移す工事の前の控えと戻す手順」has the steps.
--
-- Rollback: nothing reads these until a migration calls them. A new
-- migration undoes this one with
--   drop trigger forget_in_copies on auth.users;
--   drop function private.forget_in_copies(), private.keep_copy(text, regclass[]),
--     private.check_copy(text, regclass[], regclass[]), private.restore_copy(text, regclass[], boolean),
--     private.drop_copy(text), private.copy_columns(regclass, text),
--     private.copy_key(regclass), private.copy_owners(regclass, text, integer);
--   drop schema keep cascade;

create schema keep;
revoke all on schema keep from public, anon, authenticated;
comment on schema keep is
  'Copies taken before a migration moves data. Not exposed through the API; see 20261026000000_moving_copies.sql.';

-- One row a copied table.
create table keep.copies (
  -- The migration that took it: its version and name, as in the file name.
  label text not null check (label ~ '^[0-9]{14}_[a-z0-9_]+$'),
  -- The table copied, schema-qualified (public.books).
  source text not null,
  -- The copy's table name in keep.
  copy_name text not null unique,
  taken_at timestamptz not null default now(),
  row_count bigint not null,
  -- Columns that pointed at a person and become null (rather than the row
  -- going) when that person's account is deleted, as on the source table.
  forget_columns text[] not null default '{}',
  -- Columns that were part of a foreign key when the copy was taken: the
  -- links check_copy counts.
  link_columns text[] not null default '{}',
  -- What check_copy found: rows and links lost, rows after.
  checked jsonb,
  primary key (label, source)
);
alter table keep.copies enable row level security;
revoke all on keep.copies from public, anon, authenticated;
-- Supabase's own API role is kept out as well (only it has the role).
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke all on schema keep from service_role;
    revoke all on keep.copies from service_role;
  end if;
end;
$$;

-- The columns a copy can give back to its source: those both have, minus the
-- ones the database computes (generated). In column order of the source.
create function private.copy_columns(source regclass, copy_name text) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(a.attname::text order by a.attnum), '{}')
  from pg_catalog.pg_attribute a
  where a.attrelid = source
    and a.attnum > 0
    and not a.attisdropped
    and a.attgenerated = ''
    and exists (
      select 1 from pg_catalog.pg_attribute c
      where c.attrelid = format('keep.%I', copy_name)::regclass
        and c.attname = a.attname
        and c.attnum > 0
        and not c.attisdropped
    )
$$;
revoke all on function private.copy_columns(regclass, text) from public, anon, authenticated;

-- The primary key columns of a table, in key order.
create function private.copy_key(source regclass) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_agg(a.attname::text order by k.ord)
  from pg_catalog.pg_constraint c
  cross join lateral unnest(c.conkey) with ordinality as k (attnum, ord)
  join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.conrelid = source and c.contype = 'p'
$$;
revoke all on function private.copy_key(regclass) from public, anon, authenticated;

-- An expression for the people a row of source goes with when their account
-- is deleted: its own cascading links to a person, and through each other
-- cascading link, the people of the row it points at (a reply goes with the
-- post's writer, a shop's private shelves with the shop's owner). alias is
-- the row's name in the query; depth bounds the way up. A chain longer than
-- that is refused, so no row outlives its person in a copy unnoticed, except
-- a table pointing at itself (a reply to a reply), which stops at the bound.
create function private.copy_owners(source regclass, alias text, depth integer)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  parts text[] := '{}';
  fk record;
  up text := 'owner_' || depth;
begin
  for fk in
    select f.confrelid::regclass as parent,
      array(select a.attname::text from unnest(f.conkey) with ordinality k (n, o)
        join pg_catalog.pg_attribute a on a.attrelid = f.conrelid and a.attnum = k.n
        order by k.o) as child_cols,
      array(select a.attname::text from unnest(f.confkey) with ordinality k (n, o)
        join pg_catalog.pg_attribute a on a.attrelid = f.confrelid and a.attnum = k.n
        order by k.o) as parent_cols
    from pg_catalog.pg_constraint f
    where f.conrelid = source and f.contype = 'f' and f.confdeltype = 'c'
    order by f.conname
  loop
    if fk.parent in ('auth.users'::regclass, 'public.profiles'::regclass) then
      parts := parts || format('array[%I.%I]', alias, fk.child_cols[1]);
    elsif depth = 0 then
      if fk.parent <> source then
        raise exception 'too many links up to a person' using errcode = 'KP001';
      end if;
    else
      parts := parts || format('coalesce((select %s from %s %I where %s), ''{}'')',
        private.copy_owners(fk.parent, up, depth - 1), fk.parent, up,
        (select string_agg(format('%I.%I = %I.%I', up, fk.parent_cols[j], alias, fk.child_cols[j]), ' and ')
         from generate_subscripts(fk.child_cols, 1) j));
    end if;
  end loop;
  if cardinality(parts) = 0 then
    return '''{}''::uuid[]';
  end if;
  return '(' || array_to_string(parts, ' || ') || ')::uuid[]';
end;
$$;
revoke all on function private.copy_owners(regclass, text, integer) from public, anon, authenticated;

create function private.keep_copy(label text, tables regclass[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  source regclass;
  name text;
  copied bigint;
  forget text[];
  links text[];
  api text;
  waited text;
  owners text;
begin
  if label !~ '^[0-9]{14}_[a-z0-9_]+$' then
    raise exception 'name a copy after its migration, like 20261101000000_works';
  end if;
  foreach source in array tables loop
    if private.copy_key(source) is null then
      raise exception '% has no primary key, so its copy could not be put back', source;
    end if;
  end loop;
  -- Nobody writes to them until the migration ends, so the copies, the move
  -- and the check all see the same rows. Reading goes on. All at once, and
  -- not waiting long, so a reader's write in between cannot deadlock it.
  waited := current_setting('lock_timeout');
  perform set_config('lock_timeout', '10s', true);
  execute format('lock table %s in exclusive mode',
    (select string_agg(t::text, ', ') from unnest(tables) t));
  perform set_config('lock_timeout', waited, true);
  foreach source in array tables loop
    name := left(left(label, 14) || '_' || replace(source::text, '.', '_'), 63);
    -- keep_owners: who the row goes with (forget_in_copies).
    begin
      owners := private.copy_owners(source, 't', 5);
    exception when sqlstate 'KP001' then
      raise exception '% goes with its person through more links than a copy follows', source;
    end;
    execute format('create table keep.%I as select t.*, %s as keep_owners from %s t',
      name, owners, source);
    get diagnostics copied = row_count;
    execute format('create index on keep.%I using gin (keep_owners)', name);
    execute format('alter table keep.%I enable row level security', name);
    execute format('revoke all on table keep.%I from public', name);
    for api in
      select rolname from pg_catalog.pg_roles
      where rolname in ('anon', 'authenticated', 'service_role')
    loop
      execute format('revoke all on table keep.%I from %I', name, api);
    end loop;
    select coalesce(array_agg(a.attname::text order by a.attnum), '{}')
      into forget
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = source
      and c.contype = 'f'
      and c.confdeltype = 'n'
      and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass);
    select coalesce(array_agg(distinct a.attname::text), '{}') into links
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = source and c.contype = 'f';
    insert into keep.copies (label, source, copy_name, row_count, forget_columns, link_columns)
    values (label, source::text, name, copied, forget, links);
  end loop;
end;
$$;
revoke all on function private.keep_copy(text, regclass[]) from public, anon, authenticated;

-- Compares each table copied under label with its copy. A row is lost when
-- its primary key is gone; a link is lost when a column that is part of a
-- foreign key was set in the copy and is null (or gone) now. A move that
-- means to lose some names the tables: links_may_go (say, a column dropped
-- once its links live elsewhere) and rows_may_go (rows merged away). Those
-- are measured and recorded, not refused.
create function private.check_copy(
  label text,
  links_may_go regclass[] default '{}',
  rows_may_go regclass[] default '{}'
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  copy record;
  source regclass;
  key text[];
  match text;
  rows_after bigint;
  lost_rows bigint;
  lost_links bigint;
  link record;
  lost bigint;
  failed text[] := '{}';
begin
  if not exists (select 1 from keep.copies c where c.label = check_copy.label) then
    raise exception 'no copy is kept under %', label;
  end if;
  for copy in
    select * from keep.copies c where c.label = check_copy.label order by c.source
  loop
    source := to_regclass(copy.source);
    if source is null then
      failed := failed || (copy.source || ': the table is gone');
      continue;
    end if;
    key := private.copy_key(source);
    if key is null then
      failed := failed || (copy.source || ': its primary key is gone, so its rows cannot be matched');
      continue;
    end if;
    select string_agg(format('l.%1$I = c.%1$I', k), ' and ')
      into match from unnest(key) k;
    execute format('select count(*) from %s', source) into rows_after;
    execute format(
      'select count(*) from keep.%I c where not exists (select 1 from %s l where %s)',
      copy.copy_name, source, match
    ) into lost_rows;
    lost_links := 0;
    -- Every column that was part of a foreign key when the copy was taken,
    -- and whether the source still has it.
    for link in
      select l.name,
        exists (
          select 1 from pg_catalog.pg_attribute a
          where a.attrelid = source and a.attname = l.name
            and a.attnum > 0 and not a.attisdropped
        ) as kept
      from unnest(copy.link_columns) l (name)
    loop
      if link.kept then
        execute format(
          'select count(*) from keep.%1$I c join %2$s l on %3$s
           where c.%4$I is not null and l.%4$I is null',
          copy.copy_name, source, match, link.name
        ) into lost;
      else
        execute format('select count(*) from keep.%I c where c.%I is not null',
          copy.copy_name, link.name) into lost;
      end if;
      lost_links := lost_links + lost;
    end loop;
    update keep.copies c
    set checked = jsonb_build_object(
      'at', now(), 'rows_before', copy.row_count, 'rows_after', rows_after,
      'lost_rows', lost_rows, 'lost_links', lost_links)
    where c.label = copy.label and c.source = copy.source;
    if (lost_rows > 0 and not source = any (rows_may_go))
       or (lost_links > 0 and not source = any (links_may_go)) then
      failed := failed || format('%s: %s rows and %s links lost', copy.source, lost_rows, lost_links);
    end if;
  end loop;
  if cardinality(failed) > 0 then
    -- Counts and table names only: the message lands in public Actions logs.
    raise exception 'the move lost what the copy kept: %', array_to_string(failed, '; ');
  end if;
end;
$$;
revoke all on function private.check_copy(text, regclass[], regclass[]) from public, anon, authenticated;

-- Puts the rows of copies back: each row the copy has is written again as it
-- was (inserted if gone, overwritten if changed). Rows added since stay,
-- unless drop_newer, which deletes them first (and what cascades from them).
-- Tables run parents first. The tables' own triggers are off meanwhile, so
-- nothing is stamped or recounted; copy the tables they keep up as well.
-- A row whose parent is gone since (an account deleted, say) is left out,
-- or loses just the link when the foreign key would set it null. Rows go back
-- one by one, so a move that swapped unique values between two rows needs
-- the undoing migration to clear them first. Triggers that were off stay off.
create function private.restore_copy(
  label text,
  tables regclass[] default null,
  drop_newer boolean default false
) returns table (source text, restored bigint, skipped bigint, removed bigint)
language plpgsql security definer set search_path = '' as $$
declare
  chosen text[];
  ordered text[] := '{}';
  pending text[];
  progressed boolean;
  name text;
  copy record;
  live regclass;
  cols text[];
  key text[];
  exprs text[];
  conds text[];
  fk record;
  cond text;
  sets text;
  n bigint;
  total bigint;
  gone jsonb := '{}';
  idle text[];
begin
  select array_agg(c.source order by c.source) into chosen
  from keep.copies c
  where c.label = restore_copy.label
    and (tables is null or to_regclass(c.source) = any (tables));
  if chosen is null then
    raise exception 'no copy is kept under % for those tables', label;
  end if;
  if tables is not null and cardinality(chosen) < cardinality(tables) then
    raise exception 'some of those tables have no copy under %', label;
  end if;
  -- Parents before children, among the tables chosen.
  pending := chosen;
  while cardinality(pending) > 0 loop
    progressed := false;
    foreach name in array pending loop
      if not exists (
        select 1 from pg_catalog.pg_constraint f
        where f.conrelid = to_regclass(name) and f.contype = 'f'
          and f.confrelid <> f.conrelid
          and f.confrelid::regclass::text = any (pending)
      ) then
        ordered := ordered || name;
        pending := array_remove(pending, name);
        progressed := true;
      end if;
    end loop;
    if not progressed then
      raise exception 'the tables % point at each other; restore them one at a time', pending;
    end if;
  end loop;

  foreach name in array ordered loop
    live := to_regclass(name);
    if live is null then
      raise exception '% is gone; make it again before restoring it', name;
    end if;
    -- Triggers someone switched off stay off afterwards.
    idle := idle || array(
      select format('%s %I', live, t.tgname) from pg_catalog.pg_trigger t
      where t.tgrelid = live and not t.tgisinternal and t.tgenabled = 'D');
    execute format('alter table %s disable trigger user', live);
  end loop;

  if drop_newer then
    -- Children first, so a parent's cascade finds nothing left of them.
    for i in reverse cardinality(ordered)..1 loop
      select * into copy from keep.copies c
      where c.label = restore_copy.label and c.source = ordered[i];
      live := to_regclass(copy.source);
      key := private.copy_key(live);
      begin
        execute format(
          'delete from %s l where not exists (select 1 from keep.%I c where %s)',
          live, copy.copy_name,
          (select string_agg(format('l.%1$I = c.%1$I', k), ' and ') from unnest(key) k)
        );
      exception when others then
        -- Postgres's own message can quote a row; Actions logs are public.
        raise exception 'rows added since the copy of % could not be removed (%)',
          copy.source, sqlstate;
      end;
      get diagnostics n = row_count;
      gone := gone || jsonb_build_object(copy.source, n);
    end loop;
  end if;

  foreach name in array ordered loop
    select * into copy from keep.copies c
    where c.label = restore_copy.label and c.source = name;
    live := to_regclass(copy.source);
    cols := private.copy_columns(live, copy.copy_name);
    key := private.copy_key(live);
    if not key <@ cols then
      raise exception 'the copy of % lacks part of its primary key', name;
    end if;
    select array_agg(format('c.%I', col) order by ord) into exprs
    from unnest(cols) with ordinality as x (col, ord);
    -- The rows to write back, narrowed below until every link they keep
    -- points at a row that is there or is coming back.
    if to_regclass('pg_temp.restore_rows') is not null then
      drop table pg_temp.restore_rows;
    end if;
    execute format('create temp table restore_rows on commit drop as table keep.%I',
      copy.copy_name);
    get diagnostics total = row_count;
    conds := '{}';
    for fk in
      select f.confrelid::regclass as parent, f.confdeltype as on_delete,
        -- on delete set null (a, b) clears only those columns (Postgres 15).
        array(select a.attname::text from unnest(coalesce(f.confdelsetcols, f.conkey)) k (n)
          join pg_catalog.pg_attribute a on a.attrelid = f.conrelid and a.attnum = k.n)
          as cleared,
        f.conrelid = f.confrelid as self,
        array(select a.attname::text from unnest(f.conkey) with ordinality k (n, o)
          join pg_catalog.pg_attribute a on a.attrelid = f.conrelid and a.attnum = k.n
          order by k.o) as child_cols,
        array(select a.attname::text from unnest(f.confkey) with ordinality k (n, o)
          join pg_catalog.pg_attribute a on a.attrelid = f.confrelid and a.attnum = k.n
          order by k.o) as parent_cols
      from pg_catalog.pg_constraint f
      where f.conrelid = live and f.contype = 'f'
    loop
      if not fk.child_cols <@ cols then
        continue;
      end if;
      -- MATCH SIMPLE: a link with a null part points at nothing.
      cond := format('(%s or exists (select 1 from %s p where %s)',
        (select string_agg(format('c.%I is null', c), ' or ') from unnest(fk.child_cols) c),
        fk.parent,
        (select string_agg(format('p.%I = c.%I', fk.parent_cols[j], fk.child_cols[j]), ' and ')
         from generate_subscripts(fk.child_cols, 1) j));
      if fk.self then
        cond := cond || format(' or exists (select 1 from pg_temp.restore_rows p where %s)',
          (select string_agg(format('p.%I = c.%I', fk.parent_cols[j], fk.child_cols[j]), ' and ')
           from generate_subscripts(fk.child_cols, 1) j));
      end if;
      cond := cond || ')';
      if fk.on_delete = 'n' then
        for i in 1..cardinality(cols) loop
          if cols[i] = any (fk.cleared) then
            exprs[i] := format('case when %s then %s end', cond, exprs[i]);
          end if;
        end loop;
      else
        conds := conds || cond;
      end if;
    end loop;
    -- A row left out can take out a row that points at it in the same table
    -- (a reply to a post left out), so narrow until nothing more goes.
    if cardinality(conds) > 0 then
      loop
        execute format('delete from pg_temp.restore_rows c where not (%s)',
          array_to_string(conds, ' and '));
        get diagnostics n = row_count;
        exit when n = 0;
      end loop;
    end if;
    select string_agg(format('%1$I = excluded.%1$I', col), ', ') into sets
    from unnest(cols) col where not col = any (key);
    begin
      execute format(
        'insert into %s (%s) select %s from pg_temp.restore_rows c on conflict (%s) do %s',
        live,
        (select string_agg(format('%I', col), ', ') from unnest(cols) col),
        array_to_string(exprs, ', '),
        (select string_agg(format('%I', k), ', ') from unnest(key) k),
        case when sets is null then 'nothing' else 'update set ' || sets end
      );
      get diagnostics n = row_count;
    exception when others then
      -- A unique or check violation names the row in its detail; say only
      -- which table, since the message lands in public Actions logs.
      raise exception 'the copy of % could not be put back (%)', name, sqlstate;
    end;
    drop table pg_temp.restore_rows;
    source := name;
    restored := n;
    skipped := total - n;
    removed := (gone ->> name)::bigint;
    return next;
  end loop;

  foreach name in array ordered loop
    execute format('alter table %s enable trigger user', to_regclass(name));
  end loop;
  for i in 1..coalesce(cardinality(idle), 0) loop
    execute format('alter table %s disable trigger %s', split_part(idle[i], ' ', 1),
      substr(idle[i], length(split_part(idle[i], ' ', 1)) + 2));
  end loop;
end;
$$;
revoke all on function private.restore_copy(text, regclass[], boolean) from public, anon, authenticated;

create function private.drop_copy(label text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  name text;
begin
  if not exists (select 1 from keep.copies c where c.label = drop_copy.label) then
    raise exception 'no copy is kept under %', label;
  end if;
  for name in select c.copy_name from keep.copies c where c.label = drop_copy.label loop
    execute format('drop table keep.%I', name);
  end loop;
  delete from keep.copies c where c.label = drop_copy.label;
end;
$$;
revoke all on function private.drop_copy(text) from public, anon, authenticated;

-- An account deleted takes its rows out of every copy too, as the cascades
-- take them out of the tables: each row that goes with the person
-- (keep_owners, worked out when the copy was taken) goes, and a column that
-- the source would only clear (a set-null link to them) becomes null. What
-- the tables keep on purpose (a report about them, for the operator) stays.
create function private.forget_in_copies() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  copy record;
  col text;
begin
  for copy in select c.copy_name, c.forget_columns from keep.copies c loop
    -- A copy dropped by hand must not stop accounts from being deleted.
    if to_regclass(format('keep.%I', copy.copy_name)) is null then
      continue;
    end if;
    foreach col in array copy.forget_columns loop
      execute format('update keep.%1$I set %2$I = null where %2$I = $1', copy.copy_name, col)
        using old.id;
    end loop;
    execute format('delete from keep.%I where $1 = any (keep_owners)', copy.copy_name)
      using old.id;
  end loop;
  return null;
end;
$$;
revoke all on function private.forget_in_copies() from public, anon, authenticated;
create trigger forget_in_copies after delete on auth.users
  for each row execute function private.forget_in_copies();
