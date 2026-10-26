import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  deleteAccounts,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// 読書記録の最初の工事のデータの形 (item 18, supabase/migrations/*_reading_cards.sql;
// docs/機能/読書記録.md). One reading is one card of the reader's own (the
// clock, the room and the card's look), every book read in it is on that
// card with its own time and pages, and 今日のノート are on the card at a
// book of it. Nobody else reads any of it, it names only the reader's own
// sessions, and it goes with the sessions and the card (記録しない) and with
// the account.

const FILES = migrationFiles();
// Found by its name's end: the date in front may change before it merges.
const FILE = FILES.find((file) => file.endsWith("_reading_cards.sql"));
assert.ok(FILE, "the reading cards migration");
const TEXT = migrationText(FILE);

const AKI = "00000000-0000-4000-8000-00000000000a"; // reads
const BEN = "00000000-0000-4000-8000-00000000000b"; // reads together
const CHI = "00000000-0000-4000-8000-00000000000c"; // looks on
const DAI = "00000000-0000-4000-8000-00000000000d"; // keeps only their reading

const id = (group: number, n: number) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const book = (n: number) => id(2, n);
const session = (n: number) => id(3, n);
const note = (n: number) => id(4, n);
const cardOf = (n: number) => id(5, n);

const TABLES = ["reading_cards", "reading_card_books", "reading_notes"];

const SEED = `
  insert into auth.users (id) values ('${AKI}'), ('${BEN}'), ('${CHI}'), ('${DAI}');
  insert into profiles (id, handle, name) values
    ('${AKI}', 'aki', 'アキ'), ('${BEN}', 'ben', 'ベン'), ('${CHI}', 'chi', 'チー');
  insert into profiles (id, handle, name, published) values ('${DAI}', null, '', false);
`;

type Visitor = string | null;

async function migrated(upTo?: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of FILES.filter((file) => !upTo || file < upTo))
    await db.exec(migrationText(file));
  await db.exec(SEED);
  return db;
}

function helpers(db: PGlite) {
  const rows = async <T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> => (await db.query<T>(sql, params)).rows;
  const signIn = (visitor: Visitor) =>
    db.exec(
      visitor
        ? `set role authenticated; select set_config('request.jwt.claim.sub', '${visitor}', false);`
        : `set role anon; select set_config('request.jwt.claim.sub', '', false);`,
    );
  async function as<T = Record<string, unknown>>(
    visitor: Visitor,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    await signIn(visitor);
    try {
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec("reset role");
    }
  }
  async function refused(
    visitor: Visitor,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ code?: string; message: string; detail?: string }> {
    try {
      await as(visitor, sql, params);
    } catch (error) {
      return error as { code?: string; message: string; detail?: string };
    }
    assert.fail("expected a refusal: " + sql);
  }
  async function affected(
    visitor: Visitor,
    sql: string,
    params: unknown[] = [],
  ): Promise<number> {
    await signIn(visitor);
    try {
      return (await db.query(sql, params)).affectedRows ?? 0;
    } finally {
      await db.exec("reset role");
    }
  }
  const typed = (reader: string, bookId: string) =>
    as(
      reader,
      `insert into books (id, title, author, source, created_by)
       values ($1, '本', '著者', 'manual', $2)`,
      [bookId, reader],
    );
  /** A session as the app starts one: made by the device, ended or not. */
  const read = (
    reader: string,
    sessionId: string,
    bookId: string | null,
    { mode = "solo", ended = true } = {},
  ) =>
    as(
      reader,
      `insert into reading_sessions (id, user_id, book_id, mode, started_at, ended_at)
       values ($1, $2, $3, $4, now() - interval '30 minutes', ${ended ? "now()" : "null"})`,
      [sessionId, reader, bookId, mode],
    );
  /** "col, col=value, value": more columns of the row and their values. */
  const more = (extra: string) =>
    extra
      ? [", " + extra.split("=")[0], ", " + extra.slice(extra.indexOf("=") + 1)]
      : ["", ""];
  const card = (reader: string, cardId: string, extra = "") => {
    const [columns, values] = more(extra);
    return as(
      reader,
      `insert into reading_cards (id, user_id${columns}) values ($1, $2${values})`,
      [cardId, reader],
    );
  };
  const onCard = (
    reader: string,
    cardId: string,
    sessionId: string,
    extra = "",
  ) => {
    const [columns, values] = more(extra);
    return as(
      reader,
      `insert into reading_card_books (user_id, card_id, session_id${columns})
       values ($1, $2, $3${values})`,
      [reader, cardId, sessionId],
    );
  };
  const write = (
    reader: string,
    noteId: string,
    cardId: string,
    sessionId: string | null,
    kind = "thought",
    body = "灯りの描写が好き",
  ) =>
    as(
      reader,
      `insert into reading_notes (id, user_id, card_id, session_id, kind, body)
       values ($1, $2, $3, $4, $5, $6)`,
      [noteId, reader, cardId, sessionId, kind, body],
    );
  /** One reading of one book, as the app makes it: session, card, its book. */
  const reading = async (
    reader: string,
    cardId: string,
    sessionId: string,
    bookId: string | null,
    options: { mode?: string; ended?: boolean } = {},
  ) => {
    await read(reader, sessionId, bookId, options);
    await card(reader, cardId);
    await onCard(reader, cardId, sessionId);
  };
  return {
    rows,
    as,
    refused,
    affected,
    typed,
    read,
    card,
    onCard,
    write,
    reading,
  };
}

