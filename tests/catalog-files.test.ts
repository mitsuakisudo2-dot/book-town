import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import type { PGlite } from "@electric-sql/pglite";
import { files, type Target } from "../scripts/catalog-import";

// The month's files (scripts/catalog-import.ts files, docs/09「図書館の目録」):
// once the last file is taken, the day's changes are taken again from the day
// before the files' cut, so a change made after the cut that the files just
// took back comes again. Nothing is asked of the library: its answers are
// made up here, with no record in them.

let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const LIST = [
  "https://ndlsearch.ndl.go.jp/files/oaipmhAllData/dcndl_all_20261002_0001.xml.gz",
  "https://ndlsearch.ndl.go.jp/files/oaipmhAllData/dcndl_all_20261002_0002.xml.gz",
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
      assert.equal(kept.get("files-20261002"), "2");
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

  console.log(`${passed} catalog file checks passed`);
}

main().catch((error) => {
  console.log = quiet;
  console.error(error);
  process.exitCode = 1;
});
