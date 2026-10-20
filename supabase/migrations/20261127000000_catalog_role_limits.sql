-- The library catalog's role, narrowed before it is given a password
-- (AUD-166; 20261126000000_catalog_role.sql).
--
--   * catalog_api.take takes only the batches the import sends: 'trial',
--     'oai' and the month's files ('files-' and the file list's date).
--     'registered' is the batch of the rows made from readers' books
--     (private.catalog_promote); those are not counted against the cap, so
--     the import's role is not to make them.
--   * catalog_import may hold two connections at most (the import uses one;
--     the role cannot change this). A statement of its runs five minutes at
--     most and a transaction left open stops after a minute by default: the
--     role can set these itself, so they stop accidents, not the role.
--
-- What the role can reach beyond what every role reaches (PUBLIC's grants,
-- some of them Supabase's own, which a migration cannot take back) is
-- counted by tests/db-catalog-role.test.ts against a role given nothing.
--
-- Nothing is moved: no row of any table changes.
--
-- Rollback: a new migration with
--   alter role catalog_import connection limit -1;
--   alter role catalog_import reset statement_timeout;
--   alter role catalog_import reset idle_in_transaction_session_timeout;
-- and catalog_api.take(jsonb, text) made again as
-- 20261126000000_catalog_role.sql has it, with its revoke and grant.

create or replace function catalog_api.take(given jsonb, batch text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(given) is distinct from 'array' or jsonb_array_length(given) > 1000 then
    raise exception 'send an array of at most 1000 rows' using errcode = '22023';
  end if;
  if batch is null or batch !~ '^(trial|oai|files-[0-9]{8})$' then
    raise exception 'a batch is trial, oai or files- and a date' using errcode = '22023';
  end if;
  return private.catalog_take(given, batch);
end;
$$;
revoke all on function catalog_api.take(jsonb, text) from public, anon, authenticated, service_role;
grant execute on function catalog_api.take(jsonb, text) to catalog_import;

alter role catalog_import connection limit 2;
alter role catalog_import set statement_timeout = '5min';
alter role catalog_import set idle_in_transaction_session_timeout = '1min';