const tests: [string, () => Promise<void>][] = [];
const test = (name: string, run: () => Promise<void>) =>
  tests.push([name, run]);

test("a card, its books and its notes are the reader's own", async () => {
  const db = await migrated();
  const { as, refused, affected, typed, reading, write } = helpers(db);
  await typed(AKI, book(1));
  await reading(AKI, cardOf(1), session(1), book(1));
  await as(
    AKI,
    "update reading_card_books set page_to = 42 where session_id = $1",
    [session(1)],
  );
  await write(AKI, note(1), cardOf(1), session(1));
  assert.deepEqual(await as(AKI, "select id, look, shown from reading_cards"), [
    { id: cardOf(1), look: null, shown: {} },
  ]);
  assert.deepEqual(
    await as(
      AKI,
      "select card_id, session_id, page_to from reading_card_books",
    ),
    [{ card_id: cardOf(1), session_id: session(1), page_to: 42 }],
  );
  assert.deepEqual(
    await as(
      AKI,
      "select id, card_id, session_id, kind, body from reading_notes",
    ),
    [
      {
        id: note(1),
        card_id: cardOf(1),
        session_id: session(1),
        kind: "thought",
        body: "灯りの描写が好き",
      },
    ],
  );
  for (const table of TABLES) {
    // Nobody else reads them, and nothing is open to anon.
    assert.deepEqual(await as(CHI, `select * from ${table}`), [], table);
    assert.equal(
      (await refused(null, `select * from ${table}`)).code,
      "42501",
      `anon reads no ${table}`,
    );
    // Nor changes them.
    const change = {
      reading_cards: "look = 'window'",
      reading_card_books: "page_to = 1",
      reading_notes: "body = '書き換え'",
    }[table];
    assert.equal(
      await affected(CHI, `update ${table} set ${change}`),
      0,
      table,
    );
  }
  // Nor deletes them.
  assert.equal(await affected(CHI, "delete from reading_cards"), 0);
  assert.equal(await affected(CHI, "delete from reading_notes"), 0);
  // Never in another's name.
  for (const [sql, params] of [
    [
      "insert into reading_cards (id, user_id) values ($1, $2)",
      [cardOf(2), AKI],
    ],
    [
      "insert into reading_card_books (user_id, card_id, session_id) values ($1, $2, $3)",
      [AKI, cardOf(1), session(1)],
    ],
    [
      `insert into reading_notes (id, user_id, card_id, kind, body)
       values ($1, $2, $3, 'word', '灯り')`,
      [note(2), AKI, cardOf(1)],
    ],
  ] as const)
    assert.equal((await refused(CHI, sql, [...params])).code, "42501", sql);
  assert.equal(
    (
      await refused(
        null,
        `insert into reading_notes (id, user_id, card_id, kind, body)
         values ($1, $2, $3, 'word', '灯り')`,
        [note(2), AKI, cardOf(1)],
      )
    ).code,
    "42501",
  );
  // Nor can Chi put Aki's reading on a card of his.
  await as(CHI, "insert into reading_cards (id, user_id) values ($1, $2)", [
    cardOf(9),
    CHI,
  ]);
  assert.equal(
    (
      await refused(
        CHI,
        `insert into reading_card_books (user_id, card_id, session_id)
         values ($1, $2, $3)`,
        [CHI, cardOf(9), session(1)],
      )
    ).code,
    "23503",
  );
});

