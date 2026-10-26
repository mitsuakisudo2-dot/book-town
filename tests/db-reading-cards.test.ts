import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  SUPABASE_STANDIN,
  deleteAccounts,
  migrationFiles,
  migrationText,
} from "./fixtures/pglite-supabase";

// 読書記録の最初の工事のデータの形 (item 18, supabase/migrations/*_reading_cards.sql;
// docs/機能/読書記録.md). Each session of reading gets a card of the reader's
// own (the clock, the pages, the room and the card's look) and 今日のノート;
// nobody else reads either, they name only the reader's own sessions, and
// they go with the session (記録しない) and with the account.

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
  async function as<T = Record<string, unknown>>(
    visitor: Visitor,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    await db.exec(
      visitor
        ? `set role authenticated; select set_config('request.jwt.claim.sub', '${visitor}', false);`
        : `set role anon; select set_config('request.jwt.claim.sub', '', false);`,
    );
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
    await db.exec(
      visitor
        ? `set role authenticated; select set_config('request.jwt.claim.sub', '${visitor}', false);`
        : `set role anon; select set_config('request.jwt.claim.sub', '', false);`,
    );
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
  const card = (reader: string, sessionId: string, more: string = "") =>
    as(
      reader,
      `insert into reading_cards (user_id, session_id${more ? ", " + more.split("=")[0] : ""})
       values ($1, $2${more ? ", " + more.slice(more.indexOf("=") + 1) : ""})`,
      [reader, sessionId],
    );
  const write = (
    reader: string,
    noteId: string,
    sessionId: string,
    kind = "thought",
    body = "灯りの描写が好き",
  ) =>
    as(
      reader,
      `insert into reading_notes (id, user_id, session_id, kind, body)
       values ($1, $2, $3, $4, $5)`,
      [noteId, reader, sessionId, kind, body],
    );
  return { rows, as, refused, affected, typed, read, card, write };
}

const tests: [string, () => Promise<void>][] = [];
const test = (name: string, run: () => Promise<void>) =>
  tests.push([name, run]);

test("a card and its notes are the reader's own", async () => {
  const db = await migrated();
  const { as, refused, affected, typed, read, card, write } = helpers(db);
  await typed(AKI, book(1));
  await read(AKI, session(1), book(1));
  await card(AKI, session(1), "page_to=42");
  await write(AKI, note(1), session(1));
  assert.deepEqual(
    await as(AKI, "select session_id, page_to, look, shown from reading_cards"),
    [{ session_id: session(1), page_to: 42, look: null, shown: {} }],
  );
  assert.deepEqual(await as(AKI, "select id, kind, body from reading_notes"), [
    { id: note(1), kind: "thought", body: "灯りの描写が好き" },
  ]);
  // Nobody else reads them, and nothing is open to anon.
  assert.deepEqual(await as(CHI, "select * from reading_cards"), []);
  assert.deepEqual(await as(CHI, "select * from reading_notes"), []);
  for (const table of ["reading_cards", "reading_notes"])
    assert.equal(
      (await refused(null, `select * from ${table}`)).code,
      "42501",
      `anon reads no ${table}`,
    );
  // Nor changes or deletes them.
  assert.equal(await affected(CHI, "update reading_cards set page_to = 1"), 0);
  assert.equal(
    await affected(CHI, "update reading_notes set body = '書き換え'"),
    0,
  );
  assert.equal(await affected(CHI, "delete from reading_notes"), 0);
  assert.equal(
    (
      await refused(
        CHI,
        `insert into reading_cards (user_id, session_id) values ($1, $2)`,
        [AKI, session(1)],
      )
    ).code,
    "42501",
    "never in another's name",
  );
  assert.equal(
    (
      await refused(
        null,
        `insert into reading_notes (id, user_id, session_id, kind, body)
         values ($1, $2, $3, 'word', '灯り')`,
        [note(2), AKI, session(1)],
      )
    ).code,
    "42501",
  );
});

