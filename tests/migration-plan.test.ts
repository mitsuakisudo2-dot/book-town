import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compare,
  dryRunFiles,
  risky,
  sameAsShown,
  sha256,
} from "../scripts/migration-plan.mjs";

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));

// What Deploy database shows before approval and checks before applying
// (scripts/migration-plan.mjs, docs/09「データベースへの反映」).

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
}

async function main() {
  await check(
    "the files production has not applied are listed in order",
    () => {
      const files = [
        "20261101000000_a.sql",
        "20261102000000_b.sql",
        "20261103000000_c.sql",
      ];
      assert.deepEqual(compare(files, ["20261101000000"]), {
        problems: [],
        pending: ["20261102000000_b.sql", "20261103000000_c.sql"],
      });
      assert.deepEqual(
        compare(
          files,
          files.map((f) => f.slice(0, 14)),
        ).pending,
        [],
      );
    },
  );

  await check("a history that does not fit the files stops the run", () => {
    const unknown = compare(
      ["20261101000000_a.sql"],
      ["20261101000000", "20261105000000"],
    );
    assert.match(
      unknown.problems.join(),
      /20261105000000, which no file here has/,
    );
    const skipped = compare(
      ["20261101000000_a.sql", "20261102000000_b.sql", "20261103000000_c.sql"],
      ["20261101000000", "20261103000000"],
    );
    assert.match(
      skipped.problems.join(),
      /20261102000000_b.sql is older than 20261103000000/,
    );
    const twice = compare(["20261101000000_a.sql", "20261101000000_b.sql"], []);
    assert.match(twice.problems.join(), /share version 20261101000000/);
    const unnamed = compare(["a.sql"], []);
    assert.match(
      unnamed.problems.join(),
      /does not start with a 14-digit version/,
    );
  });

  await check("operations that can lose data are named, comments aside", () => {
    assert.deepEqual(risky("create table t (id int);"), []);
    assert.deepEqual(
      risky("-- drop table t;\n/* truncate t; */ select 1;"),
      [],
    );
    assert.deepEqual(risky("drop table public.t;"), ["drop table"]);
    assert.deepEqual(risky("alter table t drop column c;"), ["drop column"]);
    assert.deepEqual(risky("truncate private.t;"), ["truncate"]);
    assert.deepEqual(risky("delete from t where id = 1;"), ["delete from"]);
    assert.deepEqual(risky("update t set a = 1;"), ["update without where"]);
    assert.deepEqual(risky("update t set a = 1 where id = 2;"), []);
    assert.deepEqual(
      risky(
        "alter table t add foreign key (b) references u on delete cascade;",
      ),
      ["on delete cascade"],
    );
    assert.deepEqual(risky("drop schema s cascade;"), ["drop schema"]);
    assert.deepEqual(
      risky("select private.drop_copy('20261101000000_works');"),
      ["drop_copy"],
    );
  });

  await check(
    "every migration here has a version and is listed by the dry run",
    () => {
      const dir = path.join(__dirname_, "..", "supabase", "migrations");
      const files = readdirSync(dir)
        .filter((name) => name.endsWith(".sql"))
        .sort();
      assert.deepEqual(compare(files, []).problems, []);
      // The CLI prints " • name" a line, in bold when it writes to a terminal.
      const output = `Would push these migrations:\n • \u001b[1m${files[0]}\u001b[22m\n • ${files[1]}\n`;
      assert.deepEqual(dryRunFiles(output), files.slice(0, 2));
      assert.deepEqual(dryRunFiles("Remote database is up to date.\n"), []);
    },
  );

  await check("only what was shown, unchanged, may run", () => {
    const shown = [
      { name: "20261101000000_a.sql", sha256: sha256("a") },
      { name: "20261102000000_b.sql", sha256: sha256("b") },
    ];
    assert.equal(sameAsShown(shown, shown), "");
    assert.match(sameAsShown(shown, shown.slice(0, 1)), /not the ones shown/);
    assert.match(
      sameAsShown(shown, [
        ...shown,
        { name: "20261103000000_c.sql", sha256: sha256("c") },
      ]),
      /not the ones shown/,
    );
    assert.match(
      sameAsShown(shown, [shown[0], { ...shown[1], sha256: sha256("b2") }]),
      /text of 20261102000000_b.sql changed/,
    );
    assert.match(sameAsShown([], shown), /not the ones shown/);
  });

  // The script itself, against a stand-in for the management API.
  const asked: { url: string; auth: string; body: string }[] = [];
  let history: string[] = [];
  let status = 200;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      asked.push({
        url: request.url ?? "",
        auth: request.headers.authorization ?? "",
        body,
      });
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(
        status === 200
          ? JSON.stringify(history.map((version) => ({ version })))
          : '{"message":"no"}',
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const work = mkdtempSync(path.join(tmpdir(), "migration-plan-"));

  function run(mode: string, env: Record<string, string>, stdin = "") {
    return new Promise<{ code: number; output: string; written: string }>(
      (resolve) => {
        const outputFile = path.join(work, `${mode}-${asked.length}.out`);
        writeFileSync(outputFile, "");
        const child = execFile(
          process.execPath,
          ["scripts/migration-plan.mjs", mode],
          {
            cwd: path.join(__dirname_, ".."),
            env: {
              NODE_ENV: "test",
              PATH: process.env.PATH ?? "",
              SUPABASE_API_URL: `http://127.0.0.1:${port}/v1`,
              GITHUB_OUTPUT: outputFile,
              ...env,
            },
          },
          (error, stdout) =>
            resolve({
              code: error ? Number(error.code ?? 1) : 0,
              output: stdout,
              written: readFileSync(outputFile, "utf8"),
            }),
        );
        child.stdin?.end(stdin);
      },
    );
  }

  const dir = path.join(__dirname_, "..", "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const keys = {
    SUPABASE_ACCESS_TOKEN: "sbp_test",
    SUPABASE_PROJECT_ID: "ref",
  };

  await check(
    "plan reads the history read only and lists what is left",
    async () => {
      history = files.slice(0, -2).map((name) => name.slice(0, 14));
      const result = await run("plan", keys);
      assert.equal(result.code, 0, result.output);
      assert.equal(
        asked.at(-1)?.url,
        "/v1/projects/ref/database/query/read-only",
      );
      assert.equal(asked.at(-1)?.auth, "Bearer sbp_test");
      assert.match(
        asked.at(-1)?.body ?? "",
        /supabase_migrations\.schema_migrations/,
      );
      assert.match(result.written, /^count=2$/m);
      const plan = JSON.parse(
        result.written.match(/^plan=(.*)$/m)?.[1] ?? "[]",
      );
      assert.deepEqual(
        plan.map((e: { name: string }) => e.name),
        files.slice(-2),
      );
      assert.match(result.output, /Can lose data/);
    },
  );

  await check(
    "plan with nothing left says so and asks for no approval",
    async () => {
      history = files.map((name) => name.slice(0, 14));
      const result = await run("plan", keys);
      assert.equal(result.code, 0, result.output);
      assert.match(result.written, /^count=0$/m);
    },
  );

  await check(
    "plan stops on a history that does not fit, and on a refused token",
    async () => {
      history = [...files.map((name) => name.slice(0, 14)), "29991231000000"];
      const unknown = await run("plan", keys);
      assert.equal(unknown.code, 1);
      assert.match(
        unknown.output,
        /::error::Production has applied 29991231000000/,
      );
      status = 403;
      const refused = await run("plan", keys);
      status = 200;
      assert.equal(refused.code, 1);
      assert.match(refused.output, /::error::Supabase answered 403/);
      assert.doesNotMatch(refused.output, /sbp_test/);
    },
  );

  await check("same refuses a dry run that differs from the plan", async () => {
    const shown = files.slice(-2).map((name) => ({
      name,
      sha256: sha256(readFileSync(path.join(dir, name), "utf8")),
    }));
    const plan = JSON.stringify(shown);
    const dry = `Would push these migrations:\n${shown.map((e) => ` • ${e.name}`).join("\n")}\n`;
    assert.equal((await run("same", { PLAN: plan }, dry)).code, 0);
    const more = await run(
      "same",
      { PLAN: JSON.stringify(shown.slice(1)) },
      dry,
    );
    assert.equal(more.code, 1);
    assert.match(more.output, /not the ones shown/);
    const edited = JSON.stringify([
      shown[0],
      { ...shown[1], sha256: sha256("x") },
    ]);
    const changed = await run("same", { PLAN: edited }, dry);
    assert.equal(changed.code, 1);
    assert.match(changed.output, /changed after it was shown/);
  });

  await check(
    "applied checks the history holds every listed file",
    async () => {
      const plan = JSON.stringify(
        files.slice(-2).map((name) => ({ name, sha256: "" })),
      );
      history = files.map((name) => name.slice(0, 14));
      assert.equal((await run("applied", { ...keys, PLAN: plan })).code, 0);
      history = files.slice(0, -1).map((name) => name.slice(0, 14));
      const missing = await run("applied", { ...keys, PLAN: plan });
      assert.equal(missing.code, 1);
      assert.match(missing.output, /does not hold .*Check the database itself/);
    },
  );

  server.close();
  console.log(`${passed} migration plan checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
