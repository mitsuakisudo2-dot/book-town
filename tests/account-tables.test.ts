import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import {
  ACCOUNT_SCHEMAS_SQL,
  ACCOUNT_TABLES,
  type AccountTable,
} from "./fixtures/account-tables";
import { migratedDatabase } from "./fixtures/pglite-supabase";

// Holds every table the migrations make to tests/fixtures/account-tables.ts:
// what deleting an account does to it, and whether a block hides its rows.
// A table added without a line there, or with a link to a person that would
// outlive them, stops here (item 2 of the 2026-10-16 plan).

const PEOPLE = ["auth.users", "profiles", "public.profiles"];
const qualified = (name: string) =>
  name.includes(".") ? name : "public." + name;

/** What is wrong between the database and the list, one line each. */
async function audit(
  db: PGlite,
  listed: Record<string, AccountTable>,
): Promise<string[]> {
  const rows = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows;
  const problems: string[] = [];

  // Tables, views and materialized views in every schema but Postgres's own
  // and auth. Copies in keep (other than its list of them) come and go with
  // moves.
  const relations = await rows<{ name: string; kind: string }>(
    `select n.nspname || '.' || c.relname as name, c.relkind::text as kind
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p', 'v', 'm') and ${ACCOUNT_SCHEMAS_SQL}
       and (n.nspname <> 'keep' or c.relname = 'copies')
     order by 1`,
  );
  const tables = relations.map((row) => row.name);
  const views = relations
    .filter((row) => row.kind === "v" || row.kind === "m")
    .map((row) => row.name);
  for (const name of tables)
    if (!(name in listed))
      problems.push(`${name} is not in tests/fixtures/account-tables.ts`);
  for (const name of Object.keys(listed))
    if (!tables.includes(name))
      problems.push(`${name} is listed but no migration makes it`);

  type Link = {
    table: string;
    columns: string[];
    target: string;
    target_columns: string[];
    on_delete: string;
  };
  const links = await rows<Link>(
    `select n.nspname || '.' || c.relname as table,
       array(select a.attname::text from unnest(f.conkey) with ordinality k (num, o)
         join pg_attribute a on a.attrelid = f.conrelid and a.attnum = k.num
         order by k.o) as columns,
       f.confrelid::regclass::text as target,
       array(select a.attname::text from unnest(f.confkey) with ordinality k (num, o)
         join pg_attribute a on a.attrelid = f.confrelid and a.attnum = k.num
         order by k.o) as target_columns,
       f.confdeltype::text as on_delete
     from pg_constraint f
     join pg_class c on c.oid = f.conrelid
     join pg_namespace n on n.oid = c.relnamespace
     where f.contype = 'f' and ${ACCOUNT_SCHEMAS_SQL}`,
  );

  // Every link to a person: deleted or forgotten with them, as listed.
  for (const link of links.filter((l) => PEOPLE.includes(l.target))) {
    const where = `${link.table}.${link.columns.join(",")}`;
    if (link.columns.length !== 1) {
      problems.push(`${where} links to a person with more than one column`);
      continue;
    }
    const does =
      link.on_delete === "c"
        ? "delete"
        : link.on_delete === "n"
          ? "forget"
          : null;
    if (!does) {
      problems.push(
        `${where} would stop its person's account from being deleted: make it on delete cascade or set null`,
      );
      continue;
    }
    const said = listed[link.table]?.people[link.columns[0]];
    if (listed[link.table] && said !== does)
      problems.push(
        `${where} is ${does === "delete" ? "deleted" : "forgotten"} with its person; list it so`,
      );
  }
  // Every link into a table whose rows go with a person (directly, or by a
  // cascade from such a table) must let those rows go: a link that neither
  // cascades nor sets null would stop the account from being deleted.
  const owned = new Set(
    Object.entries(listed)
      .filter(([, rule]) => Object.values(rule.people).includes("delete"))
      .map(([table]) => table),
  );
  for (let grew = true; grew;) {
    grew = false;
    for (const link of links)
      if (
        link.on_delete === "c" &&
        owned.has(qualified(link.target)) &&
        !owned.has(link.table)
      ) {
        owned.add(link.table);
        grew = true;
      }
  }
  for (const link of links)
    if (
      !PEOPLE.includes(link.target) &&
      owned.has(qualified(link.target)) &&
      link.on_delete !== "c" &&
      link.on_delete !== "n"
    )
      problems.push(
        `${link.table}.${link.columns.join(",")} would stop an account from being deleted: ${qualified(link.target)} rows go with their person, so make it on delete cascade or set null`,
      );

  // Every column listed as a person's: some link takes it along with them,
  // directly or, inside a cascading link, through another table's column
  // that goes with them.
  for (const [table, rule] of Object.entries(listed))
    for (const [column, does] of Object.entries(rule.people)) {
      const direct = links.some(
        (l) =>
          l.table === table &&
          PEOPLE.includes(l.target) &&
          l.columns.length === 1 &&
          l.columns[0] === column,
      );
      const through = links.some(
        (l) =>
          does === "delete" &&
          l.table === table &&
          l.on_delete === "c" &&
          l.columns.includes(column) &&
          listed[qualified(l.target)]?.people[
            l.target_columns[l.columns.indexOf(column)]
          ] === "delete",
      );
      if (tables.includes(table) && !direct && !through)
        problems.push(
          `${table}.${column} is listed as a person's, but no foreign key takes it along with them`,
        );
    }

  // Every other uuid column: a link, a row's own id, or listed as not a
  // person's. Only a key of its own named id counts as the row's id: a
  // person's id can be a key too (user_id uuid primary key).
  const columns = await rows<{ table: string; column: string; key: boolean }>(
    `select n.nspname || '.' || c.relname as table, a.attname::text as column,
       a.attname = 'id' and exists (
         select 1 from pg_constraint p
         where p.conrelid = c.oid and p.contype = 'p' and p.conkey = array[a.attnum]
       ) as key
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p', 'v', 'm') and ${ACCOUNT_SCHEMAS_SQL}
       and a.attnum > 0 and not a.attisdropped
       and a.atttypid in ('uuid'::regtype, 'uuid[]'::regtype)`,
  );
  for (const { table, column, key } of columns) {
    const rule = listed[table];
    if (!rule) continue;
    const linked = links.some(
      (l) => l.table === table && l.columns.includes(column),
    );
    const said =
      column in rule.people ||
      column in (rule.targets ?? {}) ||
      (rule.notPeople ?? []).includes(column);
    if (!linked && !said && !key)
      problems.push(
        `${table}.${column} may hold a person's id: give it a foreign key, or list it`,
      );
  }
  for (const [table, rule] of Object.entries(listed))
    for (const column of [
      ...Object.keys(rule.targets ?? {}),
      ...(rule.notPeople ?? []),
    ])
      if (
        tables.includes(table) &&
        !columns.some((c) => c.table === table && c.column === column)
      )
        problems.push(`${table}.${column} is listed but is not a uuid column`);

  // Who reads the rows, and whether a block hides them.
  type Policy = { table: string; command: string; using: string | null };
  const policies = await rows<Policy>(
    `select n.nspname || '.' || c.relname as table, p.polcmd::text as command,
       pg_get_expr(p.polqual, p.polrelid) as using
     from pg_policy p
     join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace`,
  );
  // The functions a policy calls, all the way down, so a policy that asks
  // through a helper still counts as asking.
  async function asks(
    expression: string,
    name: string,
    seen: string[] = [],
  ): Promise<boolean> {
    if (expression.includes(name)) return true;
    const called = await rows<{ fn: string; source: string }>(
      `select p.oid::regprocedure::text as fn, p.prosrc as source from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
         and $1 ~ ('\\m' || p.proname || '\\(')`,
      [expression],
    );
    for (const { fn, source } of called)
      if (!seen.includes(fn) && (await asks(source, name, [...seen, fn])))
        return true;
    return false;
  }
  for (const [table, rule] of Object.entries(listed)) {
    if (!tables.includes(table)) continue;
    const readers = rule.readers;
    const using = policies
      .filter(
        (p) => p.table === table && (p.command === "r" || p.command === "*"),
      )
      .map((p) => p.using ?? "");
    const reachable = (
      await rows<{ ok: boolean }>(
        `select bool_or(
           has_schema_privilege(r, split_part($1, '.', 1), 'USAGE')
           and has_table_privilege(r, $1, 'SELECT')
         ) as ok
         from unnest(array['anon', 'authenticated']) r`,
        [table],
      )
    )[0].ok;
    if (readers === "nobody") {
      if (reachable)
        problems.push(
          `${table} is listed as read by nobody, but the API can read it`,
        );
      continue;
    }
    const secured = (
      await rows<{ on: boolean }>(
        "select relrowsecurity as on from pg_class where oid = $1::regclass",
        [table],
      )
    )[0].on;
    if (!secured && !views.includes(table))
      problems.push(`${table} has no row level security`);
    if (readers === "own") {
      if (using.length === 0)
        problems.push(`${table} has no policy to read by`);
      for (const expression of using)
        if (!/auth\.uid\(\)/.test(expression))
          problems.push(
            `${table} is listed as read only by whom it is about, but a policy does not ask auth.uid()`,
          );
    } else if (readers === "blocks") {
      if (using.length === 0)
        problems.push(`${table} has no policy to read by`);
      for (const expression of using)
        if (!(await asks(expression, "is_blocked_with")))
          problems.push(
            `${table} is listed as hidden from blocked people, but a policy does not ask is_blocked_with()`,
          );
    } else if ("via" in readers) {
      if (listed[readers.via]?.readers !== "blocks")
        problems.push(
          `${table} is read through ${readers.via}, which does not hide from blocked people`,
        );
      const name = readers.via.replace(/^public\./, "");
      const own = table.replace(/^public\./, "");
      if (using.length === 0)
        problems.push(`${table} has no policy to read by`);
      for (const expression of using)
        if (
          !new RegExp(`FROM ${name}\\b`).test(expression) ||
          !expression.includes(`= ${own}.`)
        )
          problems.push(
            `${table} is listed as read through ${readers.via}, but a policy does not look there`,
          );
    } else if (readers.open.trim().length < 20) {
      problems.push(`${table} is open to blocked people: say why`);
    }
  }
  return problems;
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const db = await migratedDatabase();

  await check("every table is listed as the migrations make it", async () => {
    assert.deepEqual(await audit(db, ACCOUNT_TABLES), []);
  });

  // Each mistake the list is there to catch, made on purpose and rolled back.
  async function caught(sql: string, extra: Record<string, AccountTable>) {
    await db.exec("begin");
    try {
      await db.exec(sql);
      return await audit(db, { ...ACCOUNT_TABLES, ...extra });
    } finally {
      await db.exec("rollback");
    }
  }

  await check("a new table nobody listed stops the check", async () => {
    const problems = await caught(
      `create table public.bookmarks (
         user_id uuid not null references public.profiles (id) on delete cascade,
         note text
       );`,
      {},
    );
    assert.deepEqual(problems, [
      "public.bookmarks is not in tests/fixtures/account-tables.ts",
    ]);
  });

  await check(
    "a link that would keep an account from going stops it",
    async () => {
      const problems = await caught(
        `create table public.bookmarks (
           user_id uuid not null references public.profiles (id),
           note text
         );
         alter table public.bookmarks enable row level security;
         create policy own on public.bookmarks for select using (user_id = auth.uid());`,
        {
          "public.bookmarks": { people: { user_id: "delete" }, readers: "own" },
        },
      );
      assert.deepEqual(problems, [
        "public.bookmarks.user_id would stop its person's account from being deleted: make it on delete cascade or set null",
      ]);
    },
  );

  await check("a link deleted differently from its line stops it", async () => {
    const problems = await caught(
      `create table public.bookmarks (
         user_id uuid references public.profiles (id) on delete set null
       );
       alter table public.bookmarks enable row level security;
       create policy own on public.bookmarks for select using (user_id = auth.uid());`,
      { "public.bookmarks": { people: { user_id: "delete" }, readers: "own" } },
    );
    assert.deepEqual(problems, [
      "public.bookmarks.user_id is forgotten with its person; list it so",
    ]);
  });

  await check(
    "a link to rows that go with a person, that would hold them, stops it",
    async () => {
      const problems = await caught(
        `create table public.post_notes (
           post_id uuid references public.posts (id),
           note text
         );
         alter table public.post_notes enable row level security;`,
        { "public.post_notes": { people: {}, readers: "nobody" } },
      );
      assert.deepEqual(problems, [
        "public.post_notes.post_id would stop an account from being deleted: public.posts rows go with their person, so make it on delete cascade or set null",
      ]);
    },
  );

  await check(
    "a person's id kept as a key, with no link, stops it",
    async () => {
      const problems = await caught(
        `create table public.prefs (user_id uuid primary key, theme text);
       alter table public.prefs enable row level security;
       create policy own on public.prefs for select using (user_id = auth.uid());`,
        { "public.prefs": { people: {}, readers: "own" } },
      );
      assert.deepEqual(problems, [
        "public.prefs.user_id may hold a person's id: give it a foreign key, or list it",
      ]);
    },
  );

  await check("a table in a new schema has to be listed too", async () => {
    const problems = await caught(
      `create schema audit;
       create table audit.events (id uuid primary key, note text);`,
      {},
    );
    assert.deepEqual(problems, [
      "audit.events is not in tests/fixtures/account-tables.ts",
    ]);
  });

  await check("a person's id with no link stops it", async () => {
    const problems = await caught(
      `create table public.bookmarks (
         id uuid primary key,
         reader uuid not null
       );
       alter table public.bookmarks enable row level security;
       create policy own on public.bookmarks for select using (reader = auth.uid());`,
      { "public.bookmarks": { people: {}, readers: "own" } },
    );
    assert.deepEqual(problems, [
      "public.bookmarks.reader may hold a person's id: give it a foreign key, or list it",
    ]);
  });

  await check(
    "a table said to hide blocked people that does not stops it",
    async () => {
      const problems = await caught(
        `create table public.bookmarks (
           user_id uuid not null references public.profiles (id) on delete cascade
         );
         alter table public.bookmarks enable row level security;
         create policy everyone on public.bookmarks for select using (true);`,
        {
          "public.bookmarks": {
            people: { user_id: "delete" },
            readers: "blocks",
          },
        },
      );
      assert.deepEqual(problems, [
        "public.bookmarks is listed as hidden from blocked people, but a policy does not ask is_blocked_with()",
      ]);
    },
  );

  await check("a policy asking through a helper counts as asking", async () => {
    const problems = await caught(
      `create table public.bookmarks (
         user_id uuid not null references public.profiles (id) on delete cascade
       );
       create function private.can_see_bookmark(owner uuid) returns boolean
       language sql stable as $$ select not private.is_blocked_with(owner) $$;
       alter table public.bookmarks enable row level security;
       create policy everyone on public.bookmarks for select
         using (private.can_see_bookmark(user_id));`,
      {
        "public.bookmarks": {
          people: { user_id: "delete" },
          readers: "blocks",
        },
      },
    );
    assert.deepEqual(problems, []);
  });

  await check("a table without row level security stops it", async () => {
    const problems = await caught(
      `create table public.bookmarks (
         user_id uuid not null references public.profiles (id) on delete cascade
       );`,
      { "public.bookmarks": { people: { user_id: "delete" }, readers: "own" } },
    );
    assert.deepEqual(problems, [
      "public.bookmarks has no row level security",
      "public.bookmarks has no policy to read by",
    ]);
  });

  await check(
    "a table said to be read by nobody that the API can read stops it",
    async () => {
      const problems = await caught(
        `create table public.bookmarks (note text);
         grant select on public.bookmarks to anon;`,
        { "public.bookmarks": { people: {}, readers: "nobody" } },
      );
      assert.deepEqual(problems, [
        "public.bookmarks is listed as read by nobody, but the API can read it",
      ]);
    },
  );

  console.log(`${passed} account table checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
