import { chromium, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  escapeWhileComposing,
  layersSettled,
  restingBox,
  settleBeforeNavigating,
} from "./journey-layers.mjs";
import { expectReadable } from "./journey-contrast.mjs";
import {
  coarse,
  expectKeyboardUp,
  expectNoKeyboard,
  expectNoZoomOnFocus,
  expectTapWrites,
  fakeKeyboard,
  forgetFocus,
  toolbarPlace,
  watchFocus,
} from "./journey-keyboard.mjs";

// Signs in with an emailed code and creates the first profile, in a real browser
// against a stand-in for Supabase. Serve the app with
// NEXT_PUBLIC_SUPABASE_URL=https://test-project.supabase.co and any
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY before running this.
const base = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const supabase =
  process.env.BOOK_TOWN_SUPABASE_URL ?? "https://test-project.supabase.co";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/login-qa",
);
await mkdir(output, { recursive: true });

const INVITED = "aki@example.jp";
const user = {
  id: "8f6a2c1e-5b7d-4e1a-9c3f-2d4b6a8e0c11",
  aud: "authenticated",
  role: "authenticated",
  email: INVITED,
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-10-12T00:00:00Z",
};
const base64url = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const session = () => {
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: [
      base64url({ alg: "HS256", typ: "JWT" }),
      base64url({ sub: user.id, role: "authenticated", exp: expires_at }),
      "signature",
    ].join("."),
    token_type: "bearer",
    expires_in: 3600,
    expires_at,
    refresh_token: "refresh-token",
    user,
  };
};

let profile = null;
// How long the stand-in takes to read the signed-in person's own profile.
let ownProfileDelay = 0;
// Holds the own-profile answer until released, so a test that needs the
// account "still being checked" does not race a timer on a slow runner.
let ownProfileHold = null;
const holdOwnProfile = () => {
  let release;
  ownProfileHold = new Promise((done) => (release = done));
  return () => {
    ownProfileHold = null;
    release();
  };
};
// The rest of the town, once a test fills it: rows by table.
let town = null;
// Holds the rest of the town's reads until released, so a test that looks
// at the page while the town is still being read does not race a timer: a
// navigation waits for the page's fonts, and on a slow runner that took
// longer than a fixed delay, which had ended by the time the test looked.
let townHold = null;
const holdTown = () => {
  let release;
  const held = new Promise((done) => (release = done));
  townHold = held;
  return () => {
    if (townHold === held) townHold = null;
    release();
  };
};
const reportsSent = [];
// Blocks made ([blocker, blocked]) and lifted (the query of each delete).
const blocksSent = [];
const blocksLifted = [];
// While set, the stand-in ends follows as asked (a block ends them).
let followsEnd = false;
// A change carrying these words is refused by the stand-in, as the database
// refuses one that breaks a rule, after the screen has moved on.
const REFUSED_MARK = "（断られる）";
// While set, the stand-in answers a 便り sent only once it settles.
let postsHeld = null;
// While set, a session cannot be renewed, as when its refresh token is gone.
let refreshRefused = false;
// What the database grants a reporter to read of their own reports.
const REPORT_GRANTED = [
  "id",
  "target_kind",
  "target_id",
  "reason",
  "progress",
  "created_at",
  "status_at",
];
const reportReadsRefused = [];
const coverAsks = [];
// The bibliographic master the stand-in has, by book (book_bibliography's
// rows), and the IDs each call asked about.
let masters = [];
const bibliographyAsks = [];
// The reader's books held back (book_holds' rows), the books they said are
// right after all, the fixes of books written, and whether the database
// turns a fix away (no row changed).
let holds = [];
const confirmAsks = [];
const booksFixed = [];
let fixesRefused = false;
const inserted = [];
const codeRequests = [];
// A change of address asked for (メールアドレスを変える): the new address,
// and which of its two codes were taken. The new address's code is 111111,
// the current address's 222222; ren@example.jp is another account's.
let emailChange = null;
// The reader's passkeys, as the auth server keeps them: the credential each
// was made with (the browser's stand-in authenticator holds its key).
let passkeys = [];
const passkeyChallenge = () => ({
  challenge_id: crypto.randomUUID(),
  expires_at: Math.floor(Date.now() / 1000) + 300,
});
const randomBase64url = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const townReads = [];
const townWrites = [];
// The posts the town's own read leaves out, as older than the newest 500
// it reads; and the query of each read of posts.
const outsideLoad = new Set();
const postReads = [];
// Set to fail the next read of older 便り, or of one post by its id, as a
// read the network keeps dropping ends, once the client's own retries are
// spent (a 500, which it does not retry).
let failOlderOnce = false;
let failPostOnce = null;
/**
 * Like PostgREST, the posts a read's filters ask for (eq, in, is, gte, lt
 * and newest first), as the reads after the town make them. The town's
 * own read, with no filter, never has those outside its load.
 */
function postsAsked(rows, params) {
  const bare = (value) => value.replace(/^"|"$/g, "");
  const holds = (column, filter) => (row) => {
    const op = filter.slice(0, filter.indexOf("."));
    const arg = filter.slice(op.length + 1);
    const cell = row[column];
    if (op === "eq") return String(cell) === bare(arg);
    if (op === "in")
      return arg.slice(1, -1).split(",").map(bare).includes(String(cell));
    if (op === "is") return arg === "null" ? cell === null : true;
    if (op === "gte") return Date.parse(cell) >= Date.parse(bare(arg));
    if (op === "lt") return Date.parse(cell) < Date.parse(bare(arg));
    if (op === "lte") return Date.parse(cell) <= Date.parse(bare(arg));
    throw new Error("not mocked: posts filter " + column + "=" + filter);
  };
  let asked = rows;
  let filtered = false;
  for (const [key, filter] of params) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    filtered = true;
    asked = asked.filter(holds(key, filter));
  }
  if (!filtered) asked = asked.filter((row) => !outsideLoad.has(row.id));
  const order = params.get("order");
  if (order === "created_at.desc" || order === "created_at.asc")
    asked = [...asked].sort(
      (a, b) =>
        (Date.parse(a.created_at) - Date.parse(b.created_at)) *
        (order === "created_at.asc" ? 1 : -1),
    );
  // Every reply to a 便り, read a page at a time in the order of their ids.
  else if (order === "id.asc")
    asked = [...asked].sort((a, b) => a.id.localeCompare(b.id));
  else if (order) throw new Error("not mocked: posts order " + order);
  return asked;
}
// 注釈モード: whether the database counts the reader as staff, the notes it
// holds, what was sent, and every request for them.
let staff = false;
const siteNotes = [];
const annotateAsks = [];
const notesSent = [];
const notesTakenBack = [];
const siteNoteRequests = [];
// Set to refuse every note as the hourly limit does.
let refuseNotes = false;
// 退会: each call to delete the account, and whether the database refuses it.
const leaveRequests = [];
let refuseLeave = false;
// The columns a staff member may send, and the database's checks on them
// (supabase/migrations/*_site_notes.sql): what it refuses, this refuses.
const chars = (text) => [...text].length;
const between = (low, high) => (value) =>
  Number.isInteger(value) && value >= low && value <= high;
const share = (value) =>
  value === null || (typeof value === "number" && value >= 0 && value <= 1);
const SITE_NOTE_CHECKS = {
  page: (v) => typeof v === "string" && v.startsWith("/") && chars(v) <= 500,
  x: between(0, 100000),
  y: between(0, 10000000),
  viewport_w: between(1, 20000),
  viewport_h: between(1, 20000),
  scroll_y: between(0, 10000000),
  target: (v) => typeof v === "string" && chars(v) <= 300,
  layer: (v) =>
    v === null || (typeof v === "string" && chars(v) >= 1 && chars(v) <= 120),
  anchor: (v) => typeof v === "string" && chars(v) <= 500,
  anchor_x: share,
  anchor_y: share,
  body: (v) =>
    typeof v === "string" &&
    chars(v) >= 1 &&
    chars(v) <= 2000 &&
    v === v.replace(/^[ \t\r\n\u3000]+|[ \t\r\n\u3000]+$/g, ""),
  device: (v) => typeof v === "string" && chars(v) <= 40,
  build: (v) => v === null || /^[0-9a-f]{7,40}$/.test(v),
};
/** Why the database would refuse this row, or null. */
function refusalOf(row) {
  const extra = Object.keys(row).filter((key) => !(key in SITE_NOTE_CHECKS));
  if (extra.length)
    return [
      403,
      { code: "42501", message: "permission denied for table site_notes" },
    ];
  const missing = [
    "page",
    "x",
    "y",
    "viewport_w",
    "viewport_h",
    "scroll_y",
    "body",
  ].filter((key) => row[key] === undefined || row[key] === null);
  if (missing.length)
    return [
      400,
      {
        code: "23502",
        message: `null value in column "${missing[0]}" of relation "site_notes" violates not-null constraint`,
      },
    ];
  const failed = Object.entries(SITE_NOTE_CHECKS)
    .filter(([key, ok]) => key in row && !ok(row[key]))
    .map(([key]) => key);
  if (((row.anchor_x ?? null) === null) !== ((row.anchor_y ?? null) === null))
    failed.push("anchor_x, anchor_y");
  return failed.length
    ? [
        400,
        {
          code: "23514",
          message:
            'new row for relation "site_notes" violates check constraint: ' +
            failed.join(", "),
        },
      ]
    : null;
}

// Uses Playwright's own Chromium unless BOOK_TOWN_CHROME names another browser.
const browser = await chromium.launch({
  executablePath: process.env.BOOK_TOWN_CHROME || undefined,
  headless: true,
});
const passed = [],
  errors = [];
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});
// No camera on this phone: the scanner takes typed ISBNs, whichever barcode
// reader the browser has.
await context.addInitScript(() => {
  if (navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("none", "NotFoundError"));
});
// When a field takes the focus, and a keyboard stood in on the screen.
await watchFocus(context);
await fakeKeyboard(context);
/** The stand-in for Supabase, for every context of this journey. */
const standIn = async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const json = (status, body) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  const body = request.postData() ? JSON.parse(request.postData()) : {};
  // Like PostgREST, the page asked for (offset, limit) and the total, which
  // the app reads to know it has every row of a list.
  const rowsAsked = (rows) => {
    const from = Number(url.searchParams.get("offset") ?? 0);
    const page = rows.slice(
      from,
      from + Number(url.searchParams.get("limit") ?? rows.length),
    );
    const range = page.length ? `${from}-${from + page.length - 1}` : "*";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "content-range": `${range}/${rows.length}`,
        "access-control-expose-headers": "Content-Range",
      },
      body: JSON.stringify(page),
    });
  };
  if (url.pathname === "/auth/v1/otp") {
    codeRequests.push(url);
    return body.email === INVITED
      ? json(200, {})
      : json(422, {
          code: 422,
          error_code: "otp_disabled",
          msg: "Signups not allowed for otp",
        });
  }
  if (url.pathname === "/auth/v1/user" && request.method() === "PUT") {
    if (body.email === "ren@example.jp")
      return json(422, {
        code: 422,
        error_code: "email_exists",
        msg: "A user with this email address has already been registered",
      });
    emailChange = { email: body.email, confirmed: new Set() };
    return json(200, { ...user, new_email: body.email });
  }
  if (url.pathname === "/auth/v1/verify" && body.type === "email_change") {
    const which =
      body.email === emailChange?.email && body.token === "111111"
        ? "new"
        : body.email === user.email && body.token === "222222"
          ? "current"
          : null;
    if (!which || emailChange.confirmed.has(which))
      return json(403, {
        code: 403,
        error_code: "otp_expired",
        msg: "Token has expired or is invalid",
      });
    emailChange.confirmed.add(which);
    if (emailChange.confirmed.size < 2)
      return json(200, {
        msg: "Confirmation link accepted. Please proceed to confirm link sent to the other email",
        code: "200",
      });
    user.email = emailChange.email;
    emailChange = null;
    return json(200, session());
  }
  if (url.pathname === "/auth/v1/verify")
    return body.token === "123456" && body.email === INVITED
      ? json(200, session())
      : json(403, {
          code: 403,
          error_code: "otp_expired",
          msg: "Token has expired or is invalid",
        });
  // Passkeys, like the auth server's, for pages on localhost (a passkey's
  // relying party cannot be an IP address). Signatures are not checked.
  if (url.pathname === "/auth/v1/passkeys/registration/options")
    return json(200, {
      ...passkeyChallenge(),
      options: {
        rp: { name: "BookTown", id: "localhost" },
        user: {
          name: user.email,
          displayName: user.email,
          id: Buffer.from(user.id).toString("base64url"),
        },
        challenge: randomBase64url(),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        timeout: 300000,
        excludeCredentials: passkeys.map((passkey) => ({
          type: "public-key",
          id: passkey.credential,
        })),
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "preferred",
        },
        attestation: "none",
      },
    });
  if (url.pathname === "/auth/v1/passkeys/registration/verify") {
    const made = {
      id: crypto.randomUUID(),
      credential: body.credential.id,
      friendly_name: "Google Password Manager",
      created_at: new Date().toISOString(),
    };
    passkeys.push(made);
    return json(200, {
      id: made.id,
      friendly_name: made.friendly_name,
      created_at: made.created_at,
    });
  }
  if (url.pathname === "/auth/v1/passkeys/authentication/options")
    return json(200, {
      ...passkeyChallenge(),
      options: {
        challenge: randomBase64url(),
        timeout: 300000,
        rpId: "localhost",
        userVerification: "preferred",
      },
    });
  if (url.pathname === "/auth/v1/passkeys/authentication/verify") {
    const known = passkeys.find((p) => p.credential === body.credential.id);
    if (!known)
      return json(400, {
        code: 400,
        error_code: "webauthn_verification_failed",
        msg: "Credential verification failed",
      });
    known.last_used_at = new Date().toISOString();
    return json(200, session());
  }
  if (url.pathname === "/auth/v1/passkeys")
    return json(
      200,
      passkeys.map((passkey) => ({
        id: passkey.id,
        friendly_name: passkey.friendly_name,
        created_at: passkey.created_at,
        last_used_at: passkey.last_used_at,
      })),
    );
  if (url.pathname.startsWith("/auth/v1/passkeys/")) {
    passkeys = passkeys.filter((p) => !url.pathname.endsWith("/" + p.id));
    return route.fulfill({ status: 204, body: "" });
  }
  if (url.pathname === "/auth/v1/logout")
    return route.fulfill({ status: 204, body: "" });
  if (url.pathname === "/auth/v1/user") return json(200, user);
  if (url.pathname === "/auth/v1/token" && refreshRefused)
    return json(400, {
      code: 400,
      error_code: "refresh_token_not_found",
      msg: "Invalid Refresh Token: Refresh Token Not Found",
    });
  if (url.pathname === "/rest/v1/profiles") {
    if (request.method() === "GET") {
      if (url.searchParams.get("id") === "eq." + user.id) {
        if (ownProfileHold) await ownProfileHold;
        if (ownProfileDelay)
          await new Promise((done) => setTimeout(done, ownProfileDelay));
      }
      const own = profile ? [profile] : [];
      return url.searchParams.get("id") === "eq." + user.id
        ? json(200, own)
        : rowsAsked([...own, ...(town?.profiles ?? [])]);
    }
    if (request.method() === "POST") {
      inserted.push(body);
      if (body.handle === "taken")
        return json(409, {
          code: "23505",
          message: "duplicate key value violates unique constraint",
        });
      profile = {
        bio: "",
        color: "#768281",
        links: [],
        compose_icon: "pen",
        created_at: "2026-10-12T00:00:00Z",
        updated_at: "2026-10-12T00:00:00Z",
        ...body,
      };
      return json(201, profile);
    }
    if (request.method() === "PATCH") {
      townWrites.push(url.pathname);
      if (JSON.stringify(body).includes(REFUSED_MARK))
        return json(400, {
          code: "23514",
          message: "new row violates check constraint",
        });
      profile = { ...profile, ...body };
      return route.fulfill({ status: 204, body: "" });
    }
  }
  if (url.pathname === "/rest/v1/rpc/book_holds") return json(200, holds);
  if (url.pathname === "/rest/v1/rpc/confirm_book_isbn") {
    confirmAsks.push(body.book);
    holds = holds.filter((row) => row.book_id !== body.book);
    return route.fulfill({ status: 204, body: "" });
  }
  // Like the database, a fixed book is one row changed, read back by its id.
  if (url.pathname === "/rest/v1/books" && request.method() === "PATCH") {
    townWrites.push(url.pathname);
    const id = (url.searchParams.get("id") ?? "").replace(/^eq\./, "");
    if (fixesRefused) return json(200, []);
    booksFixed.push({ id, ...body });
    return json(200, [{ id }]);
  }
  if (url.pathname === "/rest/v1/rpc/book_bibliography") {
    bibliographyAsks.push(...body.ids);
    return json(
      200,
      masters.filter((row) => body.ids.includes(row.book_id)),
    );
  }
  if (url.pathname === "/rest/v1/rpc/can_annotate") {
    annotateAsks.push(staff);
    return json(200, staff);
  }
  if (url.pathname === "/rest/v1/rpc/delete_my_account") {
    leaveRequests.push(request.method());
    if (refuseLeave)
      return json(500, { code: "XX000", message: "could not delete" });
    profile = null;
    return route.fulfill({ status: 204, body: "" });
  }
  // Like the database: staff read and write only their own notes, and to
  // anyone else the table is empty and closed.
  if (url.pathname === "/rest/v1/site_notes") {
    siteNoteRequests.push(request.method());
    if (request.method() === "GET") {
      // As PostgREST reads them: removed_at=is.null, page=match.<regular
      // expression>, order=created_at.desc and a limit.
      const open = url.searchParams.get("removed_at") === "is.null";
      const page = url.searchParams.get("page");
      const pattern = page?.startsWith("match.")
        ? new RegExp(page.slice("match.".length))
        : null;
      const rows = siteNotes.filter(
        (note) =>
          (!open || !note.removed_at) && (!pattern || pattern.test(note.page)),
      );
      if (url.searchParams.get("order") === "created_at.desc") rows.reverse();
      const limit = Number(url.searchParams.get("limit") ?? Infinity);
      return json(200, staff ? rows.slice(0, limit) : []);
    }
    if (!staff)
      return json(403, {
        code: "42501",
        message:
          'new row violates row-level security policy for table "site_notes"',
      });
    if (request.method() === "POST") {
      notesSent.push(body);
      const refused = refuseNotes
        ? [400, { code: "23514", message: "at most 60 site notes an hour" }]
        : refusalOf(body);
      if (refused) return json(...refused);
      const row = {
        ...body,
        id:
          "b0c1d2e3-0000-4000-8000-0000000000" +
          String(notesSent.length).padStart(2, "0"),
        created_at: new Date().toISOString(),
        removed_at: null,
      };
      siteNotes.push(row);
      return json(201, row);
    }
    if (request.method() === "PATCH") {
      const id = (url.searchParams.get("id") ?? "").replace(/^eq\./, "");
      const row = siteNotes.find((note) => note.id === id);
      notesTakenBack.push({ id, removed: !!body.removed_at });
      if (!row) return json(200, []);
      row.removed_at = body.removed_at ? new Date().toISOString() : null;
      return json(200, [{ id }]);
    }
  }
  // Like the database, refuse any read of a report column the reporter is
  // not granted, whether selected or filtered on (reporter_id, status, ...).
  if (url.pathname === "/rest/v1/reports") {
    const asked = [
      ...(url.searchParams.get("select") ?? "").split(","),
      ...[...url.searchParams.keys()].filter(
        (key) => !["select", "order", "limit", "offset"].includes(key),
      ),
      ...(url.searchParams.get("order") ?? "")
        .split(",")
        .map((o) => o.split(".")[0]),
    ]
      .map((column) => column.trim())
      .filter(Boolean);
    const refused = asked.filter((column) => !REPORT_GRANTED.includes(column));
    if (refused.length) {
      reportReadsRefused.push(...refused);
      return json(403, {
        code: "42501",
        message: "permission denied for table reports",
      });
    }
  }
  if (url.pathname === "/rest/v1/reports" && request.method() === "POST") {
    reportsSent.push(body);
    const at = new Date().toISOString();
    const row = {
      id:
        "6d1e0c2a-0000-4000-8000-0000000000" +
        String(reportsSent.length).padStart(2, "0"),
      target_kind: body.target_kind,
      target_id: body.target_id,
      reason: body.reason,
      progress: "open",
      created_at: at,
      status_at: at,
    };
    // Read back with the town, as the database would.
    town?.reports.unshift(row);
    return json(201, row);
  }
  if (
    followsEnd &&
    url.pathname === "/rest/v1/shop_follows" &&
    request.method() === "DELETE"
  ) {
    townWrites.push(url.pathname);
    if (town) town.shop_follows = [];
    return route.fulfill({ status: 204, body: "" });
  }
  // Like the database: a block is the blocker's own row, kept with the town.
  if (url.pathname === "/rest/v1/blocks" && request.method() !== "GET") {
    townWrites.push(url.pathname);
    if (request.method() === "POST") {
      for (const row of [body].flat()) {
        blocksSent.push([row.blocker_id, row.blocked_id]);
        if (town) town.blocks = [...(town.blocks ?? []), row];
      }
      return json(201, []);
    }
    if (request.method() === "DELETE") {
      blocksLifted.push(url.search);
      const blocked = url.searchParams.get("blocked_id")?.replace(/^eq\./, "");
      if (town)
        town.blocks = (town.blocks ?? []).filter(
          (row) => row.blocked_id !== blocked,
        );
      return route.fulfill({ status: 204, body: "" });
    }
  }
  // Like the database: a 便り is the author's own row, and one carrying the
  // refusal mark is turned away. While postsHeld, the answer waits; a page
  // gone meanwhile hears nothing.
  if (url.pathname === "/rest/v1/posts" && request.method() === "POST") {
    townWrites.push(url.pathname);
    if (postsHeld) await postsHeld;
    return (
      JSON.stringify(body).includes(REFUSED_MARK)
        ? json(400, {
            code: "23514",
            message: "new row violates check constraint",
          })
        : json(201, [])
    ).catch(() => {});
  }
  // What an owner's shop counts (followers, visitors): nobody yet.
  if (url.pathname.startsWith("/rest/v1/") && request.method() === "HEAD")
    return route.fulfill({ status: 200, headers: { "content-range": "*/0" } });
  if (url.pathname === "/rest/v1/rpc/shop_visitors") return json(200, []);
  // The books the reader typed in (my_books): a town may name some.
  if (url.pathname === "/rest/v1/rpc/my_books")
    return rowsAsked(town?.my_books ?? []);
  if (url.pathname.startsWith("/rest/v1/") && request.method() !== "GET")
    townWrites.push(url.pathname);
  // The rest of the signed-in town: a new reader has nothing yet.
  if (url.pathname.startsWith("/rest/v1/") && request.method() === "GET") {
    townReads.push(url.pathname);
    if (townHold) await townHold;
    const table = url.pathname.slice("/rest/v1/".length);
    if (table === "posts") {
      postReads.push(url.search);
      const failing =
        (failOlderOnce && url.search.includes("created_at=lte.")) ||
        (failPostOnce && url.searchParams.get("id") === "eq." + failPostOnce);
      if (failing) {
        failOlderOnce = false;
        failPostOnce = null;
        return json(500, { message: "unavailable" });
      }
    }
    return rowsAsked(
      table === "posts"
        ? postsAsked(town?.posts ?? [], url.searchParams)
        : (town?.[table] ?? []),
    );
  }
  return json(404, { message: "not mocked: " + url.pathname });
};
await context.route(supabase + "/**", standIn);
// Covers are answered locally: openBD has こころ's; Google has 星の本's,
// which its rights holder asked us not to show (cover_refusals).
const OPENBD_ISBN = "9784101010137";
const REFUSED_ISBN = "9784001141276";
await context.route("https://api.openbd.jp/**", (route) => {
  const isbns = new URL(route.request().url()).searchParams
    .get("isbn")
    .split(",");
  coverAsks.push(...isbns.map((isbn) => "openbd:" + isbn));
  return route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(
      isbns.map((isbn) =>
        isbn === OPENBD_ISBN
          ? { summary: { isbn, cover: `https://cover.openbd.jp/${isbn}.jpg` } }
          : null,
      ),
    ),
  });
});
await context.route("https://www.googleapis.com/books/**", (route) => {
  const isbn = new URL(route.request().url()).searchParams
    .get("q")
    .replace("isbn:", "");
  coverAsks.push("google:" + isbn);
  return route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      items: [
        {
          volumeInfo: {
            industryIdentifiers: [{ type: "ISBN_13", identifier: isbn }],
            imageLinks: {
              thumbnail: "https://books.google.com/books/content?id=x",
            },
          },
        },
      ],
    }),
  });
});
const coverImage = await readFile(
  new URL("../public/favicon.ico", import.meta.url),
);
await context.route(
  /^https:\/\/(cover\.openbd\.jp|books\.google\.com\/books\/content)/,
  (route) => route.fulfill({ contentType: "image/png", body: coverImage }),
);
const page = settleBeforeNavigating(await context.newPage());
page.on("pageerror", (e) => errors.push(e.message));
async function check(name, run) {
  await run();
  passed.push(name);
  console.log("PASS " + name);
}
const shot = (name) =>
  page.screenshot({ path: path.join(output, name + ".png"), fullPage: true });
// The same page at a desktop's width too, then back to the phone.
const shotBoth = async (name) => {
  await shot(name + "-390");
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(name + "-1280");
  await page.setViewportSize({ width: 390, height: 844 });
};
/** The report drafts this browser keeps, by key. */
const keptReports = () =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("book-town-report-drafts-v1") ?? "null")
        ?.drafts ?? {},
  );
/** The keys of the record drafts this browser keeps. */
const keptRecordKeys = () =>
  page.evaluate(() =>
    Object.keys(
      JSON.parse(localStorage.getItem("book-town-record-drafts-v1") ?? "null")
        ?.drafts ?? {},
    ),
  );
/** The keys of the post or poster drafts this browser keeps. */
const keptDraftKeys = (storageKey) =>
  page.evaluate(
    (key) =>
      Object.keys(
        JSON.parse(localStorage.getItem(key) ?? "null")?.drafts ?? {},
      ),
    storageKey,
  );
const POST_DRAFTS = "book-town-post-drafts-v1";
const POSTER_DRAFTS = "book-town-poster-drafts-v1";
/** What a visitor writes about a finished 見本 book before signing in. */
const VISITOR_NOTE = "灰色の男たちのところで、時計を見た。";
/** A post and a poster a visitor begins before signing in. */
const VISITOR_POST = "ログインする前に書きはじめた投稿。";
const VISITOR_POSTER = "ログインする前の見出し";
// A dialog closed by hand takes its step off the history a moment later
// (src/lib/back-layer.ts). A second Escape waits for that, as a reader's
// next key would: pressed while the browser is still stepping back, it
// closes the book beneath, and the step arrived at opens the book again.
const layersLeft = (count) =>
  expect
    .poll(() => page.evaluate(() => history.state?.booktownLayers?.length ?? 0))
    .toBe(count);
/**
 * Opens Home on ホーム, where the town's 便り are (「街の便り」); a fresh `/`
 * opens the tab shown last, and 便りだけ has only those followed.
 */
const openHome = async () => {
  await page.goto(base + "/");
  const home = page
    .getByRole("tablist", { name: "ホームの表示" })
    .getByRole("tab", { name: "ホーム" });
  await expect(home).toBeVisible();
  if ((await home.getAttribute("aria-selected")) !== "true") await home.click();
  await expect(page).toHaveURL(base + "/");
};
const noOverflow = async (label) => {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(size.document, label + ": root overflow").toBeLessThanOrEqual(
    size.width + 1,
  );
};