test("a card's book names only a session of the reader's own, and tells nothing of others'", async () => {
  const db = await migrated();
  const { as, refused, typed, read, card, onCard, write, reading } =
    helpers(db);
  await typed(BEN, book(2));
  // Ben reads together, so everyone sees the session.
  await read(BEN, session(2), book(2), { mode: "together", ended: false });
  assert.equal((await as(AKI, "select id from reading_sessions")).length, 1);
  await card(AKI, cardOf(1));
  // Aki naming it on her card is refused alike whether it is on a card of
  // Ben's yet, or is not there at all: nothing says which, nor what was asked.
  const attempt = async (sessionId: string) => {
    const { code, message, detail } = await refused(
      AKI,
      `insert into reading_card_books (user_id, card_id, session_id)
       values ($1, $2, $3)`,
      [AKI, cardOf(1), sessionId],
    );
    return { code, message, detail };
  };
  const notOnACard = await attempt(session(2));
  await card(BEN, cardOf(2));
  await onCard(BEN, cardOf(2), session(2));
  const onBens = await attempt(session(2));
  const nothingThere = await attempt(session(9));
  assert.equal(notOnACard.code, "23503");
  assert.deepEqual(onBens, notOnACard);
  assert.deepEqual(nothingThere, notOnACard);
  assert.ok(
    !`${onBens.message} ${onBens.detail}`.includes(session(2)),
    "the session asked about is not told back",
  );
  // Nor can a note of hers name Ben's card. One naming his book is on her
  // card at no book, as one naming a book not there is.
  assert.equal(
    (
      await refused(
        AKI,
        `insert into reading_notes (id, user_id, card_id, kind, body)
         values ($1, $2, $3, 'word', '灯り')`,
        [note(3), AKI, cardOf(2)],
      )
    ).code,
    "23503",
  );
  await write(AKI, note(3), cardOf(1), session(2), "word", "灯り");
  await write(AKI, note(4), cardOf(1), session(9), "word", "灯り");
  assert.deepEqual(
    await as(
      AKI,
      "select id, card_id, session_id from reading_notes order by id",
    ),
    [
      { id: note(3), card_id: cardOf(1), session_id: null },
      { id: note(4), card_id: cardOf(1), session_id: null },
    ],
  );
  await as(AKI, "delete from reading_notes");
  // A card's and a note's id are the reader's own: ones already Ben's take
  // nothing of his.
  await write(BEN, note(5), cardOf(2), session(2), "quote", "ベンの一文");
  await reading(AKI, cardOf(2), session(4), null);
  await write(
    AKI,
    note(5),
    cardOf(2),
    session(4),
    "thought",
    "アキの思ったこと",
  );
  const theirs = (reader: string) =>
    as(
      reader,
      `select c.id as card, n.body from reading_cards c
       join reading_notes n on n.card_id = c.id and n.user_id = c.user_id`,
    );
  assert.deepEqual(await theirs(BEN), [
    { card: cardOf(2), body: "ベンの一文" },
  ]);
  assert.deepEqual(await theirs(AKI), [
    { card: cardOf(2), body: "アキの思ったこと" },
  ]);
});

test("one reading, several books: one card, each book its own time and pages, a note at a book of its own card", async () => {
  const db = await migrated();
  const { rows, as, refused, typed, card, onCard, write } = helpers(db);
  await typed(AKI, book(1));
  await typed(AKI, book(2));
  // Aki reads 本1, and changes to 本2 a while in: one card, both books on it.
  await card(AKI, cardOf(1), "look, room='ticket', 'window'");
  const now = Date.now();
  const minutesAgo = (minutes: number) =>
    new Date(now - minutes * 60_000).toISOString();
  const [start, changed, end] = [minutesAgo(50), minutesAgo(30), minutesAgo(0)];
  await as(
    AKI,
    `insert into reading_sessions (id, user_id, book_id, mode, started_at, ended_at)
     values ($1, $2, $3, 'solo', $4, $5)`,
    [session(1), AKI, book(1), start, changed],
  );
  await onCard(
    AKI,
    cardOf(1),
    session(1),
    "read_seconds, page_from, page_to, format=1200, 10, 40, 'paper'",
  );
  await write(AKI, note(1), cardOf(1), session(1), "quote", "本1の一文");
  await as(
    AKI,
    `insert into reading_sessions (id, user_id, book_id, mode, started_at, ended_at)
     values ($1, $2, $3, 'solo', $4, $5)`,
    [session(2), AKI, book(2), changed, end],
  );
  await onCard(
    AKI,
    cardOf(1),
    session(2),
    "read_seconds, page_from, page_to, page_unit, format, finished=" +
      "1500, 60, 100, 'percent', 'ebook', true",
  );
  await write(AKI, note(2), cardOf(1), session(2), "word", "黄昏");
  assert.deepEqual(
    await rows(
      `select s.book_id, b.read_seconds, b.page_from, b.page_to, b.page_unit,
         b.format, b.finished
       from reading_card_books b join reading_sessions s on s.id = b.session_id
       where b.card_id = $1 order by s.started_at`,
      [cardOf(1)],
    ),
    [
      {
        book_id: book(1),
        read_seconds: 1200,
        page_from: 10,
        page_to: 40,
        page_unit: "page",
        format: "paper",
        finished: false,
      },
      {
        book_id: book(2),
        read_seconds: 1500,
        page_from: 60,
        page_to: 100,
        page_unit: "percent",
        format: "ebook",
        finished: true,
      },
    ],
  );
  // The card's time is its books', worked out; its notes are at each book.
  assert.deepEqual(
    await rows(
      `select count(*)::int as books, sum(b.read_seconds)::int as read,
         max(s.ended_at) - min(s.started_at) = interval '50 minutes' as spans
       from reading_card_books b join reading_sessions s on s.id = b.session_id
       where b.card_id = $1`,
      [cardOf(1)],
    ),
    [{ books: 2, read: 2700, spans: true }],
  );
  assert.deepEqual(
    await rows(
      `select n.body, s.book_id from reading_notes n
       join reading_sessions s on s.id = n.session_id order by n.id`,
    ),
    [
      { body: "本1の一文", book_id: book(1) },
      { body: "黄昏", book_id: book(2) },
    ],
  );
  // A session is on one card only.
  await card(AKI, cardOf(2));
  assert.equal(
    (
      await refused(
        AKI,
        `insert into reading_card_books (user_id, card_id, session_id)
         values ($1, $2, $3)`,
        [AKI, cardOf(2), session(1)],
      )
    ).code,
    "23505",
  );
  // A note names a book of its own card, or none.
  assert.equal(
    (
      await refused(
        AKI,
        `insert into reading_notes (id, user_id, card_id, session_id, kind, body)
         values ($1, $2, $3, $4, 'word', '灯り')`,
        [note(3), AKI, cardOf(2), session(1)],
      )
    ).code,
    "23503",
  );
  await write(AKI, note(3), cardOf(2), null, "thought", "本のない読書");
});

