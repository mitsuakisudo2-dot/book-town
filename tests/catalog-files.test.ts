import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import type { PGlite } from "@electric-sql/pglite";
import { daily, files, patience, type Target } from "../scripts/catalog-import";

// The month's files (scripts/catalog-import.ts files, docs/09「図書館の目録」):
// once the last file is taken, the day's changes are taken again from the day
// before the files' cut, so a change made after the cut that the files just
// took back comes again. Nothing is asked of the library: its answers are
// made up here, with no record in them. The day's changes (daily) that are
// too many to take fail the run, and the other set is still taken. A night
// the library is busy ends well and keeps the marks, so nothing is lost.

let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const LIST = [
  // The names as the library's list has them: the day the files were made
  // (the first Saturday, 2026-10-03; the cut is the Friday before) and an id.
  "https://ndlsearch.ndl.go.jp/files/oaipmhAllData/dcndl_all_20261003_0df733fe-0000-4000-8000-000000000001.gz",
  "https://ndlsearch.ndl.go.jp/files/oaipmhAllData/dcndl_all_20261003_09fe3c90-0000-4000-8000-000000000002.gz",
];
const EMPTY = gzipSync(
  Buffer.from("<OAI-PMH><ListRecords></ListRecords></OAI-PMH>"),
);

function library() {
  globalThis.fetch = (async (url: string | URL) =>
    String(url).endsWith("xmlList.txt")
      ? new Response(LIST.join("\n"))
      : new Response(EMPTY)) as typeof fetch;
}

function marks(given: Record<string, string>) {
  const kept = new Map(Object.entries(given));
  const target: Target = {
    take: async () => ({}),
    gone: async () => 0,
    mark: async (name) => kept.get(name) ?? null,
    setMark: async (name, mark) => void kept.set(name, mark),
  };
  return { kept, target };
}

const quiet = console.log;

