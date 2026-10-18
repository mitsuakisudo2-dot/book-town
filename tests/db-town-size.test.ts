import assert from "node:assert/strict";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { TOWN_VIEW_ARGS } from "../src/lib/supabase/town-backend";
import { referencedBookIds } from "../src/lib/town-remote";
import { migratedDatabase } from "./fixtures/pglite-supabase";

// How big the town's answer is, and how long the database takes to make it
// (AUD-006; supabase/migrations/*_town_view.sql). A visitor's town_view, asked
// as the app asks it (TOWN_VIEW_ARGS), and
// the town_books for the books it points to, are asked of two made-up towns,
// one twice the other, and what each added reader costs is compared with
// tests/town-size-baseline.json: bytes, part by part, and milliseconds. A change that makes any part grow more with
// each reader than the baseline stops here; one that makes it grow less asks
// for the baseline to come down, so it keeps what was won. Nothing here is
// production's: PGlite is slower than production's Postgres, and the towns
// are made up. The numbers, and where they lead at 10,000 readers, go to the
// run's summary.
//
// BOOK_TOWN_SIZE_BASELINE=write writes the baseline from this run.

const BASELINE = join(__dirname, "town-size-baseline.json");
const SMALL = 200;
const LARGE = 400;
const AT = 10_000;
// Each reader's rows, about as a reader who has settled in keeps them.
const BOOKS = 9;
const RECORDS = 5;
const POSTS = 3;
// Bytes may move a little with the made-up dates; time moves with the machine.
const BYTES_SLACK = 1.1;
const MS_SLACK = 3;

interface Baseline {
  readers: [number, number];
  bytesPerReader: Record<string, number>;
  msPerReader: number;
}

interface Answer {
  bytes: number;
  parts: Record<string, number>;
  ms: number;
}

async function town(readers: number): Promise<PGlite> {
  const db = await migratedDatabase();
  const ids = `(select g, 'a0000000-0000-4000-8000-' || lpad(g::text, 12, '0') as id
    from generate_series(1, ${readers}) g)`;
  const bookOf = (g: string, k: string) =>
    `('b' || lpad(to_hex(${g}), 7, '0') || '-' || lpad((${k})::text, 4, '0') || '-4000-8000-000000000000')::uuid`;
  // Each row its own minute, as rows written over time are; and the
  // planner's statistics, as production's database keeps them.
  const when = (g: string, k: string) =>
    `now() - ((${g}) * 10 + (${k})) * interval '1 minute'`;
  await db.exec(`
    insert into auth.users (id) select id::uuid from ${ids} r;
    insert into profiles (id, handle, name, bio)
      select id::uuid, 'reader' || g, '読書家' || g,
        '本と散歩が好きです。最近は歴史の本をよく読んでいます。'
      from ${ids} r;
    insert into books (id, title, author, source, created_by, created_at)
      select ${bookOf("g", "k")}, '本の題名 ' || g || '-' || k, '著者' || (g % 500),
        'manual', id::uuid, ${when("g", "k")}
      from ${ids} r, generate_series(1, ${BOOKS}) k;
    insert into profile_nine (profile_id, position, book_id, note)
      select id::uuid, k, ${bookOf("g", "k")}, 'この本で世界の見え方が変わりました'
      from ${ids} r, generate_series(1, ${BOOKS}) k;
    insert into reading_entries (user_id, book_id, kind, body, feelings, audience, created_at)
      select id::uuid, ${bookOf("g", "k")}, 'finished',
        '静かな余韻が残る一冊だった。また読み返したい。', array['quiet', 'talk'], 'everyone',
        ${when("g", "k")}
      from ${ids} r, generate_series(1, ${RECORDS}) k;
    insert into posts (author_id, body, book_id, created_at)
      select id::uuid, '今日はこの本を少しだけ読みました。', ${bookOf("g", "k")},
        ${when("g", "k")}
      from ${ids} r, generate_series(1, ${POSTS}) k;
    insert into shops (owner_id, name, description, tagline, is_open)
      select id::uuid, '書店' || g, '好きな本を並べた小さな本屋です。', '本と人が出会う場所', true
      from ${ids} r;
    update shops s set public_shelves = jsonb_build_array(jsonb_build_object(
      'id', 'shelf-1', 'name', 'はじめの棚', 'isPublic', true,
      'items', (select jsonb_agg(jsonb_build_object(
        'bookId', b.id, 'pop', 'おすすめの一冊です', 'display', 'spine'))
        from books b where b.created_by = s.owner_id)));
    analyze;
  `);
  return db;
}

/**
 * A visitor's town (the quickest of three askings), and the books it points
 * to after it.
 */
