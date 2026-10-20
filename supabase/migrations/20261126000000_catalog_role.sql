-- The library catalog's own role (docs/09「本番の設定」). The nightly import
-- (scripts/catalog-import.ts) logs in as the database's owner today. It is
-- to log in as catalog_import instead, which can do what the import does and
-- nothing else: take catalog rows (up to the cap, private.catalog_settings),
-- take out rows the library deleted that no reader uses, and read and write
-- how far each way of taking has come.
--
-- The role reaches that through the schema catalog_api only: four functions,
-- each running as its owner and calling the private function the importer
-- calls now, with a bound on what one call may send. The role is given the
-- use of catalog_api and the running of those four, and nothing in private:
-- an older private function may still be runnable by PUBLIC, and a role
-- without the use of the schema cannot reach it. Nobody else may use
-- catalog_api or run its functions: PUBLIC, anon, authenticated and
-- service_role are refused here, in the same file that makes them, so there
-- is no moment they are open.
--
-- A function added to catalog_api later starts closed too, but not because
-- of anything in this file: a schema's default privileges can only add to
-- the database-wide ones, never take away from them, so a
-- "revoke ... in schema catalog_api" would do nothing. What holds is the
-- database-wide default of the role that makes the functions (postgres),
-- set in 20261020000000_privacy_locks.sql: no one runs a new function until
-- it is granted. tests/db-catalog-role.test.ts makes a function in
-- catalog_api and checks that no one can run it. Each function added here
-- still revokes and grants in its own file, with its own test.
--
-- The role is made without a login and without a password, which a public
-- repository cannot hold. Its password is given later, once, by a run of
-- GitHub Actions that the owner approves; until then nothing can log in as it
-- and nothing changes for the import, which goes on as the owner.
--
-- Nothing is moved: no row of any table changes.
--
-- Rollback: a new migration with
--   drop schema catalog_api cascade;
--   drop role catalog_import;
-- No row goes with them. pnpm test:db runs exactly that.

create role catalog_import nologin noinherit nocreatedb nocreaterole nobypassrls;

create schema catalog_api;
revoke all on schema catalog_api from public, anon, authenticated, service_role;
grant usage on schema catalog_api to catalog_import;

-- Catalog rows, a thousand at most at a time (scripts/catalog-import.ts
-- sends a thousand): private.catalog_take.
create function catalog_api.take(given jsonb, batch text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(given) is distinct from 'array' or jsonb_array_length(given) > 1000 then
    raise exception 'send an array of at most 1000 rows' using errcode = '22023';
  end if;
  return private.catalog_take(given, batch);
end;
$$;
revoke all on function catalog_api.take(jsonb, text) from public, anon, authenticated, service_role;
grant execute on function catalog_api.take(jsonb, text) to catalog_import;

-- The library's deleted records, a thousand at most at a time: their rows no
-- reader uses go (private.catalog_gone).
create function catalog_api.gone(records text[]) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if records is null or cardinality(records) > 1000 then
    raise exception 'send at most 1000 records' using errcode = '22023';
  end if;
  return private.catalog_gone(records);
end;
$$;
revoke all on function catalog_api.gone(text[]) from public, anon, authenticated, service_role;
grant execute on function catalog_api.gone(text[]) to catalog_import;

-- How far a way of taking has come (private.catalog_progress).
create function catalog_api.mark(name text) returns text
language sql stable security definer set search_path = '' as $$
  select p.mark from private.catalog_progress p where p.name = mark.name
$$;
revoke all on function catalog_api.mark(text) from public, anon, authenticated, service_role;
grant execute on function catalog_api.mark(text) to catalog_import;

create function catalog_api.set_mark(name text, mark text) returns void
language sql security definer set search_path = '' as $$
  insert into private.catalog_progress (name, mark) values (set_mark.name, set_mark.mark)
  on conflict on constraint catalog_progress_pkey
  do update set mark = excluded.mark, updated_at = now()
$$;
revoke all on function catalog_api.set_mark(text, text) from public, anon, authenticated, service_role;
grant execute on function catalog_api.set_mark(text, text) to catalog_import;