async function main() {
  library();
  const db = null as unknown as PGlite;

  await check(
    "the last file taken sets the day's changes back to the day before the cut",
    async () => {
      const { kept, target } = marks({
        "oai-iss-ndl-opac": "2026-10-20",
        "oai-iss-ndl-opac-inprocess": "2026-10-20",
      });
      console.log = () => {};
      await files(db, target, 1);
      console.log = quiet;
      assert.equal(kept.get("files-20261003"), "2");
      assert.equal(kept.get("oai-iss-ndl-opac"), "2026-10-01");
      assert.equal(kept.get("oai-iss-ndl-opac-inprocess"), "2026-10-01");
    },
  );

  await check(
    "a mark already before it, or files not all taken, stay as they are",
    async () => {
      const { kept, target } = marks({
        "oai-iss-ndl-opac": "2026-09-20",
        "oai-iss-ndl-opac-inprocess": "2026-10-20",
      });
      console.log = () => {};
      await files(db, target, 1);
      console.log = quiet;
      assert.equal(kept.get("oai-iss-ndl-opac"), "2026-09-20");
      assert.equal(kept.get("oai-iss-ndl-opac-inprocess"), "2026-10-01");
      // Run again when all were taken: nothing more is set back.
      kept.set("oai-iss-ndl-opac-inprocess", "2026-10-25");
      console.log = () => {};
      await files(db, target, 1);
      console.log = quiet;
      assert.equal(kept.get("oai-iss-ndl-opac-inprocess"), "2026-10-25");
      // Stopped before the last file: nothing is set back.
      const part = marks({ "oai-iss-ndl-opac": "2026-10-20" });
      console.log = () => {};
      await files(db, part.target, 0);
      console.log = quiet;
      assert.equal(part.kept.get("oai-iss-ndl-opac"), "2026-10-20");
    },
  );

  await check(
    "too many changes in one set fail the run, keep that mark and take the other set",
    async () => {
      // The catalogue's set has more changes than a day's run takes; the set
      // in the making has three (with no record in the answer).
      const answer = (size: number, token: string) =>
        `<OAI-PMH><ListRecords><resumptionToken completeListSize="${size}">${token}</resumptionToken></ListRecords></OAI-PMH>`;
      const asked: string[] = [];
      globalThis.fetch = (async (url: string | URL) => {
        asked.push(String(url));
        return new Response(
          String(url).includes("set=iss-ndl-opac&")
            ? answer(150_000, "more")
            : answer(3, ""),
        );
      }) as typeof fetch;
      const { kept, target } = marks({
        "oai-iss-ndl-opac": "2026-10-01",
        "oai-iss-ndl-opac-inprocess": "2026-10-01",
      });
      const said: string[] = [];
      console.log = (line: string) => void said.push(line);
      await assert.rejects(daily(db, target), /not taken: iss-ndl-opac;/);
      console.log = quiet;
      assert.equal(kept.get("oai-iss-ndl-opac"), "2026-10-01");
      const yesterday = new Date(Date.now() - 86_400_000)
        .toISOString()
        .slice(0, 10);
      assert.equal(kept.get("oai-iss-ndl-opac-inprocess"), yesterday);
      // The large set's next page is not asked for; the count is told.
      assert.equal(
        asked.filter((url) => url.includes("resumptionToken")).length,
        0,
      );
      assert.ok(
        said.some((line) =>
          /^iss-ndl-opac: 150000 changes since 2026-10-01/.test(line),
        ),
      );
      // Both sets small: the run ends well and both marks move on.
      globalThis.fetch = (async () =>
        new Response(answer(3, ""))) as typeof fetch;
      console.log = () => {};
      await daily(db, target);
      console.log = quiet;
      assert.equal(kept.get("oai-iss-ndl-opac"), yesterday);
    },
  );

  await check(
    "a busy library ends the night well and keeps the marks, so the next night takes the same changes",
    async () => {
      const answer = (size: number, token: string) =>
        `<OAI-PMH><ListRecords><resumptionToken completeListSize="${size}">${token}</resumptionToken></ListRecords></OAI-PMH>`;
      const waits = { ...patience };
      Object.assign(patience, { tries: 3, gap: 0, first: 0, most: 0 });
      const yesterday = new Date(Date.now() - 86_400_000)
        .toISOString()
        .slice(0, 10);
      // The first set's first page comes; its next page is busy every time.
      const asked: string[] = [];
      let status = 429;
      globalThis.fetch = (async (url: string | URL) => {
        asked.push(String(url));
        if (String(url).includes("resumptionToken"))
          return new Response("busy", { status });
        return new Response(answer(400, "more"));
      }) as typeof fetch;
      const { kept, target } = marks({
        "oai-iss-ndl-opac": "2026-11-21",
        "oai-iss-ndl-opac-inprocess": "2026-11-21",
      });
      const said: string[] = [];
      console.log = (line: string) => void said.push(line);
      await daily(db, target);
      console.log = quiet;
      assert.equal(kept.get("oai-iss-ndl-opac"), "2026-11-21");
      assert.equal(kept.get("oai-iss-ndl-opac-inprocess"), "2026-11-21");
      // Asked three times for the busy page, and not at all for the second set.
      assert.equal(
        asked.filter((u) => u.includes("resumptionToken")).length,
        3,
      );
      assert.equal(asked.filter((u) => u.includes("inprocess")).length, 0);
      assert.ok(
        said.some((line) =>
          /^::warning::The library was busy \(iss-ndl-opac, iss-ndl-opac-inprocess\)/.test(
            line,
          ),
        ),
      );
      // 503 is busy too.
      status = 503;
      console.log = () => {};
      await daily(db, target);
      console.log = quiet;
      assert.equal(kept.get("oai-iss-ndl-opac"), "2026-11-21");
      // Another answer is still a failure, and the marks stay.
      status = 500;
      console.log = () => {};
      await assert.rejects(daily(db, target), /the library answered 500/);
      console.log = quiet;
      assert.equal(kept.get("oai-iss-ndl-opac"), "2026-11-21");
      // Busy for the second set only: the first moves on, the second stays.
      globalThis.fetch = (async (url: string | URL) =>
        String(url).includes("inprocess")
          ? new Response("busy", { status: 429 })
          : new Response(answer(3, ""))) as typeof fetch;
      console.log = () => {};
      await daily(db, target);
      console.log = quiet;
      assert.equal(kept.get("oai-iss-ndl-opac"), yesterday);
      assert.equal(kept.get("oai-iss-ndl-opac-inprocess"), "2026-11-21");
      // The next night the library answers: the second set takes the changes
      // from the same day it stopped at, and moves on.
      const from: string[] = [];
      globalThis.fetch = (async (url: string | URL) => {
        from.push(/from=([0-9-]+)/.exec(String(url))?.[1] ?? "");
        return new Response(answer(3, ""));
      }) as typeof fetch;
      console.log = () => {};
      await daily(db, target);
      console.log = quiet;
      assert.deepEqual(from, [yesterday, "2026-11-21"]);
      assert.equal(kept.get("oai-iss-ndl-opac-inprocess"), yesterday);
      Object.assign(patience, waits);
    },
  );

  console.log(`${passed} catalog file checks passed`);
}

main().catch((error) => {
  console.log = quiet;
  console.error(error);
  process.exitCode = 1;
});