test("記録しない: the sessions and the card deleted take its books and notes; a book taken out leaves its notes on the card", async () => {
  const db = await migrated();
  const { rows, as, refused, typed, read, card, onCard, write, reading } =
    helpers(db);
  await typed(AKI, book(1));
  await typed(AKI, book(2));
  await card(AKI, cardOf(1));
  await read(AKI, session(1), book(1));
  await onCard(AKI, cardOf(1), session(1));
  await read(AKI, session(2), book(2));
  await onCard(AKI, cardOf(1), session(2));
  await write(AKI, note(1), cardOf(1), session(1));
  await write(
    AKI,
    note(2),
    cardOf(1),
    session(2),
    "quote",
    "夜は、灯りのためにある。",
  );
  await reading(AKI, cardOf(2), session(3), book(1));
  await write(AKI, note(3), cardOf(2), session(3));
  // A book goes with its session or its card, never alone.
  assert.equal(
    (await refused(AKI, "delete from reading_card_books")).code,
    "42501",
  );
  // A book taken out: its session deleted. Its note stays on the card, and
  // so does one sent late from another device, written at that book.
  await as(AKI, "delete from reading_sessions where id = $1", [session(1)]);
  await write(AKI, note(5), cardOf(1), session(1), "word", "遅れて届いた言葉");
  assert.deepEqual(
    await rows("select session_id from reading_card_books where card_id = $1", [
      cardOf(1),
    ]),
    [{ session_id: session(2) }],
  );
  assert.deepEqual(
    await rows(
      `select id, card_id, session_id from reading_notes where card_id = $1
       order by id`,
      [cardOf(1)],
    ),
    [
      { id: note(1), card_id: cardOf(1), session_id: null },
      { id: note(2), card_id: cardOf(1), session_id: session(2) },
      { id: note(5), card_id: cardOf(1), session_id: null },
    ],
  );
  // 記録しない: the sessions first, then the card, and nothing of it is left.
  await as(AKI, "delete from reading_sessions where id = $1", [session(2)]);
  await as(AKI, "delete from reading_cards where id = $1", [cardOf(1)]);
  // What another device sends to it late is refused, to be dropped: its
  // book, and its note. (The session of that book did go in, and the app
  // deletes it again.)
  await read(AKI, session(5), book(2));
  assert.equal(
    (
      await refused(
        AKI,
        `insert into reading_card_books (user_id, card_id, session_id)
         values ($1, $2, $3)`,
        [AKI, cardOf(1), session(5)],
      )
    ).code,
    "23503",
  );
  assert.equal(
    (
      await refused(
        AKI,
        `insert into reading_notes (id, user_id, card_id, session_id, kind, body)
         values ($1, $2, $3, $4, 'word', '灯り')`,
        [note(6), AKI, cardOf(1), session(2)],
      )
    ).code,
    "23503",
  );
  await as(AKI, "delete from reading_sessions where id = $1", [session(5)]);
  assert.deepEqual(await rows("select id from reading_cards"), [
    { id: cardOf(2) },
  ]);
  assert.deepEqual(await rows("select session_id from reading_card_books"), [
    { session_id: session(3) },
  ]);
  assert.deepEqual(await rows("select id from reading_notes"), [
    { id: note(3) },
  ]);
  // A card deleted before its sessions takes its books and notes alike.
  await as(AKI, "delete from reading_cards where id = $1", [cardOf(2)]);
  assert.deepEqual(await rows("select 1 from reading_card_books"), []);
  assert.deepEqual(await rows("select 1 from reading_notes"), []);
  assert.deepEqual(await rows("select id from reading_sessions"), [
    { id: session(3) },
  ]);
  // A note alone can be taken back.
  await reading(AKI, cardOf(3), session(4), null);
  await write(AKI, note(4), cardOf(3), session(4));
  await as(AKI, "delete from reading_notes where id = $1", [note(4)]);
  assert.deepEqual(await rows("select id from reading_notes"), []);
});

