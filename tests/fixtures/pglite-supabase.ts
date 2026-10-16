import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

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
`;

export const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export function migrationText(file: string): string {
  return readFileSync(join(MIGRATIONS, file), "utf8");
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
