import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import {
  recordsOf,
  rowsOf,
  sqlTarget,
  type CatalogRow,
  type Target,
} from "../scripts/catalog-import";
import {
  catalog,
  helpers,
  migrated,
  numbered,
  ndlRecord,
  type Ndl,
} from "./fixtures/bibliography";
import { migrationFiles, migrationText } from "./fixtures/pglite-supabase";

// The library catalog's own role (supabase/migrations/*_catalog_role.sql,
// docs/09「本番の設定」): catalog_import reaches the four functions of
// catalog_api and nothing more than a role given nothing does; nobody else
// may use catalog_api; through it the import takes rows up to the cap, takes
// out deleted records' rows no reader uses, and keeps its marks; what it may
// send at once is bounded; the tables and private stay closed to it; a
// function added to catalog_api later starts closed; and the rollback.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_catalog_role.sql"));
assert.ok(FILE, "the catalog role migration");
const TEXT = migrationText(FILE);
const LIMITS =
  FILES.find((file) => file.endsWith("_catalog_role_limits.sql")) ?? "";
assert.ok(LIMITS, "the migration that narrows the catalog role");

const ENTRIES = [
  "catalog_api.gone(text[])",
  "catalog_api.mark(text)",
  "catalog_api.set_mark(text,text)",
  "catalog_api.take(jsonb,text)",
];
const C = (n: number) => numbered(900 + n);

/** The statements of the migration's rollback, as its header writes them. */
function rollbackSql(text: string): string {
  const from = text.indexOf("-- Rollback:");
  return text
    .slice(from, text.indexOf("\n\n", from))
    .split("\n")
    .filter((line) => line.startsWith("--   "))
    .map((line) => line.slice(3))
    .join("\n");
}