test("what the app may change changes, and nothing else", async () => {
  const db = await migrated();
  const { rows, as, refused, typed, read, card, onCard, write } = helpers(db);
  await typed(AKI, book(1));
  await read(AKI, session(1), book(1), { ended: false });
  await card(
    AKI,
    cardOf(1),
    "time_zone, timer, timer_minutes, timer_at, room, light, look=" +
      "'Europe/Paris', 'pomodoro', 25, now(), 'window', 'rain', 'ticket'",
  );
  await onCard(
    AKI,
    cardOf(1),
    session(1),
    "page_from, page_unit, format=12, 'percent', 'ebook'",
  );
  await write(AKI, note(1), cardOf(1), session(1), "word", "黄昏");
  // Paused, then going on, then ended as the app counted it.
  await as(
    AKI,
    "update reading_cards set paused_at = now() - interval '3 minutes' where id = $1",
    [cardOf(1)],
  );
  await as(
    AKI,
    `update reading_cards set paused_at = null, paused_seconds = 180, rest_minutes = 5,
       look = 'notebook', shown = '{"items": ["time", "pages"]}'
     where id = $1`,
    [cardOf(1)],
  );
  await as(
    AKI,
    `update reading_card_books set read_seconds = 1500, page_to = 48, finished = true
     where session_id = $1`,
    [session(1)],
  );
  await as(
    AKI,
    "update reading_notes set kind = 'quote', body = '黄昏の街', page = 47 where id = $1",
    [note(1)],
  );
  assert.deepEqual(
    await rows(
      `select time_zone, added_later, paused_at, paused_seconds, timer, timer_minutes,
         rest_minutes, room, light, look, shown
       from reading_cards`,
    ),
    [
      {
        time_zone: "Europe/Paris",
        added_later: false,
        paused_at: null,
        paused_seconds: 180,
        timer: "pomodoro",
        timer_minutes: 25,
        rest_minutes: 5,
        room: "window",
        light: "rain",
        look: "notebook",
        shown: { items: ["time", "pages"] },
      },
    ],
  );
  assert.deepEqual(
    await rows(
      `select read_seconds, page_from, page_to, page_unit, format, finished
       from reading_card_books`,
    ),
    [
      {
        read_seconds: 1500,
        page_from: 12,
        page_to: 48,
        page_unit: "percent",
        format: "ebook",
        finished: true,
      },
    ],
  );
  assert.deepEqual(await rows("select kind, body, page from reading_notes"), [
    { kind: "quote", body: "黄昏の街", page: 47 },
  ]);
  // Whose, which card and session, and when it was made, stay as they were.
  const keys: Record<string, string[]> = {
    reading_cards: [`user_id = '${BEN}'`, `id = '${cardOf(9)}'`],
    reading_card_books: [
      `user_id = '${BEN}'`,
      `card_id = '${cardOf(9)}'`,
      `session_id = '${session(9)}'`,
    ],
    reading_notes: [
      `user_id = '${BEN}'`,
      `id = '${note(9)}'`,
      `card_id = '${cardOf(9)}'`,
      "session_id = null",
    ],
  };
  for (const table of TABLES)
    for (const change of [
      ...keys[table],
      "created_at = now() - interval '1 day'",
      "updated_at = now() - interval '1 day'",
    ])
      assert.equal(
        (await refused(AKI, `update ${table} set ${change}`)).code,
        "42501",
        `${table}: ${change}`,
      );
  // updated_at is the database's, and moves with each change. (Set back by
  // the database's owner, its own touch held off for it.)
  for (const table of TABLES)
    await db.exec(`
      alter table ${table} disable trigger ${table}_touch;
      update ${table} set updated_at = now() - interval '1 day';
      alter table ${table} enable trigger ${table}_touch;
    `);
  const recent = async () =>
    (
      await rows<{ moved: boolean }>(
        TABLES.map(
          (table) =>
            `select updated_at > now() - interval '1 hour' as moved from ${table}`,
        ).join(" union all "),
      )
    ).map((row) => row.moved);
  assert.deepEqual(await recent(), [false, false, false]);
  await as(AKI, "update reading_cards set look = 'window'");
  await as(AKI, "update reading_card_books set page_to = 49");
  await as(AKI, "update reading_notes set page = 48");
  assert.deepEqual(await recent(), [true, true, true]);
});

