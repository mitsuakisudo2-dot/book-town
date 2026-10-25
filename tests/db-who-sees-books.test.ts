import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { databaseSearch } from "../src/lib/search/rank";
import { deleteAccounts, migratedDatabase } from "./fixtures/pglite-supabase";

// Who may read a book is written in four places, and they must answer
// alike for every book and every reader: the books' policy "books are seen
// where they are used" (row level security), the functions it asks
// (private.book_is_listed, book_is_mine, book_is_shared), the same rules in
// one query (private.seen_book_ids, for the town's newest books and the
// search), and the books a row could show the reader (private
// search_candidates, which must hold every book the reader may read, and
// whose sure ones the reader may read). copy_book copies exactly the books
// of others the reader may read. The other tests compare them on a few
// books (db-newest-books, db-search); this one builds a town of books made
// every way there is (typed in, by ISBN, held, 見本, the library's catalog,
// a copy, an owner who left) and used every way (records for everyone, for
// followers and private, posts, posters, readings, 人生の9冊, open and
// closed shops, back rooms and scenes, libraries, marks, encounters), among
// follows, blocks both ways, what the operator hid and a serious report
// holds; then hundreds more used at random. Each reader's answer from each
// place is compared, and for the hand-made books, with who should read it.
// Only reads: no migration is changed.

const AKI = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b2";
const CHI = "00000000-0000-4000-8000-0000000000c3";
const DAN = "00000000-0000-4000-8000-0000000000d4";
const ERI = "00000000-0000-4000-8000-0000000000e5";
const FUU = "00000000-0000-4000-8000-0000000000f6";
const GIN = "00000000-0000-4000-8000-0000000000a7";
const HANA = "00000000-0000-4000-8000-0000000000b8";
// Signed in with no profile: a token of someone never in the town.
const NOBODY = "00000000-0000-4000-8000-0000000000c9";

// Ben follows Aki and Fuu. Dan follows Aki and blocked Aki; Eri follows
// Aki, who blocked Eri. The operator hid Fuu's profile and Hana's shop.
// Gin leaves the town after the rows are written; Gin's token still asks.
const READERS: Record<string, string | null> = {
  visitor: null,
  aki: AKI,
  ben: BEN,
  chi: CHI,
  dan: DAN,
  eri: ERI,
  fuu: FUU,
  hana: HANA,
  gin: GIN,
  nobody: NOBODY,
};
type Name = keyof typeof READERS;
const NAMES = Object.keys(READERS) as Name[];
const PEOPLE = [AKI, BEN, CHI, DAN, ERI, FUU, GIN, HANA];
const ALL: Name[] = NAMES;

// Each hand-made book has a word of its own in its title, to be searched for.
const KANA =
  "かきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわ";
function word(n: number): string {
  let rest = n;
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out += KANA[rest % KANA.length];
    rest = Math.floor(rest / KANA.length) + 7 * (i + 1);
  }
  return out;
}

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface Case {
  /** What the book is and how it is used. */
  name: string;
  /** Who should read it. */
  readers: Name[];
}