test("a card names only a session of the reader's own, and tells nothing of others'", async () => {
  const db = await migrated();
  const { as, refused, typed, read, card, write } = helpers(db);
  await typed(BEN, book(2));
  // Ben reads together, so everyone sees the session.
  await read(BEN, session(2), book(2), { mode: "together", ended: false });
  assert.equal((await as(AKI, "select id from reading_sessions")).length, 1);
  // A card or a note on it is refused alike whether the session has a card
  // yet, or is not there at all: nothing says which, nor what was asked.
  const tries = (sessionId: string) =>
    Promise.all(
      [
        "insert into reading_cards (user_id, session_id) values ($1, $2)",
        `insert into reading_notes (id, user_id, session_id, kind, body)
         values ('${note(3)}', $1, $2, 'word', '灯り')`,
      ].map(async (sql) => {
        const { code, message, detail } = await refused(AKI, sql, [
          AKI,
          sessionId,
        ]);
        return { code, message, detail };
      }),
    );
  const noCardYet = await tries(session(2));
  await card(BEN, session(2));
  const withCard = await tries(session(2));
  const nothingThere = await tries(session(9));
  assert.deepEqual(
    noCardYet.map((error) => error.code),
    ["23503", "23503"],
  );
  assert.deepEqual(withCard, noCardYet);
  assert.deepEqual(nothingThere, noCardYet);
  for (const error of withCard)
    assert.ok(
      !`${error.message} ${error.detail}`.includes(session(2)),
      "the session asked about is not told back",
    );
  // A note's id is the reader's own: one already Ben's takes nothing of his.
  await write(BEN, note(5), session(2), "quote", "ベンの一文");
  await read(AKI, session(4), null);
  await card(AKI, session(4));
  await write(AKI, note(5), session(4), "thought", "アキの思ったこと");
  assert.deepEqual(
    await as(BEN, "select body from reading_notes where id = $1", [note(5)]),
    [{ body: "ベンの一文" }],
  );
  assert.deepEqual(
    await as(AKI, "select body from reading_notes where id = $1", [note(5)]),
    [{ body: "アキの思ったこと" }],
  );
  // A note is of a card: a session of one's own without one takes none.
  await read(AKI, session(3), null);
  assert.equal(
    (
      await refused(
        AKI,
        `insert into reading_notes (id, user_id, session_id, kind, body)
         values ($1, $2, $3, 'word', '灯り')`,
        [note(4), AKI, session(3)],
      )
    ).code,
    "23503",
  );
  await card(AKI, session(3));
  await write(AKI, note(4), session(3), "word", "灯り");
});

test("記録しない: the session deleted takes its card and notes with it", async () => {
  const db = await migrated();
  const { rows, as, refused, typed, read, card, write } = helpers(db);
  await typed(AKI, book(1));
  await read(AKI, session(1), book(1));
  await card(AKI, session(1));
  await write(AKI, note(1), session(1));
  await write(AKI, note(2), session(1), "quote", "夜は、灯りのためにある。");
  await read(AKI, session(2), book(1));
  await card(AKI, session(2));
  await write(AKI, note(3), session(2));
  // A card goes with its session, never alone.
  assert.equal((await refused(AKI, "delete from reading_cards")).code, "42501");
  await as(AKI, "delete from reading_sessions where id = $1", [session(1)]);
  assert.deepEqual(
    await rows("select session_id from reading_cards order by session_id"),
    [{ session_id: session(2) }],
  );
  assert.deepEqual(await rows("select id from reading_notes"), [
    { id: note(3) },
  ]);
  // A note alone can be taken back.
  await as(AKI, "delete from reading_notes where id = $1", [note(3)]);
  assert.deepEqual(await rows("select id from reading_notes"), []);
});