test("sending a card, a book or a note again writes nothing more", async () => {
  const db = await migrated();
  const { rows, as, refused, typed, read } = helpers(db);
  await typed(AKI, book(1));
  await read(AKI, session(1), book(1));
  for (let i = 0; i < 2; i += 1) {
    await as(
      AKI,
      `insert into reading_cards (id, user_id, look) values ($1, $2, 'window')
       on conflict do nothing`,
      [cardOf(1), AKI],
    );
    await as(
      AKI,
      `insert into reading_card_books (user_id, card_id, session_id, page_to)
       values ($1, $2, $3, 20) on conflict do nothing`,
      [AKI, cardOf(1), session(1)],
    );
    await as(
      AKI,
      `insert into reading_notes (id, user_id, card_id, session_id, kind, body)
       values ($1, $2, $3, $4, 'thought', 'もう一度') on conflict do nothing`,
      [note(1), AKI, cardOf(1), session(1)],
    );
  }
  // Named, the key is the whole of it: the id alone is none here.
  await as(
    AKI,
    `insert into reading_cards (id, user_id) values ($1, $2)
     on conflict (user_id, id) do nothing`,
    [cardOf(1), AKI],
  );
  await as(
    AKI,
    `insert into reading_card_books (user_id, card_id, session_id) values ($1, $2, $3)
     on conflict (user_id, session_id) do nothing`,
    [AKI, cardOf(1), session(1)],
  );
  await as(
    AKI,
    `insert into reading_notes (id, user_id, card_id, kind, body)
     values ($1, $2, $3, 'word', '灯り') on conflict (user_id, id) do nothing`,
    [note(1), AKI, cardOf(1)],
  );
  assert.equal(
    (
      await refused(
        AKI,
        `insert into reading_cards (id, user_id) values ($1, $2)
         on conflict (id) do nothing`,
        [cardOf(1), AKI],
      )
    ).code,
    "42P10",
  );
  // Written over, as a plain upsert does, the keys would be too: refused.
  assert.equal(
    (
      await refused(
        AKI,
        `insert into reading_cards (id, user_id, look) values ($1, $2, 'ticket')
         on conflict (user_id, id) do update
         set id = excluded.id, user_id = excluded.user_id, look = excluded.look`,
        [cardOf(1), AKI],
      )
    ).code,
    "42501",
  );
  for (const table of TABLES)
    assert.equal((await rows(`select 1 from ${table}`)).length, 1, table);
  assert.deepEqual(await rows("select look from reading_cards"), [
    { look: "window" },
  ]);
});

test("a device clock ahead dates nothing in the future, and the clock keeps the device's times; a day added later keeps its own", async () => {
  const db = await migrated();
  const { rows, as, typed, card, onCard } = helpers(db);
  await typed(AKI, book(1));
  // The device's clock is ten minutes ahead: the session starts by it, and
  // is paused five minutes on.
  const ahead = new Date(Date.now() + 10 * 60_000).toISOString();
  const pausedAt = new Date(Date.parse(ahead) + 5 * 60_000).toISOString();
  await as(
    AKI,
    `insert into reading_sessions (id, user_id, book_id, mode, started_at)
     values ($1, $2, $3, 'solo', $4)`,
    [session(1), AKI, book(1), ahead],
  );
  await as(
    AKI,
    `insert into reading_cards (id, user_id, created_at, timer_at)
     values ($1, $2, $3, $3)`,
    [cardOf(1), AKI, ahead],
  );
  await as(
    AKI,
    `insert into reading_card_books (user_id, card_id, session_id, created_at)
     values ($1, $2, $3, $4)`,
    [AKI, cardOf(1), session(1), ahead],
  );
  await as(
    AKI,
    `insert into reading_notes (id, user_id, card_id, session_id, kind, body, created_at)
     values ($1, $2, $3, $4, 'thought', '先の時計', $5)`,
    [note(1), AKI, cardOf(1), session(1), ahead],
  );
  await as(AKI, "update reading_cards set paused_at = $2 where id = $1", [
    cardOf(1),
    pausedAt,
  ]);
  assert.deepEqual(
    await rows(
      `select c.created_at <= now() as made_now,
         c.timer_at = s.started_at as timer_from_start,
         c.paused_at - s.started_at = interval '5 minutes' as paused_after_five
       from reading_cards c
       join reading_card_books b on b.card_id = c.id
       join reading_sessions s on s.id = b.session_id`,
    ),
    [{ made_now: true, timer_from_start: true, paused_after_five: true }],
  );
  assert.deepEqual(
    await rows(
      `select created_at <= now() as made_now from reading_card_books
       union all select created_at <= now() from reading_notes`,
    ),
    [{ made_now: true }, { made_now: true }],
  );
  // 記録し忘れた日: a session of the day before last, its card made today.
  await as(
    AKI,
    `insert into reading_sessions (id, user_id, book_id, mode, started_at, ended_at)
     values ($1, $2, $3, 'solo', now() - interval '2 days',
       now() - interval '2 days' + interval '30 minutes')`,
    [session(2), AKI, book(1)],
  );
  await card(AKI, cardOf(2), "added_later=true");
  await onCard(AKI, cardOf(2), session(2), "read_seconds=1800");
  assert.deepEqual(
    await rows(
      `select c.added_later, b.read_seconds, c.paused_at,
         s.started_at < now() - interval '1 day' as days_ago
       from reading_cards c
       join reading_card_books b on b.card_id = c.id
       join reading_sessions s on s.id = b.session_id
       where c.id = $1`,
      [cardOf(2)],
    ),
    [
      {
        added_later: true,
        read_seconds: 1800,
        paused_at: null,
        days_ago: true,
      },
    ],
  );
});