/** A catalog row as the importer would send it, of one record of the library's. */
async function rowsFor(
  db: PGlite,
  records: [string, Ndl][],
): Promise<CatalogRow[]> {
  const rdf = (ndl: Ndl) =>
    /<rdf:RDF[\s\S]*<\/rdf:RDF>/.exec(ndlRecord(ndl))![0];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><OAI-PMH><ListRecords>${records
    .map(
      ([record, ndl]) =>
        `<record><header><identifier>oai:ndlsearch.ndl.go.jp:${record}</identifier><datestamp>2026-10-18T00:00:00Z</datestamp><setSpec>iss-ndl-opac</setSpec></header><metadata>${rdf(ndl)}</metadata></record>`,
    )
    .join("")}</ListRecords></OAI-PMH>`;
  return rowsOf(db, recordsOf(xml).records);
}

/** Runs sql as catalog_import, as the import would once it logs in as it. */
async function asImport<T = Record<string, unknown>>(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await db.exec("set role catalog_import");
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}

/**
 * The importer's own statements (sqlTarget, what psqlTarget sends), run as
 * catalog_import and printed as psql -t -A prints them.
 */
function roleTarget(db: PGlite): Target {
  return sqlTarget(async (sql) => {
    const [row] = await asImport<Record<string, unknown>>(db, sql);
    const value = row ? Object.values(row)[0] : null;
    if (value === null || value === undefined) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

/**
 * What role may do, in every schema but Postgres's own, that a role given
 * nothing may not: beyond PUBLIC's grants. Not anon, which has the use of
 * schemas a role that logs in by itself must not lean on (AUD-166).
 */
async function beyondNobody(db: PGlite, role: string) {
  const { rows } = helpers(db);
  const schemas =
    "n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_'";
  return {
    functions: (
      await rows<{ name: string }>(
        `select p.oid::regprocedure::text as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where ${schemas}
           and has_function_privilege($1, p.oid, 'execute')
           and not has_function_privilege('nobody', p.oid, 'execute')
         order by 1`,
        [role],
      )
    ).map((r) => r.name),
    schemas: (
      await rows<{ name: string }>(
        `select n.nspname || ' ' || x.privilege as name
         from pg_namespace n cross join (values ('usage'), ('create')) x (privilege)
         where ${schemas}
           and has_schema_privilege($1, n.oid, x.privilege)
           and not has_schema_privilege('nobody', n.oid, x.privilege)
         order by 1`,
        [role],
      )
    ).map((r) => r.name),
    relations: (
      await rows<{ name: string }>(
        `select c.oid::regclass::text || ' ' || x.privilege as name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'),
           ('references'), ('trigger')) x (privilege)
         where ${schemas} and c.relkind in ('r', 'v', 'm', 'f', 'p')
           and (has_table_privilege($1, c.oid, x.privilege)
             or (x.privilege in ('select', 'insert', 'update', 'references')
               and has_any_column_privilege($1, c.oid, x.privilege)))
           and not (has_table_privilege('nobody', c.oid, x.privilege)
             or (x.privilege in ('select', 'insert', 'update', 'references')
               and has_any_column_privilege('nobody', c.oid, x.privilege)))
         union all
         select c.oid::regclass::text || ' ' || x.privilege
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join (values ('usage'), ('select'), ('update')) x (privilege)
         where ${schemas} and c.relkind = 'S'
           and has_sequence_privilege($1, c.oid, x.privilege)
           and not has_sequence_privilege('nobody', c.oid, x.privilege)
         order by 1`,
        [role],
      )
    ).map((r) => r.name),
    database: (
      await rows<{ name: string }>(
        `select x.privilege as name
         from (values ('create'), ('temporary'), ('connect')) x (privilege)
         where has_database_privilege($1, current_database(), x.privilege)
           and not has_database_privilege('nobody', current_database(), x.privilege)`,
        [role],
      )
    ).map((r) => r.name),
  };
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const db = await migrated();
  const { rows, count, refused } = helpers(db);
  await db.exec("create role nobody nologin");

  await check(
    "catalog_import cannot log in, is no superuser, and belongs to no other role",
    async () => {
      assert.deepEqual(
        await rows(
          `select rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
                  rolreplication, rolbypassrls, rolpassword is null as no_password
           from pg_authid where rolname = 'catalog_import'`,
        ),
        [
          {
            rolcanlogin: false,
            rolsuper: false,
            rolinherit: false,
            rolcreaterole: false,
            rolcreatedb: false,
            rolreplication: false,
            rolbypassrls: false,
            no_password: true,
          },
        ],
      );
      // Two connections, five minutes a statement, a minute left in a transaction (AUD-166).
      assert.deepEqual(
        await rows(
          `select rolconnlimit, rolconfig from pg_roles where rolname = 'catalog_import'`,
        ),
        [
          {
            rolconnlimit: 2,
            rolconfig: [
              "statement_timeout=5min",
              "idle_in_transaction_session_timeout=1min",
            ],
          },
        ],
      );
      assert.equal(
        await count(
          `select count(*) from pg_auth_members m
           where m.member = 'catalog_import'::regrole`,
        ),
        0,
      );
    },
  );

  await check(
    "catalog_import may do nothing a role given nothing may not, but use catalog_api and run its four functions",
    async () => {
      assert.deepEqual(await beyondNobody(db, "catalog_import"), {
        functions: ENTRIES,
        schemas: ["catalog_api usage"],
        relations: [],
        database: [],
      });
      // Each runs as its owner, with an empty search path, so the role needs
      // nothing in private.
      for (const fn of ENTRIES) {
        assert.deepEqual(
          await rows(
            `select prosecdef as definer, proconfig as config from pg_proc where oid = $1::regprocedure`,
            [fn],
          ),
          [{ definer: true, config: ['search_path=""'] }],
          fn,
        );
      }
      assert.equal(
        await count(
          "select count(*) from pg_proc where pronamespace = 'catalog_api'::regnamespace",
        ),
        ENTRIES.length,
      );
    },
  );

  await check(
    "nobody else may use catalog_api or run its functions: not PUBLIC, anon, authenticated or service_role",
    async () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        for (const privilege of ["usage", "create"])
          assert.equal(
            (
              await rows<{ ok: boolean }>(
                "select has_schema_privilege($1, 'catalog_api', $2) ok",
                [role, privilege],
              )
            )[0].ok,
            false,
            `${role} ${privilege} catalog_api`,
          );
        for (const fn of ENTRIES)
          assert.equal(
            (
              await rows<{ ok: boolean }>(
                "select has_function_privilege($1, $2::regprocedure, 'execute') ok",
                [role, fn],
              )
            )[0].ok,
            false,
            `${role} ${fn}`,
          );
      }
      // Who is named in the grants at all: the owner aside, catalog_import alone.
      assert.deepEqual(
        await rows(
          `select array(
             select coalesce(r.rolname, 'PUBLIC')
             from aclexplode(n.nspacl) a left join pg_roles r on r.oid = a.grantee
             where a.grantee <> n.nspowner order by 1) as grantees
           from pg_namespace n where n.nspname = 'catalog_api'`,
        ),
        [{ grantees: ["catalog_import"] }],
      );
      for (const fn of ENTRIES)
        assert.deepEqual(
          await rows(
            `select array(
               select coalesce(r.rolname, 'PUBLIC')
               from aclexplode(p.proacl) a left join pg_roles r on r.oid = a.grantee
               where a.grantee <> p.proowner order by 1) as grantees
             from pg_proc p where p.oid = $1::regprocedure`,
            [fn],
          ),
          [{ grantees: ["catalog_import"] }],
          fn,
        );
      for (const role of ["anon", "authenticated", "service_role"]) {
        await db.exec(`set role ${role}`);
        try {
          await refused(
            () => db.query("select catalog_api.mark('oai-iss-ndl-opac')"),
            /permission denied for schema catalog_api/,
            `${role} runs catalog_api.mark`,
          );
          await refused(
            () => db.query("select catalog_api.take('[]'::jsonb, 'trial')"),
            /permission denied for schema catalog_api/,
            `${role} runs catalog_api.take`,
          );
        } finally {
          await db.exec("reset role");
        }
      }
    },
  );

  await check(
    "a function added to catalog_api later starts closed to everyone",
    async () => {
      await db.exec(
        "create function catalog_api.later() returns integer language sql as $$ select 1 $$",
      );
      try {
        for (const role of [
          "anon",
          "authenticated",
          "service_role",
          "catalog_import",
        ])
          assert.equal(
            (
              await rows<{ ok: boolean }>(
                "select has_function_privilege($1, 'catalog_api.later()', 'execute') ok",
                [role],
              )
            )[0].ok,
            false,
            role,
          );
        // Its grants name nobody but its owner (no grants at all would mean PUBLIC's).
        assert.deepEqual(
          await rows(
            `select proacl is not null as listed, array(
               select coalesce(r.rolname, 'PUBLIC')
               from aclexplode(p.proacl) a left join pg_roles r on r.oid = a.grantee
               where a.grantee <> p.proowner) as grantees
             from pg_proc p where p.oid = 'catalog_api.later()'::regprocedure`,
          ),
          [{ listed: true, grantees: [] }],
        );
      } finally {
        await db.exec("drop function catalog_api.later()");
      }
    },
  );

  await check(
    "through catalog_api the import takes rows up to the cap, takes out a deleted record's rows no reader uses, and keeps its marks",
    async () => {
      const target = roleTarget(db);
      const taken = await rowsFor(db, [
        [
          "R100000002-I901",
          { bibId: "901", isbns: [C(1)], title: "役割の本 一" },
        ],
        [
          "R100000002-I902",
          { bibId: "902", isbns: [C(2)], title: "役割の本 二" },
        ],
        [
          "R100000002-I903",
          { bibId: "903", isbns: [C(3)], title: "役割の本 三" },
        ],
      ]);
      const before = await count("select taken from private.catalog_settings");
      await rows("update private.catalog_settings set most = $1", [before + 2]);
      const tally = await target.take(taken, "trial");
      assert.equal(tally.added, 2);
      assert.equal(tally.refused, 1);
      assert.equal(
        await count("select taken from private.catalog_settings"),
        before + 2,
      );
      await rows("update private.catalog_settings set most = 10000");
      // One of the two is used (the operator moved it), so it stays.
      const [used] = await rows<{ id: string }>(
        "select id from books where isbn = $1 and source = 'ndl'",
        [C(1)],
      );
      await rows(
        `insert into private.work_changes (book_id, from_work, to_work, kind)
         select id, work_id, work_id, 'edited' from books where id = $1`,
        [used.id],
      );
      assert.equal(
        await target.gone(["R100000002-I901", "R100000002-I902"]),
        1,
      );
      assert.equal(
        await count(
          "select count(*) from books where isbn = $1 and source = 'ndl'",
          [C(1)],
        ),
        1,
      );
      assert.equal(
        await count(
          "select count(*) from books where isbn = $1 and source = 'ndl'",
          [C(2)],
        ),
        0,
      );
      assert.equal(await target.mark("oai-iss-ndl-opac"), null);
      await target.setMark("oai-iss-ndl-opac", "2026-10-19");
      await target.setMark("oai-iss-ndl-opac", "2026-10-20");
      assert.equal(await target.mark("oai-iss-ndl-opac"), "2026-10-20");
      // The table's own checks hold through the function.
      await refused(
        () => target.setMark("Not A Name", "1"),
        /catalog_progress_name_check/,
        "a mark with a name the table refuses",
      );
    },
  );

  await check(
    "take takes the import's batches only: not 'registered', whose rows are out of the cap (AUD-166)",
    async () => {
      const before = await count(
        "select count(*) from private.catalog_imports",
      );
      for (const batch of [
        "registered",
        "files-2026103",
        "files-x",
        "Trial",
        "trial2",
        "",
      ])
        await refused(
          () =>
            asImport(db, "select catalog_api.take('[]'::jsonb, $1)", [batch]),
          /a batch is trial, oai or files- and a date/,
          batch,
        );
      await refused(
        () => asImport(db, "select catalog_api.take('[]'::jsonb, null)"),
        /a batch is/,
        "no batch",
      );
      for (const batch of ["trial", "oai", "files-20261003"])
        await asImport(db, "select catalog_api.take('[]'::jsonb, $1)", [batch]);
      assert.equal(
        await count("select count(*) from private.catalog_imports"),
        before,
      );
    },
  );

  await check("what one call may send is bounded", async () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => `R100000002-I${i}`);
    await refused(
      () =>
        asImport(db, "select catalog_api.take($1::jsonb, 'trial')", [
          JSON.stringify(many(1001)),
        ]),
      /at most 1000 rows/,
      "1001 rows",
    );
    await refused(
      () => asImport(db, "select catalog_api.take('{}'::jsonb, 'trial')"),
      /an array/,
      "not an array",
    );
    await refused(
      () => asImport(db, "select catalog_api.gone($1::text[])", [many(1001)]),
      /at most 1000 records/,
      "1001 records",
    );
    assert.deepEqual(
      await asImport(db, "select catalog_api.gone($1::text[]) n", [many(1000)]),
      [{ n: 0 }],
    );
  });

  await check(
    "as catalog_import, the tables, private and making anything are refused, and nothing changes",
    async () => {
      const books = await count("select count(*) from books");
      const denied = /permission denied/;
      for (const table of [
        "public.books",
        "public.editions",
        "public.works",
        "public.profiles",
      ]) {
        await refused(
          () => asImport(db, `select 1 from ${table} limit 1`),
          denied,
          `read ${table}`,
        );
        await refused(
          () => asImport(db, `update ${table} set id = id where false`),
          denied,
          `update ${table}`,
        );
        await refused(
          () => asImport(db, `delete from ${table} where false`),
          denied,
          `delete ${table}`,
        );
      }
      await refused(
        () => asImport(db, "insert into public.books (title) values ('x')"),
        denied,
        "insert into books",
      );
      for (const table of [
        "private.catalog_progress",
        "private.catalog_settings",
        "private.catalog_imports",
      ]) {
        await refused(
          () => asImport(db, `select 1 from ${table}`),
          denied,
          `read ${table}`,
        );
        await refused(
          () => asImport(db, `update ${table} set one = one where false`),
          denied,
          `update ${table}`,
        );
      }
      await refused(
        () => asImport(db, "select private.catalog_take('[]'::jsonb, 'trial')"),
        /permission denied for schema private/,
        "private.catalog_take",
      );
      await refused(
        () => asImport(db, "select private.catalog_gone(array[]::text[])"),
        /permission denied for schema private/,
        "private.catalog_gone",
      );
      await refused(
        () => asImport(db, "select private.catalog_drop('trial')"),
        /permission denied for schema private/,
        "private.catalog_drop",
      );
      for (const schema of ["public", "private", "catalog_api"])
        await refused(
          () => asImport(db, `create table ${schema}.made (id integer)`),
          denied,
          `create a table in ${schema}`,
        );
      await refused(
        () =>
          asImport(
            db,
            "create function catalog_api.made() returns integer language sql as $$ select 1 $$",
          ),
        denied,
        "create a function in catalog_api",
      );
      await refused(
        () => asImport(db, "create schema made"),
        denied,
        "create a schema",
      );
      assert.equal(await count("select count(*) from books"), books);
    },
  );

  await db.close();

  await check(
    "the rollback in the header leaves the database as it was before",
    async () => {
      const db = await migrated(FILE);
      const before = await catalog(db);
      await db.exec(TEXT);
      await db.exec(rollbackSql(TEXT));
      assert.deepEqual(await catalog(db), before);
      const left = await db.query(
        `select 1 from pg_namespace where nspname = 'catalog_api'
         union all select 1 from pg_authid where rolname = 'catalog_import'`,
      );
      assert.equal(left.rows.length, 0);
      await db.close();
    },
  );

  await check(
    "the rollback in the header of the narrowing leaves the database as it was before",
    async () => {
      const db = await migrated(LIMITS);
      const state = async () =>
        (
          await db.query(
            `select (select md5(prosrc) || coalesce(proacl::text, '') from pg_proc
                     where oid = 'catalog_api.take(jsonb,text)'::regprocedure) as take,
                    (select row(rolconnlimit, rolconfig)::text from pg_roles
                     where rolname = 'catalog_import') as role`,
          )
        ).rows;
      const before = await state();
      const catalogBefore = await catalog(db);
      const text = migrationText(LIMITS);
      await db.exec(text);
      assert.notDeepEqual(await state(), before);
      const first = TEXT.slice(
        TEXT.indexOf("create function catalog_api.take("),
        TEXT.indexOf(
          "\n",
          TEXT.indexOf("grant execute on function catalog_api.take("),
        ) + 1,
      ).replace("create function", "create or replace function");
      await db.exec(rollbackSql(text) + "\n" + first);
      assert.deepEqual(await state(), before);
      assert.deepEqual(await catalog(db), catalogBefore);
      await db.close();
    },
  );

  console.log(`${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