const CASES: Record<string, Case> = {
  nothing: { name: "どこにも使っていない", readers: ["aki"] },
  library: { name: "ライブラリだけ", readers: ["aki"] },
  privateRecord: { name: "自分だけの記録", readers: ["aki"] },
  publicRecord: { name: "公開の記録", readers: ALL },
  followersRecord: {
    name: "フォロワーの記録",
    // Not Dan, who blocked Aki, nor Eri, whom Aki blocked.
    readers: ["aki", "ben"],
  },
  soloPost: { name: "ひとり読みの投稿", readers: ["aki"] },
  post: { name: "ふつうの投稿", readers: ALL },
  hiddenPost: { name: "運営が隠した投稿", readers: ["aki"] },
  heldPost: { name: "深刻な通報で預かった投稿", readers: ["aki"] },
  reply: { name: "返信の本", readers: ALL },
  draftPoster: { name: "下書きのポスター", readers: ["aki"] },
  poster: { name: "公開のポスター", readers: ALL },
  hiddenPoster: { name: "運営が隠したポスター", readers: ["aki"] },
  soloReading: { name: "ひとりの読書", readers: ["aki"] },
  togetherReading: { name: "一緒の読書", readers: ALL },
  nine: { name: "人生の9冊", readers: ALL },
  openShelf: { name: "開いた店の棚", readers: ALL },
  backRoom: { name: "開いた店の奥の棚", readers: ["aki"] },
  sceneBook: { name: "店内の飾りの本", readers: ALL },
  sceneBackBook: { name: "店内の見せない本", readers: ["aki"] },
  sceneUnplaced: { name: "店内に置いていない本", readers: ["aki"] },
  libraryShelf: {
    // Shelves are not shown to anyone else yet (shelf_audience).
    name: "みんなに見せる棚",
    readers: ["aki"],
  },
  isbnPrivate: { name: "ISBNの非公開の本", readers: ["aki"] },
  isbnPublic: { name: "ISBNの公開の本", readers: ALL },
  heldBook: { name: "保留の本", readers: ALL },
  heldPrivate: { name: "保留の非公開の本", readers: ["aki"] },
  // Chi met it on Aki's post, which Aki then took down. Chi's encounter
  // names Chi's copy (own_books_only), so Aki's book is Aki's again.
  metThenGone: { name: "出会ったあと消えた投稿", readers: ["aki"] },
  // Chi's shop is not open.
  closedShelf: { name: "準備中の店の棚", readers: ["chi"] },
  chiFollowers: {
    // Nobody follows Chi.
    name: "チーのフォロワーの記録",
    readers: ["chi"],
  },
  fuuPublic: { name: "隠れた人の公開の記録", readers: ["fuu"] },
  fuuFollowers: { name: "隠れた人のフォロワーの記録", readers: ["fuu"] },
  fuuShelf: { name: "隠れた人の店の棚", readers: ["fuu"] },
  hanaShelf: { name: "隠した店の棚", readers: ["hana"] },
  // Hana copied Aki's book in a public record (copy_book): the copy is
  // Hana's, used nowhere anyone may see.
  hanaCopy: { name: "写した本", readers: ["hana"] },
  // Gin's book in Gin's post, before Gin left: no owner now, used nowhere.
  ginPost: { name: "去った人の投稿", readers: [] },
  // Ben met Gin's book on Gin's post, in a copy of his: Gin's own is
  // nobody's once Gin left.
  ginMet: { name: "去った人の出会った本", readers: [] },
  ginRecord: { name: "去った人の公開の記録", readers: [] },
  // 見本, which have no owner: each used one way.
  sampleUnused: { name: "使っていない見本", readers: [] },
  sampleShelf: { name: "開いた店の棚の見本", readers: ALL },
  sampleMarked: { name: "印を付けた見本", readers: ["ben"] },
  sampleTakenOut: { name: "ライブラリから出した見本", readers: [] },
  samplePrivate: { name: "自分だけの記録の見本", readers: ["ben"] },
  sampleFollowers: { name: "フォロワーの記録の見本", readers: ["aki", "ben"] },
  sampleBackRoom: { name: "奥の棚の見本", readers: ["aki"] },
  // The library's catalog: everyone's, however it is used.
  catalog: { name: "目録の本", readers: ALL },
  catalogPrivate: { name: "自分だけの記録の目録の本", readers: ALL },
};
const KEYS = Object.keys(CASES);
const bookOf = (key: string) => id(1, KEYS.indexOf(key) + 1);
const titleOf = (key: string) =>
  `しらべ ${word(KEYS.indexOf(key) + 1)} ${CASES[key].name}`;