test("only the forms the app sends are kept", async () => {
  const db = await migrated();
  const { rows, as, refused, typed, read, reading, write } = helpers(db);
  await typed(AKI, book(1));
  await reading(AKI, cardOf(1), session(1), book(1));
  await write(AKI, note(1), cardOf(1), session(1));
  const refusedChange = async (table: string, change: string) =>
    (await refused(AKI, `update ${table} set ${change}`)).code;
  const REFUSED: [string, string[]][] = [
    [
      "reading_cards",
      [
        "timer = 'stopwatch'",
        "timer_minutes = 0",
        "timer_minutes = 1441",
        "rest_minutes = 0",
        "room = 'Window'",
        "light = '-rain'",
        "look = 'a b'",
        "look = ''",
        "shown = '[]'",
        "shown = '\"window\"'",
        `shown = jsonb_build_object('layout', repeat('x', 65536))`,
      ],
    ],
    [
      "reading_card_books",
      [
        "page_from = -1",
        "page_to = 1000001",
        "page_unit = 'chapter'",
        "format = 'kindle'",
      ],
    ],
    [
      "reading_notes",
      [
        "kind = 'memo'",
        "body = ''",
        "body = '  　'",
        "body = repeat('あ', 2001)",
        "page = -1",
      ],
    ],
  ];
  for (const [table, changes] of REFUSED)
    for (const change of changes)
      assert.equal(
        await refusedChange(table, change),
        "23514",
        `${table}: ${change}`,
      );
  // What a device names and a look added later go in, and what a device's
  // clock or an old browser could send refuses no reading.
  const kept = async (table: string, change: string, column: string) => {
    await as(AKI, `update ${table} set ${change}`);
    const [row] = await rows<Record<string, unknown>>(
      `select ${column} as value from ${table}`,
    );
    return row.value;
  };
  const KEPT: [string, string, string, unknown][] = [
    [
      "reading_cards",
      "time_zone = 'America/Argentina/Buenos_Aires'",
      "time_zone",
      "America/Argentina/Buenos_Aires",
    ],
    ["reading_cards", "time_zone = 'Etc/GMT+9'", "time_zone", "Etc/GMT+9"],
    ["reading_cards", "time_zone = 'Etc/Unknown'", "time_zone", "Etc/Unknown"],
    ["reading_cards", "time_zone = '+09:00'", "time_zone", "+09:00"],
    ["reading_cards", "time_zone = '-03:30'", "time_zone", "-03:30"],
    ["reading_cards", "time_zone = null", "time_zone", "Asia/Tokyo"],
    ["reading_cards", "time_zone = ''", "time_zone", "Asia/Tokyo"],
    ["reading_cards", "time_zone = '+0900'", "time_zone", "Asia/Tokyo"],
    [
      "reading_cards",
      "time_zone = 'Asia/Tokyo; drop'",
      "time_zone",
      "Asia/Tokyo",
    ],
    ["reading_cards", "paused_seconds = -1", "paused_seconds", 0],
    ["reading_cards", "paused_seconds = null", "paused_seconds", 0],
    ["reading_cards", "added_later = null", "added_later", false],
    ["reading_cards", "shown = null", "shown::text", "{}"],
    ["reading_cards", "look = 'ticket-2'", "look", "ticket-2"],
    ["reading_cards", "room = 'sea-view'", "room", "sea-view"],
    [
      "reading_cards",
      "timer = 'timer', timer_minutes = 300",
      "timer_minutes",
      300,
    ],
    [
      "reading_cards",
      `shown = jsonb_build_object('layout', repeat('x', 60000))`,
      "octet_length(shown::text) > 60000",
      true,
    ],
    [
      "reading_card_books",
      "format = 'audio', page_unit = 'second'",
      "page_unit",
      "second",
    ],
    ["reading_card_books", "page_from = 0, page_to = 0", "page_to", 0],
    // A reading left running for thirteen months is kept as it was.
    ["reading_card_books", "read_seconds = 34000000", "read_seconds", 34000000],
    ["reading_card_books", "read_seconds = -1", "read_seconds", 0],
    ["reading_card_books", "page_unit = null", "page_unit", "page"],
    ["reading_card_books", "finished = null", "finished", false],
    ["reading_notes", "body = repeat('あ', 2000)", "char_length(body)", 2000],
  ];
  for (const [table, change, column, value] of KEPT)
    assert.equal(
      await kept(table, change, column),
      value,
      `${table}: ${change}`,
    );
  // Rows sent together send null for a column some of them leave out: the
  // default stands in, and the reading is kept.
  await read(AKI, session(2), book(1));
  await as(
    AKI,
    `insert into reading_cards (id, user_id, time_zone, added_later, paused_seconds,
       timer, shown, created_at)
     values ($1, $2, null, null, null, null, null, null)`,
    [cardOf(2), AKI],
  );
  await as(
    AKI,
    `insert into reading_card_books (user_id, card_id, session_id, page_unit, finished,
       created_at)
     values ($1, $2, $3, null, null, null)`,
    [AKI, cardOf(2), session(2)],
  );
  await as(
    AKI,
    `insert into reading_notes (id, user_id, card_id, session_id, kind, body, created_at)
     values ($1, $2, $3, $4, 'word', '栞', null)`,
    [note(2), AKI, cardOf(2), session(2)],
  );
  assert.deepEqual(
    await rows(
      `select c.time_zone, c.added_later, c.paused_seconds, c.timer, c.shown,
         b.page_unit, b.finished,
         c.created_at <= now() and b.created_at <= now() and n.created_at <= now()
           as dated
       from reading_cards c
       join reading_card_books b on b.card_id = c.id
       join reading_notes n on n.card_id = c.id
       where c.id = $1`,
      [cardOf(2)],
    ),
    [
      {
        time_zone: "Asia/Tokyo",
        added_later: false,
        paused_seconds: 0,
        timer: "none",
        shown: {},
        page_unit: "page",
        finished: false,
        dated: true,
      },
    ],
  );
});

