import { chromium, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { restingBox, settleBeforeNavigating } from "./journey-layers.mjs";
import { expectReadable } from "./journey-contrast.mjs";

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
// The rest of the town, once a test fills it: rows by table.
let town = null;
const reportsSent = [];
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
const inserted = [];
const codeRequests = [];
const townReads = [];
const townWrites = [];
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
await context.route(supabase + "/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const json = (status, body) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  const body = request.postData() ? JSON.parse(request.postData()) : {};
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
  if (url.pathname === "/auth/v1/verify")
    return body.token === "123456" && body.email === INVITED
      ? json(200, session())
      : json(403, {
          code: 403,
          error_code: "otp_expired",
          msg: "Token has expired or is invalid",
        });
  if (url.pathname === "/auth/v1/logout")
    return route.fulfill({ status: 204, body: "" });
  if (url.pathname === "/auth/v1/user") return json(200, user);
  if (url.pathname === "/rest/v1/profiles") {
    if (request.method() === "GET") {
      const own = profile ? [profile] : [];
      return json(
        200,
        url.searchParams.get("id") === "eq." + user.id
          ? own
          : [...own, ...(town?.profiles ?? [])],
      );
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
  }
  if (url.pathname === "/rest/v1/rpc/can_annotate") {
    annotateAsks.push(staff);
    return json(200, staff);
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
  if (url.pathname.startsWith("/rest/v1/") && request.method() !== "GET")
    townWrites.push(url.pathname);
  // The rest of the signed-in town: a new reader has nothing yet. Like
  // PostgREST, the page asked for (offset, limit) and the total, which the
  // app reads to know it has every one of the reader's own rows.
  if (url.pathname.startsWith("/rest/v1/") && request.method() === "GET") {
    townReads.push(url.pathname);
    const table = url.pathname.slice("/rest/v1/".length);
    const rows = town?.[table] ?? [];
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
  }
  return json(404, { message: "not mocked: " + url.pathname });
});
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
// A dialog closed by hand takes its step off the history a moment later
// (src/lib/back-layer.ts). A second Escape waits for that, as a reader's
// next key would: pressed while the browser is still stepping back, it
// closes the book beneath, and the step arrived at opens the book again.
const layersLeft = (count) =>
  expect
    .poll(() => page.evaluate(() => history.state?.booktownLayers?.length ?? 0))
    .toBe(count);
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
    "a signed-out visitor finds the sign-in link on a phone",
    async () => {
      await page.goto(base + "/");
      const link = page.getByRole("link", { name: "ログイン" });
      await expect(link).toBeVisible();
      await link.click();
      await expect(
        page.getByRole("heading", { name: "本の街に入る" }),
      ).toBeVisible();
      await shot("1-email");
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

  await check("the right code leads to the first profile", async () => {
    await page.getByLabel("6桁のコード").fill("123456");
    await page.getByRole("button", { name: "ログインする" }).click();
    await expect(
      page.getByRole("heading", { name: "ようこそ、本の街へ" }),
    ).toBeVisible();
    await shot("3-welcome");
  });

  await check(
    "the ID, the name and the age are checked before saving",
    async () => {
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
    ]) {
      await page.goto(base + path);
      await expect(page.locator("main.town-main")).toBeVisible();
      await expect(page.locator("main")).not.toContainText(
        /(^|\D)0(人|件|軒|分|回|冊| 投稿| フォロ)/,
      );
    }
  });

  await check(
    "a like for a 見本 says it reaches nobody, and nothing is sent",
    async () => {
      await page.goto(base + "/timeline/");
      // A post: posters on the timeline are made, not liked.
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
        // Asking whether the reader is staff (注釈モード) writes nothing.
        if (url.pathname === "/rest/v1/rpc/can_annotate")
          return route.fallback();
        if (request.method() !== "GET") {
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
        .toEqual(["/rest/v1/books", "/rest/v1/book_marks"]);
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
        // Asking whether the reader is staff (注釈モード) writes nothing.
        if (url.pathname === "/rest/v1/rpc/can_annotate")
          return route.fallback();
        if (request.method() !== "GET") {
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
        .toEqual(["/rest/v1/books", "/rest/v1/book_marks"]);
      const [books, marks] = sent.map((write) => [write.rows].flat());
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
      // Saved: the device lets it go.
      await expect.poll(journal).toBeNull();
      await scanner.getByRole("button", { name: "終わる" }).click();
      await expect(page.locator(".toast")).toContainText("1冊を登録しました");
      await page.unroute(supabase + "/rest/v1/**", hold);
      await page.unroute("https://api.openbd.jp/**", titles);
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

  await check(
    "a post folded by reports opens with a tap; the writer is told gently",
    async () => {
      town = filled();
      await page.goto(base + "/timeline/");
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
      await post.getByRole("button", { name: "この投稿を通報" }).click();
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
        detail: "",
      });
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
    "a poster folded by reports opens with a tap; its maker is told gently",
    async () => {
      town = withPosters();
      await page.goto(base + "/timeline/");
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
      await page.goto(base + "/timeline/");
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
      await send.click();
      await expect(dialog).toContainText(
        "受け付けました。運営が確認を始めたときと、確認し終えたときに、お知らせでお伝えします。",
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
          const { position } = getComputedStyle(node);
          if (position === "fixed" || position === "sticky") return true;
        }
        return false;
      };
      return [
        ...document.querySelectorAll(
          'a[href], button, input, [role="button"], [role="link"], [role="tab"]',
        ),
      ]
        .filter((element) => {
          if (element.closest("[data-site-notes]")) return false;
          // On purpose: on a wide screen the street's sticky column of POP
          // cards fills the right side from the top bar to the bottom, so no
          // corner there is free. The button lies on one card's last lines;
          // the card is a large button, tapped anywhere else.
          if (element.closest(".street-aside")) return false;
          const box = element.getBoundingClientRect();
          return (
            box.width > 0 &&
            box.height > 0 &&
            getComputedStyle(element).visibility !== "hidden" &&
            box.left < button.right &&
            button.left < box.right &&
            box.top < button.bottom &&
            button.top < box.bottom &&
            held(element)
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
      await clear("/");
      expect(annotateAsks.at(-1)).toBe(true);
      await shot("21-notes-button");
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
      await clear("/");
      await page.setViewportSize({ width: 390, height: 844 });
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
      await expect(notesField).toBeFocused();
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
      await expect(notesField).toBeFocused();
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

  if (errors.length) throw new Error("Page errors: " + errors.join(" | "));
  console.log(passed.length + " login journey checks passed");
} finally {
  await browser.close();
}