test("what the app may change changes, and nothing else", async () => {
  const db = await migrated();
  const { rows, as, refused, typed, read, card, write } = helpers(db);
  await typed(AKI, book(1));
  await read(AKI, session(1), book(1), { ended: false });
  await card(
    AKI,
    session(1),
    "time_zone, timer, timer_minutes, timer_at, room, light, look, page_from, page_unit, format=" +
      "'Europe/Paris', 'pomodoro', 25, now(), 'window', 'rain', 'ticket', 12, 'percent', 'ebook'",
  );
  await write(AKI, note(1), session(1), "word", "黄昏");
  // Paused, then going on, then ended as the app counted it.
  await as(
    AKI,
    "update reading_cards set paused_at = now() - interval '3 minutes' where session_id = $1",
    [session(1)],
  );
  await as(
    AKI,
    `update reading_cards set paused_at = null, paused_seconds = 180, rest_minutes = 5
     where session_id = $1`,
    [session(1)],
  );
  await as(
    AKI,
    `update reading_cards set read_seconds = 1500, page_to = 48, finished = true,
       look = 'notebook', shown = '{"items": ["time", "pages"]}'
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
         rest_minutes, read_seconds, page_from, page_to, page_unit, format, finished,
         room, light, look, shown
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
        read_seconds: 1500,
        page_from: 12,
        page_to: 48,
        page_unit: "percent",
        format: "ebook",
        finished: true,
        room: "window",
        light: "rain",
        look: "notebook",
        shown: { items: ["time", "pages"] },
      },
    ],
  );
  assert.deepEqual(await rows("select kind, body, page from reading_notes"), [
    { kind: "quote", body: "黄昏の街", page: 47 },
  ]);
  // Whose and which session, and when it was made, stay as they were.
  for (const change of [
    `user_id = '${BEN}'`,
    `session_id = '${session(9)}'`,
    "created_at = now() - interval '1 day'",
    "updated_at = now() - interval '1 day'",
  ]) {
    assert.equal(
      (await refused(AKI, `update reading_cards set ${change}`)).code,
      "42501",
      change,
    );
    assert.equal(
      (await refused(AKI, `update reading_notes set ${change}`)).code,
      "42501",
      change,
    );
  }
  // updated_at is the database's, and moves with each change.
  // (Set back by the database's owner, its own touch held off for it.)
  for (const table of ["reading_cards", "reading_notes"])
    await db.exec(`
      alter table ${table} disable trigger ${table}_touch;
      update ${table} set updated_at = now() - interval '1 day';
      alter table ${table} enable trigger ${table}_touch;
    `);
  assert.deepEqual(
    await rows(
      `select updated_at < now() - interval '1 hour' as back from reading_cards
       union all select updated_at < now() - interval '1 hour' from reading_notes`,
    ),
    [{ back: true }, { back: true }],
  );
  await as(AKI, "update reading_cards set page_to = 49");
  await as(AKI, "update reading_notes set page = 48");
  assert.deepEqual(
    await rows(
      `select updated_at > now() - interval '1 hour' as moved from reading_cards
       union all select updated_at > now() - interval '1 hour' from reading_notes`,
    ),
    [{ moved: true }, { moved: true }],
  );
});

test("sending a card or a note again writes nothing more", async () => {
  const db = await migrated();
  const { rows, as, typed, read } = helpers(db);
  await typed(AKI, book(1));
  await read(AKI, session(1), book(1));
  for (let i = 0; i < 2; i += 1) {
    await as(
      AKI,
      `insert into reading_cards (user_id, session_id, look) values ($1, $2, 'window')
       on conflict do nothing`,
      [AKI, session(1)],
    );
    await as(
      AKI,
      `insert into reading_notes (id, user_id, session_id, kind, body)
       values ($1, $2, $3, 'thought', 'もう一度') on conflict do nothing`,
      [note(1), AKI, session(1)],
    );
  }
  assert.equal((await rows("select 1 from reading_cards")).length, 1);
  assert.equal((await rows("select 1 from reading_notes")).length, 1);
});

test("a device clock ahead dates no card or note in the future, and the clock keeps the device's times; a day added later keeps its own", async () => {
  const db = await migrated();
  const { rows, as, typed, card } = helpers(db);
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
    `insert into reading_cards (user_id, session_id, created_at, timer_at)
     values ($1, $2, $3, $3)`,
    [AKI, session(1), ahead],
  );
  await as(
    AKI,
    `insert into reading_notes (id, user_id, session_id, kind, body, created_at)
     values ($1, $2, $3, 'thought', '先の時計', $4)`,
    [note(1), AKI, session(1), ahead],
  );
  await as(
    AKI,
    "update reading_cards set paused_at = $2 where session_id = $1",
    [session(1), pausedAt],
  );
  assert.deepEqual(
    await rows(
      `select c.created_at <= now() as made_now,
         c.timer_at = s.started_at as timer_from_start,
         c.paused_at - s.started_at = interval '5 minutes' as paused_after_five
       from reading_cards c join reading_sessions s on s.id = c.session_id
       union all select created_at <= now(), null, null from reading_notes`,
    ),
    [
      { made_now: true, timer_from_start: true, paused_after_five: true },
      { made_now: true, timer_from_start: null, paused_after_five: null },
    ],
  );
  // 記録し忘れた日: a session of the day before last, its card made today.
  await as(
    AKI,
    `insert into reading_sessions (id, user_id, book_id, mode, started_at, ended_at)
     values ($1, $2, $3, 'solo', now() - interval '2 days',
       now() - interval '2 days' + interval '30 minutes')`,
    [session(2), AKI, book(1)],
  );
  await card(AKI, session(2), "added_later, read_seconds=true, 1800");
  assert.deepEqual(
    await rows(
      `select c.added_later, c.read_seconds, c.paused_at,
         s.started_at < now() - interval '1 day' as days_ago
       from reading_cards c join reading_sessions s on s.id = c.session_id
       where c.session_id = $1`,
      [session(2)],
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
  const { rows, as, refused, typed, read, card, write } = helpers(db);
  await typed(AKI, book(1));
  await read(AKI, session(1), book(1));
  await card(AKI, session(1));
  await write(AKI, note(1), session(1));
  const refusedCard = async (change: string) =>
    (
      await refused(
        AKI,
        `update reading_cards set ${change} where session_id = $1`,
        [session(1)],
      )
    ).code;
  for (const change of [
    "timer = 'stopwatch'",
    "timer_minutes = 0",
    "timer_minutes = 1441",
    "rest_minutes = 0",
    "page_from = -1",
    "page_to = 1000001",
    "page_unit = 'chapter'",
    "format = 'kindle'",
    "room = 'Window'",
    "light = '-rain'",
    "look = 'a b'",
    "look = ''",
    "shown = '[]'",
    "shown = '\"window\"'",
    `shown = jsonb_build_object('layout', repeat('x', 65536))`,
  ])
    assert.equal(await refusedCard(change), "23514", change);
  // What a device names and a look added later go in.
  const kept = async (change: string, column: string) => {
    await as(AKI, `update reading_cards set ${change} where session_id = $1`, [
      session(1),
    ]);
    const [row] = await rows<Record<string, unknown>>(
      `select ${column} as value from reading_cards`,
    );
    return row.value;
  };
  for (const [change, column, value] of [
    [
      "time_zone = 'America/Argentina/Buenos_Aires'",
      "time_zone",
      "America/Argentina/Buenos_Aires",
    ],
    ["time_zone = 'Etc/GMT+9'", "time_zone", "Etc/GMT+9"],
    ["time_zone = 'Etc/Unknown'", "time_zone", "Etc/Unknown"],
    ["time_zone = '+09:00'", "time_zone", "+09:00"],
    ["time_zone = '-03:30'", "time_zone", "-03:30"],
    ["look = 'ticket-2'", "look", "ticket-2"],
    ["room = 'sea-view'", "room", "sea-view"],
    ["format = 'audio', page_unit = 'second'", "page_unit", "second"],
    ["timer = 'timer', timer_minutes = 300", "timer_minutes", 300],
    ["page_from = 0, page_to = 0", "page_to", 0],
    // A reading left running for thirteen months is kept as it was.
    ["read_seconds = 34000000", "read_seconds", 34000000],
    [
      `shown = jsonb_build_object('layout', repeat('x', 60000))`,
      "octet_length(shown::text) > 60000",
      true,
    ],
  ] as const)
    assert.equal(await kept(change, column), value, change);
  // What a device's clock or an old browser could send refuses no reading.
  for (const [change, column, value] of [
    ["time_zone = null", "time_zone", "Asia/Tokyo"],
    ["time_zone = ''", "time_zone", "Asia/Tokyo"],
    ["time_zone = '+0900'", "time_zone", "Asia/Tokyo"],
    ["time_zone = 'Asia/Tokyo; drop'", "time_zone", "Asia/Tokyo"],
    ["read_seconds = -1", "read_seconds", 0],
    ["paused_seconds = -1", "paused_seconds", 0],
    ["paused_seconds = null", "paused_seconds", 0],
  ] as const)
    assert.equal(await kept(change, column), value, change);
  const refusedNote = async (change: string) =>
    (
      await refused(AKI, `update reading_notes set ${change} where id = $1`, [
        note(1),
      ])
    ).code;
  for (const change of [
    "kind = 'memo'",
    "body = ''",
    "body = '  　'",
    "body = repeat('あ', 2001)",
    "page = -1",
  ])
    assert.equal(await refusedNote(change), "23514", change);
  await as(
    AKI,
    "update reading_notes set body = repeat('あ', 2000) where id = $1",
    [note(1)],
  );
});

test("in 読書管理モード, and without a public profile, a reader keeps cards and notes", async () => {
  const db = await migrated();
  const { rows, as, typed, read, card, write } = helpers(db);
  await as(
    AKI,
    "insert into reader_settings (user_id, mode) values ($1, 'manage')",
    [AKI],
  );
  await typed(AKI, book(1));
  await read(AKI, session(1), book(1));
  await card(AKI, session(1), "look='window'");
  await write(AKI, note(1), session(1));
  await typed(DAI, book(2));
  await read(DAI, session(2), book(2));
  await card(DAI, session(2));
  await write(DAI, note(2), session(2), "word", "栞");
  assert.deepEqual(
    await rows("select user_id from reading_cards order by user_id"),
    [{ user_id: AKI }, { user_id: DAI }],
  );
  assert.equal((await rows("select 1 from reading_notes")).length, 2);
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

test("a reader leaving takes their cards and notes, and no one else's", async () => {
  const db = await migrated();
  const { rows, typed, read, card, write } = helpers(db);
  await typed(AKI, book(1));
  await read(AKI, session(1), book(1));
  await card(AKI, session(1));
  await write(AKI, note(1), session(1));
  await typed(BEN, book(2));
  await read(BEN, session(2), book(2));
  await card(BEN, session(2));
  await write(BEN, note(2), session(2));
  await deleteAccounts(db, [AKI]);
  assert.deepEqual(await rows("select user_id from reading_cards"), [
    { user_id: BEN },
  ]);
  assert.deepEqual(await rows("select user_id from reading_notes"), [
    { user_id: BEN },
  ]);
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