try {
  await check(
    "a signed-out visitor walks the 見本 town and is invited to sign in to follow",
    async () => {
      await page.goto(base + "/walk/");
      await expect(page.getByText("見本の書店").first()).toBeVisible();
      const follow = page.getByRole("button", { name: "この書店をフォロー" });
      await follow.click();
      const invite = page.getByRole("heading", {
        name: "本の街の住人になりませんか",
      });
      await expect(invite).toBeVisible();
      // Nothing was followed, so no message says it was.
      await expect(page.getByText(/をフォローしました/)).toHaveCount(0);
      await shot("0-invite");
      await page.getByRole("button", { name: "このまま見る" }).click();
      await expect(invite).toHaveCount(0);
      await expect(follow).toHaveAttribute("aria-pressed", "false");
      await page.goto(base + "/profiles/me/");
      await expect(
        page.getByRole("heading", {
          name: "あなたのページは、ログインしてから。",
        }),
      ).toBeVisible();
      expect(townReads).toContain("/rest/v1/shops");
      townReads.length = 0;
      // No one is signed in, so no one is asked whether they are staff.
      expect(annotateAsks).toHaveLength(0);
      await expect(page.locator("[data-site-notes]")).toHaveCount(0);
    },
  );

  await check(
    "a visitor's Home shows the bones of its 便り until the town is read, never an empty line, then marks every 見本",
    async () => {
      const bones = page.locator("main .home-skeletons");
      const empty = page.getByText("まだ便りがありません");
      let release = holdTown();
      try {
        // 便りだけ: following nobody, it is empty, but only once it is known.
        await page.goto(base + "/timeline/");
        await expect(bones).toHaveAttribute("aria-busy", "true");
        await expect(bones.locator(".home-skel")).toHaveCount(3);
        await expect(empty).toHaveCount(0);
        release();
        await expect(bones).toHaveCount(0, { timeout: 10000 });
        await expect(empty).toBeVisible();
        // ホーム, opened for the first time: nothing kept from last time.
        await page.evaluate(() => {
          localStorage.setItem("book-town-home-tab-v1", "home");
          localStorage.removeItem("book-town-home-snapshot-v1");
        });
        release = holdTown();
        await page.goto(base + "/");
        await expect(bones).toHaveAttribute("aria-busy", "true");
        await expect(page.locator(".home-carousel")).toHaveAttribute(
          "aria-busy",
          "true",
        );
        await expect(page.locator("main")).not.toContainText(
          /(^|\D)0(人|件|軒|分|回|冊| 投稿| フォロ)/,
        );
        release();
        await expect(bones).toHaveCount(0, { timeout: 10000 });
      } finally {
        release();
      }
      // The real town is empty here: every tile, slide, paper and front
      // drawn is a 見本, and says so.
      const home = page.locator('[role="tabpanel"][data-pane="home"]');
      for (const [part, least] of [
        [".home-rail > li", 6],
        [".home-slide.is-tonight, .home-slide.is-exhibition", 2],
        [".home-notice", 2],
        [".street-shop", 6],
      ]) {
        const found = await home.locator(part).all();
        expect(found.length, part).toBeGreaterThanOrEqual(least);
        for (const each of found)
          await expect(each, part).toContainText("見本");
      }
    },
  );

  await check(
    "a visitor's Home opened again draws the 便り kept from last time, read-only, until the town is read",
    async () => {
      const kept = page.locator("main .home-kept");
      const words = await page.evaluate(() =>
        localStorage.getItem("book-town-home-snapshot-v1"),
      );
      expect(JSON.parse(words ?? "null")?.owner).toBe("visitor");
      const release = holdTown();
      try {
        await page.goto(base + "/");
        await expect(kept).toHaveAttribute("aria-busy", "true");
        await expect(kept).toHaveAttribute("inert", "");
        await expect(kept.locator("article.letter").first()).toBeVisible();
        await expect(page.locator("main .home-skeletons")).toHaveCount(0);
        await expect(page.locator("main")).not.toContainText(
          /(^|\D)0(人|件|軒|分|回|冊| 投稿| フォロ)/,
        );
        release();
        await expect(kept).toHaveCount(0, { timeout: 10000 });
      } finally {
        release();
      }
      await expect(page.locator("main article.letter").first()).toBeVisible();
    },
  );

  await check(
    "a visitor's words on a finished book are kept when 記録する asks them to sign in",
    async () => {
      await page.goto(base + "/books/momo/");
      const feelings = page.locator(".book-feelings");
      await feelings
        .getByRole("button", { name: "読み終えた気持ちを残す" })
        .click();
      const sheet = page.getByRole("dialog", { name: "読み終えた気持ち" });
      await sheet.getByRole("button", { name: "あたたかくなった" }).click();
      await sheet
        .getByLabel("ひとこと（なくても大丈夫です）")
        .fill(VISITOR_NOTE);
      await sheet.getByRole("button", { name: "記録する" }).click();
      const invite = page.getByRole("heading", {
        name: "本の街の住人になりませんか",
      });
      await expect(invite).toBeVisible();
      await page.getByRole("button", { name: "このまま見る" }).click();
      await expect(invite).toHaveCount(0);
      expect(await keptRecordKeys()).toEqual(["visitor:record-new:momo"]);
    },
  );

  await check(
    "a visitor's post and poster being written are kept as theirs",
    async () => {
      await page.goto(base + "/timeline/");
      const fab = page.locator(".compose-fab");
      await fab.click();
      const compose = page.getByRole("dialog", { name: "投稿する" });
      await compose.locator("textarea").fill(VISITOR_POST);
      await page.keyboard.press("Escape");
      await expect(compose).toHaveCount(0);
      await expect(fab).toContainText("下書き");
      await page.goto(base + "/posters/new/");
      await page.getByRole("textbox", { name: "見出し" }).fill(VISITOR_POSTER);
      await expect(
        page.getByText("書きかけは、このブラウザに残しています"),
      ).toBeVisible();
      expect(await keptDraftKeys(POST_DRAFTS)).toEqual(["visitor:new-post"]);
      expect(await keptDraftKeys(POSTER_DRAFTS)).toEqual(["visitor:new"]);
    },
  );

  await check(
    "a visitor who leaves a 便り's page to sign in starts at the top of the sign-in page",
    async () => {
      // Short enough that the sign-in page scrolls too.
      await page.setViewportSize({ width: 390, height: 420 });
      await openHome();
      const times = page.locator("main article.letter .letter-time");
      // The 見本 town's 便り are read in (its memos are ひとこと's, not
      // 便り), then the reader scrolls down.
      await expect(times.nth(5)).toBeAttached();
      await times
        .nth(4)
        .evaluate((time) => time.scrollIntoView({ block: "center" }));
      await expect
        .poll(() => page.evaluate(() => scrollY))
        .toBeGreaterThan(300);
      const target = await times.evaluateAll((links) =>
        links.findIndex((link) => {
          const box = link.getBoundingClientRect();
          return box.top > 60 && box.bottom < innerHeight - 100;
        }),
      );
      expect(target).toBeGreaterThanOrEqual(0);
      await times.nth(target).tap();
      const letter = page.locator(".post-page.is-layer");
      await expect(letter).toBeVisible();
      await letter
        .locator(".is-main")
        .getByRole("button", { name: "いいね", exact: true })
        .tap();
      const invite = page.getByRole("dialog", {
        name: "本の街の住人になりませんか",
      });
      await expect(invite).toBeVisible();
      await invite.getByRole("link", { name: "ログインする" }).tap();
      await expect(
        page.getByRole("heading", { name: "本の街に入る" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight > innerHeight,
        ),
        "the sign-in page scrolls",
      ).toBe(true);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => scrollY), "at its top").toBe(0);
      await page.setViewportSize({ width: 390, height: 844 });
    },
  );

  await check(
    "a signed-out visitor finds the sign-in link on a phone",
    async () => {
      await page.goto(base + "/");
      const link = page.getByRole("link", { name: "ログイン" });
      await expect(link).toBeVisible();
      await link.click();
      await expect(
        page.getByRole("heading", { name: "本の街に入る" }),
      ).toBeVisible();
      // On a phone the address waits for a tap: no keyboard over the page,
      // and the step's heading has the focus.
      expect(await coarse(page)).toBe(true);
      await expectNoKeyboard(page, "sign in");
      await expect(
        page.getByRole("heading", { name: "本の街に入る" }),
      ).toBeFocused();
      await expectTapWrites(page.getByLabel("メールアドレス"));
      await shot("1-email");
    },
  );

  await check(
    "on a phone, an address that is not one is marked without the keyboard",
    async () => {
      const email = page.getByLabel("メールアドレス");
      await email.fill("abc");
      // The browser's own check would put the focus (and the keyboard) in
      // the field; the page says why and marks the field instead.
      await page.getByRole("button", { name: "コードを送る" }).tap();
      await expect(page.locator("#account-error")).toContainText(
        "メールアドレスの形を確かめてください",
      );
      await expect(email).toHaveAttribute("aria-invalid", "true");
      await expectNoKeyboard(page, "address refused");
      await expect(email).toBeInViewport();
      await expectTapWrites(email);
      await page.keyboard.type("@example.jp");
      await expect(email).not.toHaveAttribute("aria-invalid");
      expect(codeRequests).toHaveLength(0);
    },
  );

  await check("an email without an invitation is told so", async () => {
    await page.getByLabel("メールアドレス").fill("someone@example.jp");
    await page.getByRole("button", { name: "コードを送る" }).click();
    await expect(page.locator("#account-error")).toContainText(
      "まだ招待されていません",
    );
  });

  await check(
    "an invited email gets a code, and a wrong code is refused",
    async () => {
      await page.getByLabel("メールアドレス").fill(" Aki@Example.jp ");
      await page.getByRole("button", { name: "コードを送る" }).click();
      await expect(
        page.getByRole("heading", { name: "メールを確かめてください" }),
      ).toBeVisible();
      await expect(page.getByText(INVITED)).toBeVisible();
      // The code waits for a tap too.
      await expectNoKeyboard(page, "code step");
      await expect(
        page.getByRole("heading", { name: "メールを確かめてください" }),
      ).toBeFocused();
      await expectTapWrites(page.getByLabel("6桁のコード"));
      // The link in the email leads back to this site's sign-in page.
      expect(codeRequests.at(-1).searchParams.get("redirect_to")).toBe(
        new URL("/login/", base).href,
      );
      const login = page.getByRole("button", { name: "ログインする" });
      await page.getByLabel("6桁のコード").fill("99999");
      await expect(login).toBeDisabled();
      await page.getByLabel("6桁のコード").fill("999 999");
      await login.click();
      await expect(page.locator("#account-error")).toContainText(
        "期限が切れています",
      );
      await shot("2-code");
    },
  );

  await check(
    "the code step survives a reload while the reader is in the mail app",
    async () => {
      const step = page.getByRole("heading", {
        name: "メールを確かめてください",
      });
      const kept = () =>
        page.evaluate(() => sessionStorage.getItem("book-town-sign-in-v1"));
      await page.reload();
      await expect(step).toBeVisible();
      await expect(page.getByText(INVITED)).toBeVisible();
      // Only the address and when the code was sent, never a code.
      expect(Object.keys(JSON.parse(await kept()).drafts.sent).sort()).toEqual([
        "email",
        "sentAt",
      ]);
      // Sending again goes to the same address after the reload.
      const asked = codeRequests.length;
      await page.getByRole("button", { name: "コードを送り直す" }).click();
      await expect.poll(() => codeRequests.length).toBe(asked + 1);
      await expect(step).toBeVisible();
      // Changing the address forgets the step and keeps the address to fix.
      await page
        .getByRole("button", { name: "メールアドレスを変える" })
        .click();
      await expect(page.getByLabel("メールアドレス")).toHaveValue(INVITED);
      expect(await kept()).toBeNull();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "本の街に入る" }),
      ).toBeVisible();
      await page.getByLabel("メールアドレス").fill(INVITED);
      await page.getByRole("button", { name: "コードを送る" }).click();
      await expect(step).toBeVisible();
      await page.reload();
      await expect(step).toBeVisible();
    },
  );

  await check("the right code leads to the first profile", async () => {
    // The profile is read before the page changes; until then the code step
    // stays, never the empty sign-in it came from.
    await page.evaluate(() => {
      const heading = () =>
        document.querySelector(".account-card h1")?.textContent ?? "";
      window.headingsSeen = [heading()];
      new MutationObserver(() => {
        const text = heading();
        if (text && window.headingsSeen.at(-1) !== text)
          window.headingsSeen.push(text);
      }).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    ownProfileDelay = 1500;
    await page.getByLabel("6桁のコード").fill("123456");
    await page.getByRole("button", { name: "ログインする" }).click();
    await expect(
      page.getByRole("heading", { name: "ようこそ、本の街へ" }),
    ).toBeVisible();
    await expectNoKeyboard(page, "first profile");
    await expect(
      page.getByRole("heading", { name: "ようこそ、本の街へ" }),
    ).toBeFocused();
    ownProfileDelay = 0;
    expect(await page.evaluate(() => window.headingsSeen)).toEqual([
      "メールを確かめてください",
      "ようこそ、本の街へ",
    ]);
    // Signed in, the step is not kept any more.
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem("book-town-sign-in-v1")),
      )
      .toBeNull();
    await shot("3-welcome");
  });

  await check(
    "the first profile typed so far survives a reload, until thrown away",
    async () => {
      const name = page.getByLabel("ユーザー名");
      const handle = page.getByLabel("ユーザーID");
      const resumed = page.getByText("書きかけを続けています");
      await name.fill("アキ");
      await handle.fill("aki");
      await expect(resumed).toHaveCount(0);
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "ようこそ、本の街へ" }),
      ).toBeVisible();
      await expect(name).toHaveValue("アキ");
      await expect(handle).toHaveValue("aki");
      await expect(resumed).toBeVisible();
      await expectReadable(page.locator(".account-kept"), "kept first profile");
      await shot("3-welcome-resumed");
      // Thrown away only when asked, and asked once.
      await page.getByRole("button", { name: "書きかけを消す" }).click();
      await page.getByRole("button", { name: "残す", exact: true }).click();
      await expect(name).toHaveValue("アキ");
      await expect(
        page.getByRole("button", { name: "書きかけを消す" }),
      ).toBeFocused();
      await page.getByRole("button", { name: "書きかけを消す" }).click();
      await page.getByRole("button", { name: "消す", exact: true }).click();
      await expect(name).toHaveValue("");
      await expect(handle).toHaveValue("");
      await expect(resumed).toHaveCount(0);
      // The name waits for a tap: the keyboard stays down.
      await expectNoKeyboard(page, "first profile thrown away");
      await expectTapWrites(name);
      await page.reload();
      await expect(name).toHaveValue("");
      await expect(resumed).toHaveCount(0);
    },
  );

  await check(
    "the ID, the name and the age are checked before saving",
    async () => {
      // A name left empty is said and marked, with no keyboard over it.
      await page.getByLabel("ユーザーID").fill("aki_books");
      await page.getByRole("button", { name: "はじめる" }).tap();
      await expect(page.locator("#account-error")).toContainText(
        "ユーザー名を入れてください",
      );
      await expect(page.getByLabel("ユーザー名")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expectNoKeyboard(page, "name left empty");
      await page.getByLabel("ユーザー名").fill("アキ");
      await page.getByLabel("ユーザーID").fill("booktown");
      await page.getByLabel("13歳以上です").check();
      await page.getByRole("button", { name: "はじめる" }).click();
      await expect(page.locator("#account-error")).toContainText(
        "このIDは使えません",
      );
      await page.getByLabel("ユーザーID").fill("taken");
      await page.getByRole("button", { name: "はじめる" }).click();
      await expect(page.locator("#account-error")).toContainText(
        "ほかの読書家が使っています",
      );
      await page.getByLabel("ユーザーID").fill("aki_books");
      await page.getByLabel("13歳以上です").uncheck();
      await page.getByRole("button", { name: "はじめる" }).click();
      await expect(page.locator("#account-error")).toContainText("13歳以上");
      expect(inserted.map((row) => row.handle)).toEqual(["taken"]);
    },
  );

  await check("the profile is created as the signed-in person", async () => {
    await page.getByLabel("13歳以上です").check();
    // Records start private: 自分だけ comes first, chosen; each one can be
    // published, and is told when it is.
    const choices = page.getByRole("radio");
    await expect(choices.first()).toHaveAccessibleName(/^自分だけ/);
    await expect(page.getByRole("radio", { name: /^自分だけ/ })).toBeChecked();
    await expect(
      page.getByRole("radio", { name: /^公開する/ }),
    ).not.toBeChecked();
    await expect(page.locator(".account-choice")).toContainText(
      "公開したときは、毎回お知らせします。",
    );
    await page.getByRole("button", { name: "はじめる" }).click();
    await expect(
      page.getByRole("heading", { name: "ログインしています" }),
    ).toBeVisible();
    await expect(page.getByText("アキ（@aki_books）さん")).toBeVisible();
    // Kept until now through reloads, the typed profile is not kept after.
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("book-town-first-profile-v1"),
      ),
    ).toBeNull();
    expect(inserted.at(-1)).toEqual({
      id: user.id,
      handle: "aki_books",
      name: "アキ",
      reading_visibility: "private",
    });
    await shot("4-signed-in");
  });

  await check("the town is read from the account, not the demo", async () => {
    await page.getByRole("link", { name: "本の街へ" }).click();
    await expect(page.locator(".town-topbar")).toBeVisible();
    await expect(page.getByRole("link", { name: "ログイン" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /本の街/ })).toBeVisible();
    expect(townReads).toContain("/rest/v1/shops");
    await page.goto(base + "/profiles/me/");
    await expect(page.getByRole("heading", { name: "アキ" })).toBeVisible();
    await expect(page.getByText("@aki_books")).toBeVisible();
    await expect(page.getByText(/(デモ|見本)の読書家/)).toHaveCount(0);
    await expect(page.locator(".persistence-warning")).toBeHidden();
    await shot("5-town");
  });

  await check("a new reader's empty town shows no zeros", async () => {
    // Nothing has happened yet, so nothing is counted.
    await expect(page.locator(".profile-stats")).toHaveCount(0);
    await page.goto(base + "/reading/");
    // The 見本 keep a new reader's town from being empty, marked as such.
    await expect(page.getByText("見本の読書家").first()).toBeVisible();
    await shot("6-reading-samples");
    await page.goto(base + "/notifications/");
    await expect(
      page.getByRole("heading", { name: "まだ静かです" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "本屋を開く" })).toBeVisible();
    await shot("7-notices-quiet");
    await page.goto(base + "/search/");
    await expect(page.getByRole("heading", { name: "検索" })).toBeVisible();
    for (const path of [
      "/",
      "/reading/",
      "/notifications/",
      "/search/",
      "/profiles/me/",
      "/profiles/me/?books=library",
      "/my-shop/",
      "/reading-list/",
      "/timeline/",
      // A 見本 便り's page: no count of likes or replies at nothing.
      "/post/?id=p-1",
    ]) {
      await page.goto(base + path);
      await expect(page.locator("main.town-main")).toBeVisible();
      // Home and the 便り drawn, not their bones, before nothing is looked
      // for.
      if (path === "/" || path === "/timeline/")
        await expect(
          page.locator("main .home-skeletons, main .home-kept"),
        ).toHaveCount(0);
      if (path.startsWith("/post/")) {
        await expect(page.locator("main")).toContainText("十年ぶりに再読");
        await expect(
          page.locator("main .post-page-replies article.letter").first(),
        ).toBeVisible();
      }
      await expect(page.locator("main")).not.toContainText(
        /(^|\D)0(人|件|軒|分|回|冊| 投稿| フォロ)/,
      );
    }
    // A shop just opened has nothing on its shelf, nor may another reader's
    // public shelf: neither counts its books, and the owner can fill theirs.
    const NEIGHBOUR = "2b0c1a3f-6d5e-4f4a-9b8c-7d6e5f4a3b2c";
    const NEIGHBOUR_SHOP = "1a9b0c2e-5c4d-4e3f-8a7b-6c5d4e3f2a1b";
    const empty = {
      id: "first",
      name: "はじめの本棚",
      capacity: 20,
      isPublic: true,
      items: [],
    };
    const shopRow = (id, owner_id, name) => ({
      id,
      owner_id,
      name,
      description: "",
      tagline: "",
      theme: "sage",
      is_open: true,
      public_shelves: [empty],
      public_scene_books: [],
    });
    town = {
      profiles: [
        {
          id: NEIGHBOUR,
          handle: "tomo_reads",
          name: "トモ",
          bio: "",
          color: "#8a7f6a",
          links: [],
          compose_icon: "pen",
          reading_visibility: "private",
          created_at: "2026-10-12T00:00:00Z",
          updated_at: "2026-10-12T00:00:00Z",
        },
      ],
      shops: [
        shopRow("0f1e2d3c-4b5a-4968-8776-655443322110", user.id, "アキの本屋"),
        shopRow(NEIGHBOUR_SHOP, NEIGHBOUR, "トモの本屋"),
      ],
      shop_private: [{ shelves: [empty], scene_books: [] }],
    };
    for (const path of ["/shops/mine/", "/shop/?id=" + NEIGHBOUR_SHOP]) {
      await page.goto(base + path);
      const label = page.locator(".store-shelf-label");
      await expect(label).toContainText("はじめの本棚");
      await expect(page.locator("main")).not.toContainText(
        /(^|\D)0(人|件|軒|分|回|冊| 投稿| フォロ)/,
      );
      await expect(label.getByRole("link", { name: "本を並べる" })).toHaveCount(
        path === "/shops/mine/" ? 1 : 0,
      );
    }
    await expect(
      page.getByRole("heading", { name: "トモの本屋" }),
    ).toBeVisible();
    await page.goto(base + "/shops/mine/");
    const fill = page
      .locator(".store-shelf-label")
      .getByRole("link", { name: "本を並べる" });
    await expect(fill).toHaveAttribute("href", "/my-shop/");
    expect((await fill.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await shot("7-empty-shelf");
    town = null;
  });

  await check(
    "what a visitor wrote on a finished book waits for them once signed in",
    async () => {
      await page.goto(base + "/books/momo/");
      await page
        .locator(".book-feelings")
        .getByRole("button", { name: "書きかけの気持ちを続ける" })
        .click();
      const sheet = page.getByRole("dialog", { name: "読み終えた気持ち" });
      const note = sheet.getByLabel("ひとこと（なくても大丈夫です）");
      await expect(note).toHaveValue(VISITOR_NOTE);
      await expect(
        sheet.getByRole("button", { name: "あたたかくなった" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(sheet.getByText("書きかけを続けています")).toBeVisible();
      expect(await keptRecordKeys()).toEqual([user.id + ":record-new:momo"]);
      // Thrown away here, so the rest of the journey has no record of momo.
      await sheet.getByRole("button", { name: "書きかけを消す" }).click();
      await sheet.getByRole("button", { name: "消す", exact: true }).click();
      await expect(note).toHaveValue("");
      expect(await keptRecordKeys()).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
    },
  );

  await check(
    "the post and the poster a visitor began wait for them once signed in",
    async () => {
      await page.goto(base + "/timeline/");
      const fab = page.locator(".compose-fab");
      await expect(fab).toContainText("下書き");
      await fab.click();
      const compose = page.getByRole("dialog", { name: "投稿する" });
      await expect(compose.locator("textarea")).toHaveValue(VISITOR_POST);
      await expect(compose.getByText("書きかけを続けています")).toBeVisible();
      expect(await keptDraftKeys(POST_DRAFTS)).toEqual([user.id + ":new-post"]);
      // Thrown away here, so the rest of the journey starts without them.
      await compose.getByRole("button", { name: "書きかけを消す" }).click();
      await compose.getByRole("button", { name: "消す", exact: true }).click();
      await expect(compose.locator("textarea")).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(compose).toHaveCount(0);
      await page.goto(base + "/posters/new/");
      const heading = page.getByRole("textbox", { name: "見出し" });
      await expect(heading).toHaveValue(VISITOR_POSTER);
      expect(await keptDraftKeys(POSTER_DRAFTS)).toEqual([user.id + ":new"]);
      const line = page.locator(".poster-editor-kept");
      await line.getByRole("button", { name: "書きかけを消す" }).click();
      await line.getByRole("button", { name: "消す", exact: true }).click();
      await expect(heading).toHaveValue("");
      expect(await keptDraftKeys(POST_DRAFTS)).toEqual([]);
      expect(await keptDraftKeys(POSTER_DRAFTS)).toEqual([]);
    },
  );

  await check(
    "a post begun while the account is still checked is kept for it once known",
    async () => {
      const BEGUN = "確かめているあいだに書きはじめた。";
      const release = holdOwnProfile();
      try {
        await page.goto(base + "/timeline/");
        const fab = page.locator(".compose-fab");
        await fab.click();
        const compose = page.getByRole("dialog", { name: "投稿する" });
        const text = compose.locator("textarea");
        await text.fill(BEGUN);
        // Whose it is is not known yet: the words stay on the screen, and
        // nothing is kept in the browser.
        await expect(text).toHaveValue(BEGUN);
        expect(await keptDraftKeys(POST_DRAFTS)).toEqual([]);
        release();
        await expect
          .poll(() => keptDraftKeys(POST_DRAFTS), { timeout: 10000 })
          .toEqual([user.id + ":new-post"]);
        await expect(text).toHaveValue(BEGUN);
        // Kept quietly: the sheet says nothing of it.
        await expect(compose).not.toContainText("このブラウザ");
        await text.fill("");
        await page.keyboard.press("Escape");
        await expect(compose).toHaveCount(0);
      } finally {
        release();
      }
      expect(await keptDraftKeys(POST_DRAFTS)).toEqual([]);
    },
  );

  await check(
    "words written while the account is still checked do not replace its kept draft, and the poster maker waits for it",
    async () => {
      const KEPT = "前に残していた書きかけ。";
      const BEGUN = "確かめているあいだに続けた言葉。";
      const KEPT_POSTER = "前に作りかけていたポスター";
      const fab = page.locator(".compose-fab");
      const compose = page.getByRole("dialog", { name: "投稿する" });
      const text = compose.locator("textarea");
      const heading = page.getByRole("textbox", { name: "見出し" });
      const keptPosts = () =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) ?? "null")?.drafts,
          POST_DRAFTS,
        );
      const post = (body) => ({
        [user.id + ":new-post"]: { body, bookId: null, spoiler: false },
      });
      await page.goto(base + "/timeline/");
      await fab.click();
      await text.fill(KEPT);
      await page.keyboard.press("Escape");
      await expect(compose).toHaveCount(0);
      await page.goto(base + "/posters/new/");
      await heading.fill(KEPT_POSTER);
      expect(await keptDraftKeys(POSTER_DRAFTS)).toEqual([user.id + ":new"]);
      let release = holdOwnProfile();
      try {
        await page.goto(base + "/timeline/");
        await fab.click();
        // Whose draft it is is not known yet, so the box is empty; what is
        // written there goes after the kept words once it is.
        await expect(text).toHaveValue("");
        await text.fill(BEGUN);
        release();
        await expect(text).toHaveValue(KEPT + "\n" + BEGUN, {
          timeout: 10000,
        });
        expect(await keptPosts()).toEqual(post(KEPT + "\n" + BEGUN));
        await page.keyboard.press("Escape");
        await expect(compose).toHaveCount(0);

        // Too long to join: the words written stay on the screen, not kept
        // and said so, and the kept draft stays as it was.
        const LONG = "続き".repeat(490);
        release = holdOwnProfile();
        await page.goto(base + "/timeline/");
        await fab.click();
        await expect(text).toHaveValue("");
        await text.fill(LONG);
        release();
        await expect(
          compose.getByText("このブラウザに書きかけを残せませんでした"),
        ).toBeVisible({ timeout: 10000 });
        await expect(text).toHaveValue(LONG);
        expect(await keptPosts()).toEqual(post(KEPT + "\n" + BEGUN));
        await page.keyboard.press("Escape");
        await expect(compose).toHaveCount(0);

        // The poster maker opens once its maker is known, with the work kept.
        release = holdOwnProfile();
        await page.goto(base + "/posters/new/");
        await expect(page.getByText("ポスターを開いています…")).toBeVisible();
        await expect(heading).toHaveCount(0);
        release();
        await expect(heading).toHaveValue(KEPT_POSTER, { timeout: 10000 });
      } finally {
        release();
      }
      const line = page.locator(".poster-editor-kept");
      await line.getByRole("button", { name: "書きかけを消す" }).click();
      await line.getByRole("button", { name: "消す", exact: true }).click();
      await expect(heading).toHaveValue("");
      await page.goto(base + "/timeline/");
      await fab.click();
      await expect(text).toHaveValue(KEPT + "\n" + BEGUN);
      await text.fill("");
      await page.keyboard.press("Escape");
      await expect(compose).toHaveCount(0);
      expect(await keptDraftKeys(POST_DRAFTS)).toEqual([]);
      expect(await keptDraftKeys(POSTER_DRAFTS)).toEqual([]);
    },
  );

  await check(
    "a like for a 見本 says it reaches nobody, and nothing is sent",
    async () => {
      await openHome();
      // A post: posters among the 便り are made, not liked.
      const sample = page
        .locator("article.post-card:not(.poster-card)")
        .filter({ hasText: "見本" })
        .first();
      const writes = townWrites.length;
      await sample.getByRole("button", { name: /いいね/ }).click();
      await expect(
        page.getByText("見本の書店と投稿には、いいねやフォローは届きません"),
      ).toBeVisible();
      await expect(
        sample.getByRole("button", { name: /いいね/ }),
      ).toHaveAttribute("aria-pressed", "false");
      expect(townWrites.length).toBe(writes);
      await shot("8-sample-like");
    },
  );

  await check(
    "a profile change the account turns away later is kept, and said",
    async () => {
      await page.goto(base + "/profiles/me/");
      const editProfile = page.getByRole("button", {
        name: "プロフィールを編集",
      });
      const dialog = page.getByRole("dialog", { name: "読書家のプロフィール" });
      const bio = dialog.getByLabel("自己紹介", { exact: true });
      const kept = () =>
        page.evaluate(() =>
          localStorage.getItem("book-town-profile-drafts-v1"),
        );
      const refused = "夜にだけ本を読みます" + REFUSED_MARK;
      await editProfile.click();
      await bio.fill(refused);
      await dialog.getByRole("button", { name: "保存する" }).click();
      // The town takes it and the dialog closes; the account turns it away a
      // moment later, and the words are still kept.
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByText(
          "プロフィールを保存できませんでした。書きかけは残しています。",
        ),
      ).toBeVisible();
      expect(profile.bio).toBe("");
      expect(await kept()).toContain(refused);
      await editProfile.click();
      await expect(bio).toHaveValue(refused);
      await expect(dialog.getByText("書きかけを続けています")).toBeVisible();
      await expect(dialog.getByRole("alert")).toContainText(
        "うまく保存できませんでした。書きかけは残しています。",
      );
      // Written again and taken by the account, nothing is kept aside.
      await bio.fill("夜にだけ本を読みます。");
      await dialog.getByRole("button", { name: "保存する" }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => profile.bio).toBe("夜にだけ本を読みます。");
      await expect.poll(kept).toBeNull();
    },
  );

  /** The page at a narrow phone's width too, then back. */
  const shotNarrow = async (name) => {
    await shot(name + "-390");
    await page.setViewportSize({ width: 320, height: 640 });
    await shot(name + "-320");
    await page.setViewportSize({ width: 390, height: 844 });
  };
  const outboxKeys = () =>
    page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("book-town-outbox-v2:"),
      ),
    );

  await check(
    "a 便り the account turns away later comes back to 投稿する, and the banner names it",
    async () => {
      const REFUSED_POST = "雨の日に読む本を探しています。" + REFUSED_MARK;
      const fab = page.locator(".compose-fab");
      const compose = page.getByRole("dialog", { name: "投稿する" });
      const text = compose.locator("textarea");
      await page.goto(base + "/timeline/");
      await fab.click();
      await text.fill(REFUSED_POST);
      await compose
        .getByRole("button", { name: "投稿する", exact: true })
        .click();
      await expect(compose).toHaveCount(0);
      // The town takes it at once; the account turns it away a moment
      // later, and its words go back to the composer, said so.
      await expect(page.locator(".persistence-warning")).toHaveText(
        "便りを保存できませんでした。書きかけは残しています。",
      );
      // What said it was posted gives way to what says it was not.
      expect(await page.locator(".toast").count()).toBe(0);
      await expect(fab).toContainText("下書き");
      expect(await keptDraftKeys(POST_DRAFTS)).toEqual([user.id + ":new-post"]);
      // Turned away, it waits for nothing more.
      expect(await outboxKeys()).toEqual([]);
      await shotNarrow("9-refused-post");
      await fab.click();
      await expect(text).toHaveValue(REFUSED_POST);
      // Thrown away here, so the rest of the journey starts without it.
      await compose.getByRole("button", { name: "書きかけを消す" }).click();
      await compose.getByRole("button", { name: "消す", exact: true }).click();
      await expect(text).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(compose).toHaveCount(0);
      expect(await keptDraftKeys(POST_DRAFTS)).toEqual([]);
    },
  );

  await check(
    "a 便り written with no connection says it waits, and ログアウト says so until it is sent",
    async () => {
      const WAITING_POST = "電車の中で書いた便り。";
      const fab = page.locator(".compose-fab");
      const compose = page.getByRole("dialog", { name: "投稿する" });
      await page.goto(base + "/timeline/");
      await expect(page.locator("main.town-main")).toBeVisible();
      let release = () => {};
      postsHeld = new Promise((done) => (release = done));
      try {
        await context.setOffline(true);
        await fab.click();
        await compose.locator("textarea").fill(WAITING_POST);
        await compose
          .getByRole("button", { name: "投稿する", exact: true })
          .click();
        await expect(
          page.getByText(
            "つながらないため、まだ投稿できていません。つながりしだい投稿します。",
          ),
        ).toBeVisible();
        // Kept on this device while it waits.
        await expect
          .poll(outboxKeys)
          .toEqual(["book-town-outbox-v2:" + user.id]);
        await expect(page.locator(".toast")).toHaveCSS("opacity", "1");
        await shotNarrow("9-offline-post");
        // Back online, it is sent but not answered yet: ログアウト says what
        // it would let go of.
        await context.setOffline(false);
        await page.goto(base + "/login/");
        await expect(
          page.getByText(
            "まだ送れていない変更があります。ログアウトすると、この端末から消えます",
          ),
        ).toBeVisible();
        await shotNarrow("9-logout-warning");
      } finally {
        await context.setOffline(false);
        postsHeld = null;
        release();
      }
      // Answered, nothing waits any more.
      await page.goto(base + "/timeline/");
      await expect.poll(outboxKeys).toEqual([]);
      await page.goto(base + "/login/");
      await expect(
        page.getByText("まだ送れていない変更があります"),
      ).toHaveCount(0);
    },
  );

  await check(
    "a sign-in that ends by itself keeps what waits and says so, and sends it once signed in again",
    async () => {
      const LAPSED_POST = "ログインが切れる前に書いた便り。";
      const fab = page.locator(".compose-fab");
      const compose = page.getByRole("dialog", { name: "投稿する" });
      const warning = page.locator(".persistence-warning");
      await page.goto(base + "/timeline/");
      await expect(page.locator("main.town-main")).toBeVisible();
      let release = () => {};
      postsHeld = new Promise((done) => (release = done));
      try {
        await fab.click();
        await compose.locator("textarea").fill(LAPSED_POST);
        await compose
          .getByRole("button", { name: "投稿する", exact: true })
          .click();
        await expect
          .poll(outboxKeys)
          .toEqual(["book-town-outbox-v2:" + user.id]);
        // The session runs out and cannot be renewed: nobody pressed
        // ログアウト. The page looks at it again when it is shown.
        refreshRefused = true;
        await page.evaluate(() => {
          const key = Object.keys(localStorage).find((name) =>
            /^sb-.+-auth-token$/.test(name),
          );
          const kept = JSON.parse(localStorage.getItem(key));
          kept.expires_at = Math.floor(Date.now() / 1000) - 60;
          localStorage.setItem(key, JSON.stringify(kept));
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await expect(warning).toHaveText(
          "ログインが切れました。まだ送れていない変更は、この端末に残しています。もう一度ログインすると送ります。",
        );
        // It was not posted after all: the message saying so gives way.
        expect(await page.locator(".toast").count()).toBe(0);
        expect(await outboxKeys()).toEqual(["book-town-outbox-v2:" + user.id]);
        await shotNarrow("9-lapsed");
      } finally {
        refreshRefused = false;
        postsHeld = null;
        release();
      }
      // Signed in again by the link from the email: what waited is sent.
      const link = session();
      await page.goto("about:blank");
      await page.goto(
        base +
          "/login/#" +
          new URLSearchParams({
            access_token: link.access_token,
            expires_at: String(link.expires_at),
            expires_in: "3600",
            refresh_token: link.refresh_token,
            token_type: "bearer",
            type: "magiclink",
          }),
      );
      await expect(
        page.getByRole("heading", { name: "ログインしています" }),
      ).toBeVisible();
      await page.goto(base + "/timeline/");
      await expect.poll(outboxKeys).toEqual([]);
      await expect(warning).toBeHidden();
    },
  );

  await check(
    "a book registered while the town loads is not said to be registered",
    async () => {
      // The town's reads wait; the reader's own profile comes, so they are
      // signed in. What the page writes is answered here and noted.
      let holding = true;
      const held = [];
      const sent = [];
      const hold = (route) => {
        const request = route.request();
        const url = new URL(request.url());
        // Asking whether the reader is staff (注釈モード), or which of
        // their books are held back, writes nothing.
        if (
          url.pathname === "/rest/v1/rpc/can_annotate" ||
          url.pathname === "/rest/v1/rpc/book_holds"
        )
          return route.fallback();
        // Which books the reader typed in (my_books) is asked with the
        // town, so it waits with it.
        const read =
          request.method() === "GET" ||
          url.pathname === "/rest/v1/rpc/my_books";
        if (!read) {
          sent.push(url.pathname);
          return route.fulfill({ status: 201, body: "" });
        }
        if (!holding || url.searchParams.get("id") === "eq." + user.id)
          return route.fallback();
        held.push(route);
      };
      await page.route(supabase + "/rest/v1/**", hold);
      await page.goto(base + "/profiles/me/");
      // One book by hand: ［手で入力］ in the scanner.
      await page
        .locator(".profile-minor-actions")
        .getByRole("button", { name: "本を登録" })
        .click();
      const scanner = page.getByRole("dialog", { name: "本を続けて登録" });
      await scanner.getByRole("button", { name: "手で入力" }).click();
      const dialog = page.getByRole("dialog", {
        name: "本を登録",
        exact: true,
      });
      const register = dialog.getByRole("button", {
        name: "登録する",
        exact: true,
      });
      await dialog.getByLabel("タイトル").fill("こころ");
      await register.click();
      await expect(dialog.locator(".register-message")).toHaveText(
        "まだ保存できません。読み込みが終わってから、もう一度押してください。",
      );
      await expect(dialog).toBeVisible();
      await expect(page.locator(".toast")).toHaveCount(0);
      expect(held.length).toBeGreaterThan(0);
      expect(sent).toEqual([]);
      await shot("8-register-while-loading");
      // Once the town is read, the same press registers it, and it is sent.
      holding = false;
      for (const route of held.splice(0)) await route.fallback();
      // The reader's name comes with the town, behind the dialog.
      await expect(page.locator("#profile-name")).toHaveText("アキ");
      await register.click();
      await expect(page.locator(".toast")).toContainText(
        "『こころ』を登録しました",
      );
      await expect(dialog).toHaveCount(0);
      await expect
        .poll(() => sent)
        .toEqual([
          "/rest/v1/books",
          "/rest/v1/library_entries",
          "/rest/v1/book_marks",
        ]);
      await scanner.getByRole("button", { name: "終わる" }).click();
      await expect(scanner).toHaveCount(0);
      await page.unroute(supabase + "/rest/v1/**", hold);
    },
  );

  await check(
    "an ISBN read while the town loads waits on the device, then is registered",
    async () => {
      let holding = true;
      const held = [];
      const sent = [];
      const hold = (route) => {
        const request = route.request();
        const url = new URL(request.url());
        // Asking whether the reader is staff (注釈モード), or which of
        // their books are held back, writes nothing.
        if (
          url.pathname === "/rest/v1/rpc/can_annotate" ||
          url.pathname === "/rest/v1/rpc/book_holds"
        )
          return route.fallback();
        // Which books the reader typed in (my_books) is asked with the
        // town, so it waits with it.
        const read =
          request.method() === "GET" ||
          url.pathname === "/rest/v1/rpc/my_books";
        if (!read) {
          sent.push({ path: url.pathname, rows: request.postDataJSON() });
          return route.fulfill({ status: 201, body: "" });
        }
        if (!holding || url.searchParams.get("id") === "eq." + user.id)
          return route.fallback();
        held.push(route);
      };
      // openBD knows its title.
      const READ_ISBN = "9784101092058";
      const titles = (route) => {
        const isbns = new URL(route.request().url()).searchParams
          .get("isbn")
          .split(",");
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(
            isbns.map((isbn) =>
              isbn === READ_ISBN
                ? { summary: { isbn, title: "車輪の下", author: "ヘッセ／著" } }
                : null,
            ),
          ),
        });
      };
      await page.route("https://api.openbd.jp/**", titles);
      await page.route(supabase + "/rest/v1/**", hold);
      await page.goto(base + "/profiles/me/");
      await page
        .locator(".profile-minor-actions")
        .getByRole("button", { name: "本を登録" })
        .click();
      const scanner = page.getByRole("dialog", { name: "本を続けて登録" });
      await expect(scanner.locator(".scan-banner")).toContainText(
        "読み込んでいます",
      );
      // No camera here: the ISBN is typed.
      await scanner.getByLabel("ISBN", { exact: true }).fill(READ_ISBN);
      await expect(scanner.locator(".scan-card-status")).toHaveText(
        "読み込みが終わったら登録します",
      );
      // Kept on this device, and nothing sent yet.
      const journalKey = "book-town-library-journal:" + user.id;
      const journal = () =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key))?.items ?? null,
          journalKey,
        );
      expect(await journal()).toEqual([
        expect.objectContaining({ isbn: READ_ISBN, state: "ready" }),
      ]);
      const decided = (await journal())[0].bookId;
      expect(sent).toEqual([]);
      await shot("8-scan-while-loading");
      // Once the town is read, it is registered with the id it was given.
      holding = false;
      for (const route of held.splice(0)) await route.fallback();
      await expect(scanner.locator(".scan-card-status")).toHaveText(
        "登録しました",
      );
      await expect(scanner.locator(".scan-count")).toHaveText("この回 1冊");
      await expect
        .poll(() => sent.map((write) => write.path))
        .toEqual([
          "/rest/v1/books",
          "/rest/v1/library_entries",
          "/rest/v1/book_marks",
        ]);
      const [books, entries, marks] = sent.map((write) => [write.rows].flat());
      expect(books).toHaveLength(1);
      expect(books[0]).toEqual(
        expect.objectContaining({ isbn: READ_ISBN, title: "車輪の下" }),
      );
      expect(books[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      // The id decided at the read: sent twice, it would be one book.
      expect(books[0].id).toBe(decided);
      expect(marks.map((mark) => mark.book_id)).toEqual([books[0].id]);
      // Its library row says it came in by an ISBN typed, written before the mark.
      expect(entries).toEqual([
        expect.objectContaining({ book_id: books[0].id, source: "isbn" }),
      ]);
      // Saved: the device lets it go.
      await expect.poll(journal).toBeNull();
      await scanner.getByRole("button", { name: "終わる" }).click();
      await expect(page.locator(".toast")).toContainText("1冊を登録しました");
      await page.unroute(supabase + "/rest/v1/**", hold);
      await page.unroute("https://api.openbd.jp/**", titles);
    },
  );

  await check(
    "another reader's typed-in book is the reader's own copy on its page",
    async () => {
      // レン typed three books in; the reader has a copy of the first, wished,
      // on a shelf of their shop.
      const REN = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e01";
      const THEIRS = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e02";
      const COPY = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e03";
      const UNTAKEN = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e04";
      const LATER = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e05";
      const WORK = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e06";
      const SHOP = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e07";
      const at = "2026-10-12T00:00:00Z";
      const typed = (id, created_by, title, work_id = id) => ({
        id,
        isbn: null,
        title,
        author: "試験 作家",
        publisher: "",
        price: null,
        source: "manual",
        created_by,
        work_id,
        created_at: at,
        updated_at: at,
      });
      const shelf = {
        id: "evening",
        name: "夕方の棚",
        capacity: 10,
        isPublic: true,
        items: [{ id: "e1", bookId: COPY, display: "face", pop: "" }],
      };
      town = {
        books: [
          typed(THEIRS, REN, "夜の手帖", WORK),
          typed(COPY, user.id, "夜の手帖", WORK),
          typed(UNTAKEN, REN, "朝の手帖"),
          typed(LATER, REN, "昼の手帖"),
        ],
        book_marks: [
          { user_id: user.id, book_id: COPY, kind: "wish", created_at: at },
        ],
        my_books: [{ id: COPY, copied_from: THEIRS }],
        shops: [
          {
            id: SHOP,
            owner_id: user.id,
            name: "アキの夕方の本屋",
            description: "",
            tagline: "",
            theme: "sage",
            is_open: true,
            public_shelves: [shelf],
            public_scene_books: [],
          },
        ],
        shop_private: [{ shelves: [shelf], scene_books: [] }],
      };
      // What the page writes is answered here and noted, in order.
      const sent = [];
      const writes = [
        "/rest/v1/rpc/copy_book",
        "/rest/v1/book_marks",
        "/rest/v1/library_entries",
        "/rest/v1/shop_private",
      ];
      const answer = (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === "GET" || !writes.includes(url.pathname))
          return route.fallback();
        sent.push({
          path: url.pathname,
          asked: url.search + " " + (request.postData() ?? ""),
        });
        return route.fulfill({ status: 201, body: "" });
      };
      await page.route(supabase + "/rest/v1/**", answer);
      await page.goto(base + "/books/registered/?id=" + THEIRS);
      // Asked of レン's book, the reader's copy answers.
      const wished = page.getByRole("button", { name: "読みたいに登録済み" });
      await expect(wished).toBeVisible();
      await expect(page.locator(".bh-to-shop").first()).toHaveAttribute(
        "href",
        new RegExp("place=" + COPY),
      );
      // The shop that has the reader's copy has this book.
      await expect(page.locator(".stockist h3")).toHaveText([
        "アキの夕方の本屋",
      ]);
      await wished.click();
      await expect(
        page.getByRole("button", { name: "読みたいに加える" }),
      ).toBeVisible();
      await expect
        .poll(() => sent.map((write) => write.path))
        .toContain("/rest/v1/book_marks");
      for (const write of sent) {
        expect(write.asked).toContain(COPY);
        expect(write.asked).not.toContain(THEIRS);
      }
      // One the reader has nothing of: the copy is made first, then named.
      sent.splice(0);
      await page.goto(base + "/books/registered/?id=" + UNTAKEN);
      await page.getByRole("button", { name: "読みたいに加える" }).click();
      await expect(
        page.getByRole("button", { name: "読みたいに登録済み" }),
      ).toBeVisible();
      await expect
        .poll(() => sent.map((write) => write.path))
        .toContain("/rest/v1/book_marks");
      const [made, ...named] = sent;
      expect(made.path).toBe("/rest/v1/rpc/copy_book");
      expect(made.asked).toContain(UNTAKEN);
      const copy = /"copy":"([0-9a-f-]{36})"/.exec(made.asked)?.[1];
      expect(copy).toBeTruthy();
      for (const write of named) {
        expect(write.path).not.toBe("/rest/v1/rpc/copy_book");
        expect(write.asked).toContain(copy);
        expect(write.asked).not.toContain(UNTAKEN);
      }
      // No shop has it yet: the way to put it on a shelf takes the copy.
      await expect(
        page.locator(".stockist-list .empty-state a"),
      ).toHaveAttribute("href", new RegExp("place=" + copy));
      // Put among the shop's scene, a book the reader has nothing of goes on
      // as their copy, made first.
      sent.splice(0);
      await page.goto(base + "/my-shop/");
      await page
        .getByRole("button", { name: "店内を飾りつける", exact: true })
        .click();
      const editor = page.getByRole("dialog", {
        name: "店内を飾りつける",
        exact: true,
      });
      await editor.getByLabel("棚に加える本を探す").fill("昼の手帖");
      await editor
        .locator(".scene-search-results button", { hasText: "昼の手帖" })
        .click();
      await editor
        .getByRole("button", { name: "店内を保存", exact: true })
        .click();
      await expect(editor).toHaveCount(0);
      await expect
        .poll(() => sent.map((write) => write.path))
        .toContain("/rest/v1/shop_private");
      const [placed, ...scene] = sent;
      expect(placed.path).toBe("/rest/v1/rpc/copy_book");
      expect(placed.asked).toContain(LATER);
      const later = /"copy":"([0-9a-f-]{36})"/.exec(placed.asked)?.[1];
      expect(later).toBeTruthy();
      expect(scene.map((write) => write.path)).toContain(
        "/rest/v1/shop_private",
      );
      for (const write of scene) {
        expect(write.path).not.toBe("/rest/v1/rpc/copy_book");
        expect(write.asked).not.toContain(LATER);
      }
      expect(
        scene.find((write) => write.path === "/rest/v1/shop_private").asked,
      ).toContain(later);
      await expect.poll(outboxKeys).toEqual([]);
      await page.unroute(supabase + "/rest/v1/**", answer);
      town = null;
    },
  );

  // Another reader, their shop and posts; what reports did; the reader's own
  // reports; and two books with outside covers.
  const OTHER = "3c1d2b4a-7e6f-4a5b-8c9d-0e1f2a3b4c5d";
  const OTHER_SHOP = "4d2e3c5b-8f7a-4b6c-9d0e-1f2a3b4c5d6e";
  const FOLDED = "5e3f4d6c-9a8b-4c7d-8e1f-2a3b4c5d6e7f";
  const TO_REPORT = "6f4a5e7d-0b9c-4d8e-9f2a-3b4c5d6e7f80";
  const OWN_HELD = "7a5b6f8e-1c0d-4e9f-8a3b-4c5d6e7f8091";
  const COVER_BOOK = "8b6c7a9f-2d1e-4f0a-9b4c-5d6e7f8091a2";
  const REFUSED_BOOK = "9c7d8b0a-3e2f-4a1b-8c5d-6e7f8091a2b3";
  // Posters: another reader's folded one and one the reader will report,
  // and two of the reader's own, held and folded.
  const POSTER_FOLDED = "a0b1c2d3-4e5f-4a6b-8c7d-8e9f0a1b2c01";
  const POSTER_TO_REPORT = "a0b1c2d3-4e5f-4a6b-8c7d-8e9f0a1b2c02";
  const POSTER_OWN_HELD = "a0b1c2d3-4e5f-4a6b-8c7d-8e9f0a1b2c03";
  const POSTER_OWN_FOLDED = "a0b1c2d3-4e5f-4a6b-8c7d-8e9f0a1b2c04";
  const ago = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();
  const postRow = (id, author_id, body, created_at) => ({
    id,
    author_id,
    body,
    book_id: null,
    spoiler: false,
    spoiler_folded: false,
    parent_id: null,
    reading_mode: null,
    created_at,
  });
  const bookRow = (id, isbn, title) => ({
    id,
    isbn,
    title,
    author: "試験 作家",
    publisher: "",
    price: null,
    source: "isbn",
    created_by: OTHER,
    created_at: ago(30),
    updated_at: ago(30),
  });
  const filled = () => ({
    profiles: [
      {
        id: OTHER,
        handle: "ren_reads",
        name: "レン",
        bio: "夜にだけ本を読む人です。",
        color: "#8a7f6a",
        links: [],
        compose_icon: "pen",
        reading_visibility: "private",
        created_at: ago(400),
        updated_at: ago(400),
      },
    ],
    shops: [
      {
        id: OTHER_SHOP,
        owner_id: OTHER,
        name: "レンの夜の本屋",
        description: "夜更けに開く、小さな本屋です。",
        tagline: "",
        theme: "sage",
        is_open: true,
        public_shelves: [
          {
            id: "night",
            name: "夜の棚",
            capacity: 10,
            isPublic: true,
            items: [{ id: "n1", bookId: COVER_BOOK, display: "face", pop: "" }],
          },
        ],
        public_scene_books: [],
      },
    ],
    posts: [
      {
        ...postRow(FOLDED, OTHER, "三人分の通報でたたまれた言葉。", ago(2)),
        book_id: COVER_BOOK,
      },
      postRow(TO_REPORT, OTHER, "これから通報される言葉。", ago(3)),
      postRow(OWN_HELD, user.id, "運営が確かめている、わたしの言葉。", ago(4)),
    ],
    books: [
      bookRow(COVER_BOOK, OPENBD_ISBN, "こころの本"),
      bookRow(REFUSED_BOOK, REFUSED_ISBN, "星の本"),
    ],
    moderation_folds: [
      {
        target_kind: "post",
        target_id: FOLDED,
        state: "folded",
        since: ago(1),
      },
      {
        target_kind: "post",
        target_id: OWN_HELD,
        state: "held",
        since: ago(1),
      },
      {
        target_kind: "profile",
        target_id: OTHER,
        state: "folded",
        since: ago(1),
      },
      {
        target_kind: "shop",
        target_id: OTHER_SHOP,
        state: "folded",
        since: ago(1),
      },
    ],
    reports: [
      {
        id: "1a000000-0000-4000-8000-000000000001",
        target_kind: "profile",
        target_id: OTHER,
        reason: "harassment",
        progress: "checking",
        created_at: "2026-10-12T03:00:00Z",
        status_at: ago(1),
      },
      {
        id: "1a000000-0000-4000-8000-000000000002",
        target_kind: "shop",
        target_id: OTHER_SHOP,
        reason: "spam",
        progress: "checked",
        created_at: "2026-10-11T03:00:00Z",
        status_at: ago(2),
      },
    ],
    cover_refusals: [{ isbn: REFUSED_ISBN, source: "google" }],
  });
  const posterRow = (id, author_id, heading, text, bookId, created_at) => ({
    id,
    author_id,
    template: "one_book",
    theme: "navy",
    font: "mincho",
    pages: [
      {
        blocks: [
          { type: "heading", text: heading },
          { type: "books", book_ids: [bookId] },
          { type: "text", text },
        ],
      },
    ],
    spoiler: false,
    show_in_timeline: true,
    allow_display: true,
    status: "published",
    created_at,
    updated_at: created_at,
  });
  const fold = (target_id, state) => ({
    target_kind: "poster",
    target_id,
    state,
    since: ago(1),
  });
  const withPosters = () => {
    const rows = filled();
    rows.posters = [
      posterRow(
        POSTER_FOLDED,
        OTHER,
        "たたまれたポスターの見出し",
        "たたまれたポスターの言葉。",
        COVER_BOOK,
        ago(5),
      ),
      {
        ...posterRow(
          POSTER_TO_REPORT,
          OTHER,
          "結末を語るポスター",
          "最後の場面の話。",
          REFUSED_BOOK,
          ago(6),
        ),
        spoiler: true,
      },
      posterRow(
        POSTER_OWN_HELD,
        user.id,
        "確かめられているわたしのポスター",
        "わたしの言葉。",
        COVER_BOOK,
        ago(7),
      ),
      posterRow(
        POSTER_OWN_FOLDED,
        user.id,
        "たたまれたわたしのポスター",
        "わたしの別の言葉。",
        REFUSED_BOOK,
        ago(8),
      ),
    ];
    rows.moderation_folds.push(
      fold(POSTER_FOLDED, "folded"),
      fold(POSTER_OWN_HELD, "held"),
      fold(POSTER_OWN_FOLDED, "folded"),
    );
    return rows;
  };
  // The home's 特集 (PR 1b): a town of its own for each check.
  const homeId = (n) =>
    "4b6c7d8e-9f0a-4b1c-8d2e-" + String(n).padStart(12, "0");
  const profileRow = (id, handle, name) => ({
    id,
    handle,
    name,
    bio: "",
    color: "#8a7f6a",
    links: [],
    compose_icon: "pen",
    reading_visibility: "private",
    created_at: ago(400),
    updated_at: ago(400),
  });
  /** Six 便り of the reader's own this morning: the home needs no others. */
  const ownMorning = () =>
    Array.from({ length: 6 }, (_, at) =>
      postRow(
        homeId(30 + at),
        user.id,
        `今朝の一行、その${at + 1}。`,
        ago(0.1 * (at + 1)),
      ),
    );
  // Until the town is read: the bones, or the 便り kept from last time.
  const bones = page.locator("main .home-skeletons, main .home-kept");
  const homeDoors = page.getByRole("navigation", { name: "できること" });

  await check(
    "the home never shows a shelf kept private nor covered words: not on 今夜の一軒, 本棚をのぞく, 本屋のPOP, 感想が面白い本 or the 掲示板",
    async () => {
      // ミナ's shop: a private shelf first (a book and a POP on it), as the
      // database would never send it, then a public one of three books.
      const MINA = homeId(1);
      const MINA_SHOP = homeId(2);
      const READERS = [
        [homeId(3), "yu_reads", "ユウ"],
        [homeId(4), "kai_reads", "カイ"],
        [homeId(5), "sora_reads", "ソラ"],
      ];
      const CORNER = [homeId(11), homeId(12), homeId(13)];
      const LOCKED = homeId(14);
      const SECRET = {
        shelf: "誰にも見せない奥の棚",
        book: "鍵のかかった日記帳",
        pop: "ここだけの内緒の言葉",
        covered: "ひみつの結末",
      };
      town = {
        profiles: [
          profileRow(MINA, "mina_reads", "ミナ"),
          ...READERS.map(([id, handle, name]) => profileRow(id, handle, name)),
        ],
        shops: [
          {
            id: MINA_SHOP,
            owner_id: MINA,
            name: "ミナの角の本屋",
            description: "",
            tagline: "",
            theme: "sage",
            is_open: true,
            public_shelves: [
              {
                id: "locked",
                name: SECRET.shelf,
                capacity: 10,
                isPublic: false,
                items: [
                  {
                    id: "l1",
                    bookId: LOCKED,
                    display: "face",
                    pop: SECRET.pop,
                  },
                ],
              },
              {
                id: "corner",
                name: "角の棚",
                capacity: 10,
                isPublic: true,
                items: CORNER.map((bookId, at) => ({
                  id: "c" + at,
                  bookId,
                  display: "spine",
                  pop: "",
                })),
              },
            ],
            public_scene_books: [],
          },
        ],
        books: [
          ...CORNER.map((id, at) => bookRow(id, null, `角の本 その${at + 1}`)),
          bookRow(LOCKED, null, SECRET.book),
        ],
        posts: [
          ...ownMorning(),
          // ミナ's newest, about a book, with words covered (||…||).
          {
            ...postRow(
              homeId(20),
              MINA,
              `最後に||${SECRET.covered}||が待っていた。`,
              ago(0.8),
            ),
            book_id: CORNER[0],
          },
          ...READERS.map(([id, , name], at) => ({
            ...postRow(
              homeId(21 + at),
              id,
              `${name}の感想。角の本を読んだ。`,
              ago(1 + at),
            ),
            book_id: CORNER[at],
          })),
        ],
      };
      await openHome();
      await expect(bones).toHaveCount(0, { timeout: 10000 });
      // Each part drawn, so what is missing from it is left out, not undrawn.
      await expect(
        page.locator(".home-carousel .home-slide.is-tonight"),
      ).toContainText("ミナの角の本屋");
      await expect(
        page.getByRole("region", { name: "本棚をのぞく" }).first(),
      ).toContainText("ミナの角の本屋");
      await expect(
        page.getByRole("region", { name: "本屋のPOP" }).first(),
      ).toBeVisible();
      const reviews = page.getByRole("region", { name: "感想が面白い本" });
      for (const [, , name] of READERS)
        await expect(reviews).toContainText(`${name}の感想。`);
      await expect(page.locator("#home-board")).toBeVisible();
      const html = await page.content();
      for (const [what, words] of Object.entries(SECRET))
        expect(html, what).not.toContain(words);
      town = null;
    },
  );

  await check(
    "a poster folded while the home holds 「今日の街」 leaves its 企画展 slide",
    async () => {
      // レン's newest poster is the 企画展 slide; his shop, unfolded here,
      // is one the reader can follow from the alley.
      const POSTER_OPEN = "a0b1c2d3-4e5f-4a6b-8c7d-8e9f0a1b2c05";
      const rows = withPosters();
      rows.moderation_folds = rows.moderation_folds.filter(
        (entry) =>
          entry.target_kind === "post" || entry.target_kind === "poster",
      );
      rows.posters.unshift(
        posterRow(
          POSTER_OPEN,
          OTHER,
          "夜更けの企画展",
          "夜に読む本を集めました。",
          COVER_BOOK,
          ago(0.5),
        ),
      );
      town = rows;
      await openHome();
      await expect(bones).toHaveCount(0, { timeout: 10000 });
      const slide = page.locator(".home-carousel .home-slide.is-exhibition");
      await expect(slide).toHaveCount(1);
      await expect(slide).toContainText("夜更けの企画展");
      const covers = page.locator("article.poster-card").filter({
        hasText: "通報があったため、運営が確かめるまで、たたんでいます",
      });
      const folded = await covers.count();
      // Folded by reports meanwhile. The follow below is refused (the
      // stand-in answers no write of it), so the town is read again in
      // place, the fold with it, while the home holds what it drew.
      town.moderation_folds.push(fold(POSTER_OPEN, "folded"));
      const writes = townWrites.length;
      const reads = townReads.length;
      await page
        .getByRole("button", { name: "レンの夜の本屋をフォロー" })
        .click();
      await expect
        .poll(() => townWrites.slice(writes))
        .toContain("/rest/v1/shop_follows");
      await expect
        .poll(() => townReads.slice(reads))
        .toContain("/rest/v1/moderation_folds");
      await expect(
        page.getByRole("button", { name: "レンの夜の本屋をフォロー" }),
      ).toBeVisible();
      // The slide is gone, and its card among the 便り is folded, as the
      // poster now is: its title nowhere on the page.
      await expect(slide).toHaveCount(0);
      await expect(covers).toHaveCount(folded + 1);
      await expect(page.getByText("夜更けの企画展")).toHaveCount(0);
      town = null;
    },
  );

  await check(
    "while the town is read, the doors that depend on it wait: never 本屋を開く for a shop's owner, never a 掲示板 with no board",
    async () => {
      const OWN_SHOP = "0f1e2d3c-4b5a-4968-8776-655443322110";
      const shelf = {
        id: "first",
        name: "はじめの本棚",
        capacity: 20,
        isPublic: true,
        items: [{ id: "f1", bookId: COVER_BOOK, display: "face", pop: "" }],
      };
      town = {
        shops: [
          {
            id: OWN_SHOP,
            owner_id: user.id,
            name: "アキの本屋",
            description: "",
            tagline: "",
            theme: "sage",
            is_open: true,
            public_shelves: [shelf],
            public_scene_books: [],
          },
        ],
        shop_private: [{ shelves: [shelf], scene_books: [] }],
        books: [bookRow(COVER_BOOK, OPENBD_ISBN, "こころの本")],
      };
      const release = holdTown();
      try {
        await openHome();
        await expect(bones).toHaveAttribute("aria-busy", "true");
        for (const name of ["本屋を開く", "本を登録", "掲示板"])
          await expect(homeDoors.getByText(name)).toHaveCount(0);
        // Their places kept, as shapes.
        await expect(homeDoors.locator(".home-entrance")).toHaveCount(4);
        await expect(
          homeDoors.locator(".home-entrance.is-waiting"),
        ).toHaveCount(2);
        release();
        await expect(bones).toHaveCount(0, { timeout: 10000 });
      } finally {
        release();
      }
      await expect(
        homeDoors.getByRole("button", { name: "本を登録" }),
      ).toBeVisible();
      await expect(
        homeDoors.getByRole("link", { name: "本屋を開く" }),
      ).toHaveCount(0);
      await homeDoors.getByRole("button", { name: "掲示板" }).click();
      await expect(page.locator("#home-board")).toBeInViewport();
      town = null;
    },
  );

  await check(
    "new 便り wait above until a tap or a pull: the pill, its eight seconds and the dot, the tab, a pull, an old 便り's page and 便りだけ's older 便り",
    async () => {
      // ミナ, followed: five 便り read with the town, and three older than
      // the town's read. New ones come while Home is open.
      const MINA = homeId(40);
      const MINA_SHOP = homeId(41);
      const NEW_BOOK = homeId(42);
      const minas = [1, 2, 3, 4, 5].map((hours) =>
        postRow(
          homeId(50 + hours),
          MINA,
          `ミナの便り、${hours}時間前。`,
          ago(hours),
        ),
      );
      const old = [30, 31, 32].map((days) =>
        postRow(
          homeId(60 + days),
          MINA,
          `ミナの前の便り、${days}日前。`,
          ago(days * 24),
        ),
      );
      const OLD_REPLY = homeId(99);
      town = {
        profiles: [profileRow(MINA, "mina_reads", "ミナ")],
        shops: [
          {
            id: MINA_SHOP,
            owner_id: MINA,
            name: "ミナの角の本屋",
            description: "",
            tagline: "",
            theme: "sage",
            is_open: true,
            public_shelves: [],
            public_scene_books: [],
          },
        ],
        shop_follows: [{ shop_id: MINA_SHOP }],
        books: [],
        posts: [
          ...minas,
          ...old,
          {
            ...postRow(
              OLD_REPLY,
              MINA,
              "前の便りへの、ミナの返事。",
              ago(30 * 24 - 1),
            ),
            parent_id: old[0].id,
          },
        ],
      };
      for (const row of [...old, town.posts.at(-1)]) outsideLoad.add(row.id);
      const arrive = (n, words, extra = {}) => {
        const row = {
          ...postRow(homeId(70 + n), MINA, words, new Date().toISOString()),
          ...extra,
        };
        town.posts.push(row);
        return row;
      };
      // A phone of its own, signed in as the reader, whose clock the test
      // keeps.
      const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        reducedMotion: "reduce",
        storageState: await context.storageState(),
      });
      try {
        await phone.route(supabase + "/**", standIn);
        await phone.route(
          (url) => !url.href.startsWith(base) && !url.href.startsWith(supabase),
          (route) => route.abort(),
        );
        await phone.clock.install();
        const at = settleBeforeNavigating(await phone.newPage());
        at.on("pageerror", (e) => errors.push(e.message));
        await at.goto(base + "/");
        const homeTab = at
          .getByRole("tablist", { name: "ホームの表示" })
          .getByRole("tab", { name: /^ホーム/ });
        if ((await homeTab.getAttribute("aria-selected")) !== "true")
          await homeTab.click();
        const pane = at.locator('[role="tabpanel"][data-pane="home"]');
        // The 便り themselves, not a 特集's cards between them.
        const cards = pane.locator(
          ".home-letters > .post-feed > article.letter",
        );
        await expect(cards.first()).toHaveAttribute(
          "data-post-id",
          minas[0].id,
          { timeout: 10000 },
        );
        const order = () =>
          cards.evaluateAll((all) => all.map((card) => card.dataset.postId));
        const drawn = await order();
        const pill = at.getByRole("button", { name: "新しい便りを見る" });
        const said = at.locator(".town-said");
        const writes = townWrites.length;
        /**
         * Nothing of what came was written back: a change would be on its
         * way after the save's short wait (400ms on the page's clock).
         */
        const nothingWritten = async (paused = true) => {
          if (paused) await at.clock.runFor(1_000);
          await new Promise((done) => setTimeout(done, 1_500));
          expect(townWrites.slice(writes)).toEqual([]);
        };
        // The clock stops a little ahead: Home is still settling.
        const now = await at.evaluate(() => Date.now());
        await at.clock.pauseAt(now + 2000);

        // A minute later the town reads what came; nothing moves.
        const first = arrive(1, "新しく届いた、ミナの便り。", {
          book_id: NEW_BOOK,
        });
        town.books.push(bookRow(NEW_BOOK, null, "届いたばかりの本"));
        const asked = postReads.length;
        await at.clock.runFor(30_000);
        expect(postReads.length, "not before the minute").toBe(asked);
        await at.clock.runFor(31_000);
        await expect(pill).toBeVisible();
        expect(postReads.slice(asked).join(" ")).toContain("created_at=gte.");
        await expect(said).toHaveText("新しい便りがあります");
        await expect(pill).toContainText("新しい便り");
        await expect(pill.locator(".home-new-face")).toHaveText("ミ");
        // ミナ's colour is washed pale, so the ink of her initial reads.
        await expectReadable(pill.locator(".home-new-face"), "her initial");
        expect(await order()).toEqual(drawn);
        await expect(at.getByText(first.body)).toHaveCount(0);
        await expectReadable(pill, "the pill");
        // 34px to the eye, a finger's 44px to a tap.
        const box = await pill.boundingBox();
        expect(Math.round(box.height)).toBe(34);
        const missed = await pill.evaluate((button) => {
          const { left, top, width, height } = button.getBoundingClientRect();
          const x = left + width / 2;
          const y = top + height / 2;
          return [-21, 0, 21]
            .flatMap((dx) => [-21, 0, 21].map((dy) => [dx, dy]))
            .filter(([dx, dy]) => {
              const hit = document.elementFromPoint(x + dx, y + dy);
              return !hit || !button.contains(hit);
            });
        });
        expect(missed, "points a finger misses").toEqual([]);
        await at.screenshot({ path: path.join(output, "2a-new-pill.png") });

        // Eight seconds on the screen, then a small dot says it instead.
        await at.clock.runFor(7_900);
        await expect(pill).toBeVisible();
        await at.clock.runFor(200);
        await expect(pill).toHaveCount(0);
        const dotted = at.getByRole("tab", {
          name: "ホーム（新しい便りがあります）",
        });
        await expect(dotted).toBeVisible();
        await expect(dotted.locator(".home-tab-dot")).toBeVisible();
        await expect(
          at.getByRole("tab", { name: "便りだけ（新しい便りがあります）" }),
        ).toBeVisible();
        expect(await order()).toEqual(drawn);
        await expect(at.locator("main")).not.toContainText(
          /(^|\D)0(人|件|軒|分|回|冊| 投稿| フォロ)/,
        );

        // Down the page and back up a little, the tab shown is tapped: the
        // new 便り goes in at the top, and the page goes there.
        const shell = at.locator(".town-shell");
        await at.evaluate(() => window.scrollTo(0, 600));
        await expect(shell).toHaveAttribute("data-bar", "hidden");
        await at.evaluate(() => window.scrollTo(0, 560));
        await expect(shell).not.toHaveAttribute("data-bar", "hidden");
        await expect(dotted).toBeInViewport();
        await dotted.tap();
        await expect(cards.first()).toHaveAttribute("data-post-id", first.id);
        expect(await at.evaluate(() => scrollY)).toBe(0);
        await expect(said).toHaveText("新しい便りを上に出しました");
        await expect(
          at.getByRole("tab", { name: "ホーム", exact: true }),
        ).toBeVisible();
        // Six followed of late now: no 「街の便り」 below them any more.
        const followed = minas.map((row) => row.id);
        expect(drawn.slice(0, 5)).toEqual(followed);
        expect(await order()).toEqual([first.id, ...followed]);
        await expect(cards.first()).toContainText("届いたばかりの本");
        // Taken in as the town's own reading: nothing of it is written back.
        await nothingWritten();

        // The next one: a tap on the pill.
        const second = arrive(2, "もうひとつ届いた、ミナの便り。");
        await at.clock.runFor(61_000);
        await expect(pill).toBeVisible();
        expect(await order()).toEqual([first.id, ...followed]);
        await pill.tap();
        await expect(pill).toHaveCount(0);
        await expect(cards.first()).toHaveAttribute("data-post-id", second.id);
        expect(await at.evaluate(() => scrollY)).toBe(0);

        // A pull at the top: v37's words in turn, and what came is on top.
        const view = at.locator(".home-view");
        const pull = (stage, dy) =>
          view.evaluate(
            (element, { stage, dy }) => {
              const box = element.getBoundingClientRect();
              const point = (y) =>
                new Touch({
                  identifier: 1,
                  target: element,
                  clientX: box.left + box.width / 2,
                  clientY: y,
                });
              const fire = (type, touch) =>
                element.dispatchEvent(
                  new TouchEvent(type, {
                    bubbles: true,
                    touches: type === "touchend" ? [] : [touch],
                    changedTouches: [touch],
                  }),
                );
              const top = box.top + 120;
              if (stage === "start") fire("touchstart", point(top));
              if (stage === "move") fire("touchmove", point(top + dy));
              if (stage === "end") fire("touchend", point(top + dy));
            },
            { stage, dy },
          );
        const words = at.locator(".home-pull");
        const third = arrive(3, "引っぱって届いた、ミナの便り。");
        await pull("start", 0);
        await pull("move", 60);
        await expect(words).toHaveText("引っぱって新しい便りを読む");
        await pull("move", 170);
        await expect(words).toHaveText("離すと読み込みます");
        expect((await words.boundingBox()).height).toBeCloseTo(85, 0);
        await expect(words).toHaveAttribute("aria-hidden", "true");
        await pull("end", 170);
        await expect(words).toHaveText("新しい便りが届きました");
        await expect(said).toHaveText("新しい便りが届きました");
        await expect(cards.first()).toHaveAttribute("data-post-id", third.id);
        await expectReadable(words.locator("span"), "the pull's words");
        await at.clock.runFor(1_000);
        await expect(words).toHaveCount(0);
        // Again, with nothing new.
        await pull("start", 0);
        await pull("move", 170);
        await pull("end", 170);
        await expect(words).toHaveText("新しい便りはまだありません");
        await expect(said).toHaveText("新しい便りはまだありません");
        await at.clock.runFor(1_000);
        await expect(words).toHaveCount(0);
        // A short pull reads nothing.
        const reads = postReads.length;
        await pull("start", 0);
        await pull("move", 100);
        await pull("end", 100);
        await expect(words).toHaveCount(0);
        expect(postReads.length).toBe(reads);
        await nothingWritten();
        await at.clock.resume();

        // An old 便り, not in the town's read, opens by its id; its reply
        // comes along. One that is not there says so.
        await at.goto(base + "/post/?id=" + old[0].id);
        await expect(at.getByText(old[0].body)).toBeVisible();
        await expect(at.getByText("前の便りへの、ミナの返事。")).toBeVisible();
        expect(postReads.join(" ")).toContain("id=eq." + old[0].id);
        await at.goto(base + "/post/?id=" + homeId(98));
        await expect(
          at.getByText("この便りは、いまは開けません"),
        ).toBeVisible();

        // 便りだけ: past the 便り the town read, the older ones come a page
        // at a time; then the end. Opened last two and a half hours ago,
        // 「前に開いたのはここまで」 stands above the first from before.
        await at.evaluate(
          (key) =>
            localStorage.setItem(key, String(Date.now() - 2.5 * 3600_000)),
          "book-town-home-opened-v1",
        );
        await at.goto(base + "/timeline/");
        const letters = at.locator('[role="tabpanel"][data-pane="letters"]');
        await expect(letters.getByText("便りは、ここまでです")).toBeVisible({
          timeout: 10000,
        });
        expect(
          await letters
            .locator("article.letter")
            .evaluateAll((all) => all.map((card) => card.dataset.postId)),
        ).toEqual([
          third.id,
          second.id,
          first.id,
          ...minas.map((row) => row.id),
          ...old.map((row) => row.id),
        ]);
        const older = postReads.find((query) =>
          query.includes("created_at=lte."),
        );
        expect(older).toContain("author_id=in.");
        expect(older).toContain("parent_id=is.null");
        const line = letters.locator(".home-since");
        await expect(line).toHaveText("前に開いたのはここまで");
        expect(
          await line.evaluate(
            (element) => element.nextElementSibling?.dataset.postId,
          ),
        ).toBe(minas[2].id);
        await expectReadable(line, "「前に開いたのはここまで」");
        await expect(at.locator("main")).not.toContainText(
          /(^|\D)0(人|件|軒|分|回|冊| 投稿| フォロ)/,
        );
        await at.screenshot({
          path: path.join(output, "2a-older.png"),
          fullPage: true,
        });
        await nothingWritten(false);
      } finally {
        await phone.close();
        outsideLoad.clear();
        town = null;
      }
    },
  );

  await check(
    "new 便り wait under a layer, keep the focus, dot a pane left behind and are said once; 便り read by id or back stay in order, tell nothing and survive a town read again",
    async () => {
      // ミナ, followed: three 便り of late and ten from weeks ago, read with
      // the town; three older than its read, one with a reply. レン is not
      // followed: his 便り tops up ホーム as 「街の便り」.
      const MINA = homeId(200);
      const MINA_SHOP = homeId(201);
      const REN = homeId(202);
      const recent = [1, 2, 3].map((hours) =>
        postRow(
          homeId(210 + hours),
          MINA,
          `ミナの近ごろ、${hours}時間前。`,
          ago(hours),
        ),
      );
      const weeks = Array.from({ length: 10 }, (_, n) =>
        postRow(
          homeId(220 + n),
          MINA,
          `ミナの数週前、${20 + n}日前。`,
          ago((20 + n) * 24),
        ),
      );
      const old = [40, 41, 42].map((days) =>
        postRow(
          homeId(200 + days),
          MINA,
          `ミナの昔の便り、${days}日前。`,
          ago(days * 24),
        ),
      );
      const oldReply = {
        ...postRow(homeId(250), MINA, "昔の便りへの返事。", ago(41 * 24 - 1)),
        parent_id: old[1].id,
      };
      town = {
        profiles: [
          profileRow(MINA, "mina_reads", "ミナ"),
          profileRow(REN, "ren_reads", "レン"),
        ],
        shops: [
          {
            id: MINA_SHOP,
            owner_id: MINA,
            name: "ミナの角の本屋",
            description: "",
            tagline: "",
            theme: "sage",
            is_open: true,
            public_shelves: [],
            public_scene_books: [],
          },
        ],
        shop_follows: [{ shop_id: MINA_SHOP }],
        books: [],
        posts: [...recent, ...weeks, ...old, oldReply],
      };
      for (const row of [...old, oldReply]) outsideLoad.add(row.id);
      const arrive = (n, author, words) => {
        const row = postRow(
          homeId(260 + n),
          author,
          words,
          new Date().toISOString(),
        );
        town.posts.push(row);
        return row;
      };
      const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        reducedMotion: "reduce",
        storageState: await context.storageState(),
      });
      try {
        await phone.route(supabase + "/**", standIn);
        await phone.route(
          (url) => !url.href.startsWith(base) && !url.href.startsWith(supabase),
          (route) => route.abort(),
        );
        await phone.clock.install();
        const at = settleBeforeNavigating(await phone.newPage());
        at.on("pageerror", (e) => errors.push(e.message));
        // Every notice so far read: the bell has no light.
        await at.goto(base + "/notifications/");
        const bell = at.getByRole("link", { name: "お知らせ", exact: true });
        await expect(bell).toHaveCount(1, { timeout: 10000 });
        // Kept in this browser once saved, for the pages opened next.
        await expect
          .poll(() =>
            at.evaluate(
              (key) => localStorage.getItem(key) ?? "",
              "book-town-seen-v1:" + user.id,
            ),
          )
          .toContain("follow:" + recent[0].id);

        // An old 便り by its id, the network dropping the first read: it
        // says so, and reads again when asked, the focus kept on the page.
        failPostOnce = old[1].id;
        await at.goto(base + "/post/?id=" + old[1].id);
        await expect(
          at.getByText("つながらないため、開けませんでした"),
        ).toBeVisible();
        await at.getByRole("button", { name: "もう一度読む" }).click();
        await expect(at.getByText(old[1].body)).toBeVisible();
        await expect(at.getByText(oldReply.body)).toBeVisible();
        expect(await at.evaluate(() => document.activeElement?.className)).toBe(
          "post-page-body",
        );
        // A change refused there (the stand-in answers no いいね): the town
        // is read again without it, and the page reads it again, staying.
        const reads = postReads.length;
        await at
          .locator(".post-page .letter.is-main")
          .getByRole("button", { name: "いいね" })
          .click();
        await expect
          .poll(
            () =>
              postReads
                .slice(reads)
                .filter(
                  (query) =>
                    new URLSearchParams(query).get("id") === "eq." + old[1].id,
                ).length,
          )
          .toBeGreaterThan(0);
        await expect(at.getByText(old[1].body)).toBeVisible();
        await expect(at).toHaveURL(base + "/post/?id=" + old[1].id);

        // On to the town in place: 便りだけ reads back past the town's read,
        // the first page dropped once and read again when asked; the 便り
        // opened by its id stands in its own place, and none of the old
        // ones lights the bell.
        failOlderOnce = true;
        await at.getByRole("button", { name: "本の街へ" }).click();
        await expect(at).toHaveURL(/\/(timeline\/)?$/);
        const tabs = at.getByRole("tablist", { name: "ホームの表示" });
        const tab = (name) => tabs.getByRole("tab", { name });
        if ((await tab(/^便りだけ/).getAttribute("aria-selected")) !== "true")
          await tab(/^便りだけ/).click();
        const letters = at.locator('[role="tabpanel"][data-pane="letters"]');
        const again = letters.getByRole("button", {
          name: "前の便りをもう一度読む",
        });
        // Near the end, the next page is read.
        const toEnd = () =>
          at.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect(letters.locator("article.letter")).toHaveCount(13, {
          timeout: 10000,
        });
        await toEnd();
        await again.click();
        await expect(letters.getByText("便りは、ここまでです")).toBeVisible({
          timeout: 10000,
        });
        expect(await at.evaluate(() => document.activeElement?.className)).toBe(
          "home-letters-further",
        );
        const lettersOrder = () =>
          letters
            .locator("article.letter")
            .evaluateAll((all) => all.map((card) => card.dataset.postId));
        const inOrder = [...recent, ...weeks, ...old].map((row) => row.id);
        expect(await lettersOrder()).toEqual(inOrder);
        await expect(bell).toHaveCount(1);
        // A change refused here too: read again, 便りだけ reads back again,
        // never saying it is all there with the old ones gone.
        const backReads = postReads.length;
        await letters
          .locator(`article.letter[data-post-id="${weeks[0].id}"]`)
          .getByRole("button", { name: "いいね" })
          .click();
        await expect
          .poll(async () => {
            await toEnd();
            return postReads
              .slice(backReads)
              .filter((query) => query.includes("created_at=lte.")).length;
          })
          .toBe(1);
        await expect(
          letters.locator(`article.letter[data-post-id="${old[2].id}"]`),
        ).toHaveCount(1);
        expect(await lettersOrder()).toEqual(inOrder);
        await expect(at.locator("main")).not.toContainText(
          /(^|\D)0(人|件|軒|分|回|冊| 投稿| フォロ)/,
        );

        // What the town says is counted from here, each time it says it.
        await at.evaluate(() => {
          window.townSaid = [];
          new MutationObserver((changes) => {
            for (const change of changes)
              if (change.target.classList?.contains("town-said"))
                for (const node of change.addedNodes)
                  window.townSaid.push(node.textContent);
          }).observe(document.body, { childList: true, subtree: true });
        });
        const saidSoFar = () => at.evaluate(() => [...window.townSaid]);
        await tab(/^ホーム/).click();
        await at.evaluate(() => window.scrollTo(0, 0));
        const home = at.locator('[role="tabpanel"][data-pane="home"]');
        const homeCards = home.locator(
          ".home-letters > .post-feed > article.letter",
        );
        const pill = at.getByRole("button", { name: "新しい便りを見る" });
        const now = await at.evaluate(() => Date.now());
        await at.clock.pauseAt(now + 2000);
        const newReads = () =>
          postReads.filter((query) => query.includes("created_at=gte.")).length;

        // A 便り's page open over Home when one comes: the pill waits under
        // it, and its eight seconds with it.
        await homeCards.first().locator(".letter-time").click();
        const layer = at.locator(".post-page.is-layer");
        await expect(layer).toBeVisible();
        const first = arrive(1, MINA, "ページを開いている間に届いた便り。");
        let before = newReads();
        await at.clock.runFor(61_000);
        await expect.poll(newReads).toBe(before + 1);
        // Not drawn at all (the page beneath is out of a screen reader's
        // reach under the layer, so asked by its class), nor said.
        const drawn = at.locator(".home-new");
        await at.waitForTimeout(500);
        await expect(drawn).toHaveCount(0);
        await at.clock.runFor(10_000);
        await expect(drawn).toHaveCount(0);
        expect(await saidSoFar()).toEqual([]);
        await layer.getByRole("button", { name: "戻る" }).click();
        await expect(layer).toHaveCount(0);
        await expect(pill).toBeVisible();
        expect(await saidSoFar()).toEqual(["新しい便りがあります"]);
        await at.clock.runFor(4_000);
        await expect(pill).toBeVisible();

        // With the focus on it, its time stands still; taken with Enter,
        // the focus goes to the tab shown.
        await pill.focus();
        await at.clock.runFor(9_000);
        await expect(pill).toBeVisible();
        await at.keyboard.press("Enter");
        await expect(pill).toHaveCount(0);
        await expect(homeCards.first()).toHaveAttribute(
          "data-post-id",
          first.id,
        );
        expect(await at.evaluate(() => document.activeElement?.id)).toBe(
          "home-tab-home",
        );
        expect((await saidSoFar()).at(-1)).toBe("新しい便りを上に出しました");
        // 便りだけ, made before, still draws the town from before: a dot
        // says so until it is renewed.
        const behind = tab("便りだけ（新しい便りがあります）");
        await expect(behind).toBeVisible();
        await behind.click();
        await expect(behind).toHaveAttribute("aria-selected", "true");
        await expect(letters.locator("article.letter").first()).toHaveAttribute(
          "data-post-id",
          recent[0].id,
        );
        await at.evaluate(() => window.scrollTo(0, 0));
        await behind.click();
        await expect(letters.locator("article.letter").first()).toHaveAttribute(
          "data-post-id",
          first.id,
        );
        await expect(tab("便りだけ")).toHaveAttribute("aria-selected", "true");

        // Down 便りだけ, レン's 便り comes: nothing for 便りだけ. Its tab
        // tapped takes it in without a word, and ホーム, where it would
        // show, keeps a dot until renewed.
        const ren = arrive(2, REN, "レンの、街に届いた便り。");
        before = newReads();
        await at.clock.runFor(61_000);
        await expect.poll(newReads).toBe(before + 1);
        await expect(pill).toHaveCount(0);
        const saidBefore = (await saidSoFar()).length;
        // Down 便りだけ, then a little back up: the bars come back.
        const shell = at.locator(".town-shell");
        const down = await at.evaluate(() => {
          const y = Math.min(900, document.body.scrollHeight - innerHeight);
          window.scrollTo(0, y);
          return y;
        });
        expect(down).toBeGreaterThan(200);
        await expect(shell).toHaveAttribute("data-bar", "hidden");
        await at.evaluate((y) => window.scrollTo(0, y - 40), down);
        await expect(shell).not.toHaveAttribute("data-bar", "hidden");
        await tab("便りだけ").click();
        await expect(tab("ホーム（新しい便りがあります）")).toBeVisible();
        expect((await saidSoFar()).length).toBe(saidBefore);
        await tab("ホーム（新しい便りがあります）").click();
        await expect(home.getByText(ren.body)).toHaveCount(0);
        await at.evaluate(() => window.scrollTo(0, 0));
        await tab("ホーム（新しい便りがあります）").click();
        await expect(home.getByText(ren.body)).toBeVisible();
        await expect(tab("ホーム")).toBeVisible();

        // Said once for what came: not again when the bars bring the pill
        // back, nor when Home is left and come back to.
        await at.evaluate(() => window.scrollTo(0, 0));
        const fourth = arrive(3, MINA, "四つめに届いた、ミナの便り。");
        await at.clock.runFor(61_000);
        await expect(pill).toBeVisible();
        const told = (await saidSoFar()).length;
        expect((await saidSoFar()).at(-1)).toBe("新しい便りがあります");
        await at.evaluate(() => window.scrollTo(0, 600));
        await expect(shell).toHaveAttribute("data-bar", "hidden");
        await expect(pill).toHaveCount(0);
        await at.evaluate(() => window.scrollTo(0, 0));
        await expect(shell).not.toHaveAttribute("data-bar", "hidden");
        await expect(pill).toBeVisible();
        const nav = at.getByRole("navigation", {
          name: "スマートフォンナビゲーション",
        });
        await nav.getByRole("link", { name: "検索" }).click();
        await expect(at).toHaveURL(base + "/search/");
        await nav.getByRole("link", { name: "ホーム" }).click();
        await expect(pill).toBeVisible();
        expect((await saidSoFar()).length).toBe(told);

        // Off Home, and with the page out of view, nothing is read; back in
        // view, at once.
        const away = newReads();
        await nav.getByRole("link", { name: "検索" }).click();
        await expect(at).toHaveURL(base + "/search/");
        await at.clock.runFor(3 * 60_000);
        expect(newReads()).toBe(away);
        // The read back on Home is let finish in the page before it goes
        // out of view: a read is timed from when the page took its answer,
        // and one taken while the clock below runs on looks just made when
        // the page comes back. レン writes meanwhile, so the page has taken
        // the answer once レン's face joins the pill (its network reply alone
        // can come before that, on a slow runner).
        arrive(4, REN, "レンの、ホームを離れていたあいだの便り。");
        await nav.getByRole("link", { name: "ホーム" }).click();
        await expect.poll(newReads).toBe(away + 1);
        await expect(pill.locator(".home-new-face")).toHaveCount(2);
        const seen = (state) =>
          at.evaluate((state) => {
            Object.defineProperty(document, "visibilityState", {
              value: state,
              configurable: true,
            });
            document.dispatchEvent(new Event("visibilitychange"));
          }, state);
        await seen("hidden");
        await at.clock.runFor(3 * 60_000);
        expect(newReads()).toBe(away + 1);
        await seen("visible");
        await expect.poll(newReads).toBe(away + 2);
        await pill.tap();
        await expect(homeCards.first()).toHaveAttribute(
          "data-post-id",
          fourth.id,
        );
        await at.clock.resume();
      } finally {
        await phone.close();
        outsideLoad.clear();
        failOlderOnce = false;
        failPostOnce = null;
        town = null;
      }
    },
  );

  await check(
    "ひとこと: memos read together come in at Live's top while it is seen, never as new 便り; 止める (kept through a redraw and Home left, and 動かす by the keyboard too), a 便り's page over it, the keyboard's focus on a line and the box off the screen hold them; a memo waiting for the box is no new 便り when Home is come back to; a line just come opens its 便り and 便りだけ gets a dot for it; each memo shows once; with less motion nothing moves",
    async () => {
      // The page's clock starts on a night the 見本 town's memos are within
      // Live's seven days of, so they stay below サク's whatever day it runs.
      const LIVE_NOW = Date.parse("2026-10-11T06:00:00+09:00");
      const startedAt = Date.now();
      const agoLive = (hours) =>
        new Date(LIVE_NOW - hours * 3600_000).toISOString();
      const nowLive = () =>
        new Date(LIVE_NOW + (Date.now() - startedAt)).toISOString();
      // サク, followed: two 便り and three memos read together of late.
      const SAKU = homeId(300);
      const SAKU_SHOP = homeId(301);
      const LIVE_BOOK = homeId(302);
      const memoRow = (id, words, created_at) => ({
        ...postRow(id, SAKU, words, created_at),
        book_id: LIVE_BOOK,
        reading_mode: "together",
      });
      const memos = [1, 2, 3].map((hours) =>
        memoRow(
          homeId(310 + hours),
          `いっしょに読んでいる、${hours}時間前のひとこと。`,
          agoLive(hours),
        ),
      );
      const letters = [4, 5].map((hours) =>
        postRow(
          homeId(320 + hours),
          SAKU,
          `サクの便り、${hours}時間前。`,
          agoLive(hours),
        ),
      );
      town = {
        profiles: [profileRow(SAKU, "saku_reads", "サク")],
        shops: [
          {
            id: SAKU_SHOP,
            owner_id: SAKU,
            name: "サクの本屋",
            description: "",
            tagline: "",
            theme: "sage",
            is_open: true,
            public_shelves: [],
            public_scene_books: [],
          },
        ],
        shop_follows: [{ shop_id: SAKU_SHOP }],
        books: [bookRow(LIVE_BOOK, null, "いっしょに読む本")],
        posts: [...memos, ...letters],
      };
      const arrive = (n, words) => {
        const row = memoRow(homeId(340 + n), words, nowLive());
        town.posts.push(row);
        return row;
      };
      const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        storageState: await context.storageState(),
      });
      try {
        await phone.route(supabase + "/**", standIn);
        await phone.route(
          (url) => !url.href.startsWith(base) && !url.href.startsWith(supabase),
          (route) => route.abort(),
        );
        // Every move Live makes, counted.
        await phone.addInitScript(() => {
          // And all that is said to a screen reader.
          window.liveSaid = [];
          new MutationObserver((changes) => {
            for (const change of changes)
              if (change.target.classList?.contains("town-said"))
                for (const node of change.addedNodes)
                  window.liveSaid.push(node.textContent);
          }).observe(document, { childList: true, subtree: true });
          window.liveMoves = 0;
          const animate = Element.prototype.animate;
          Element.prototype.animate = function (...args) {
            if (this.closest(".home-live")) window.liveMoves += 1;
            return animate.apply(this, args);
          };
        });
        await phone.clock.install({ time: LIVE_NOW });
        const at = settleBeforeNavigating(await phone.newPage());
        at.on("pageerror", (e) => errors.push(e.message));
        await at.goto(base + "/");
        const homeTab = at
          .getByRole("tablist", { name: "ホームの表示" })
          .getByRole("tab", { name: /^ホーム/ });
        const lettersTab = at
          .getByRole("tablist", { name: "ホームの表示" })
          .getByRole("tab", { name: /^便りだけ/ });
        if ((await homeTab.getAttribute("aria-selected")) !== "true")
          await homeTab.click();
        const pane = at.locator('[role="tabpanel"][data-pane="home"]');
        const live = pane.locator(".home-live");
        const box = live.locator(".home-live-box");
        const rows = box.locator(".home-live-line");
        const lines = () =>
          rows.evaluateAll((all) => all.map((row) => row.dataset.postId));
        const cards = pane.locator(
          ".home-letters > .post-feed > article.letter",
        );
        const cardIds = () =>
          cards.evaluateAll((all) => all.map((card) => card.dataset.postId));
        /** Each memo once: in Live, never among the 便り too. */
        const eachOnce = async () => {
          const inLive = await lines();
          expect(new Set(inLive).size).toBe(inLive.length);
          expect((await cardIds()).filter((id) => inLive.includes(id))).toEqual(
            [],
          );
        };
        // サク's, then the 見本 town's memos below them, six at most.
        const top = async (count) => (await lines()).slice(0, count);
        const MEMOS = memos.map((row) => row.id);
        const LETTERS = letters.map((row) => row.id);
        await expect(rows).toHaveCount(6, { timeout: 10000 });
        expect(await top(3)).toEqual(MEMOS);
        expect((await cardIds()).slice(0, 2)).toEqual(LETTERS);
        await expect(box).toHaveAttribute("aria-live", "off");
        const stop = live.getByRole("button", { name: "ひとことを止める" });
        const go = live.getByRole("button", { name: "ひとことを動かす" });
        const size = await stop.boundingBox();
        expect(size.width).toBeGreaterThanOrEqual(44);
        expect(size.height).toBeGreaterThanOrEqual(44);
        const height = () =>
          box.evaluate((element) => element.getBoundingClientRect().height);
        expect(await height()).toBe(312);
        await box.evaluate((element) =>
          element.scrollIntoView({ block: "center" }),
        );
        const pill = at.getByRole("button", { name: "新しい便りを見る" });
        const newReads = () =>
          postReads.filter((query) => query.includes("created_at=gte.")).length;
        // The clock stops a little ahead: Home is still settling.
        const now = await at.evaluate(() => Date.now());
        await at.clock.pauseAt(now + 2000);

        // A memo comes: at Live's top, the box as tall as it was, and no
        // pill, as it is no new 便り.
        const first = arrive(1, "届いたばかりのひとこと。");
        let before = newReads();
        await at.clock.runFor(61_000);
        await expect.poll(newReads).toBe(before + 1);
        await expect.poll(() => top(4)).toEqual([first.id, ...MEMOS]);
        expect(await height()).toBe(312);
        await expect(pill).toBeHidden();
        expect(await at.evaluate(() => window.liveMoves)).toBeGreaterThan(0);
        await eachOnce();

        // 止める: what comes waits outside the box; 動かす lets it in. Home
        // left and come back to keeps it stopped, and the memo waiting for
        // the box is no new 便り there: no pill, nothing said.
        await stop.tap();
        await expect(go).toBeVisible();
        const said = await at.evaluate(() => window.liveSaid.length);
        const nav = at.getByRole("navigation", {
          name: "スマートフォンナビゲーション",
        });
        await nav.getByRole("link", { name: "検索" }).click();
        await expect(at).toHaveURL(base + "/search/");
        await nav.getByRole("link", { name: "ホーム" }).click();
        await expect(go).toBeVisible();
        await expect(pill).toBeHidden();
        expect(
          await at.evaluate((from) => window.liveSaid.slice(from), said),
        ).not.toContain("新しい便りがあります");
        // So does Home drawn again (the tab), which takes the memo in.
        await box.evaluate((element) =>
          element.scrollIntoView({ block: "center" }),
        );
        await homeTab.click();
        await expect(go).toBeVisible();
        await expect.poll(() => top(4)).toEqual([first.id, ...MEMOS]);
        // 便りだけ made now, from the town as it is: nothing behind there.
        await lettersTab.click();
        await homeTab.click();
        await expect(lettersTab).toHaveAccessibleName("便りだけ");
        await box.evaluate((element) =>
          element.scrollIntoView({ block: "center" }),
        );
        const second = arrive(2, "止めている間に届いたひとこと。");
        before = newReads();
        await at.clock.runFor(61_000);
        await expect.poll(newReads).toBe(before + 1);
        await at.clock.runFor(1_000);
        expect((await lines())[0]).toBe(first.id);
        await expect(pill).toBeHidden();
        await go.tap();
        await expect.poll(async () => (await lines())[0]).toBe(second.id);
        await expect(stop).toBeVisible();

        // A line just come, not in the town yet, opens its 便り's page.
        // What comes while it is open waits, and goes in once it is closed;
        // 便りだけ, drawn before the memo was taken in, gets a dot for it.
        await rows.first().locator(".home-live-text").tap();
        const layer = at.getByRole("dialog", { name: /^サクさんの便り/ });
        await expect(layer).toBeVisible();
        await expect(layer).toContainText(second.body);
        const fourth = arrive(4, "ページを読んでいる間に届いたひとこと。");
        before = newReads();
        await at.clock.runFor(61_000);
        await expect.poll(newReads).toBe(before + 1);
        await at.clock.runFor(1_000);
        expect((await lines())[0]).toBe(second.id);
        await at.goBack();
        await expect(layer).toHaveCount(0);
        await expect.poll(async () => (await lines())[0]).toBe(fourth.id);
        await expect(lettersTab).toHaveAccessibleName(
          "便りだけ（新しい便りがあります）",
        );
        await expect(pill).toBeHidden();
        await eachOnce();
        // Home drawn again: the memos stay Live's, none a 便り.
        await homeTab.click();
        await expect
          .poll(() => top(6))
          .toEqual([fourth.id, second.id, first.id, ...MEMOS]);
        expect((await cardIds()).slice(0, 2)).toEqual(LETTERS);
        await eachOnce();

        // The keyboard's focus on a line: what comes waits until it leaves,
        // so the line it is on never slips under the box.
        await box.evaluate((element) =>
          element.scrollIntoView({ block: "center" }),
        );
        await at.keyboard.press("Tab");
        const keyed = rows.nth(2).locator("a.home-live-time");
        await keyed.focus();
        await box.evaluate((element) =>
          element.scrollIntoView({ block: "center" }),
        );
        expect(
          await keyed.evaluate((link) => link.matches(":focus-visible")),
        ).toBe(true);
        const fifth = arrive(5, "キーボードで読んでいる間に届いたひとこと。");
        before = newReads();
        await at.clock.runFor(61_000);
        await expect.poll(newReads).toBe(before + 1);
        await at.clock.runFor(1_000);
        expect((await lines())[0]).toBe(fourth.id);
        await expect(keyed).toBeFocused();
        await keyed.evaluate((link) => link.blur());
        await expect.poll(async () => (await lines())[0]).toBe(fifth.id);

        // 止める and 動かす by the keyboard: the focus on them holds nothing,
        // and 動かす lets in what waited.
        await stop.focus();
        await box.evaluate((element) =>
          element.scrollIntoView({ block: "center" }),
        );
        await at.keyboard.press("Enter");
        await expect(go).toBeFocused();
        const seventh = arrive(7, "止めて、動かすまでに届いたひとこと。");
        before = newReads();
        await at.clock.runFor(61_000);
        await expect.poll(newReads).toBe(before + 1);
        await at.clock.runFor(1_000);
        expect((await lines())[0]).toBe(fifth.id);
        await at.keyboard.press("Enter");
        await expect(stop).toBeFocused();
        await expect.poll(async () => (await lines())[0]).toBe(seventh.id);

        // Off the screen: what comes waits, and goes in once the box is seen.
        await at.evaluate(() =>
          window.scrollTo(0, document.documentElement.scrollHeight),
        );
        await expect
          .poll(() =>
            box.evaluate((element) => {
              const edges = element.getBoundingClientRect();
              return edges.bottom <= 0 || edges.top >= innerHeight;
            }),
          )
          .toBe(true);
        const sixth = arrive(6, "見えないところに届いたひとこと。");
        before = newReads();
        await at.clock.runFor(61_000);
        await expect.poll(newReads).toBe(before + 1);
        await at.clock.runFor(1_000);
        expect((await lines())[0]).toBe(seventh.id);
        await expect(pill).toBeHidden();
        await box.evaluate((element) =>
          element.scrollIntoView({ block: "center" }),
        );
        await expect.poll(async () => (await lines())[0]).toBe(sixth.id);
        await eachOnce();

        // Less motion: a line comes in without moving.
        await at.emulateMedia({ reducedMotion: "reduce" });
        expect(
          await box.evaluate(
            (element) => getComputedStyle(element).transitionDuration,
          ),
        ).toBe("0s");
        await box.evaluate((element) =>
          element.scrollIntoView({ block: "center" }),
        );
        const moves = await at.evaluate(() => window.liveMoves);
        const third = arrive(3, "動きを減らしても届くひとこと。");
        before = newReads();
        await at.clock.runFor(61_000);
        await expect.poll(newReads).toBe(before + 1);
        await expect.poll(async () => (await lines())[0]).toBe(third.id);
        expect(await at.evaluate(() => window.liveMoves)).toBe(moves);
        await expect(pill).toBeHidden();
        await at.clock.resume();
      } finally {
        await phone.close();
        town = null;
      }
    },
  );

  await check(
    "a post folded by reports opens with a tap; the writer is told gently",
    async () => {
      town = filled();
      // レン is not followed: his 便り are among 「街の便り」 on ホーム.
      await openHome();
      const folded = page.locator("article.post-card").filter({
        hasText: "通報があったため、運営が確かめるまで、たたんでいます",
      });
      await expect(folded).toBeVisible();
      await expect(
        page.getByText("三人分の通報でたたまれた言葉。"),
      ).toHaveCount(0);
      // Nor its book, until it is opened.
      await expect(folded).not.toContainText("こころの本");
      await expect(folded.locator(".post-book")).toHaveCount(0);
      // The writer's own post, held: still theirs to read, and why.
      await expect(
        page.getByText(
          "運営が確かめるまで、ほかの人からは見えないようにしています。問題がなければ、元に戻ります。",
        ),
      ).toBeVisible();
      await expect(
        page.getByText("運営が確かめている、わたしの言葉。"),
      ).toBeVisible();
      await shot("9-folded-post");
      await folded.getByRole("button", { name: "読む" }).click();
      await expect(
        page.getByText("三人分の通報でたたまれた言葉。"),
      ).toBeVisible();
      await expect(
        page
          .locator("article.post-card")
          .filter({ hasText: "三人分の通報でたたまれた言葉。" })
          .locator(".post-book"),
      ).toContainText("こころの本");
    },
  );

  await check(
    "a reporter is told the report was received, and the post folds for them",
    async () => {
      const post = page
        .locator("article.post-card")
        .filter({ hasText: "これから通報される言葉。" });
      await post.getByRole("button", { name: "その他の操作" }).click();
      await page
        .getByRole("dialog", { name: "その他の操作" })
        .getByRole("button", { name: "この投稿を通報" })
        .click();
      const dialog = page.getByRole("dialog", { name: "通報する" });
      await expect(dialog.locator("label:has(input[type=radio])")).toHaveText([
        "宣伝・スパム",
        "嫌がらせ・攻撃的な言葉",
        "個人情報をさらしている",
        "脅し・危害を加えるという言葉",
        "不適切な内容",
        "その他",
      ]);
      await dialog.getByLabel("脅し・危害を加えるという言葉").check();
      // What is chosen and written is kept for this account and this post
      // through a close by hand, until the report is received.
      const words = dialog.getByLabel("くわしく（なくても大丈夫です）");
      await words.fill("同じ言葉が何度も届きます。");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      expect(Object.keys(await keptReports())).toEqual([
        `${user.id}:post:${TO_REPORT}`,
      ]);
      await layersSettled(page);
      await post.getByRole("button", { name: "その他の操作" }).click();
      await page
        .getByRole("dialog", { name: "その他の操作" })
        .getByRole("button", { name: "この投稿を通報" })
        .click();
      await expect(
        dialog.getByLabel("脅し・危害を加えるという言葉"),
      ).toBeChecked();
      await expect(words).toHaveValue("同じ言葉が何度も届きます。");
      await expect(dialog.getByText("書きかけを続けています")).toBeVisible();
      await dialog.getByRole("button", { name: "通報する" }).click();
      await expect(dialog).toContainText(
        "受け付けました。知らせてくださって、ありがとうございます。",
      );
      await expect(dialog).toContainText(
        "運営が確認を始めたときと、確認し終えたときに、お知らせでお伝えします。相手への対応の中身は、お伝えしていません。",
      );
      await expect(dialog).toContainText(
        "この投稿は、あなたの画面ではたたんでおきます。",
      );
      // What the reporter will be told, and that it folds, can be read.
      await expectReadable(dialog.locator("p"), "report sent");
      expect(reportsSent.at(-1)).toEqual({
        reporter_id: user.id,
        target_kind: "post",
        target_id: TO_REPORT,
        reason: "threat",
        detail: "同じ言葉が何度も届きます。",
      });
      // Received, nothing is kept aside any more.
      expect(await keptReports()).toEqual({});
      await shot("10-report-sent");
      await dialog.getByRole("button", { name: "閉じる" }).last().click();
      const mine = page
        .locator("article.post-card")
        .filter({ hasText: "あなたが通報した投稿です" });
      await expect(mine).toBeVisible();
      await expect(page.getByText("これから通報される言葉。")).toHaveCount(0);
      await mine.getByRole("button", { name: "読む" }).click();
      await expect(page.getByText("これから通報される言葉。")).toBeVisible();
    },
  );

  await check(
    "the reporter hears only how far along each report is",
    async () => {
      await page.goto(base + "/notifications/");
      await expect(
        page.getByText(
          "読書家について10月12日にいただいた通報を、運営が確認しています",
        ),
      ).toBeVisible();
      await expect(
        page.getByText(
          "本屋について10月11日にいただいた通報を、運営が確認しました。知らせてくださって、ありがとうございます",
        ),
      ).toBeVisible();
      // The writer of the held post is told too, never who or how many.
      await expect(
        page.getByText(/運営が確かめるまで、あなたの投稿「運営が確かめている/),
      ).toBeVisible();
      const own = page.getByRole("region", { name: "あなたの通報" });
      await expect(own.getByRole("listitem")).toHaveText([
        /^\d+月\d+日 · 投稿 · 脅し・危害を加えるという言葉 · 受け付けました$/,
        "10月12日 · 読書家 · 嫌がらせ・攻撃的な言葉 · 確認中",
        "10月11日 · 本屋 · 宣伝・スパム · 確認しました",
      ]);
      await expect(own.getByRole("link")).toHaveCount(0);
      await expectReadable(own.getByRole("listitem"), "own reports");
      // Every read of reports asked only for what a reporter may read.
      expect(reportReadsRefused).toEqual([]);
      await shot("11-own-reports");
      await page.getByRole("link", { name: /運営が確認しています/ }).click();
      await expect(page).toHaveURL(/\/notifications\/#reports$/);
      await expect(own).toBeInViewport();
    },
  );

  await check(
    "a person's and a shop's words folded by reports open with a tap",
    async () => {
      await page.goto(base + "/profile/?id=" + OTHER);
      await expect(
        page.getByRole("heading", { name: "レン", exact: true }),
      ).toBeVisible();
      const words = page.getByText(
        "この紹介文は、通報があったため、運営が確かめるまでたたんでいます",
      );
      // The bio, and the shop's introduction on its sign (opened on the shop's page).
      await expect(words).toHaveCount(2);
      await expect(page.getByText("夜にだけ本を読む人です。")).toHaveCount(0);
      await shot("12-folded-bio");
      await expect(page.locator(".words-folded button")).toHaveCount(1);
      await page
        .locator(".words-folded")
        .getByRole("button", { name: "読む" })
        .click();
      await expect(page.getByText("夜にだけ本を読む人です。")).toBeVisible();
      await page.goto(base + "/shop/?id=" + OTHER_SHOP);
      await expect(
        page.getByRole("heading", { name: "レンの夜の本屋" }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("夜更けに開く、小さな本屋です。"),
      ).toHaveCount(0);
      await page
        .locator(".shop-about .words-folded")
        .getByRole("button", { name: "読む" })
        .click();
      await expect(
        page.getByText("夜更けに開く、小さな本屋です。"),
      ).toBeVisible();
      // In passing, folded words are not matched.
      await page.goto(base + "/search/");
      await page.getByRole("searchbox").first().fill("夜更けに開く");
      await expect(page.getByText("レンの夜の本屋")).toHaveCount(0);
    },
  );

  await check(
    "another reader's typed-in book waits for its name in lists before a search",
    async () => {
      // レン typed in 星の本 and used it nowhere; こころの本 is on their public shelf.
      await page.goto(base + "/search/");
      await expect(
        page.getByRole("heading", { name: "棚の隅の本" }),
      ).toBeVisible();
      await expect(page.locator("main")).not.toContainText("星の本");
      // Nor does a genre find it: the 登録した本 chip, or part of it typed.
      const box = page.getByRole("searchbox", { name: "本と書店を検索" });
      const listed = (title) =>
        page.locator(".search-results .search-book").filter({
          hasText: title,
        });
      await page
        .getByRole("group", { name: "ジャンルで探す" })
        .getByRole("button", { name: "登録した本" })
        .click();
      await expect(box).toHaveValue("登録した本");
      await expect(listed("こころの本")).toHaveCount(1);
      await expect(listed("星の本")).toHaveCount(0);
      await box.fill("登録");
      await expect(listed("こころの本")).toHaveCount(1);
      await expect(listed("星の本")).toHaveCount(0);
      await box.fill("星の本");
      await expect(listed("星の本")).toHaveCount(1);
      // The 人生の9冊 picker offers it only once it is searched for.
      await page.goto(base + "/profiles/me/");
      await page
        .getByRole("region", { name: "人生の9冊" })
        .getByRole("button", { name: "編集" })
        .click();
      const nine = page.getByRole("dialog", { name: "人生の9冊を選ぶ" });
      const pick = (title) =>
        nine.getByRole("button", { name: title + "を人生の9冊に加える" });
      await expect(pick("こころの本")).toBeVisible();
      await expect(pick("星の本")).toHaveCount(0);
      const nineBox = nine.getByRole("searchbox", {
        name: "人生の9冊に追加する本を検索",
      });
      await nineBox.fill("登録した本");
      await expect(pick("こころの本")).toBeVisible();
      await expect(pick("星の本")).toHaveCount(0);
      await nineBox.fill("星の本");
      await expect(pick("星の本")).toBeVisible();
      await nine.getByRole("button", { name: "キャンセル" }).click();
      await expect(nine).toHaveCount(0);
      // Nor does a 見本's shop fill out its shelves with it in the walk,
      // though it may with こころの本 (one 見本's shelf is named 星の本).
      const onShelf = (title) =>
        page.locator(`.walk-book-target[aria-label^="${title}、試験 作家。"]`);
      await page.goto(base + "/walk/");
      await expect(page.locator(".walk-book-target").first()).toBeVisible();
      await expect(page).toHaveURL(/\/walk\/#./);
      const first = page.url();
      let shelved = 0;
      for (let step = 0; step < 12; step++) {
        const at = page.url();
        await expect(onShelf("星の本")).toHaveCount(0);
        if (/#shop-/.test(at)) shelved += await onShelf("こころの本").count();
        await page.getByRole("button", { name: "次の書店" }).click();
        await expect(page).not.toHaveURL(at);
        if (page.url() === first) break;
      }
      expect(page.url()).toBe(first);
      expect(shelved).toBeGreaterThan(0);
    },
  );

  await check(
    "a nine saved on another device first is not written over, and the reader's own waits to be opened",
    async () => {
      // The database counts the nine's versions; the page reads version 1.
      profile.nine_version = 1;
      town.profile_nine = [];
      const sent = [];
      const answer = (route) => {
        sent.push(JSON.parse(route.request().postData()));
        if (sent.length === 1) {
          // Another device saved its nine first: version 2.
          profile.nine_version = 2;
          town.profile_nine = [
            {
              profile_id: user.id,
              position: 0,
              book_id: "solaris",
              note: "別の端末で選んだ一冊",
            },
          ];
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              code: "PT409",
              message: "changed elsewhere",
              details: null,
              hint: null,
            }),
          });
        }
        profile.nine_version = 3;
        town.profile_nine = [
          { profile_id: user.id, position: 0, book_id: "momo", note: "" },
        ];
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "3",
        });
      };
      await page.route(supabase + "/rest/v1/rpc/save_nine", answer);
      try {
        await page.goto(base + "/profiles/me/");
        const section = page.getByRole("region", { name: "人生の9冊" });
        const nine = page.getByRole("dialog", { name: "人生の9冊を選ぶ" });
        const note = nine.locator(".profile-kept");
        await section.getByRole("button", { name: "編集" }).click();
        await nine
          .getByRole("searchbox", { name: "人生の9冊に追加する本を検索" })
          .fill("モモ");
        await nine
          .getByRole("button", { name: "モモを人生の9冊に加える" })
          .click();
        await nine
          .getByRole("button", { name: "この並びを保存", exact: true })
          .click();
        await expect(nine).toHaveCount(0);
        // Sent over version 1, and not written over the one saved since:
        // the page reads it again, says so once, and keeps the work.
        await expect(
          page.getByText(
            "別の端末で先に変わっていたため、人生の9冊の変更は送りませんでした。書きかけは残しています。",
          ),
        ).toBeVisible();
        expect(sent[0].base).toBe(1);
        await shot("nine-elsewhere-told");
        await expect(
          page.getByText("人生の9冊を保存できませんでした"),
        ).toHaveCount(0);
        await expect(section.locator(".profile-nine-title")).toHaveText([
          "ソラリス",
        ]);
        // The dialog shows the nine saved now, and waits on the choice.
        await section.getByRole("button", { name: "編集" }).click();
        await expect(note).toContainText(
          "書きかけより新しい人生の9冊が保存されています",
        );
        const items = nine.locator(".profile-nine-editor-item strong");
        await expect(items).toHaveText(["ソラリス"]);
        await shot("nine-elsewhere-waits");
        // キャンセル leaves the work it never showed, still waiting.
        await nine
          .getByRole("button", { name: "キャンセル", exact: true })
          .click();
        await expect(nine).toHaveCount(0);
        await section.getByRole("button", { name: "編集" }).click();
        await expect(note).toContainText(
          "書きかけより新しい人生の9冊が保存されています",
        );
        await note
          .getByRole("button", { name: "書きかけを開く", exact: true })
          .click();
        await expect(items).toHaveText(["モモ"]);
        await expect(note).toContainText(
          "保存すると、いま保存されている人生の9冊と入れ替わります",
        );
        await shot("nine-elsewhere-opened");
        // Saved again, over the version read since, the work is let go.
        await nine
          .getByRole("button", { name: "この並びを保存", exact: true })
          .click();
        await expect(nine).toHaveCount(0);
        await expect.poll(() => sent.length).toBe(2);
        expect(sent[1].base).toBe(2);
        await expect(section.locator(".profile-nine-title")).toHaveText([
          "モモ",
        ]);
        await expect
          .poll(() =>
            page.evaluate(
              () => localStorage.getItem("book-town-nine-drafts-v1") ?? "",
            ),
          )
          .not.toContain("momo");
      } finally {
        await page.unroute(supabase + "/rest/v1/rpc/save_nine", answer);
        delete profile.nine_version;
        delete town.profile_nine;
      }
    },
  );

  await check(
    "shelves changed on another device first are not written over, and this device's can be put back",
    async () => {
      const was = town;
      const SHOP = "6f4e5d7c-1a2b-4c3d-9e8f-7a6b5c4d3e2f";
      const shelfOf = (name, bookId) => ({
        id: "first",
        name,
        capacity: 10,
        isPublic: true,
        items: [{ id: "first-1", bookId, display: "face", pop: "" }],
      });
      const here = shelfOf("はじめの本棚", "momo");
      const there = shelfOf("別の端末で直した棚", "solaris");
      // The database counts versions; the page reads the shelves' first.
      profile.nine_version = 1;
      town = {
        shops: [
          {
            id: SHOP,
            owner_id: user.id,
            name: "アキの本屋",
            description: "",
            tagline: "",
            theme: "sage",
            is_open: true,
            public_shelves: [here],
            public_scene_books: [],
          },
        ],
        shop_private: [
          { shelves: [here], scene_books: [], shelves_version: 1 },
        ],
      };
      const sent = [];
      const answer = (route) => {
        const asked = JSON.parse(route.request().postData());
        sent.push(asked);
        if (sent.length === 1) {
          // Another device saved its shelves first: version 2.
          town.shops[0].public_shelves = [there];
          town.shop_private = [
            { shelves: [there], scene_books: [], shelves_version: 2 },
          ];
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              code: "PT409",
              message: "changed elsewhere",
              details: null,
              hint: null,
            }),
          });
        }
        town.shops[0].public_shelves = asked.value;
        town.shop_private = [
          { shelves: asked.value, scene_books: [], shelves_version: 3 },
        ];
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "3",
        });
      };
      // The book put back joins the library, as on the other device.
      const library = (route) =>
        route.request().method() === "GET"
          ? route.fallback()
          : route.fulfill({ status: 201, body: "" });
      await page.route(supabase + "/rest/v1/rpc/save_shelves", answer);
      await page.route(supabase + "/rest/v1/library_entries*", library);
      try {
        await page.goto(base + "/my-shop/");
        const name = page.getByRole("textbox", { name: "本棚の名前" });
        const kept = page.locator(".editor-shelves-kept");
        await expect(name).toHaveValue("はじめの本棚");
        await page.getByRole("button", { name: "本棚を非公開にする" }).click();
        // Sent over version 1, and not written over the shelves saved
        // since: the page reads them again, says so once, and keeps these.
        await expect(
          page.getByText(
            "別の端末で先に変わっていたため、書店の棚の変更は送りませんでした。書きかけは残しています。",
          ),
        ).toBeVisible();
        expect(sent[0].base).toBe(1);
        await expect(name).toHaveValue("別の端末で直した棚");
        await expect(
          page.getByText("書店の棚を保存できませんでした"),
        ).toHaveCount(0);
        await expect(kept).toContainText(
          "別の端末で先に棚が変わっていたため、この端末で直した棚を残しています",
        );
        await shot("shelves-elsewhere-kept");
        await kept.evaluate((note) => note.scrollIntoView({ block: "center" }));
        await page.screenshot({
          path: path.join(output, "shelves-elsewhere-kept-view.png"),
        });
        // Put back in place of the shelves saved since, over their version.
        await kept
          .getByRole("button", { name: "この端末の棚にする", exact: true })
          .click();
        await expect(name).toHaveValue("はじめの本棚");
        await expect(
          page.getByRole("button", { name: "本棚を公開する" }),
        ).toBeVisible();
        await expect(page.getByText("この端末の棚にしました。")).toBeVisible();
        // The note's buttons are gone: the hand is on 本棚を追加.
        await expect(
          page.getByRole("button", { name: "本棚を追加" }),
        ).toBeFocused();
        await expect.poll(() => sent.length).toBe(2);
        expect(sent[1].base).toBe(2);
        expect(
          sent[1].value.map((shelf) => [shelf.name, shelf.isPublic]),
        ).toEqual([["はじめの本棚", false]]);
        await expect(page.getByText(/保存できませんでした/)).toHaveCount(0);
        await shot("shelves-elsewhere-put-back");
        await name.evaluate((field) =>
          field.scrollIntoView({ block: "center" }),
        );
        await page.screenshot({
          path: path.join(output, "shelves-elsewhere-put-back-view.png"),
        });
        // Saved: nothing is left to keep.
        await expect(kept).toHaveCount(0);
        await expect
          .poll(() =>
            page.evaluate(
              () => localStorage.getItem("book-town-shelves-drafts-v1") ?? "",
            ),
          )
          .not.toContain("momo");
      } finally {
        await page.unroute(supabase + "/rest/v1/rpc/save_shelves", answer);
        await page.unroute(supabase + "/rest/v1/library_entries*", library);
        delete profile.nine_version;
        town = was;
      }
    },
  );

  await check(
    "a new poster turned away waits on its page, and opens again as a new one",
    async () => {
      const was = town;
      town = { posters: [] };
      const HEADING = "断られたポスターの見出し";
      let refuse = true;
      const answer = (route) => {
        const request = route.request();
        if (request.method() === "GET") return route.fallback();
        const rows = [].concat(JSON.parse(request.postData()));
        if (refuse)
          return route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({
              code: "42501",
              message:
                'new row violates row-level security policy for table "posters"',
            }),
          });
        const at = new Date().toISOString();
        for (const row of rows)
          town.posters.push({
            allow_display: true,
            ...row,
            created_at: at,
            updated_at: at,
          });
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(rows.map((row) => ({ id: row.id }))),
        });
      };
      await page.route(supabase + "/rest/v1/posters*", answer);
      try {
        await page.goto(base + "/posters/new/?book=solaris");
        const heading = page.getByRole("textbox", { name: "見出し" });
        await heading.fill(HEADING);
        await page
          .getByRole("textbox", { name: "この本のこと" })
          .fill("断られても、言葉はここに残る。");
        await page
          .getByRole("button", { name: "貼り出す", exact: true })
          .click();
        await expect(page).toHaveURL(/\/posters\/\?id=/);
        const id = new URL(page.url()).searchParams.get("id");
        // Turned away: the poster is not there, and its work waits under
        // the poster it went as, not in the place of a new one.
        await expect(
          page.getByRole("heading", {
            name: "このポスターは、いまは貼られていません。",
          }),
        ).toBeVisible();
        await expect(
          page.getByText(
            "このポスターの書きかけを、このブラウザに残しています",
          ),
        ).toBeVisible();
        expect(await keptDraftKeys(POSTER_DRAFTS)).toEqual([
          user.id + ":poster:" + id,
        ]);
        await shot("poster-refused-kept");
        await page.getByRole("link", { name: "書きかけを開く" }).click();
        await expect(heading).toHaveValue(HEADING);
        await expect(
          page.getByText(
            "もとのポスターが見つからないため、書きかけを新しいポスターとして開いています",
          ),
        ).toBeVisible();
        await shot("poster-refused-opened");
        // Read again from the start, the page opens it the same way.
        await page.reload();
        await expect(heading).toHaveValue(HEADING);
        // Put up as a new poster: its work is let go once the account has it.
        refuse = false;
        await page
          .getByRole("button", { name: "貼り出す", exact: true })
          .click();
        await expect(page).toHaveURL(/\/posters\/\?id=/);
        expect(new URL(page.url()).searchParams.get("id")).not.toBe(id);
        await expect(
          page.getByRole("heading", { name: HEADING, level: 1 }),
        ).toBeVisible();
        await expect.poll(() => keptDraftKeys(POSTER_DRAFTS)).toEqual([]);
      } finally {
        await page.unroute(supabase + "/rest/v1/posters*", answer);
        town = was;
      }
    },
  );

  await check(
    "on a phone, the sheet of words for an owner opens ready to write, with 届ける just above the keyboard",
    async () => {
      expect(await coarse(page)).toBe(true);
      await page.goto(base + "/walk/#shop-orbit");
      await expect(page.locator(".walk-book-target").first()).toBeVisible();
      // A writing screen: its text box is focused within the opening tap,
      // so the keyboard rises with it.
      await forgetFocus(page);
      await page.getByRole("button", { name: "店主にひとことを伝える" }).tap();
      const sheet = page.getByRole("dialog", { name: "店主にひとことを残す" });
      const box = sheet.getByRole("textbox", { name: "店主に伝えたい言葉" });
      await expectKeyboardUp(page, box, "店主にひとことを残す");
      // A way to begin, tapped: written in, and the keyboard stays up.
      const starters = sheet.getByRole("group", { name: "書き出しの例" });
      await starters.getByRole("button").first().tap();
      await expect(box).not.toHaveValue("");
      await expect(box).toBeFocused();
      // With the keyboard up, 届ける sits on it and the title at the top.
      await page.evaluate(() => window.__keyboard(336, 120));
      const place = await toolbarPlace(sheet);
      expect(Math.abs(place.bottom - place.seen)).toBeLessThan(2);
      expect(Math.abs(place.top - place.seenTop)).toBeLessThan(2);
      const send = sheet.getByRole("button", { name: "届ける" });
      /** 届ける in what is seen, and what a tap there reaches. */
      const reachable = () =>
        send.evaluate((button) => {
          const box = button.getBoundingClientRect();
          const there = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          const viewport = window.visualViewport;
          return (
            box.bottom <= viewport.offsetTop + viewport.height + 1 &&
            Boolean(there && button.contains(there))
          );
        });
      expect(await reachable(), "届ける on the keyboard").toBe(true);
      // Put away, the sheet is the whole screen, over the bottom bar.
      await page.evaluate(() => window.__keyboard(0));
      expect(await reachable(), "届ける with no keyboard").toBe(true);
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
    },
  );

  await check(
    "a poster folded by reports opens with a tap; its maker is told gently",
    async () => {
      town = withPosters();
      await openHome();
      const posterCard = (text) =>
        page.locator("article.poster-card").filter({ hasText: text });
      const folded = posterCard(
        "通報があったため、運営が確かめるまで、たたんでいます",
      );
      await expect(folded).toHaveCount(1);
      await expect(folded).toHaveAttribute("aria-label", "レンのポスター");
      await expect(page.getByText("たたまれたポスターの見出し")).toHaveCount(0);
      await expect(page.getByText("たたまれたポスターの言葉。")).toHaveCount(0);
      // The maker's own, held and folded: theirs to read, and why.
      await expect(
        posterCard("確かめられているわたしのポスター"),
      ).toContainText(
        "運営が確かめるまで、ほかの人からは見えないようにしています。問題がなければ、元に戻ります。",
      );
      await expect(posterCard("たたまれたわたしのポスター")).toContainText(
        "通報があったため、運営が確かめるまで、みんなの画面ではたたんで表示しています。ポスターは消えていません。",
      );
      await noOverflow("timeline with a folded poster");
      await expectReadable(
        folded.getByRole("link", { name: "ポスターを開く" }),
        "ポスターを開く",
      );
      await posterCard("たたまれたわたしのポスター").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(output, "16-poster-maker-card-390.png"),
      });
      await folded.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(output, "16-poster-folded-card-390.png"),
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await folded.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(output, "16-poster-folded-card-1280.png"),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await folded.getByRole("button", { name: "読む" }).click();
      await expect(page.getByText("たたまれたポスターの見出し")).toBeVisible();
      await expect(
        page.getByRole("region", { name: "レンのポスター", exact: true }),
      ).toBeFocused();
    },
  );

  await check(
    "a folded poster's page keeps it and its books behind the cover",
    async () => {
      await page.goto(base + "/posters/?id=" + POSTER_FOLDED);
      const title = page.getByRole("heading", { level: 1 });
      await expect(title).toHaveText("たたんでいるポスター");
      await expect(
        page.getByText("通報があったため、運営が確かめるまで、たたんでいます"),
      ).toBeVisible();
      await expect(page.getByText("たたまれたポスターの見出し")).toHaveCount(0);
      await expect(page.getByText("こころの本")).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "このポスターの本" }),
      ).toHaveCount(0);
      await noOverflow("folded poster page");
      await shotBoth("17-poster-folded-page");
      await page.getByRole("button", { name: "読む" }).click();
      await expect(page.getByText("たたまれたポスターの見出し")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "このポスターの本" }),
      ).toBeVisible();
      // Opened, its words are read; they still do not name the page.
      await expect(title).toHaveText("たたんでいるポスター");
      await expect(
        page.getByRole("region", { name: "レンのポスター", exact: true }),
      ).toBeFocused();
    },
  );

  await check(
    "a poster the reader reports folds for them; its spoiler door comes after",
    async () => {
      await page.goto(base + "/posters/?id=" + POSTER_TO_REPORT);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "ネタバレを含むポスター",
      );
      await page.getByRole("button", { name: "このポスターを通報" }).click();
      const dialog = page.getByRole("dialog", { name: "通報する" });
      await expect(dialog).toContainText(
        "「レンさんのポスター」について、運営に知らせます。",
      );
      await dialog.getByLabel("宣伝・スパム").check();
      await dialog.getByRole("button", { name: "通報する" }).click();
      await expect(dialog).toContainText(
        "このポスターは、あなたの画面ではたたんでおきます。",
      );
      await expect(dialog).not.toContainText("この投稿は");
      await expectReadable(dialog.locator("p"), "poster report sent");
      expect(reportsSent.at(-1)).toEqual({
        reporter_id: user.id,
        target_kind: "poster",
        target_id: POSTER_TO_REPORT,
        reason: "spam",
        detail: "",
      });
      await dialog.getByRole("button", { name: "閉じる" }).last().click();
      await expect(
        page.getByText("あなたが通報したポスターです"),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "あなたが通報したポスター",
      );
      await page.getByRole("button", { name: "読む" }).click();
      // Then the poster's own spoiler door, with the hand on it.
      const door = page.getByRole("button", { name: "表示する" });
      await expect(door).toBeFocused();
      await expect(page.getByText("最後の場面の話。")).toHaveCount(0);
      await door.click();
      await expect(page.getByText("最後の場面の話。")).toBeVisible();
      // Read back with the town, it stays folded for the reporter.
      await page.reload();
      await expect(
        page.getByText("あなたが通報したポスターです"),
      ).toBeVisible();
      await openHome();
      await expect(
        page
          .locator("article.poster-card")
          .filter({ hasText: "あなたが通報したポスターです" }),
      ).toHaveCount(1);
    },
  );

  await check(
    "a folded poster's thumb on a book's page says nothing of its words",
    async () => {
      await page.goto(base + "/books/registered/?id=" + COVER_BOOK);
      const row = page.locator(".book-posters-row");
      // Its spoken name says what its tile says, and why: たたんでいます.
      const folded = row.getByRole("link", { name: /たたんでいます/ });
      await expect(folded).toHaveAttribute(
        "aria-label",
        "ポスター たたんでいます（通報があったため）、レン",
      );
      await expect(folded).toContainText("たたんでいます");
      await expect(folded).toContainText("通報があったため");
      await expect(page.locator("main")).not.toContainText(
        "たたまれたポスターの見出し",
      );
      // Not in a label, a title or an alt text either.
      const named = await page
        .locator("main [aria-label], main [alt], main [title]")
        .evaluateAll((elements) =>
          elements.flatMap((element) =>
            ["aria-label", "alt", "title"].map(
              (name) => element.getAttribute(name) ?? "",
            ),
          ),
        );
      expect(named.filter((name) => name.includes("たたまれた"))).toEqual([]);
      expect(await page.title()).not.toContain("たたまれた");
      // The maker's own held poster is theirs to see, as it is, with a word
      // on what others get.
      const ownHeld = row.getByRole("link", {
        name: /^ポスター 確かめられているわたしのポスター/,
      });
      await expect(ownHeld).toBeVisible();
      await expect(ownHeld).toHaveAttribute(
        "aria-label",
        "ポスター 確かめられているわたしのポスター、アキ（運営が確かめるまで、ほかの人には見えません）",
      );
      await expect(ownHeld).toContainText(
        "運営が確かめるまで、ほかの人には見えません",
      );
      await expectReadable(
        ownHeld.locator(".poster-thumb-review"),
        "own held thumb",
      );
      await noOverflow("book page with a folded poster");
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(output, "18-poster-folded-thumb-390.png"),
      });
      // The thumb leads to the poster, and 戻る comes back to the book.
      await folded.click();
      await expect(page).toHaveURL(new RegExp("id=" + POSTER_FOLDED));
      await page.goBack();
      await expect(page).toHaveURL(new RegExp("id=" + COVER_BOOK));
      // On the maker's profile too.
      await page.goto(base + "/profile/?id=" + OTHER);
      // The folded one, and the one the reader reported, each saying why.
      const grid = page.locator(".profile-poster-grid").getByRole("link");
      await expect(grid).toHaveCount(2);
      for (const name of [
        "ポスター たたんでいます（通報があったため）",
        "ポスター たたんでいます（あなたが通報したため）",
      ])
        await expect(page.getByRole("link", { name, exact: true })).toHaveCount(
          1,
        );
      await expect(page.locator("main")).not.toContainText(
        "たたまれたポスターの見出し",
      );
    },
  );

  await check(
    "the maker hears of a folded and a held poster, and reads why on it",
    async () => {
      await page.goto(base + "/notifications/");
      // Each poster by its own name, so two never read alike.
      await expect(
        page.getByText(
          "通報があったため、運営が確かめるまで、あなたのポスター「たたまれたわたしのポスター」をみんなの画面ではたたんでいます。ポスターは消えていません",
        ),
      ).toBeVisible();
      await page
        .getByRole("link", {
          name: /運営が確かめるまで、あなたのポスター「確かめられているわたしのポスター」をほかの人から見えないようにしています/,
        })
        .click();
      await expect(page).toHaveURL(new RegExp("id=" + POSTER_OWN_HELD));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "確かめられているわたしのポスター",
      );
      await expect(page.locator(".poster-screen-review")).toHaveText(
        "運営が確かめるまで、ほかの人からは見えないようにしています。問題がなければ、元に戻ります。",
      );
      await expect(page.getByText("わたしの言葉。")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "このポスターを通報" }),
      ).toHaveCount(0);
      await shotBoth("19-poster-maker-note");
      // On the maker's own profile, each says what others get.
      await page.goto(base + "/profiles/me/");
      const grid = page.locator(".profile-poster-grid");
      await expect(
        grid.getByRole("link", {
          name: /^ポスター 確かめられているわたしのポスター/,
        }),
      ).toContainText("運営が確かめるまで、ほかの人には見えません");
      await expect(
        grid.getByRole("link", {
          name: /^ポスター たたまれたわたしのポスター/,
        }),
      ).toHaveAttribute(
        "aria-label",
        "ポスター たたまれたわたしのポスター（通報があり、みんなの画面ではたたんでいます）",
      );
      await noOverflow("own posters with notes");
      await grid.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(output, "19-poster-maker-grid-390.png"),
      });
      // And where it is changed.
      await page.goto(base + "/posters/new/?id=" + POSTER_OWN_FOLDED);
      await expect(
        page.getByRole("heading", { name: "ポスターを直す" }),
      ).toBeVisible();
      await expect(page.locator(".poster-editor-review")).toHaveText(
        "通報があったため、運営が確かめるまで、みんなの画面ではたたんで表示しています。ポスターは消えていません。",
      );
      await expectReadable(
        page.locator(".poster-editor-review p"),
        "editor review note",
      );
      // Back to the posts' town for what follows.
      town = filled();
    },
  );

  await check(
    "a book's page is headed by its bibliographic master once there is one, and says where it came from",
    async () => {
      const hero = page.locator(".book-page-hero");
      const title = hero.getByRole("heading", { level: 1 });
      // No master yet: what its reader typed, and no credit for one.
      await page.goto(base + "/books/registered/?id=" + COVER_BOOK);
      await expect(title).toHaveText("こころの本");
      await expect(hero.locator(".book-page-author")).toHaveText("試験 作家");
      await expect(hero.locator(".book-page-publication")).toHaveCount(0);
      await expect(hero.getByRole("link", { name: "書誌の出典" })).toHaveCount(
        0,
      );
      expect(bibliographyAsks).toContain(COVER_BOOK);
      // Only books of the database are asked about: no 見本, no demo book.
      expect(
        bibliographyAsks.filter(
          (id) =>
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
              id,
            ),
        ),
      ).toEqual([]);
      masters = [
        {
          book_id: COVER_BOOK,
          title: "こころ",
          title_reading: "ココロ",
          subtitle: "ある先生の話",
          volume: "上",
          edition: "新版",
          series: [{ name: "試験文庫", number: "3" }],
          creators: [
            { name: "ジェーン・ドウ", role: "著" },
            { name: "山田一郎", role: "訳" },
          ],
          credits: [],
          publisher: "試験書房",
          issued: "2003-09",
          ndc: "913",
          sources: {
            title: "ndl",
            volume: "ndl",
            creators: "ndl",
            publisher: "openbd",
            issued: "ndl",
          },
        },
      ];
      await page.reload();
      await expect(title).toHaveText("こころ 上");
      await expect(hero.locator(".book-page-subtitle")).toHaveText(
        "ある先生の話 新版",
      );
      await expect(hero.locator(".book-page-author")).toHaveText(
        "ジェーン・ドウ 著／山田一郎 訳",
      );
      await expect(hero.locator(".book-page-publication")).toHaveText(
        "試験書房・試験文庫・2003年9月",
      );
      // The shop links look for the master's title too.
      await expect(
        hero.getByRole("link", { name: /^Amazonで探す/ }),
      ).toHaveAttribute("href", new RegExp(encodeURIComponent("こころ 上")));
      await noOverflow("book page with its master");
      await page.screenshot({
        path: path.join(output, "18-book-master-390.png"),
      });
      // Where it came from: one page for every book, no date of any book's.
      const credit = hero.getByRole("link", { name: "書誌の出典" });
      await expect(credit).toHaveAttribute("href", "/credits/");
      await credit.click();
      await expect(page).toHaveURL(/\/credits\/$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "本のデータの出典" }),
      ).toBeVisible();
      await expect(page.locator("main")).toContainText(
        "出典：国立国会図書館書誌データ（https://ndlsearch.ndl.go.jp/）をもとに BookTown が編集・加工して作成",
      );
      await expect(page.locator("main")).toContainText(
        "2026年10月から随時取得",
      );
      await noOverflow("credits page");
      await page.goBack();
      await expect(title).toHaveText("こころ 上");
      masters = [];
    },
  );

  await check(
    "a book held back tells only its reader, who fixes its ISBN or says it is right",
    async () => {
      const heldRow = {
        book_id: COVER_BOOK,
        held_at: ago(0.5),
        title: "別の本",
        creators: [{ name: "山田一郎", role: "著" }],
      };
      holds = [heldRow];
      await page.goto(base + "/notifications/");
      const notice = page
        .locator(".notice-list li")
        .filter({ hasText: "のISBNは" });
      await expect(notice).toContainText(
        "登録した『こころの本』のISBNは、『別の本』のものです。本のページで確かめてください",
      );
      await notice.getByRole("link").click();
      await expect(page).toHaveURL(new RegExp("id=" + COVER_BOOK));
      const note = page.locator(".book-held");
      await expect(note).toContainText(
        `登録したISBN（${OPENBD_ISBN}）は、『別の本』（山田一郎）のものです。`,
      );
      // Until it is answered, the page shows what the reader typed.
      await expect(
        page.locator(".book-page-hero").getByRole("heading", { level: 1 }),
      ).toHaveText("こころの本");
      await noOverflow("held book page");
      await note.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(output, "19-held-book-390.png"),
      });

      // Fixing it: the words wait in this browser while they are written.
      const fixButton = note.getByRole("button", { name: "ISBNを直す" });
      await fixButton.click();
      const sheet = page.getByRole("dialog", { name: "本の登録を直す" });
      await expect(sheet.getByLabel("題名")).toHaveValue("こころの本");
      const isbnField = sheet.getByLabel("ISBN（なくてもかまいません）");
      await expect(isbnField).toHaveValue(OPENBD_ISBN);
      // The ISBN first, the thing to fix; then the title and the author.
      expect(
        await sheet
          .locator("input")
          .evaluateAll((fields) =>
            fields.map((field) => field.closest("label")?.textContent ?? ""),
          ),
      ).toEqual(["ISBN（なくてもかまいません）", "題名", "著者"]);
      // Pictured once it has finished coming in.
      await sheet.evaluate((element) =>
        Promise.all(
          (element.closest(".modal-backdrop") ?? element)
            .getAnimations({ subtree: true })
            .map((motion) => motion.finished),
        ),
      );
      await page.screenshot({
        path: path.join(output, "19-held-book-fix-390.png"),
      });
      await isbnField.fill("978-4");
      await sheet.getByRole("button", { name: "保存する" }).click();
      await expect(sheet.getByRole("alert")).toContainText(
        "ISBNとして読めませんでした",
      );
      expect(booksFixed).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await fixButton.click();
      await expect(isbnField).toHaveValue("978-4");
      await expect(sheet.getByText("書きかけを続けています")).toBeVisible();
      await isbnField.fill("978-4-00-000000-0");
      await sheet.getByLabel("題名").fill("こころの本 新版");
      // The database turns the fix away: the town goes back to the book as
      // saved, the note comes back, and the words wait to be sent again.
      fixesRefused = true;
      await sheet.getByRole("button", { name: "保存する" }).click();
      await expect(sheet).toHaveCount(0);
      await expect(page.locator(".toast")).toContainText(
        "うまく保存できませんでした。書きかけは残しています。",
        { timeout: 10000 },
      );
      await expect(note).toContainText(`登録したISBN（${OPENBD_ISBN}）は`);
      await expect(
        page.locator(".book-page-hero").getByRole("heading", { level: 1 }),
      ).toHaveText("こころの本");
      expect(booksFixed).toEqual([]);
      await page.screenshot({
        path: path.join(output, "19-held-book-refused-390.png"),
      });
      await fixButton.click();
      await expect(sheet.getByText("書きかけを続けています")).toBeVisible();
      await expect(isbnField).toHaveValue("9784000000000");
      await expect(sheet.getByLabel("題名")).toHaveValue("こころの本 新版");
      fixesRefused = false;
      await sheet.getByRole("button", { name: "保存する" }).click();
      await expect(sheet).toHaveCount(0);
      await expect(page.locator(".toast")).toContainText("直しました");
      await expect(note).toHaveCount(0);
      await expect
        .poll(() => booksFixed)
        .toEqual([
          {
            id: COVER_BOOK,
            title: "こころの本 新版",
            author: "試験 作家",
            isbn: "9784000000000",
          },
        ]);
      // Saved: the browser lets the words go.
      await expect
        .poll(() =>
          page.evaluate(
            () => localStorage.getItem("book-town-book-fix-drafts-v1") ?? "",
          ),
        )
        .not.toContain(COVER_BOOK);

      // Or the reader says the book is the ISBN's after all: the master is
      // asked for again.
      holds = [heldRow];
      await page.reload();
      await expect(note).toBeVisible();
      const asked = bibliographyAsks.length;
      await note.getByRole("button", { name: "このISBNで合っている" }).click();
      await expect(page.locator(".toast")).toContainText(
        "このISBNで合っていると伝えました",
      );
      expect(confirmAsks).toEqual([COVER_BOOK]);
      await expect(note).toHaveCount(0);
      await expect
        .poll(() => bibliographyAsks.slice(asked))
        .toContain(COVER_BOOK);
      // Read again, nothing is held: no notice, no note.
      await page.goto(base + "/notifications/");
      const heldNotices = page
        .locator(".notice-list li")
        .filter({ hasText: "のISBNは" });
      await expect(heldNotices).toHaveCount(0);
      // A book held while the page stays open is told when お知らせ opens
      // again: asked anew then, not over and over.
      await page
        .getByRole("navigation", { name: "スマートフォンナビゲーション" })
        .getByRole("link", { name: "ホーム" })
        .click();
      await expect(page).not.toHaveURL(/\/notifications\//);
      holds = [heldRow];
      await page.waitForTimeout(5_100);
      await page
        .getByRole("link", { name: /^お知らせ/ })
        .first()
        .click();
      await expect(page).toHaveURL(/\/notifications\/$/);
      await expect(heldNotices).toHaveCount(1);
      holds = [];
      booksFixed.length = 0;
    },
  );

  await check(
    "a cover request being written is kept until it is sent or thrown away",
    async () => {
      await page.goto(base + "/books/registered/?id=" + COVER_BOOK);
      const ask = page.getByRole("button", { name: "表紙の削除依頼はこちら" });
      const dialog = page.getByRole("dialog", { name: "表紙の削除を依頼する" });
      const words = dialog.getByLabel(
        "この表紙とのご関係と、依頼の内容（必ず書いてください）",
      );
      const key = `${user.id}:book:${COVER_BOOK}`;
      await ask.click();
      // Its first field is the words: on a phone they wait for a tap.
      await expectNoKeyboard(page, "cover request", dialog);
      await expectTapWrites(words);
      await words.fill("書きかけの依頼です。");
      // Closed by hand, the words wait for the next time.
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      expect((await keptReports())[key]).toEqual({
        reason: "cover",
        detail: "書きかけの依頼です。",
      });
      await layersSettled(page);
      await ask.click();
      await expect(words).toHaveValue("書きかけの依頼です。");
      await expect(dialog.getByText("書きかけを続けています")).toBeVisible();
      // やめる asks once for the words, and 消す throws them away.
      await dialog.getByRole("button", { name: "やめる" }).click();
      await expect(dialog.getByText("書きかけを消しますか？")).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "残す", exact: true }),
      ).toBeFocused();
      await dialog.getByRole("button", { name: "消す", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(Object.keys(await keptReports())).not.toContain(key);
      await layersSettled(page);
      await ask.click();
      await expect(words).toHaveValue("");
      await expect(dialog.getByText("書きかけを続けています")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    },
  );

  await check(
    "a cover can be asked to be taken down, and a refused one is not shown",
    async () => {
      await page.goto(base + "/books/registered/?id=" + COVER_BOOK);
      await expect(page.locator(".cover-credit")).toContainText("openBD");
      const ask = page.getByRole("button", { name: "表紙の削除依頼はこちら" });
      await expect(ask).toBeVisible();
      // Quiet, but readable (AA contrast against what is behind it) and a 24px target.
      const look = await ask.evaluate((button) => {
        const rgb = (value) => value.match(/[\d.]+/g).map(Number);
        const lum = ([r, g, b]) => {
          const c = [r, g, b].map((v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        };
        let back = button;
        let bg = "rgba(0, 0, 0, 0)";
        while (back && /rgba\(.*, 0\)$/.test(bg)) {
          bg = getComputedStyle(back).backgroundColor;
          back = back.parentElement;
        }
        const a = lum(rgb(getComputedStyle(button).color));
        const b = lum(rgb(bg));
        return {
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          height: button.getBoundingClientRect().height,
          size: parseFloat(getComputedStyle(button).fontSize),
        };
      });
      expect(look.contrast).toBeGreaterThanOrEqual(4.5);
      expect(look.height).toBeGreaterThanOrEqual(24);
      expect(look.size).toBeGreaterThanOrEqual(12);
      await shot("13-cover-link");
      await ask.click();
      const dialog = page.getByRole("dialog", { name: "表紙の削除を依頼する" });
      await expect(dialog).toContainText(
        "『こころの本』の表紙を、BookTown に出さないよう運営に依頼します。",
      );
      await expect(dialog.getByRole("radio")).toHaveCount(0);
      const send = dialog.getByRole("button", { name: "依頼する" });
      await expect(send).toBeDisabled();
      await dialog
        .getByLabel("この表紙とのご関係と、依頼の内容（必ず書いてください）")
        .fill("この本の装丁を担当した者です。");
      await shot("14-cover-request");
      expect(Object.keys(await keptReports())).toContain(
        `${user.id}:book:${COVER_BOOK}`,
      );
      await send.click();
      await expect(dialog).toContainText(
        "受け付けました。運営が確認を始めたときと、確認し終えたときに、お知らせでお伝えします。",
      );
      // Received, the request written before is not kept any more.
      expect(Object.keys(await keptReports())).not.toContain(
        `${user.id}:book:${COVER_BOOK}`,
      );
      expect(reportsSent.at(-1)).toEqual({
        reporter_id: user.id,
        target_kind: "book",
        target_id: COVER_BOOK,
        reason: "cover",
        detail:
          "この本の装丁を担当した者です。\n\n表紙の出どころ: openBD / ISBN " +
          OPENBD_ISBN,
      });
      await dialog.getByRole("button", { name: "閉じる" }).last().click();
      // Asked from a book in hand: one Escape closes the request, not the book.
      await page.goto(base + "/shop/?id=" + OTHER_SHOP);
      await page.locator(".shelf-book-button").first().click();
      const inHand = page.locator(".bh-dialog");
      await expect(inHand).toBeVisible();
      await inHand
        .getByRole("button", { name: "表紙の削除依頼はこちら" })
        .click();
      const request = page.getByRole("dialog", {
        name: "表紙の削除を依頼する",
      });
      await request
        .getByLabel("この表紙とのご関係と、依頼の内容（必ず書いてください）")
        .fill("書きかけ");
      // The book is not asked to close at all (it could open again after).
      await inHand.evaluate((book) => {
        window.bookAskedToClose = [];
        for (const name of ["cancel", "close"])
          book.addEventListener(name, () => window.bookAskedToClose.push(name));
      });
      await page.keyboard.press("Escape");
      await expect(request).toHaveCount(0);
      await expect(inHand).toBeVisible();
      expect(await page.evaluate(() => window.bookAskedToClose)).toEqual([]);
      await layersLeft(1);
      await page.keyboard.press("Escape");
      await expect(inHand).not.toBeVisible();
      // Closed at once after the request, it stays closed, and both steps
      // came off: one 戻る leaves the shop.
      await page.goBack();
      await expect(page).toHaveURL(
        new RegExp("/books/registered/\\?id=" + COVER_BOOK + "$"),
      );
      // Google's cover of 星の本 was refused: Google is not asked for it, and
      // the book keeps its 装丁カード, with no credit and no link.
      await page.goto(base + "/books/registered/?id=" + REFUSED_BOOK);
      await expect(page.getByRole("heading", { name: "星の本" })).toBeVisible();
      await expect(page.locator(".book-page-hero .jacket-title")).toBeVisible();
      await expect(page.locator(".book-page-hero img")).toHaveCount(0);
      await expect(page.locator(".cover-credit")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "表紙の削除依頼はこちら" }),
      ).toHaveCount(0);
      expect(coverAsks).toContain("openbd:" + REFUSED_ISBN);
      expect(coverAsks).not.toContain("google:" + REFUSED_ISBN);
      await shot("15-cover-refused");
      town = null;
    },
  );

  // 注釈モード, for staff: a note left on a page, read back as a pin, taken
  // back and returned; over a Modal and in a book in hand. Then a reader who
  // is not staff, who is never shown any of it.
  const annotate = page.getByRole("button", { name: "注釈", exact: true });
  const notesMode = page.locator(".site-notes-mode");
  const notesSheet = page.getByRole("form", { name: "注釈を残す" });
  const notesField = page.getByLabel("注釈", { exact: true });
  const toast = page.locator(".toast");
  const solaris = new URL("/books/solaris/", base).href;
  const overlaps = (a, b) =>
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;
  // Loads a page and waits until it has heard whether the reader is staff
  // and drawn what that means.
  const loadAsked = async (address) => {
    const answered = page.waitForResponse((response) =>
      response.url().includes("/rest/v1/rpc/can_annotate"),
    );
    await page.goto(base + address);
    await (await answered).finished();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  };
  // Opens 注釈モード with `button` and waits until it has asked for this
  // page's notes and drawn their pins.
  const openAndLoad = async (button) => {
    const loaded = page.waitForResponse(
      (response) =>
        response.url().includes("/rest/v1/site_notes") &&
        response.request().method() === "GET",
    );
    await button.click();
    await (await loaded).finished();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  };
  // What 注釈モード's tap was about: the back link, in words.
  let backName = "";
  // The controls held to the screen (bars, the compose button, a sticky
  // column) that lie under the 注釈 button, by name. What scrolls with the
  // page can be scrolled out from under it; these cannot.
  const underAnnotate = () =>
    page.evaluate(() => {
      const button = document
        .querySelector(".site-notes-button")
        .getBoundingClientRect();
      const held = (element) => {
        for (let node = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.position === "fixed" || style.position === "sticky")
            return true;
          // Inside a box that scrolls of its own (a 便り's page over the
          // screen), it can be scrolled out from under the button too.
          if (
            node !== element &&
            /auto|scroll/.test(style.overflowY) &&
            node.scrollHeight > node.clientHeight
          )
            return false;
        }
        return false;
      };
      // On top where it meets the button: not under a page laid over it
      // (a 便り's page covers ホーム, whose body is then held still).
      const shown = (element, box) => {
        const x =
          (Math.max(box.left, button.left) +
            Math.min(box.right, button.right)) /
          2;
        const y =
          (Math.max(box.top, button.top) +
            Math.min(box.bottom, button.bottom)) /
          2;
        const top = document
          .elementsFromPoint(x, y)
          .find((hit) => !hit.closest("[data-site-notes]"));
        return Boolean(top && element.contains(top));
      };
      return [
        ...document.querySelectorAll(
          'a[href], button, input, [role="button"], [role="link"], [role="tab"]',
        ),
      ]
        .filter((element) => {
          if (element.closest("[data-site-notes]")) return false;
          const box = element.getBoundingClientRect();
          return (
            box.width > 0 &&
            box.height > 0 &&
            getComputedStyle(element).visibility !== "hidden" &&
            box.left < button.right &&
            button.left < box.right &&
            box.top < button.bottom &&
            button.top < box.bottom &&
            held(element) &&
            shown(element, box)
          );
        })
        .map((element) =>
          (element.getAttribute("aria-label") || element.textContent || "")
            .trim()
            .slice(0, 40),
        );
    });

  await check(
    "staff find the 注釈 button in a corner where it covers nothing",
    async () => {
      staff = true;
      // A town with another reader's posters, so a poster's page opens.
      town = filled();
      const clear = async (address) => {
        await loadAsked(address);
        await expect(annotate).toBeVisible();
        const box = await annotate.boundingBox();
        expect(box.width, address).toBeGreaterThanOrEqual(44);
        expect(box.height, address).toBeGreaterThanOrEqual(44);
        expect(await underAnnotate(), address).toEqual([]);
        // And at the end of the page, where sticky things settle.
        await page.evaluate(() =>
          scrollTo(0, document.documentElement.scrollHeight),
        );
        expect(await underAnnotate(), address + " (end)").toEqual([]);
        // The walk never scrolls: nothing of its stage is under it either.
        if (address.startsWith("/walk/")) {
          for (const control of await page
            .locator(".walk-book-target, .walk-actions button")
            .all()) {
            if (!(await control.isVisible())) continue;
            expect(
              overlaps(box, await control.boundingBox()),
              address + ": over " + (await control.getAttribute("aria-label")),
            ).toBe(false);
          }
        }
        await noOverflow(address);
      };
      // Home on each of its tabs: a fresh `/` opens the one shown last.
      const keepTab = (tab) =>
        page.evaluate(
          (tab) => localStorage.setItem("book-town-home-tab-v1", tab),
          tab,
        );
      await keepTab("home");
      // (Scrolled to its end by then, the alley has grown: `?rounds`.)
      const path = () => new URL(page.url()).pathname;
      await clear("/");
      expect(path()).toBe("/");
      expect(annotateAsks.at(-1)).toBe(true);
      await shot("21-notes-button");
      await keepTab("letters");
      await clear("/");
      expect(path()).toBe("/timeline/");
      await clear("/timeline/");
      // A 便り's page, at its address and over ホーム: its reply bar is held
      // at the bottom.
      await clear("/post/?id=" + TO_REPORT);
      await keepTab("home");
      await loadAsked("/");
      await page.locator("main article.letter .letter-time").first().click();
      const letter = page.locator(".post-page.is-layer");
      await expect(letter).toBeVisible();
      await expect(letter.locator(".post-page-bar")).toBeVisible();
      expect(await underAnnotate(), "a 便り's page over ホーム").toEqual([]);
      await letter
        .locator(".post-page-scroll")
        .evaluate((element) => element.scrollTo(0, element.scrollHeight));
      expect(await underAnnotate(), "a 便り's page over ホーム (end)").toEqual(
        [],
      );
      await page.goBack();
      await expect(letter).toHaveCount(0);
      for (const address of [
        "/walk/#shop-window",
        "/shops/shop-orbit/",
        "/books/solaris/",
        "/profiles/me/",
        "/search/?q=" + encodeURIComponent("夜"),
        "/posters/",
        "/posters/?id=" + POSTER_FOLDED,
      ])
        await clear(address);
      await page.setViewportSize({ width: 1280, height: 900 });
      await keepTab("home");
      await clear("/");
      await clear("/timeline/");
      await page.setViewportSize({ width: 390, height: 844 });
      // The checks below open `/` on ホーム.
      await keepTab("home");
      town = null;
      // The walk last: the checks below step back to it.
      await clear("/walk/");
    },
  );

  await check(
    "a tap in 注釈モード presses nothing beneath and opens a sheet about what is there",
    async () => {
      await loadAsked("/books/solaris/");
      const back = page.locator(".back-link").first();
      await expect(back).toBeVisible();
      backName = (await back.innerText()).trim();
      await page.evaluate(() => {
        window.linkHit = [];
        for (const type of ["pointerdown", "click"])
          document.addEventListener(
            type,
            (event) => {
              if (event.target.closest?.(".back-link"))
                window.linkHit.push(type);
            },
            true,
          );
      });
      const writes = townWrites.length;
      await annotate.click();
      await expect(
        page.getByText("メモしたい場所をタップしてください"),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "やめる", exact: true }),
      ).toBeFocused();
      const at = await back.boundingBox();
      await page.touchscreen.tap(at.x + at.width / 2, at.y + at.height / 2);
      await expect(notesSheet).toBeVisible();
      expect(await page.evaluate(() => window.linkHit)).toEqual([]);
      expect(page.url()).toBe(solaris);
      expect(townWrites.length).toBe(writes);
      const where = notesSheet.locator(".site-notes-where p");
      await expect(where).toContainText("「" + backName + "」");
      // The keyboard would cover the page and the pin: the field waits for
      // a tap, and the sheet's heading has the focus.
      await expectNoKeyboard(page, "注釈を残す", notesSheet);
      await expect(
        notesSheet.getByRole("heading", { name: "注釈を残す" }),
      ).toBeFocused();
      await expectTapWrites(notesField);
      // The sheet's buttons stay within what the screen shows: here all of
      // it, then less of it, zoomed in (as above a keyboard).
      const inSight = () =>
        notesSheet.evaluate((form) => {
          const view = visualViewport;
          return [...form.querySelectorAll("button")].every((button) => {
            const box = button.getBoundingClientRect();
            return (
              box.top >= view.offsetTop - 0.5 &&
              box.bottom <= view.offsetTop + view.height + 0.5 &&
              box.left >= view.offsetLeft - 0.5 &&
              box.right <= view.offsetLeft + view.width + 0.5
            );
          });
        });
      expect(await inSight()).toBe(true);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1.5 });
      await expect
        .poll(() => page.evaluate(() => visualViewport.scale))
        .toBe(1.5);
      await expect.poll(inSight).toBe(true);
      await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
      await expect
        .poll(() => page.evaluate(() => visualViewport.scale))
        .toBe(1);
      await expect.poll(inSight).toBe(true);
      await cdp.detach();
      await notesField.fill("戻るの字が小さい");
      // A tap beside the sheet only puts the keyboard away: the pin and the
      // words stay where they are.
      const pin = page.locator(".site-notes-pin.is-draft");
      const pinAt = await pin.boundingBox();
      const whereWas = await where.innerText();
      const spare = await page.evaluate(() => {
        for (let y = 120; y < innerHeight; y += 40)
          if (
            document
              .elementFromPoint(195, y)
              ?.classList.contains("site-notes-tint")
          )
            return y;
        return null;
      });
      expect(spare).not.toBeNull();
      await page.touchscreen.tap(195, spare);
      await expect(notesField).not.toBeFocused();
      await expect(notesField).toHaveValue("戻るの字が小さい");
      await expect(where).toHaveText(whereWas);
      expect(await pin.boundingBox()).toEqual(pinAt);
      expect(await page.evaluate(() => window.linkHit)).toEqual([]);
      await shot("22-notes-sheet");
    },
  );

  await check(
    "戻る keeps a note half written, and 残す leaves it as the one signed in",
    async () => {
      await page.goBack();
      await expect(notesMode).toHaveCount(0);
      expect(page.url()).toBe(solaris);
      // Straight back to the words, at their pin.
      await annotate.click();
      await expect(notesSheet).toBeVisible();
      await expect(notesSheet).toContainText("書きかけの注釈です");
      await expect(notesField).toHaveValue("戻るの字が小さい");
      await expectNoKeyboard(page, "注釈 half written", notesSheet);
      await expect(
        notesSheet.getByRole("heading", { name: "注釈を残す" }),
      ).toBeFocused();
      const leave = notesSheet.getByRole("button", {
        name: "残す",
        exact: true,
      });
      // Past the hourly limit the words stay, with the reason.
      refuseNotes = true;
      await leave.click();
      await expect(notesSheet.getByRole("alert")).toContainText(
        "1時間に残せる注釈は60件まで",
      );
      await expect(notesField).toHaveValue("戻るの字が小さい");
      await expect(leave).toBeEnabled();
      refuseNotes = false;
      const sent = notesSent.length;
      await leave.click();
      await expect(toast).toContainText("注釈を残しました");
      await expect(notesMode).toHaveCount(0);
      expect(notesSent.length).toBe(sent + 1);
      const note = notesSent.at(-1);
      // Who left it is the database's to fill in.
      expect(note).not.toHaveProperty("user_id");
      // The device by its short name only (this browser is headless Chrome
      // on Linux), never the user agent itself.
      expect(note).toMatchObject({
        page: "/books/solaris/",
        body: "戻るの字が小さい",
        layer: null,
        viewport_h: 844,
        device: "Linux Chrome",
      });
      expect(note.target).toContain("「" + backName + "」");
      expect(note.anchor).not.toBe("");
      // Closed by hand, the mode takes its step back off.
      await expect
        .poll(() => page.evaluate(() => history.state?.booktownLayers ?? null))
        .toBeNull();
      expect(page.url()).toBe(solaris);
    },
  );

  await check(
    "a note comes back as a numbered pin, can be taken back and returned, and 戻る leaves in one step",
    async () => {
      await annotate.click();
      const pin = page.getByRole("button", {
        name: "注釈1「戻るの字が小さい」",
      });
      await expect(pin).toBeVisible();
      const pinBox = await pin.boundingBox();
      const backBox = await page.locator(".back-link").first().boundingBox();
      const centre = (box) => [box.x + box.width / 2, box.y + box.height / 2];
      const [pinX, pinY] = centre(pinBox);
      const [backX, backY] = centre(backBox);
      expect(Math.abs(pinX - backX)).toBeLessThan(2);
      expect(Math.abs(pinY - backY)).toBeLessThan(2);
      await shot("23-notes-pins");
      await pin.click();
      const card = page.locator(".site-notes-card");
      await expect(card.getByRole("heading", { name: "注釈1" })).toBeVisible();
      await expect(card).toContainText("戻るの字が小さい");
      await expect(card).toContainText("に残しました");
      await expect(card).toBeFocused();
      await card.getByRole("button", { name: "取り下げる" }).click();
      await expect(toast).toContainText("注釈を取り下げました");
      // From the top while the mode is on, clear of its banner.
      expect((await restingBox(toast)).y).toBeLessThan(60);
      await expect(pin).toHaveCount(0);
      const id = siteNotes.find((n) => n.body === "戻るの字が小さい").id;
      expect(notesTakenBack.at(-1)).toEqual({ id, removed: true });
      // Opened again, the mode asks for the notes again: a note taken back
      // is not among them.
      await page.getByRole("button", { name: "やめる", exact: true }).click();
      await expect(notesMode).toHaveCount(0);
      await layersLeft(0);
      await openAndLoad(annotate);
      await expect(pin).toHaveCount(0);
      // 元に戻す brings it back into the mode open now.
      await toast.getByRole("button", { name: "元に戻す" }).click();
      await expect(toast).toContainText("注釈を戻しました");
      await expect(pin).toBeVisible();
      expect(notesTakenBack.at(-1)).toEqual({ id, removed: false });
      await page.goBack();
      await expect(notesMode).toHaveCount(0);
      expect(page.url()).toBe(solaris);
      await page.goBack();
      await expect(page).toHaveURL(/\/walk\//);
    },
  );

  await check(
    "a note thrown away can be brought back, and a pin by the edge widens nothing",
    async () => {
      await expect(annotate).toBeVisible();
      await annotate.click();
      await page.touchscreen.tap(380, 500);
      await expect(notesSheet).toBeVisible();
      await notesField.fill("右端の余白");
      await notesSheet.getByRole("button", { name: "やめる" }).click();
      await expect(notesMode).toHaveCount(0);
      await expect(toast).toContainText("書きかけの注釈を消しました");
      await toast.getByRole("button", { name: "元に戻す" }).click();
      await expect(toast).toContainText("書きかけの注釈を戻しました");
      await annotate.click();
      await expect(notesField).toHaveValue("右端の余白");
      // The pin is low, so the sheet opens at the top, and the toast still
      // showing drops to the bottom: nothing lies over 残す.
      const leave = notesSheet.getByRole("button", {
        name: "残す",
        exact: true,
      });
      await expect(notesSheet).toHaveAttribute("data-side", "top");
      const onLeave = await leave.evaluate((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return {
          toast: !!document.querySelector(".toast"),
          self: !!hit && button.contains(hit),
        };
      });
      expect(onLeave).toEqual({ toast: true, self: true });
      await leave.click();
      await expect(toast).toContainText("注釈を残しました");
      expect(notesSent.at(-1)).toMatchObject({ body: "右端の余白", x: 380 });
      await annotate.click();
      const pin = page.getByRole("button", { name: "注釈1「右端の余白」" });
      await expect(pin).toBeVisible();
      const box = await pin.boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      await noOverflow("a pin by the edge");
      // Escape leaves too, and gives the focus back to the button.
      await page.keyboard.press("Escape");
      await expect(notesMode).toHaveCount(0);
      await expect(annotate).toBeFocused();
    },
  );

  await check(
    "over a Modal the note names it, and Escape leaves only the mode",
    async () => {
      await loadAsked("/");
      await page.getByRole("button", { name: "本の街について" }).click();
      const about = page.getByRole("dialog", { name: "Book Townへようこそ" });
      await expect(about).toBeVisible();
      await expect(annotate).toBeVisible();
      const corner = await annotate.boundingBox();
      for (const control of await about.getByRole("button").all())
        expect(overlaps(corner, await control.boundingBox())).toBe(false);
      await annotate.click();
      const heading = about.getByRole("heading", {
        name: "Book Townへようこそ",
      });
      const at = await heading.boundingBox();
      await page.touchscreen.tap(at.x + 20, at.y + at.height / 2);
      await expect(notesSheet).toContainText(
        "見出し「Book Townへようこそ」　小窓「Book Townへようこそ」の中",
      );
      await notesField.fill("ようこその字が細い");
      await notesSheet
        .getByRole("button", { name: "残す", exact: true })
        .click();
      await expect(toast).toContainText("注釈を残しました");
      expect(notesSent.at(-1)).toMatchObject({
        page: "/",
        target: "見出し「Book Townへようこそ」",
        layer: "Book Townへようこそ",
        body: "ようこその字が細い",
      });
      await expect(about).toBeVisible();
      await annotate.click();
      const pin = page.getByRole("button", {
        name: "注釈1「ようこその字が細い」",
      });
      await expect(pin).toBeVisible();
      // Taken back over the Modal, the toast keeps clear of the banner at
      // the top, and 元に戻す brings the pin back.
      await pin.click();
      await page
        .locator(".site-notes-card")
        .getByRole("button", { name: "取り下げる" })
        .click();
      await expect(toast).toContainText("注釈を取り下げました");
      const banner = page.locator(".site-notes-banner");
      await expect(banner).toHaveAttribute("data-at", "top");
      expect(overlaps(await restingBox(banner), await restingBox(toast))).toBe(
        false,
      );
      await toast.getByRole("button", { name: "元に戻す" }).click();
      await expect(pin).toBeVisible();
      await shot("24-notes-modal");
      await page.keyboard.press("Escape");
      await expect(notesMode).toHaveCount(0);
      await expect(about).toBeVisible();
      await layersLeft(1);
      await page.keyboard.press("Escape");
      await expect(about).toHaveCount(0);
      // The page beneath shows none of the Modal's notes.
      await layersLeft(0);
      await openAndLoad(annotate);
      await expect(pin).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(notesMode).toHaveCount(0);
    },
  );

  await check(
    "in a book in hand the mode stays inside the book, and Escape leaves only the mode",
    async () => {
      await loadAsked("/shops/shop-orbit/");
      await page.locator(".shelf-book-button").first().click();
      const inHand = page.locator(".bh-dialog");
      await expect(inHand).toBeVisible();
      const inside = inHand.getByRole("button", { name: "注釈", exact: true });
      await expect(inside).toBeVisible();
      const box = await restingBox(inside);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await inside.click();
      const title = inHand.locator("h2").first();
      const name = (await title.innerText()).trim();
      const at = await title.boundingBox();
      await page.touchscreen.tap(at.x + 10, at.y + at.height / 2);
      const sheet = inHand.getByRole("form", { name: "注釈を残す" });
      await expect(sheet).toContainText("小窓「" + name + "」の中");
      await inHand.getByLabel("注釈", { exact: true }).fill("題の行間が狭い");
      await sheet.getByRole("button", { name: "残す", exact: true }).click();
      await expect(toast).toContainText("注釈を残しました");
      expect(notesSent.at(-1).page).toMatch(/^\/shops\/shop-orbit\//);
      expect(notesSent.at(-1).layer).toBe(name);
      await expect(inHand).toBeVisible();
      await inside.click();
      await expect(
        inHand.getByRole("button", { name: "注釈1「題の行間が狭い」" }),
      ).toBeVisible();
      await shot("25-notes-book");
      await page.keyboard.press("Escape");
      await expect(notesMode).toHaveCount(0);
      await expect(inHand).toBeVisible();
      await layersLeft(1);
      await page.keyboard.press("Escape");
      await expect(inHand).not.toBeVisible();
    },
  );

  await check(
    "in a book in hand a swipe in the mode turns its pages, and the banner keeps clear of a pin below",
    async () => {
      await loadAsked("/shops/shop-orbit/");
      const book = page.locator(".shelf-book-button").first();
      await book.click();
      const inHand = page.locator(".bh-dialog");
      await expect(inHand).toBeVisible();
      const pages = inHand.locator(".bh-content");
      const link = inHand.getByRole("link", { name: "作品のページを開く" });
      const inside = inHand.getByRole("button", { name: "注釈", exact: true });
      const cdp = await context.newCDPSession(page);
      // A finger drawn up the screen, as a reader turns the pages.
      const swipeUp = async () => {
        const points = [600, 550, 500, 450, 400, 350, 300, 250];
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: 195, y: points[0] }],
        });
        for (const y of points.slice(1))
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: 195, y }],
          });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      };
      const scrolled = () => pages.evaluate((element) => element.scrollTop);
      const linkInSight = () =>
        link.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const seen = element.closest(".bh-content").getBoundingClientRect();
          return box.top >= seen.top && box.bottom <= seen.bottom;
        });
      await inside.click();
      await expect(inHand.locator(".site-notes-banner")).toBeVisible();
      expect(await linkInSight()).toBe(false);
      const before = await scrolled();
      await swipeUp();
      await expect.poll(scrolled).toBeGreaterThan(before + 200);
      for (let turn = 0; turn < 8 && !(await linkInSight()); turn++)
        await swipeUp();
      expect(await linkInSight()).toBe(true);
      // Nothing beneath was pressed on the way.
      await expect(notesSheet).toHaveCount(0);
      const at = await link.boundingBox();
      await page.touchscreen.tap(at.x + 20, at.y + at.height / 2);
      const sheet = inHand.getByRole("form", { name: "注釈を残す" });
      await expect(sheet).toContainText("「作品のページを開く」");
      await inHand.getByLabel("注釈", { exact: true }).fill("作品への道が遠い");
      await sheet.getByRole("button", { name: "残す", exact: true }).click();
      await expect(toast).toContainText("注釈を残しました");
      await expect(notesMode).toHaveCount(0);
      await layersLeft(1);
      // The book opened again, at its top: the note's place is out of sight
      // below, so its pin waits at the bottom edge, and the banner, which
      // starts there, moves up out of its way.
      await page.keyboard.press("Escape");
      await expect(inHand).not.toBeVisible();
      await layersLeft(0);
      await book.click();
      await expect(inHand).toBeVisible();
      expect(await scrolled()).toBe(0);
      await openAndLoad(inside);
      const pin = inHand.getByRole("button", { name: /「作品への道が遠い」$/ });
      await expect(pin).toHaveClass(/is-approximate/);
      const banner = inHand.locator(".site-notes-banner");
      await expect(banner).toHaveAttribute("data-at", "top");
      const pinBox = await restingBox(pin);
      expect(overlaps(pinBox, await restingBox(banner))).toBe(false);
      expect(
        await pin.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2,
            ),
          );
        }),
      ).toBe(true);
      await pin.click();
      const card = inHand.locator(".site-notes-card");
      await expect(card).toContainText("作品への道が遠い");
      await expect(card).toContainText("この場所はいま隠れています");
      await card.getByRole("button", { name: "閉じる" }).click();
      // Turned to in the mode, its place comes into sight and the pin with it.
      for (let turn = 0; turn < 8 && !(await linkInSight()); turn++)
        await swipeUp();
      await expect(pin).not.toHaveClass(/is-approximate/);
      const linkBox = await link.boundingBox();
      const placed = await pin.boundingBox();
      expect(placed.y + placed.height / 2).toBeGreaterThanOrEqual(linkBox.y);
      expect(placed.y + placed.height / 2).toBeLessThanOrEqual(
        linkBox.y + linkBox.height,
      );
      await shot("26-notes-book-below");
      await cdp.detach();
      await page.keyboard.press("Escape");
      await expect(notesMode).toHaveCount(0);
      await layersLeft(1);
      await page.keyboard.press("Escape");
      await expect(inHand).not.toBeVisible();
    },
  );

  await check(
    "on Home in the mode a finger scrolls the carousel, a 特集's rail and a 便り's page beneath, and switches or closes nothing",
    async () => {
      await page.evaluate(() =>
        localStorage.setItem("book-town-home-tab-v1", "home"),
      );
      await loadAsked("/");
      expect(page.url()).toBe(base + "/");
      // Held still first, so only the finger moves it.
      await page
        .getByRole("button", { name: "自動の切り替えを止める" })
        .click();
      const cdp = await context.newCDPSession(page);
      const drag = async (from, to) => {
        const steps = 8;
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [from],
        });
        for (let step = 1; step <= steps; step++)
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
              {
                x: from.x + ((to.x - from.x) * step) / steps,
                y: from.y + ((to.y - from.y) * step) / steps,
              },
            ],
          });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      };
      const middleOf = async (locator) => {
        await locator.evaluate((element) =>
          element.scrollIntoView({ block: "center" }),
        );
        const box = await locator.boundingBox();
        return box.y + box.height / 2;
      };
      await annotate.click();
      await expect(notesMode).toHaveCount(1);
      for (const part of [".home-carousel-track", ".home-rail"]) {
        const box = page.locator(part).first();
        const y = await middleOf(box);
        await drag({ x: 330, y }, { x: 90, y });
        await expect
          .poll(() => box.evaluate((element) => element.scrollLeft), part)
          .toBeGreaterThan(100);
      }
      // A swipe across the doors would switch the tab: not in the mode.
      const y = await middleOf(
        page.getByRole("navigation", { name: "できること" }),
      );
      await drag({ x: 330, y }, { x: 60, y });
      await page.waitForTimeout(400);
      expect(page.url()).toBe(base + "/");
      await expect(notesSheet).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(notesMode).toHaveCount(0);
      // A 便り's page over ホーム, on a short screen: a finger up scrolls its
      // words; one from the left edge does not close it.
      await page.setViewportSize({ width: 390, height: 420 });
      try {
        await page.locator("main article.letter .letter-time").first().click();
        const letter = page.locator(".post-page.is-layer");
        await expect(letter).toBeVisible();
        const words = letter.locator(".post-page-scroll");
        await expect
          .poll(() =>
            words.evaluate(
              (element) => element.scrollHeight > element.clientHeight,
            ),
          )
          .toBe(true);
        await annotate.click();
        await expect(notesMode).toHaveCount(1);
        await drag({ x: 195, y: 330 }, { x: 195, y: 130 });
        await expect
          .poll(() => words.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(50);
        await drag({ x: 8, y: 250 }, { x: 300, y: 250 });
        await page.waitForTimeout(400);
        await expect(letter).toBeVisible();
        await expect(notesSheet).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(notesMode).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(letter).toHaveCount(0);
      } finally {
        await cdp.detach();
        await page.setViewportSize({ width: 390, height: 844 });
      }
    },
  );

  await check(
    "a reader who is not staff is never shown the button and reads no notes",
    async () => {
      staff = false;
      const asks = annotateAsks.length;
      const requests = siteNoteRequests.length;
      await loadAsked("/books/solaris/");
      await page.waitForLoadState("networkidle");
      expect(annotateAsks.length).toBe(asks + 1);
      await expect(annotate).toHaveCount(0);
      await expect(page.locator("[data-site-notes]")).toHaveCount(0);
      expect(siteNoteRequests.length).toBe(requests);
    },
  );

  await check(
    "an Escape that cancels a kana conversion closes neither the request nor the book",
    async () => {
      town = filled();
      await page.goto(base + "/shop/?id=" + OTHER_SHOP);
      await page.locator(".shelf-book-button").first().click();
      const inHand = page.locator(".bh-dialog");
      await expect(inHand).toBeVisible();
      await inHand
        .getByRole("button", { name: "表紙の削除依頼はこちら" })
        .click();
      const request = page.getByRole("dialog", {
        name: "表紙の削除を依頼する",
      });
      const words = request.getByLabel(
        "この表紙とのご関係と、依頼の内容（必ず書いてください）",
      );
      await words.fill("装丁を担当した者です");
      await escapeWhileComposing(page);
      await expect(request).toBeVisible();
      await expect(words).toHaveValue("装丁を担当した者です");
      await expect(inHand).toBeVisible();
      await escapeWhileComposing(page, { keyCode229: true });
      await expect(request).toBeVisible();
      await expect(inHand).toBeVisible();
      // Plain Escapes still close one layer each: the request, then, once
      // its step is off the history (see back-layer.ts), the book.
      await words.fill("");
      await page.keyboard.press("Escape");
      await expect(request).toHaveCount(0);
      await expect(inHand).toBeVisible();
      await page.waitForFunction(
        () => history.state?.booktownLayers?.length === 1,
      );
      await page.keyboard.press("Escape");
      await expect(inHand).not.toBeVisible();
      town = null;
    },
  );

  await check(
    "a reader blocks another from their profile and a 便り, and lifts it in 設定",
    async () => {
      // The reader follows レン's shop; his 便り and shop are in the town.
      town = {
        ...filled(),
        moderation_folds: [],
        shop_follows: [{ shop_id: OTHER_SHOP }],
      };
      blocksSent.length = 0;
      blocksLifted.length = 0;
      followsEnd = true;
      const toast = page.locator(".toast");
      await page.goto(base + "/profile/?id=" + OTHER);
      await expect(
        page.getByRole("heading", { name: "レン", exact: true }),
      ).toBeVisible();
      const block = page.getByRole("button", { name: "ブロック", exact: true });
      await expect(block).toBeVisible();
      await block.scrollIntoViewIfNeeded();
      await shot("block-0-link");
      // Quiet, but big enough for a finger.
      expect((await block.boundingBox()).height).toBeGreaterThanOrEqual(44);
      // Asked first; やめる does nothing.
      await block.click();
      const asking = page.getByRole("dialog", { name: "ブロック" });
      await expect(asking).toContainText("レンさんをブロックしますか？");
      await expect(asking).toContainText(
        "お互いの本屋・投稿・記録・ポスターが見えなくなり、フォローも外れます。相手には知らされません。あとで設定から外せます。",
      );
      await expectReadable(asking.locator("p"), "block question");
      await shot("block-1-question");
      await asking.getByRole("button", { name: "やめる" }).click();
      await expect(asking).toHaveCount(0);
      expect(blocksSent).toEqual([]);
      await layersSettled(page);

      await block.click();
      await asking.getByRole("button", { name: "ブロックする" }).click();
      await expect(toast).toContainText("レンさんをブロックしました");
      // Only who he is, and the way to lift it, are left on his profile.
      const note = page
        .getByRole("note")
        .filter({ hasText: "ブロックしています" });
      await expect(note).toBeVisible();
      await expect(page.getByText("レンの夜の本屋")).toHaveCount(0);
      await expect(page.getByText("夜にだけ本を読む人です。")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "書店をフォロー" }),
      ).toHaveCount(0);
      await noOverflow("blocked profile");
      await shot("block-2-profile");
      await page.setViewportSize({ width: 320, height: 568 });
      await noOverflow("blocked profile, narrowest");
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => blocksSent).toEqual([[user.id, OTHER]]);
      // Following his shop ended with it.
      expect(townWrites).toContain("/rest/v1/shop_follows");

      // Gone from ホーム too, and still blocked after a reload.
      await openHome();
      await expect(page.getByText("これから通報される言葉。")).toHaveCount(0);
      await page.goto(base + "/profile/?id=" + OTHER);
      await expect(note).toBeVisible();

      // 設定 lists him while he is blocked; 解除 lifts it, with a way back.
      await page.goto(base + "/profiles/me/");
      await page.getByRole("button", { name: "設定" }).click();
      const settings = page.getByRole("dialog", { name: "設定" });
      const list = settings.getByRole("group", { name: "ブロックした読書家" });
      await expect(list).toContainText("レン");
      await expect(list).toContainText("@ren_reads");
      await list.scrollIntoViewIfNeeded();
      await shot("block-3-settings");
      await page.setViewportSize({ width: 320, height: 568 });
      await noOverflow("blocked list, narrowest");
      await page.setViewportSize({ width: 390, height: 844 });
      await list.getByRole("button", { name: "解除" }).click();
      await expect(toast).toContainText(
        "レンさんのブロックを解除しました。本屋や投稿は、次にBookTownを開いたときから見えます",
      );
      await expect(list).toHaveCount(0);
      await expect.poll(() => blocksLifted.length).toBe(1);
      expect(blocksLifted[0]).toContain("blocked_id=eq." + OTHER);
      await page.keyboard.press("Escape");
      await expect(settings).toHaveCount(0);

      // From a 便り's 「…」, after the town is read again.
      await openHome();
      const post = page
        .locator("article.post-card")
        .filter({ hasText: "これから通報される言葉。" });
      await expect(post).toBeVisible();
      await post.getByRole("button", { name: "その他の操作" }).click();
      const menu = page.getByRole("dialog", { name: "その他の操作" });
      await menu.getByRole("button", { name: "レンさんをブロック" }).click();
      await expect(menu).toContainText("レンさんをブロックしますか？");
      await menu.getByRole("button", { name: "ブロックする" }).click();
      await expect(menu).toHaveCount(0);
      await expect(toast).toContainText("レンさんをブロックしました");
      await expect(page.getByText("これから通報される言葉。")).toHaveCount(0);
      await expect.poll(() => blocksSent.length).toBe(2);
      followsEnd = false;
      town = null;
    },
  );

  await check(
    "signed out in another tab, the home reads the town afresh: its bones meanwhile, never an empty town nor the account's 便り",
    async () => {
      // The reader follows レン's shop; his 便り are theirs above the alley.
      town = {
        profiles: [filled().profiles[0]],
        shops: [{ ...filled().shops[0] }],
        books: [bookRow(COVER_BOOK, OPENBD_ISBN, "こころの本")],
        posts: [1, 2, 3].map((at) =>
          postRow(
            homeId(40 + at),
            OTHER,
            `レンの夜の一行、その${at}。`,
            ago(at),
          ),
        ),
        shop_follows: [{ shop_id: OTHER_SHOP }],
      };
      const theirs = page.getByText("フォロー中の便りは、ここまでです。");
      await openHome();
      await expect(bones).toHaveCount(0, { timeout: 10000 });
      await expect(theirs).toBeVisible();
      // Kept for the next opening, as this account's.
      const keptOwner = () =>
        page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem("book-town-home-snapshot-v1") ?? "null",
            )?.owner ?? null,
        );
      await expect.poll(keptOwner).toBe(user.id);
      // Whatever the page shows from now on is noted.
      await page.evaluate(() => {
        window.sawEmptyTown = false;
        new MutationObserver(() => {
          if (document.body.textContent.includes("この街は、まだ朝です"))
            window.sawEmptyTown = true;
        }).observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
      const elsewhere = settleBeforeNavigating(await context.newPage());
      elsewhere.on("pageerror", (e) => errors.push(e.message));
      let release = () => {};
      try {
        await elsewhere.goto(base + "/login/");
        await expect(
          elsewhere.getByRole("heading", { name: "ログインしています" }),
        ).toBeVisible();
        release = holdTown();
        await elsewhere.getByRole("button", { name: "ログアウト" }).click();
        // The home, signed out there, reads the visitor's town.
        await expect(bones).toHaveAttribute("aria-busy", "true");
        await expect(theirs).toHaveCount(0);
        // The account's kept 便り went with it, never drawn for a visitor.
        expect(await keptOwner()).not.toBe(user.id);
        await expect(page.getByText("レンの夜の一行、その1。")).toHaveCount(0);
        release();
        await expect(bones).toHaveCount(0, { timeout: 10000 });
      } finally {
        release();
        await elsewhere.close();
      }
      expect(await page.evaluate(() => window.sawEmptyTown)).toBe(false);
      // The visitor's lists: レン's 便り among the town's, none followed.
      await expect(
        page.getByRole("heading", { name: "街の便り" }),
      ).toBeVisible();
      await expect(page.getByText("レンの夜の一行、その1。")).toBeVisible();
      await expect(theirs).toHaveCount(0);
      await expect(
        page.locator(".home-alley .street-shop").first(),
      ).toBeVisible();
      // Signed in again for what follows.
      const link = session();
      await page.goto("about:blank");
      await page.goto(
        base +
          "/login/#" +
          new URLSearchParams({
            access_token: link.access_token,
            expires_at: String(link.expires_at),
            expires_in: "3600",
            refresh_token: link.refresh_token,
            token_type: "bearer",
            type: "magiclink",
          }),
      );
      await expect(
        page.getByRole("heading", { name: "ログインしています" }),
      ).toBeVisible();
      town = null;
    },
  );

  await check(
    "the session survives a reload, and signing out ends it",
    async () => {
      await page.goto(base + "/login/");
      await expect(
        page.getByRole("heading", { name: "ログインしています" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "ログアウト" }).click();
      await expect(
        page.getByRole("heading", { name: "本の街に入る" }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "本の街に入る" }),
      ).toBeVisible();
    },
  );

  await check(
    "a visitor is not offered a cover removal request they could not send",
    async () => {
      // Signing in is by invitation, so the link would only lead to a sign-in
      // a rights holder without an account cannot finish.
      town = filled();
      const asks = annotateAsks.length;
      await page.goto(base + "/books/registered/?id=" + COVER_BOOK);
      await expect(page.locator(".cover-credit")).toContainText("openBD");
      await expect(
        page.getByRole("button", { name: "表紙の削除依頼はこちら" }),
      ).toHaveCount(0);
      // Nor asked whether they are staff.
      expect(annotateAsks.length).toBe(asks);
      town = null;
    },
  );

  await check("the link from the email signs in, too", async () => {
    const link = session();
    const params = new URLSearchParams({
      access_token: link.access_token,
      expires_at: String(link.expires_at),
      expires_in: "3600",
      refresh_token: link.refresh_token,
      token_type: "bearer",
      type: "magiclink",
    });
    // The link opens a fresh page, as it does from a mail app.
    await page.goto("about:blank");
    await page.goto(base + "/login/#" + params);
    await expect(
      page.getByRole("heading", { name: "ログインしています" }),
    ).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
    await page.getByRole("button", { name: "ログアウト" }).click();
  });

  await check("a used or expired link says so", async () => {
    await page.goto("about:blank");
    await page.goto(
      base +
        "/login/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    await expect(page.locator("#account-error")).toContainText(
      "期限が切れているか、すでに使われています",
    );
    expect(await page.evaluate(() => location.hash)).toBe("");
    await expect(
      page.getByRole("heading", { name: "本の街に入る" }),
    ).toBeVisible();
  });

  await check(
    "an account's unsent post and poster are not shown to another account on this browser, and wait for its return",
    async () => {
      const signInByLink = async () => {
        const link = session();
        await page.goto("about:blank");
        await page.goto(
          base +
            "/login/#" +
            new URLSearchParams({
              access_token: link.access_token,
              expires_at: String(link.expires_at),
              expires_in: "3600",
              refresh_token: link.refresh_token,
              token_type: "bearer",
              type: "magiclink",
            }),
        );
        await expect(
          page.getByRole("heading", { name: "ログインしています" }),
        ).toBeVisible();
      };
      const signOut = async () => {
        await page.goto(base + "/login/");
        await page.getByRole("button", { name: "ログアウト" }).click();
        await expect(
          page.getByRole("heading", { name: "本の街に入る" }),
        ).toBeVisible();
      };
      const fab = page.locator(".compose-fab");
      const compose = page.getByRole("dialog", { name: "投稿する" });
      const text = compose.locator("textarea");
      const heading = page.getByRole("textbox", { name: "見出し" });
      const elsewhere = page.getByRole("region", {
        name: "このブラウザに残している書きかけ",
      });
      const A_POST = "アキがまだ送っていない投稿。";
      const A_POSTER = "アキの作りかけのポスター";
      await signInByLink();
      await page.goto(base + "/timeline/");
      await fab.click();
      await text.fill(A_POST);
      await page.keyboard.press("Escape");
      await expect(fab).toContainText("下書き");
      await page.goto(base + "/posters/new/?book=momo");
      await heading.fill(A_POSTER);
      expect(await keptDraftKeys(POST_DRAFTS)).toEqual([user.id + ":new-post"]);
      expect(await keptDraftKeys(POSTER_DRAFTS)).toEqual([
        user.id + ":book:momo",
      ]);
      await signOut();

      // Another account signs in on the same browser.
      const aki = { id: user.id, email: user.email, profile };
      user.id = "3c9d2e1f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
      user.email = "mio@example.jp";
      profile = {
        ...aki.profile,
        id: user.id,
        handle: "mio_books",
        name: "ミオ",
      };
      try {
        await signInByLink();
        await expect(page.getByText("ミオ（@mio_books）さん")).toBeVisible();
        await page.goto(base + "/timeline/");
        await expect(page.locator("main.town-main")).toBeVisible();
        await expect(fab).not.toContainText("下書き");
        await fab.click();
        await expect(text).toHaveValue("");
        await expect(compose.getByText("書きかけを続けています")).toHaveCount(
          0,
        );
        await page.keyboard.press("Escape");
        await page.goto(base + "/posters/new/");
        await expect(heading).toHaveValue("");
        await expect(elsewhere).toHaveCount(0);
        await page.goto(base + "/posters/new/?book=momo");
        await expect(heading).toHaveValue("");
        await expect(page.getByText(A_POSTER)).toHaveCount(0);
        await expect(page.locator(".poster-editor-kept")).toHaveCount(0);
        // Still kept in the browser, for the account that wrote them.
        expect(await keptDraftKeys(POST_DRAFTS)).toEqual([
          aki.id + ":new-post",
        ]);
        expect(await keptDraftKeys(POSTER_DRAFTS)).toEqual([
          aki.id + ":book:momo",
        ]);
        await signOut();
      } finally {
        user.id = aki.id;
        user.email = aki.email;
        profile = aki.profile;
      }

      // Back, the first account finds them where it left them.
      await signInByLink();
      await expect(page.getByText("アキ（@aki_books）さん")).toBeVisible();
      await page.goto(base + "/timeline/");
      await expect(fab).toContainText("下書き");
      await fab.click();
      await expect(text).toHaveValue(A_POST);
      await page.keyboard.press("Escape");
      await page.goto(base + "/posters/new/");
      await expect(elsewhere).toContainText(A_POSTER);
      await elsewhere.getByRole("link", { name: /つづきを書く/ }).click();
      await expect(heading).toHaveValue(A_POSTER);
      await signOut();
    },
  );

  await check(
    "with a mouse, each step's field is ready to type into, as before",
    async () => {
      const desk = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      const signedIn = profile;
      try {
        // Nothing outside the site and the stand-in is needed here.
        await desk.route(
          (url) => !url.href.startsWith(base) && !url.href.startsWith(supabase),
          (route) => route.abort(),
        );
        await desk.route(supabase + "/**", standIn);
        const at = settleBeforeNavigating(await desk.newPage());
        at.on("pageerror", (e) => errors.push(e.message));
        await at.goto(base + "/login/");
        expect(await coarse(at)).toBe(false);
        const email = at.getByLabel("メールアドレス");
        await expect(email).toBeFocused();
        // The browser's own check stops an address that is not one, and
        // leaves the focus in the field to fix it.
        const asked = codeRequests.length;
        await email.fill("abc");
        await at.getByRole("button", { name: "コードを送る" }).click();
        await expect(email).toBeFocused();
        await expect(at.locator("#account-error")).toHaveCount(0);
        expect(codeRequests).toHaveLength(asked);
        await email.fill(INVITED);
        await at.getByRole("button", { name: "コードを送る" }).click();
        await expect(at.getByLabel("6桁のコード")).toBeFocused();
        // A reader with no profile yet, for the first profile's step.
        profile = null;
        await at.getByLabel("6桁のコード").fill("123456");
        await at.getByRole("button", { name: "ログインする" }).click();
        const name = at.getByLabel("ユーザー名");
        await expect(name).toBeFocused();
        await name.fill("アキ");
        await at.reload();
        await expect(at.getByText("書きかけを続けています")).toBeVisible();
        await at.getByRole("button", { name: "書きかけを消す" }).click();
        await at.getByRole("button", { name: "消す", exact: true }).click();
        await expect(name).toHaveValue("");
        await expect(name).toBeFocused();
        profile = signedIn;

        // 店主にひとことを残す: ready to type into, and laid out as any
        // sheet, with no phone's toolbar: 届ける is its last button.
        await at.goto(base + "/walk/#shop-orbit");
        await expect(at.locator(".walk-book-target").first()).toBeVisible();
        await at
          .getByRole("button", { name: "店主にひとことを伝える" })
          .click();
        const words = at.getByRole("dialog", { name: "店主にひとことを残す" });
        await expect(
          words.getByRole("textbox", { name: "店主に伝えたい言葉" }),
        ).toBeFocused();
        await expect(
          words.locator(".writing-toolbar, .modal-body"),
        ).toHaveCount(0);
        expect(
          await words.evaluate((sheet) => sheet.lastElementChild?.textContent),
        ).toBe("届ける");
        await at.keyboard.press("Escape");
        await expect(words).toHaveCount(0);

        // 注釈モード: the sheet opens with its field ready.
        staff = true;
        const [notesAsked] = await Promise.all([
          at.waitForResponse((response) =>
            response.url().includes("/rest/v1/rpc/can_annotate"),
          ),
          at.goto(base + "/books/solaris/"),
        ]);
        await notesAsked.finished();
        await at.getByRole("button", { name: "注釈", exact: true }).click();
        await expect(
          at.getByText("メモしたい場所をタップしてください"),
        ).toBeVisible();
        // Clicked on the book's title, in the middle of the page.
        const title = await at
          .getByRole("heading", { level: 1 })
          .first()
          .boundingBox();
        await at.mouse.click(
          title.x + title.width / 2,
          title.y + title.height / 2,
        );
        await expect(
          at.getByRole("form", { name: "注釈を残す" }),
        ).toBeVisible();
        await expect(at.getByLabel("注釈", { exact: true })).toBeFocused();
      } finally {
        profile = signedIn;
        staff = false;
        await desk.close();
      }
    },
  );

  await check(
    "メールアドレスを変える from 設定: a code from each address, the new one first",
    async () => {
      const link = session();
      try {
        await page.goto("about:blank");
        await page.goto(
          base +
            "/login/#" +
            new URLSearchParams({
              access_token: link.access_token,
              expires_at: String(link.expires_at),
              expires_in: "3600",
              refresh_token: link.refresh_token,
              token_type: "bearer",
              type: "magiclink",
            }),
        );
        await expect(
          page.getByRole("heading", { name: "ログインしています" }),
        ).toBeVisible();
        // The address signed in with is on the account's page.
        await expect(page.locator(".account-email")).toContainText(INVITED);

        await page.goto(base + "/profiles/me/");
        await page.getByRole("button", { name: "設定" }).click();
        const settings = page.getByRole("dialog", { name: "設定" });
        await expect(settings.getByText(INVITED)).toBeVisible();
        await settings
          .getByRole("button", { name: "メールアドレスを変える" })
          .scrollIntoViewIfNeeded();
        await shot("email-change-0-settings-390");
        await settings
          .getByRole("button", { name: "メールアドレスを変える" })
          .click();
        await expect(page).toHaveURL(base + "/login/?change=email");
        const heading = page.getByRole("heading", {
          name: "メールアドレスを変える",
        });
        await expect(heading).toBeVisible();
        // On a phone the keyboard waits for a tap.
        await expect(heading).toBeFocused();
        await noOverflow("change email");
        await shotBoth("email-change-1-address");

        const address = page.getByLabel("新しいメールアドレス");
        await address.fill(INVITED);
        await page.getByRole("button", { name: "コードを送る" }).click();
        await expect(page.locator("#account-error")).toContainText(
          "いまログインに使っているアドレスと同じです",
        );
        await address.fill("ren@example.jp");
        await page.getByRole("button", { name: "コードを送る" }).click();
        await expect(page.locator("#account-error")).toContainText(
          "ほかのアカウントで使われています",
        );
        await address.fill(" Aki.New@example.jp ");
        await page.getByRole("button", { name: "コードを送る" }).click();
        const codes = page.getByRole("heading", {
          name: "届いたコードを入れる",
        });
        await expect(codes).toBeVisible();
        await expect(page.locator(".account-card")).toContainText(
          "aki.new@example.jp",
        );
        await noOverflow("email change codes");
        await shotBoth("email-change-2-codes");
        // The step stays through a reload, and no code is kept.
        await page.reload();
        await expect(codes).toBeVisible();
        expect(
          await page.evaluate(() =>
            sessionStorage.getItem("book-town-email-change-v1"),
          ),
        ).not.toMatch(/111111|222222/);

        const change = page.getByRole("button", {
          name: "メールアドレスを変える",
        });
        await expect(change).toBeDisabled();
        await page.locator("#account-new-code").fill("111111");
        await page.locator("#account-current-code").fill("999999");
        await change.click();
        await expect(page.locator("#account-error")).toContainText(
          "コードが違うか、期限が切れています",
        );
        // The new address's code was taken; it is not asked again.
        await expect(page.locator("#account-new-code")).toHaveCount(0);
        await expect(page.getByText("確かめました")).toBeVisible();
        await shot("email-change-3-one-taken-390");
        await page.reload();
        await expect(page.getByText("確かめました")).toBeVisible();
        await page.locator("#account-current-code").fill("222 222");
        await change.click();

        await expect(
          page.getByRole("heading", { name: "ログインしています" }),
        ).toBeVisible();
        await expect(page).toHaveURL(base + "/login/");
        await expect(page.locator(".account-email")).toContainText(
          "aki.new@example.jp",
        );
        await expect(page.getByRole("status")).toContainText(
          "メールアドレスを変えました",
        );
        await shot("email-change-4-done-390");
        expect(
          await page.evaluate(() =>
            sessionStorage.getItem("book-town-email-change-v1"),
          ),
        ).toBeNull();
        // 戻る goes back to where 設定 was opened.
        await page.goBack();
        await expect(page).toHaveURL(base + "/profiles/me/");

        // Given up halfway, nothing is kept; the address is as it was.
        await page.goto(base + "/login/?change=email");
        await page.getByLabel("新しいメールアドレス").fill("x@example.jp");
        await page.getByRole("button", { name: "コードを送る" }).click();
        await expect(codes).toBeVisible();
        await page.getByRole("button", { name: "やめる" }).click();
        await expect(
          page.getByRole("heading", { name: "ログインしています" }),
        ).toBeVisible();
        await expect(page.getByRole("status")).toHaveCount(0);
        await expect(page.locator(".account-email")).toContainText(
          "aki.new@example.jp",
        );
        expect(
          await page.evaluate(() =>
            sessionStorage.getItem("book-town-email-change-v1"),
          ),
        ).toBeNull();
        await page.getByRole("button", { name: "ログアウト" }).click();
      } finally {
        user.email = INVITED;
        emailChange = null;
      }
    },
  );

  await check(
    "パスキー from 設定: made on this phone, it signs in without a code; removed, it does not",
    async () => {
      // A passkey works only on pages under its relying party, and an IP
      // address cannot be one: this phone opens the site at localhost.
      const local = base.replace("127.0.0.1", "localhost");
      const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        reducedMotion: "reduce",
      });
      try {
        await phone.route(supabase + "/**", standIn);
        const at = settleBeforeNavigating(await phone.newPage());
        at.on("pageerror", (e) => errors.push(e.message));
        const snap = (name) =>
          at.screenshot({
            path: path.join(output, name + ".png"),
            fullPage: true,
          });
        // The phone's fingerprint, stood in for: it keeps what it makes.
        const cdp = await phone.newCDPSession(at);
        await cdp.send("WebAuthn.enable");
        await cdp.send("WebAuthn.addVirtualAuthenticator", {
          options: {
            protocol: "ctap2",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
          },
        });
        const link = session();
        await at.goto(
          local +
            "/login/#" +
            new URLSearchParams({
              access_token: link.access_token,
              expires_at: String(link.expires_at),
              expires_in: "3600",
              refresh_token: link.refresh_token,
              token_type: "bearer",
              type: "magiclink",
            }),
        );
        const signedIn = at.getByRole("heading", {
          name: "ログインしています",
        });
        await expect(signedIn).toBeVisible();
        await expect(at.locator(".account-row")).toContainText("パスキー");
        await snap("passkey-0-account-390");
        await at.goto(local + "/profiles/me/");
        await at.getByRole("button", { name: "設定" }).click();
        await at
          .getByRole("dialog", { name: "設定" })
          .getByRole("button", { name: "パスキー", exact: true })
          .scrollIntoViewIfNeeded();
        await snap("passkey-0-settings-390");
        await at
          .getByRole("dialog", { name: "設定" })
          .getByRole("button", { name: "パスキー", exact: true })
          .click();
        await expect(at).toHaveURL(local + "/login/?change=passkey");
        const heading = at.getByRole("heading", { name: "パスキー" });
        await expect(heading).toBeFocused();
        // None made yet: no list, no count, only the way to make one.
        const make = at.getByRole("button", {
          name: "この端末でパスキーを作る",
        });
        await expect(make).toBeEnabled();
        await expect(at.locator(".account-passkeys")).toHaveCount(0);
        await expect(at.locator(".account-card")).not.toContainText("0");
        await snap("passkey-1-none-390");

        await make.click();
        await expect(at.getByRole("status")).toContainText(
          "パスキーを作りました",
        );
        const items = at.locator(".account-passkeys li");
        await expect(items).toHaveCount(1);
        await expect(items.first()).toContainText("Google Password Manager");
        await snap("passkey-2-made-390");
        // The same phone makes one; asked again, it says so.
        await make.click();
        await expect(at.locator("#account-error")).toContainText(
          "この端末のパスキーは、もう作ってあります",
        );
        await expect(items).toHaveCount(1);

        // 戻る, then signed out: the passkey signs in with no code.
        await at.getByRole("button", { name: "戻る" }).click();
        await expect(signedIn).toBeVisible();
        await at.getByRole("button", { name: "ログアウト" }).click();
        const passkeyIn = at.getByRole("button", {
          name: "パスキーでログイン",
        });
        await expect(passkeyIn).toBeVisible();
        await snap("passkey-3-sign-in-390");
        const asked = codeRequests.length;
        await passkeyIn.click();
        await expect(signedIn).toBeVisible();
        expect(codeRequests.length).toBe(asked);

        // Removed after asking, it signs nobody in.
        await at.goto(local + "/login/?change=passkey");
        await expect(items).toHaveCount(1);
        await expect(items.first()).toContainText("に使用");
        await items.first().getByRole("button", { name: "消す" }).click();
        await expect(items.first()).toContainText(
          "このパスキーではログインできなくなります",
        );
        await snap("passkey-4-remove-390");
        await items.first().getByRole("button", { name: "残す" }).click();
        await expect(items).toHaveCount(1);
        await items.first().getByRole("button", { name: "消す" }).click();
        await items.first().getByRole("button", { name: "消す" }).click();
        await expect(at.locator(".account-passkeys")).toHaveCount(0);
        expect(passkeys).toEqual([]);
        await at.getByRole("button", { name: "戻る" }).click();
        await at.getByRole("button", { name: "ログアウト" }).click();
        await passkeyIn.click();
        await expect(at.locator("#account-passkey-error")).toContainText(
          "このパスキーでは入れませんでした",
        );
        // Its line is the passkey's, not the address field's.
        await expect(at.getByLabel("メールアドレス")).not.toHaveAttribute(
          "aria-describedby",
          "account-passkey-error",
        );
        await expect(
          at.getByRole("heading", { name: "本の街に入る" }),
        ).toBeVisible();
        const width = await at.evaluate(() => ({
          page: innerWidth,
          document: document.documentElement.scrollWidth,
        }));
        expect(width.document).toBeLessThanOrEqual(width.page + 1);
      } finally {
        passkeys = [];
        await phone.close();
      }
    },
  );

  await check(
    "退会 from 設定: the reader's ID first, then everything of theirs goes, here too",
    async () => {
      const signedIn = profile;
      const link = session();
      try {
        await page.goto("about:blank");
        await page.goto(
          base +
            "/login/#" +
            new URLSearchParams({
              access_token: link.access_token,
              expires_at: String(link.expires_at),
              expires_in: "3600",
              refresh_token: link.refresh_token,
              token_type: "bearer",
              type: "magiclink",
            }),
        );
        await expect(
          page.getByRole("heading", { name: "ログインしています" }),
        ).toBeVisible();
        // What this browser keeps for them, and for no one in particular.
        await page.evaluate((id) => {
          localStorage.setItem(
            "book-town-post-drafts-v1",
            JSON.stringify({
              version: 1,
              drafts: {
                [id + ":new-post"]: {
                  body: "退会する前の書きかけ",
                  bookId: null,
                  spoiler: false,
                },
                "visitor:new-post": {
                  body: "ログインしていない人の書きかけ",
                  bookId: null,
                  spoiler: false,
                },
              },
            }),
          );
          localStorage.setItem("book-town-seen-v1:" + id, "[]");
        }, user.id);
        // Next to ログアウト on the sign-in page, too.
        await expect(
          page.getByRole("link", { name: "退会する" }),
        ).toHaveAttribute("href", "/leave/");

        await page.goto(base + "/profiles/me/");
        await page.getByRole("button", { name: "設定" }).click();
        const settings = page.getByRole("dialog", { name: "設定" });
        // Last in the settings, and quiet.
        await settings
          .getByRole("button", { name: "退会する" })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(output, "leave-settings.png"),
        });
        await settings.getByRole("button", { name: "退会する" }).click();
        await expect(page).toHaveURL(base + "/leave/");
        const heading = page.getByRole("heading", { name: "退会する" });
        await expect(heading).toBeVisible();
        // On a phone the keyboard waits for a tap.
        await expect(heading).toBeFocused();
        await expect(page.getByText("消えるもの")).toBeVisible();
        await noOverflow("退会");
        await shotBoth("leave");
        // The narrowest phone too.
        await page.setViewportSize({ width: 320, height: 568 });
        await noOverflow("退会 at 320");
        await shot("leave-320");
        await page.setViewportSize({ width: 390, height: 844 });
        // やめる goes back where they were, the settings closed.
        await page.getByRole("button", { name: "やめる" }).click();
        await expect(page).toHaveURL(base + "/profiles/me/");
        await expect(settings).toHaveCount(0);

        await page.getByRole("button", { name: "設定" }).click();
        await settings.getByRole("button", { name: "退会する" }).click();
        await expect(page).toHaveURL(base + "/leave/");
        const leave = page.getByRole("button", { name: "退会する" });
        const field = page.getByLabel(/確かめるため/);
        await expect(leave).toBeDisabled();
        await expectNoKeyboard(page, "退会");
        await expectNoZoomOnFocus(field, "退会の ID");
        await field.fill("someone_else");
        await expect(leave).toBeDisabled();
        await field.fill("@" + signedIn.handle.toUpperCase());
        await expect(leave).toBeEnabled();
        // Refused: nothing went, and they are told so.
        refuseLeave = true;
        await leave.click();
        await expect(page.locator("#leave-error")).toContainText(
          "何も消えていません",
        );
        expect(leaveRequests).toHaveLength(1);
        expect(await keptDraftKeys(POST_DRAFTS)).toContain(
          user.id + ":new-post",
        );
        refuseLeave = false;
        await leave.click();
        await expect(
          page.getByRole("heading", { name: "退会しました" }),
        ).toBeVisible();
        expect(leaveRequests).toEqual(["POST", "POST"]);
        await shot("leave-done-390");
        // Nothing of theirs is left in this browser; the visitor's stays.
        expect(await keptDraftKeys(POST_DRAFTS)).toEqual(["visitor:new-post"]);
        const left = await page.evaluate((id) => {
          const found = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (
              key.includes(id) ||
              (localStorage.getItem(key) ?? "").includes(id)
            )
              found.push(key);
          }
          return found;
        }, user.id);
        expect(left).toEqual([]);
        await page.getByRole("link", { name: "本の街へ" }).click();
        await page.goto(base + "/login/");
        await expect(
          page.getByRole("heading", { name: "本の街に入る" }),
        ).toBeVisible();
        // Signed out, the page asks them to sign in to the account to delete.
        await page.goto(base + "/leave/");
        await expect(
          page.getByRole("link", { name: "ログインする" }),
        ).toBeVisible();
      } finally {
        profile = signedIn;
        refuseLeave = false;
      }
    },
  );

  if (errors.length) throw new Error("Page errors: " + errors.join(" | "));
  console.log(passed.length + " login journey checks passed");
} finally {
  await browser.close();
}