test("in 読書管理モード, and without a public profile, a reader keeps cards and notes", async () => {
  const db = await migrated();
  const { rows, as, typed, reading, write } = helpers(db);
  await as(
    AKI,
    "insert into reader_settings (user_id, mode) values ($1, 'manage')",
    [AKI],
  );
  await typed(AKI, book(1));
  await reading(AKI, cardOf(1), session(1), book(1));
  await write(AKI, note(1), cardOf(1), session(1));
  await typed(DAI, book(2));
  await reading(DAI, cardOf(2), session(2), book(2));
  await write(DAI, note(2), cardOf(2), session(2), "word", "栞");
  for (const table of TABLES)
    assert.deepEqual(
      await rows(`select user_id from ${table} order by user_id`),
      [{ user_id: AKI }, { user_id: DAI }],
      table,
    );
});

test("sessions are as they were", async () => {
  const db = await migrated();
  const { rows, as, refused, typed } = helpers(db);
  await typed(BEN, book(2));
  // The app before this one writes sessions without cards, as it did.
  await as(
    BEN,
    "insert into reading_sessions (user_id, book_id, mode) values ($1, $2, 'together')",
    [BEN, book(2)],
  );
  assert.equal(
    (
      await refused(
        BEN,
        "insert into reading_sessions (user_id, mode) values ($1, 'solo')",
        [BEN],
      )
    ).code,
    "23505",
    "one running at a time",
  );
  await as(
    BEN,
    "update reading_sessions set ended_at = now() where user_id = $1",
    [BEN],
  );
  // Reading together is still seen, by anon too; its card is not.
  assert.equal((await as(null, "select * from reading_sessions")).length, 1);
  assert.equal((await as(CHI, "select * from reading_sessions")).length, 1);
  assert.deepEqual(
    await rows(
      `select pg_get_constraintdef(oid) as def from pg_constraint
       where conname = 'reading_sessions_user_id_id_key'`,
    ),
    [{ def: "UNIQUE (user_id, id)" }],
  );
});

test("a reader leaving takes their cards, books and notes, and no one else's", async () => {
  const db = await migrated();
  const { rows, typed, reading, write } = helpers(db);
  await typed(AKI, book(1));
  await reading(AKI, cardOf(1), session(1), book(1));
  await write(AKI, note(1), cardOf(1), session(1));
  await typed(BEN, book(2));
  await reading(BEN, cardOf(2), session(2), book(2));
  await write(BEN, note(2), cardOf(2), session(2));
  await deleteAccounts(db, [AKI]);
  for (const table of TABLES)
    assert.deepEqual(
      await rows(`select user_id from ${table}`),
      [{ user_id: BEN }],
      table,
    );
});

test("the rollback undoes it, and it applies again", async () => {
  // Up to this file: the files after it are undone first, as they came.
  const db = await migrated(FILES[FILES.indexOf(FILE!) + 1]);
  const before = await migrated(FILE);
  const rollback = TEXT.split("-- Rollback (a new migration)")[1]
    .split("\n-- Dropping the tables")[0]
    .split("\n")
    .filter((line) => line.startsWith("--   "))
    .map((line) => line.slice(5))
    .join("\n");
  await db.exec(rollback);
  const shape = (d: PGlite) =>
    d
      .query<{ s: string }>(
        `select string_agg(x, E'\\n' order by x) s from (
           select 'table ' || table_schema || '.' || table_name x from information_schema.tables
             where table_schema in ('public', 'private')
           union all select 'constraint ' || conrelid::regclass || ' ' || pg_get_constraintdef(oid)
             from pg_constraint where connamespace in ('public'::regnamespace, 'private'::regnamespace)
           union all select 'index ' || indexdef from pg_indexes
             where schemaname in ('public', 'private')
           union all select 'function ' || p.oid::regprocedure || ' ' || md5(p.prosrc)
             from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
           union all select 'trigger ' || tgrelid::regclass || ' ' || tgname from pg_trigger
             where not tgisinternal
           union all select 'grant ' || table_name || ' ' || grantee || ' ' || privilege_type
             from information_schema.role_table_grants
             where table_schema = 'public' and grantee in ('anon', 'authenticated')
         ) all_of_it`,
      )
      .then((r) => r.rows[0].s);
  assert.equal(await shape(db), await shape(before), "as it was before");
  await db.exec(TEXT);
});

async function main() {
  for (const [name, run] of tests) {
    await run();
    console.log("ok -", name);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