/** An ISBN of its own, with its check digit: 978-4-00 and then n. */
const isbn = (n: number) => {
  const body = `978400${String(n).padStart(6, "0")}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(body[i]) * (i % 2 ? 3 : 1);
  return body + String((10 - (sum % 10)) % 10);
};

const shelf = (shelfId: string, isPublic: boolean, books: string[]) => ({
  id: shelfId,
  name: "棚",
  isPublic,
  items: books.map((bookId) => ({ bookId })),
});

async function as<T = Record<string, unknown>>(
  db: PGlite,
  reader: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await db.exec(
    reader
      ? `set role authenticated; select set_config('request.jwt.claim.sub', '${reader}', false);`
      : `set role anon; select set_config('request.jwt.claim.sub', '', false);`,
  );
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec(
      "reset role; select set_config('request.jwt.claim.sub', '', false);",
    );
  }
}

/** The 見本 the migrations made, by private.is_sample_book. */
async function samples(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    "select id from books where private.is_sample_book(id) order by id",
  );
  return rows.map((row) => row.id);
}

async function handMade(db: PGlite, sample: Record<string, string>) {
  const manual = KEYS.filter((key) => !key.startsWith("sample"));
  const ownerOf = (key: string) =>
    key.startsWith("chi")
      ? CHI
      : key === "closedShelf"
        ? CHI
        : key.startsWith("fuu")
          ? FUU
          : key.startsWith("hana")
            ? HANA
            : key.startsWith("gin")
              ? GIN
              : AKI;
  const rows = manual
    .filter((key) => key !== "hanaCopy")
    .map((key) => {
      const number = /^(isbn|held)/.test(key)
        ? `'${isbn(KEYS.indexOf(key) + 1)}'`
        : "null";
      const source = key.startsWith("catalog")
        ? "'ndl', null"
        : `'manual', '${ownerOf(key)}'`;
      return `('${bookOf(key)}', '${titleOf(key)}', '著者', ${number}, ${source})`;
    });
  const b = bookOf;
  const pages = (book: string) =>
    JSON.stringify([{ blocks: [{ type: "books", book_ids: [book] }] }]);
  const scene = JSON.stringify({
    objects: [
      { id: "row-open", kind: "row", isPublic: true },
      { id: "row-back", kind: "row", isPublic: false },
      { id: "s1", kind: "book", parentId: "row-open", bookId: b("sceneBook") },
      {
        id: "s2",
        kind: "book",
        parentId: "row-open",
        bookId: b("sceneBackBook"),
        isPublic: false,
      },
      {
        id: "s3",
        kind: "book",
        parentId: "row-open",
        bookId: b("sceneUnplaced"),
        placed: false,
      },
    ],
  });
  const akiShelves = JSON.stringify([
    shelf("open", true, [b("openShelf"), sample.sampleShelf]),
    shelf("back", false, [b("backRoom"), sample.sampleBackRoom]),
  ]);
  await db.exec(`
    insert into books (id, title, author, isbn, source, created_by) values
      ${rows.join(",\n      ")};
    insert into library_entries (user_id, book_id, source) values
      ('${AKI}', '${b("library")}', 'manual'),
      ('${AKI}', '${b("libraryShelf")}', 'manual');
    insert into library_shelves (id, user_id, name, position, audience) values
      ('${id(9, 1)}', '${AKI}', 'みんなの棚', 'a', 'everyone');
    insert into library_shelf_books (shelf_id, user_id, book_id) values
      ('${id(9, 1)}', '${AKI}', '${b("libraryShelf")}');
    insert into reading_entries (user_id, book_id, kind, is_public, audience) values
      ('${AKI}', '${b("privateRecord")}', 'finished', false, 'private'),
      ('${AKI}', '${b("publicRecord")}', 'finished', true, 'everyone'),
      ('${AKI}', '${b("followersRecord")}', 'finished', false, 'followers'),
      ('${AKI}', '${b("isbnPrivate")}', 'finished', false, 'private'),
      ('${AKI}', '${b("isbnPublic")}', 'finished', true, 'everyone'),
      ('${AKI}', '${b("heldBook")}', 'finished', true, 'everyone'),
      ('${AKI}', '${b("heldPrivate")}', 'finished', false, 'private'),
      ('${AKI}', '${b("catalogPrivate")}', 'finished', false, 'private'),
      ('${AKI}', '${sample.sampleFollowers}', 'finished', false, 'followers'),
      ('${CHI}', '${b("chiFollowers")}', 'finished', false, 'followers'),
      ('${FUU}', '${b("fuuPublic")}', 'finished', true, 'everyone'),
      ('${FUU}', '${b("fuuFollowers")}', 'finished', false, 'followers'),
      ('${GIN}', '${b("ginRecord")}', 'finished', true, 'everyone'),
      ('${BEN}', '${sample.samplePrivate}', 'finished', false, 'private');
    insert into posts (id, author_id, body, book_id, reading_mode) values
      ('${id(8, 1)}', '${AKI}', 'ひとり', '${b("soloPost")}', 'solo'),
      ('${id(8, 2)}', '${AKI}', 'みんな', '${b("post")}', null),
      ('${id(8, 3)}', '${AKI}', '隠される', '${b("hiddenPost")}', null),
      ('${id(8, 4)}', '${AKI}', '預かられる', '${b("heldPost")}', null),
      ('${id(8, 5)}', '${AKI}', '消す', '${b("metThenGone")}', null),
      ('${id(8, 7)}', '${GIN}', '去る前に', '${b("ginPost")}', null),
      ('${id(8, 8)}', '${GIN}', '出会われる', '${b("ginMet")}', null);
    insert into posts (author_id, body, book_id, parent_id) values
      ('${AKI}', '返す', '${b("reply")}', '${id(8, 2)}');
    insert into moderation_hides (target_kind, target_id) values
      ('post', '${id(8, 3)}'), ('profile', '${FUU}');
    insert into moderation_folds (target_kind, target_id, state, owner_id) values
      ('post', '${id(8, 4)}', 'held', '${AKI}');
    insert into posters (id, author_id, template, pages, status) values
      ('${id(7, 1)}', '${AKI}', 'one_book', '${pages(b("draftPoster"))}', 'draft'),
      ('${id(7, 2)}', '${AKI}', 'one_book', '${pages(b("poster"))}', 'published'),
      ('${id(7, 3)}', '${AKI}', 'one_book', '${pages(b("hiddenPoster"))}', 'published');
    insert into moderation_hides (target_kind, target_id) values ('poster', '${id(7, 3)}');
    insert into reading_sessions (user_id, book_id, mode, started_at, ended_at) values
      ('${AKI}', '${b("soloReading")}', 'solo', now() - interval '2 days', now() - interval '1 day'),
      ('${AKI}', '${b("togetherReading")}', 'together', now() - interval '2 days', null);
    insert into profile_nine (profile_id, position, book_id) values
      ('${AKI}', 1, '${b("nine")}');
    insert into shops (id, owner_id, name, is_open) values
      ('${id(6, 1)}', '${AKI}', 'アキの店', true),
      ('${id(6, 3)}', '${CHI}', 'チーの準備中の店', false),
      ('${id(6, 6)}', '${FUU}', 'フーの店', true),
      ('${id(6, 8)}', '${HANA}', 'ハナの店', true);
    insert into shop_private (shop_id, shelves, scene) values
      ('${id(6, 1)}', '${akiShelves}', '${scene}'),
      ('${id(6, 3)}', '${JSON.stringify([shelf("c", true, [b("closedShelf")])])}', null),
      ('${id(6, 6)}', '${JSON.stringify([shelf("f", true, [b("fuuShelf")])])}', null),
      ('${id(6, 8)}', '${JSON.stringify([shelf("h", true, [b("hanaShelf")])])}', null)
    on conflict (shop_id) do update
      set shelves = excluded.shelves, scene = excluded.scene;
    insert into moderation_hides (target_kind, target_id) values ('shop', '${id(6, 8)}');
    -- 見本.
    insert into book_marks (user_id, book_id, kind) values
      ('${BEN}', '${sample.sampleMarked}', 'wish');
    insert into library_entries (user_id, book_id, source, removed_at) values
      ('${CHI}', '${sample.sampleTakenOut}', 'manual', now());
  `);
  // Met on a post, as the app meets it: in a copy of the reader's own
  // (copy_book), which the encounter names. Then Aki takes the post down.
  for (const [reader, book, post] of [
    [CHI, b("metThenGone"), id(8, 5)],
    [BEN, b("ginMet"), id(8, 8)],
  ]) {
    const [{ copy }] = await as<{ copy: string }>(
      db,
      reader,
      "select gen_random_uuid() as copy",
    );
    await as(db, reader, "select copy_book($1, $2)", [book, copy]);
    await as(
      db,
      reader,
      `insert into book_encounters (id, user_id, book_id, kind, via, post_id)
       values (gen_random_uuid(), $1, $2, 'want', 'post', $3)`,
      [reader, copy, post],
    );
  }
  await db.exec(`delete from posts where id = '${id(8, 5)}'`);
  // Held: Aki's two books clearly another (bibliography_holds).
  await db.exec(`
    update private.book_checks c
    set checked_at = now(), verdict = 'apart', judged_at = now(), held_work = b.work_id
    from books b
    where b.id = c.book_id and b.id in ('${b("heldBook")}', '${b("heldPrivate")}');
  `);
  const { rows: held } = await db.query(
    "select 1 from private.book_checks where held_work is not null",
  );
  assert.equal(held.length, 2, "two books held");
  // Hana copies Aki's book in a public record, as the app does.
  await as(db, HANA, "select copy_book($1, $2)", [
    b("publicRecord"),
    b("hanaCopy"),
  ]);
  await db.query("update books set title = $1 where id = $2", [
    titleOf("hanaCopy"),
    b("hanaCopy"),
  ]);
  await as(
    db,
    HANA,
    "insert into library_entries (user_id, book_id, source) values ($1, $2, 'manual')",
    [HANA, b("hanaCopy")],
  );
}

/** A little random number maker, the same every run. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RANDOM = 360;

/**
 * Books of every reader still in the town, each used a few ways at random
 * by its owner (a reader's rows name only their own books), and 見本 used
 * by anyone; and the operator hides a few of the rows.
 */
async function atRandom(db: PGlite, sample: string[]) {
  const next = seeded(20261020);
  const pick = <T>(list: T[]) => list[Math.floor(next() * list.length)];
  const owners = [AKI, BEN, CHI, DAN, ERI, FUU, HANA];
  const books: string[] = [];
  const sql: string[] = [];
  const shelves = new Map<
    string,
    { open: string[]; back: string[]; scene: string[] }
  >();
  const nine = new Map<string, number>();
  const owned = new Set<string>();
  const audiences = ["private", "followers", "everyone"];
  for (let n = 1; n <= RANDOM; n += 1) {
    const book = id(2, n);
    const owner = pick(owners);
    // A few share an ISBN, so their edition holds books of others too; a
    // reader keeps one book of an ISBN (AUD-010), so a second has none.
    const shared = next() < 0.3 ? isbn(1000 + (n % 90)) : null;
    const own = `${owner} ${shared}`;
    const number = shared && !owned.has(own) ? `'${shared}'` : "null";
    if (shared) owned.add(own);
    books.push(book);
    sql.push(
      `insert into books (id, title, author, isbn, source, created_by) values
        ('${book}', 'ためし ${n}', '著者', ${number}, 'manual', '${owner}');`,
    );
    const uses = Math.floor(next() * 4);
    for (let u = 0; u < uses; u += 1) {
      const kind = Math.floor(next() * 9);
      if (kind === 0) {
        const audience = pick(audiences);
        sql.push(`insert into reading_entries (user_id, book_id, kind, is_public, audience)
          values ('${owner}', '${book}', 'finished', ${audience === "everyone"}, '${audience}');`);
      } else if (kind === 1) {
        const post = id(3, n * 10 + u);
        sql.push(`insert into posts (id, author_id, body, book_id, reading_mode)
          values ('${post}', '${owner}', 'ためし', '${book}', ${next() < 0.4 ? "'solo'" : "null"});`);
        if (next() < 0.2)
          sql.push(
            `insert into moderation_hides (target_kind, target_id) values ('post', '${post}');`,
          );
      } else if (kind === 2) {
        const poster = id(4, n * 10 + u);
        sql.push(`insert into posters (id, author_id, template, pages, status) values
          ('${poster}', '${owner}', 'one_book',
           '${JSON.stringify([{ blocks: [{ type: "books", book_ids: [book] }] }])}',
           '${next() < 0.5 ? "draft" : "published"}');`);
        if (next() < 0.2)
          sql.push(
            `insert into moderation_hides (target_kind, target_id) values ('poster', '${poster}');`,
          );
      } else if (kind === 3) {
        // Ended: one reading at a time runs.
        sql.push(`insert into reading_sessions (user_id, book_id, mode, started_at, ended_at)
          values ('${owner}', '${book}', '${next() < 0.5 ? "solo" : "together"}',
            now() - interval '2 days', now() - interval '1 day');`);
      } else if (kind === 4) {
        const at = (nine.get(owner) ?? 0) + 1;
        if (at <= 9) {
          nine.set(owner, at);
          sql.push(`insert into profile_nine (profile_id, position, book_id)
            values ('${owner}', ${at}, '${book}') on conflict do nothing;`);
        }
      } else if (kind === 5 && ![AKI, CHI, FUU, HANA].includes(owner)) {
        // On a shelf or in the scene of a shop of its own (the hand-made
        // books' shops are left as they are).
        const shop = shelves.get(owner) ?? { open: [], back: [], scene: [] };
        const where = pick(["open", "back", "scene"] as const);
        shop[where].push(book);
        shelves.set(owner, shop);
      } else if (kind === 6) {
        sql.push(`insert into library_entries (user_id, book_id, source, removed_at)
          values ('${owner}', '${book}', 'manual', ${next() < 0.3 ? "now()" : "null"})
          on conflict do nothing;`);
      } else if (kind === 7) {
        sql.push(`insert into book_marks (user_id, book_id, kind)
          values ('${owner}', '${book}', 'wish') on conflict do nothing;`);
      } else {
        // A 見本, used by anyone.
        const reader = pick(owners);
        const s = pick(sample);
        const audience = pick(audiences);
        sql.push(`insert into reading_entries (user_id, book_id, kind, is_public, audience)
          values ('${reader}', '${s}', 'finished', ${audience === "everyone"}, '${audience}');`);
      }
    }
  }
  for (const [owner, shop] of shelves) {
    const shelvesJson = JSON.stringify([
      shelf("r-open", true, shop.open),
      shelf("r-back", false, shop.back),
    ]);
    const scene = JSON.stringify({
      objects: [
        { id: "r-row", kind: "row", isPublic: next() < 0.7 },
        ...shop.scene.map((bookId, k) => ({
          id: `r${k}`,
          kind: "book",
          parentId: "r-row",
          bookId,
          isPublic: next() < 0.7,
        })),
      ],
    });
    sql.push(`insert into shops (owner_id, name, is_open) values
        ('${owner}', '店', ${next() < 0.6});
      insert into shop_private (shop_id, shelves, scene)
        select s.id, '${shelvesJson}', '${scene}' from shops s where s.owner_id = '${owner}'
      on conflict (shop_id) do update set shelves = excluded.shelves, scene = excluded.scene;`);
  }
  await db.exec(sql.join("\n"));
  return books;
}

async function town() {
  const db = await migratedDatabase();
  await db.exec(`
    insert into auth.users (id) values
      ${PEOPLE.map((who) => `('${who}')`).join(", ")};
    insert into profiles (id, handle, name) values
      ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'), ('${CHI}', 'chi', 'チー'),
      ('${DAN}', 'dan', 'ダン'), ('${ERI}', 'eri', 'エリ'), ('${FUU}', 'fuu', 'フー'),
      ('${GIN}', 'gin', 'ギン'), ('${HANA}', 'hana', 'ハナ');
    insert into blocks (blocker_id, blocked_id) values
      ('${DAN}', '${AKI}'), ('${AKI}', '${ERI}');
    -- A block takes the follows between the two away; these are put after
    -- it, so only may_see's own question about blocks keeps them out.
    insert into profile_follows (follower_id, followee_id) values
      ('${BEN}', '${AKI}'), ('${BEN}', '${FUU}'), ('${DAN}', '${AKI}'), ('${ERI}', '${AKI}');
  `);
  const all = await samples(db);
  assert.ok(all.length >= 8, "the migrations' 見本");
  const sampleKeys = KEYS.filter((key) => key.startsWith("sample"));
  const sample = Object.fromEntries(sampleKeys.map((key, n) => [key, all[n]]));
  await handMade(db, sample);
  const randomBooks = await atRandom(db, all.slice(sampleKeys.length));
  // Gin leaves: Gin's rows go, Gin's books stay without an owner.
  await deleteAccounts(db, [GIN]);
  const { rows: follows } = await db.query("select 1 from profile_follows");
  assert.equal(follows.length, 4, "the follows stay");
  await db.exec("analyze");
  return { db, sample, randomBooks };
}

const sorted = (ids: string[]) => [...ids].sort();

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const { db, sample, randomBooks } = await town();
  const bookId = (key: string) =>
    key.startsWith("sample") ? sample[key] : bookOf(key);
  const everyBook = (
    await db.query<{ id: string }>("select id from books order by id")
  ).rows.map((row) => row.id);
  assert.ok(everyBook.length > RANDOM + KEYS.length);

  // What each place answers, for each reader, over every book.
  const policy: Record<string, string[]> = {};
  for (const name of NAMES)
    policy[name] = sorted(
      (await as<{ id: string }>(db, READERS[name], "select id from books")).map(
        (row) => row.id,
      ),
    );

  await check(
    "the hand-made books are read by whom they should be",
    async () => {
      for (const key of KEYS) {
        const book = bookId(key);
        const readers = NAMES.filter((name) => policy[name].includes(book));
        assert.deepEqual(
          readers,
          CASES[key].readers,
          `${key} (${CASES[key].name})`,
        );
      }
    },
  );

  await check("the policy's functions answer as the policy does", async () => {
    for (const name of NAMES) {
      const reader = READERS[name];
      // As the database's owner, who reads every row, asking for the reader.
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        reader ?? "",
      ]);
      try {
        const { rows } = await db.query<{ id: string }>(
          `select id from books
           where source <> 'manual'
             or created_by = (select auth.uid())
             or private.book_is_listed(id)
             or private.book_is_mine(id)
             or private.book_is_shared(id)`,
        );
        assert.deepEqual(sorted(rows.map((row) => row.id)), policy[name], name);
        // And book_is_listed is the same for everyone: what a visitor reads.
        const { rows: listed } = await db.query<{ id: string }>(
          `select id from books
           where source = 'manual' and private.book_is_listed(id)`,
        );
        const visitorTyped = (
          await db.query<{ id: string }>(
            "select id from books where source = 'manual' and id = any($1::uuid[])",
            [policy.visitor],
          )
        ).rows.map((row) => row.id);
        assert.deepEqual(
          sorted(listed.map((row) => row.id)),
          sorted(visitorTyped),
          name,
        );
      } finally {
        await db.query("select set_config('request.jwt.claim.sub', '', false)");
      }
    }
  });

  // seen_book_ids and search_candidates are not served to readers; the
  // newest books and the search call them. Here they are asked directly.
  async function asked<T>(run: () => Promise<T>): Promise<T> {
    await db.exec(`begin;
      grant execute on function private.seen_book_ids(uuid[]) to anon, authenticated;
      grant execute on function private.search_candidates(uuid[]) to anon, authenticated;`);
    try {
      return await run();
    } finally {
      await db.exec("rollback");
    }
  }

  await check(
    "seen_book_ids gives each reader what the policy gives",
    async () => {
      await asked(async () => {
        for (const name of NAMES) {
          const seen = (
            await as<{ id: string }>(
              db,
              READERS[name],
              "select s.id from private.seen_book_ids($1::uuid[]) s(id)",
              [everyBook],
            )
          ).map((row) => row.id);
          assert.equal(new Set(seen).size, seen.length, `${name}: each once`);
          assert.deepEqual(sorted(seen), policy[name], name);
          // Asked a few books at a time, as keep_seen_books asks, the same.
          const bySlices: string[] = [];
          for (let at = 0; at < everyBook.length; at += 37)
            bySlices.push(
              ...(
                await as<{ id: string }>(
                  db,
                  READERS[name],
                  "select s.id from private.seen_book_ids($1::uuid[]) s(id)",
                  [everyBook.slice(at, at + 37)],
                )
              ).map((row) => row.id),
            );
          assert.deepEqual(
            sorted(bySlices),
            policy[name],
            `${name}, in slices`,
          );
        }
      });
    },
  );

  await check(
    "search_candidates holds every book the reader may read, and its sure ones are theirs",
    async () => {
      await asked(async () => {
        for (const name of NAMES) {
          const rows = await as<{ id: string; sure: boolean }>(
            db,
            READERS[name],
            "select c.id, c.sure from private.search_candidates($1::uuid[]) c",
            [everyBook],
          );
          const candidates = new Set(rows.map((row) => row.id));
          for (const book of policy[name])
            assert.ok(
              candidates.has(book),
              `${name}: a book it may read, ${book}`,
            );
          for (const row of rows.filter((row) => row.sure))
            assert.ok(
              policy[name].includes(row.id),
              `${name}: sure, ${row.id}`,
            );
        }
      });
    },
  );

  await check("the town's newest books are what the policy gives", async () => {
    for (const name of NAMES) {
      const [{ ids }] = await as<{ ids: string[] }>(
        db,
        READERS[name],
        "select private.newest_book_ids(1000) as ids",
      );
      const typed = (
        await as<{ id: string }>(
          db,
          READERS[name],
          "select id from books where source = 'manual' order by created_at desc, id desc",
        )
      ).map((row) => row.id);
      assert.deepEqual(ids, typed, name);
    }
  });

  await check(
    "the search finds each hand-made book for whom it should",
    async () => {
      for (const name of NAMES) {
        const editions = new Map(
          (
            await db.query<{ id: string; edition_id: string }>(
              "select id, edition_id from books where id = any($1::uuid[])",
              [policy[name]],
            )
          ).rows.map((row) => [row.id, row.edition_id]),
        );
        for (const key of KEYS) {
          const book = bookId(key);
          const asked = key.startsWith("sample")
            ? (
                await db.query<{ title: string }>(
                  "select title from books where id = $1",
                  [book],
                )
              ).rows[0].title
            : word(KEYS.indexOf(key) + 1);
          const [{ ids }] = await as<{ ids: string[] }>(
            db,
            READERS[name],
            "select coalesce(jsonb_agg(b ->> 'id'), '[]') as ids from jsonb_array_elements(find_books($1::jsonb, null, null, 100)) b",
            [JSON.stringify(databaseSearch(asked)!.forms)],
          );
          for (const found of ids)
            assert.ok(
              policy[name].includes(found),
              `${name} finds only what it may read`,
            );
          // One book of each edition is kept, the reader's own first.
          const foundEditions = new Set(
            ids.map((found) => editions.get(found)),
          );
          assert.equal(
            policy[name].includes(book) &&
              foundEditions.has(editions.get(book)),
            policy[name].includes(book),
            `${name} searching for ${key}`,
          );
        }
      }
    },
  );

  await check(
    "copy_book copies exactly the others' books the reader may read",
    async () => {
      const others = (
        await db.query<{
          id: string;
          created_by: string | null;
          isbn: string | null;
        }>(
          `select id, created_by, isbn from books
         where source = 'manual' and not private.is_sample_book(id)
           and id = any($1::uuid[])`,
          [[...KEYS.map(bookId), ...randomBooks.slice(0, 120)]],
        )
      ).rows;
      // A reader keeps one book of an ISBN (AUD-010): a copy of one they
      // may read is refused when they have a book of its ISBN already (the
      // app names theirs instead, own-books.ts).
      const owned = new Set(
        (
          await db.query<{ own: string }>(
            "select created_by || ' ' || isbn as own from books where created_by is not null and isbn is not null",
          )
        ).rows.map((row) => row.own),
      );
      for (const name of NAMES) {
        const reader = READERS[name];
        // Only readers in the town keep books.
        if (!reader || name === "gin" || name === "nobody") continue;
        for (const book of others) {
          if (book.created_by === reader) continue;
          // In a transaction undone after, which takes the role back too.
          await db.exec(`begin; set local role authenticated;
          select set_config('request.jwt.claim.sub', '${reader}', true);`);
          const reads: boolean = policy[name].includes(book.id);
          const ownsOne: boolean = reads && owned.has(`${reader} ${book.isbn}`);
          let copied = true;
          try {
            await db.query("select copy_book($1, gen_random_uuid())", [
              book.id,
            ]);
          } catch (error) {
            assert.match(
              String(error),
              ownsOne ? /books_own_isbn/ : /no book has that id/,
            );
            copied = false;
          } finally {
            await db.exec("rollback");
          }
          assert.equal(copied, reads && !ownsOne, `${name} copying ${book.id}`);
        }
      }
    },
  );

  await check(
    "the random books are read by some and not by others",
    async () => {
      // So the comparisons above meant something: each reader reads some of
      // the random books and not others, and some only by book_is_shared.
      for (const name of NAMES.filter(
        (name) => name !== "gin" && name !== "nobody",
      )) {
        const read = randomBooks.filter((book) => policy[name].includes(book));
        assert.ok(
          read.length > 0 && read.length < RANDOM,
          `${name}: ${read.length}`,
        );
      }
      assert.ok(
        policy.ben.length > policy.visitor.length + 10,
        "a follower reads more than a visitor",
      );
    },
  );

  console.log(`${passed} who sees books checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