async function answer(db: PGlite): Promise<Answer> {
  await db.exec(
    "set role anon; select set_config('request.jwt.claim.sub', '', false);",
  );
  try {
    let best: (Answer & { town: string }) | null = null;
    for (let round = 0; round < 3; round += 1) {
      const started = performance.now();
      const result = await db.query<{ town: string }>(
        `select public.town_view(${Object.keys(TOWN_VIEW_ARGS)
          .map((name, at) => `${name} => $${at + 1}`)
          .join(", ")})::text as town`,
        Object.values(TOWN_VIEW_ARGS),
      );
      const ms = performance.now() - started;
      if (best && best.ms <= ms) continue;
      const text = result.rows[0].town;
      const parts = Object.fromEntries(
        Object.entries(JSON.parse(text) as Record<string, unknown>).map(
          ([part, rows]) => [part, Buffer.byteLength(JSON.stringify(rows))],
        ),
      );
      best = { bytes: Buffer.byteLength(text), parts, ms, town: text };
    }
    // Then the books its rows point to, as the app asks for them: those the
    // newest books (catalog) did not bring, a thousand ids a request.
    const town = JSON.parse(best!.town) as Record<string, unknown[]>;
    const have = new Set(
      (town.catalog as { id: string }[]).map((book) => book.id),
    );
    const ids = referencedBookIds({
      ...town,
      sessions: town.together,
      marks: [],
      ownShelves: [],
      ownSceneBooks: [],
    } as unknown as Parameters<typeof referencedBookIds>[0]).filter(
      (id) => !have.has(id),
    );
    let books = 0;
    const started = performance.now();
    for (let at = 0; at < ids.length; at += 1000) {
      const result = await db.query<{ books: string }>(
        "select public.town_books($1::uuid[])::text as books",
        [ids.slice(at, at + 1000)],
      );
      books += Buffer.byteLength(result.rows[0].books);
    }
    const booksMs = performance.now() - started;
    return {
      bytes: best!.bytes + books,
      parts: { ...best!.parts, town_books: books },
      ms: best!.ms + booksMs,
    };
  } finally {
    await db.exec("reset role");
  }
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)}MB`;

async function main() {
  const small = await answer(await town(SMALL));
  const large = await answer(await town(LARGE));
  const added = LARGE - SMALL;
  const bytesPerReader = Object.fromEntries(
    Object.keys(large.parts)
      .sort()
      .map((part) => [
        part,
        Math.max(
          0,
          Math.round((large.parts[part] - (small.parts[part] ?? 0)) / added),
        ),
      ]),
  );
  const msPerReader = Math.max(0, (large.ms - small.ms) / added);
  const at = (bytes: number, perReader: number) =>
    bytes + perReader * (AT - LARGE);
  const lines = [
    `${SMALL} readers: ${mb(small.bytes)}, ${Math.round(small.ms)}ms`,
    `${LARGE} readers: ${mb(large.bytes)}, ${Math.round(large.ms)}ms`,
    `each reader adds ${Object.values(bytesPerReader).reduce((a, b) => a + b, 0)} bytes ` +
      `(${Object.entries(bytesPerReader)
        .filter(([, bytes]) => bytes > 0)
        .map(([part, bytes]) => `${part} ${bytes}`)
        .join(", ")}) and ${msPerReader.toFixed(2)}ms`,
    `${AT.toLocaleString("en")} readers, about ${mb(
      at(
        large.bytes,
        Object.values(bytesPerReader).reduce((a, b) => a + b, 0),
      ),
    )} and ${(at(large.ms, msPerReader) / 1000).toFixed(1)}s in PGlite`,
  ];
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### The town's answer to a visitor (made-up towns, PGlite)\n\n` +
        lines.map((line) => `- ${line}`).join("\n") +
        "\n",
    );

  if (process.env.BOOK_TOWN_SIZE_BASELINE === "write") {
    const baseline: Baseline = {
      readers: [SMALL, LARGE],
      bytesPerReader,
      msPerReader: Number(msPerReader.toFixed(2)),
    };
    await writeFile(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
    console.log("wrote tests/town-size-baseline.json");
    return;
  }

  const baseline = JSON.parse(await readFile(BASELINE, "utf8")) as Baseline;
  let passed = 0;
  const check = (name: string, run: () => void) => {
    run();
    passed += 1;
    console.log("PASS " + name);
  };
  check("no part of the town grows more with each reader than before", () => {
    for (const [part, bytes] of Object.entries(bytesPerReader))
      assert.ok(
        bytes <= Math.ceil((baseline.bytesPerReader[part] ?? 0) * BYTES_SLACK),
        `${part} grows by ${bytes} bytes a reader, more than the ` +
          `${baseline.bytesPerReader[part] ?? 0} in tests/town-size-baseline.json. ` +
          "Read it when its screen opens, or a window of it (AUD-006).",
      );
  });
  check("a part that grows less keeps what was won", () => {
    for (const [part, bytes] of Object.entries(baseline.bytesPerReader))
      assert.ok(
        (bytesPerReader[part] ?? 0) * BYTES_SLACK >= bytes,
        `${part} now grows by ${bytesPerReader[part] ?? 0} bytes a reader, ` +
          `less than the ${bytes} in tests/town-size-baseline.json: lower it ` +
          "(BOOK_TOWN_SIZE_BASELINE=write pnpm tsx tests/db-town-size.test.ts, then pnpm format).",
      );
  });
  check("the database takes no longer for each reader than before", () => {
    assert.ok(
      msPerReader <= Math.max(baseline.msPerReader * MS_SLACK, 0.05),
      `each reader adds ${msPerReader.toFixed(2)}ms to the town's answer, ` +
        `more than ${MS_SLACK} times the ${baseline.msPerReader}ms in ` +
        "tests/town-size-baseline.json.",
    );
  });
  console.log(`${passed} town size checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
