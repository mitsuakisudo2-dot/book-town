import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

// pg_net and pg_cron, as far as the bibliographic master uses them. A
// question is written down in net.http_request_queue, and a test puts its
// answer in net._http_response as pg_net would; a schedule is a row.
export const EXTENSIONS_STANDIN = `
  create schema net;
  create table net.http_request_queue (
    id bigserial primary key,
    method text not null,
    url text not null,
    headers jsonb,
    timeout_milliseconds integer
  );
  create table net._http_response (
    id bigint primary key,
    status_code integer,
    content_type text,
    headers jsonb,
    content text,
    timed_out boolean,
    error_msg text,
    created timestamptz not null default now()
  );
  create function net.http_get(url text, params jsonb default '{}',
      headers jsonb default '{}', timeout_milliseconds integer default 5000)
  returns bigint language sql as $$
    insert into net.http_request_queue (method, url, headers, timeout_milliseconds)
    values ('GET', url, headers, timeout_milliseconds)
    returning id
  $$;
  create schema cron;
  create table cron.job (
    jobid bigserial primary key,
    jobname text unique,
    schedule text not null,
    command text not null
  );
  create table cron.job_run_details (runid bigserial primary key, end_time timestamptz);
  create function cron.schedule(job_name text, schedule text, command text)
  returns bigint language sql as $$
    insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
    returning jobid
  $$;
  create function cron.unschedule(job_name text) returns boolean language sql as $$
    with gone as (delete from cron.job where jobname = job_name returning 1)
    select exists (select 1 from gone)
  $$;
`;

// The parts of Supabase the migrations rely on: its roles, auth.users and
// auth.uid(), as tests/database-policies.test.ts sets them up.
export const SUPABASE_STANDIN = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;

${EXTENSIONS_STANDIN}`;

export const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export function migrationText(file: string): string {
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

/**
 * Gives each statement a moment of its own, as production's clock does.
 * PGlite reads the time in milliseconds (production, in microseconds), so two
 * statements run one after the other can read the same now(), and an order
 * the time decides (which edition is asked about first) falls to something
 * else, such as a random id. Each query and exec waits until the clock has
 * moved on from the end of the one before.
 */
export function oneMomentEach(db: PGlite): PGlite {
  let last = 0;
  const after =
    <A extends unknown[], R>(run: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      while (Date.now() <= last) {
        // the clock moves on
      }
      try {
        return await run(...args);
      } finally {
        last = Date.now();
      }
    };
  db.query = after(db.query.bind(db)) as typeof db.query;
  db.exec = after(db.exec.bind(db)) as typeof db.exec;
  return db;
}

/** A fresh database with every migration applied, each file as one batch. */
export async function migratedDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of migrationFiles()) await db.exec(migrationText(file));
  return db;
}

/**
 * Deletes accounts the way Supabase does: as supabase_auth_admin, who owns
 * auth.users and has no rights in public.
 */
export async function deleteAccounts(db: PGlite, ids: string[]) {
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
        create role supabase_auth_admin nologin;
      end if;
    end $$;
    alter schema auth owner to supabase_auth_admin;
    alter table auth.users owner to supabase_auth_admin;
    set role supabase_auth_admin;
  `);
  try {
    await db.query("delete from auth.users where id = any($1::uuid[])", [ids]);
  } finally {
    await db.exec("reset role");
  }
}

/**
 * The database keeps days and weeks in Japan time (now() at time zone
 * 'Asia/Tokyo'): the same screen error on a day is one row, and a shop's
 * visitors are counted for last week, Monday to Sunday. A check that writes
 * and then reads the same day or week fails if Japan's midnight falls in
 * between, as it did when CI ran at 00:00 in Japan. Such a check calls this
 * first: near midnight, it waits until the new day has begun.
 */
export async function clearOfJapanMidnight(seconds = 120) {
  const DAY = 86_400_000;
  const left = DAY - ((Date.now() + 9 * 3_600_000) % DAY);
  if (left <= seconds * 1000)
    await new Promise((resolve) => setTimeout(resolve, left + 1000));
}
