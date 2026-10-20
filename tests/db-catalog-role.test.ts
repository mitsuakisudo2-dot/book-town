import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import {
  recordsOf,
  rowsOf,
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
// catalog_api and nothing more than an anonymous visitor does; nobody else
// may use catalog_api; through it the import takes rows up to the cap, takes
// out deleted records' rows no reader uses, and keeps its marks; what it may
// send at once is bounded; the tables and private stay closed to it; a
// function added to catalog_api later starts closed; and the rollback.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_catalog_role.sql"));
assert.ok(FILE, "the catalog role migration");
const TEXT = migrationText(FILE);

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

/** The importer's target, through catalog_api as catalog_import. */
function roleTarget(db: PGlite): Target {
  return {
    async take(rows, batch) {
      const [{ r }] = await asImport<{ r: Record<string, number> }>(
        db,
        "select catalog_api.take($1::jsonb, $2) r",
        [JSON.stringify(rows), batch],
      );
      return r;
    },
    async gone(records) {
      const [{ n }] = await asImport<{ n: number }>(
        db,
        "select catalog_api.gone($1::text[]) n",
        [records],
      );
      return n;
    },
    async mark(name) {
      const [{ mark }] = await asImport<{ mark: string | null }>(
        db,
        "select catalog_api.mark($1) mark",
        [name],
      );
      return mark;
    },
    async setMark(name, mark) {
      await asImport(db, "select catalog_api.set_mark($1, $2)", [name, mark]);
    },
  };
}

/** What role may do, in every schema but Postgres's own, that anon may not. */
async function beyondAnon(db: PGlite, role: string) {
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
           and not has_function_privilege('anon', p.oid, 'execute')
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
           and not has_schema_privilege('anon', n.oid, x.privilege)
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
           and not (has_table_privilege('anon', c.oid, x.privilege)
             or (x.privilege in ('select', 'insert', 'update', 'references')
               and has_any_column_privilege('anon', c.oid, x.privilege)))
         union all
         select c.oid::regclass::text || ' ' || x.privilege
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join (values ('usage'), ('select'), ('update')) x (privilege)
         where ${schemas} and c.relkind = 'S'
           and has_sequence_privilege($1, c.oid, x.privilege)
           and not has_sequence_privilege('anon', c.oid, x.privilege)
         order by 1`,
        [role],
      )
    ).map((r) => r.name),
    database: (
      await rows<{ name: string }>(
        `select x.privilege as name
         from (values ('create'), ('temporary'), ('connect')) x (privilege)
         where has_database_privilege($1, current_database(), x.privilege)
           and not has_database_privilege('anon', current_database(), x.privilege)`,
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
    "catalog_import may do no more than anon, but use catalog_api and run its four functions",
    async () => {
      assert.deepEqual(await beyondAnon(db, "catalog_import"), {
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

  console.log(`${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
