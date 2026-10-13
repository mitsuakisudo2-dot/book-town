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
      const prefix = (url.searchParams.get("page") ?? "like.%")
        .slice("like.".length)
        .replace(/%$/, "")
        .replace(/\\(.)/g, "$1");
      return json(
        200,
        staff
          ? siteNotes.filter(
              (note) => !note.removed_at && note.page.startsWith(prefix),
            )
          : [],
      );
    }
    if (!staff)
      return json(403, {
        code: "42501",
        message:
          'new row violates row-level security policy for table "site_notes"',
      });
    if (request.method() === "POST") {
      notesSent.push(body);
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
  // The rest of the signed-in town: a new reader has nothing yet.
  if (url.pathname.startsWith("/rest/v1/") && request.method() === "GET") {
    townReads.push(url.pathname);
    const table = url.pathname.slice("/rest/v1/".length);
    return json(200, town?.[table] ?? []);
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
  // What 注釈モード's tap was about: the back link, in words.
  let backName = "";

  await check(
    "staff find the 注釈 button in a corner where it covers nothing",
    async () => {
      staff = true;
      const clear = async (label) => {
        await expect(annotate).toBeVisible();
        const box = await annotate.boundingBox();
        expect(box.width, label).toBeGreaterThanOrEqual(44);
        expect(box.height, label).toBeGreaterThanOrEqual(44);
        for (const other of [".town-bottom-nav", ".compose-fab"]) {
          const there = page.locator(other).first();
          if (!(await there.isVisible())) continue;
          expect(
            overlaps(box, await there.boundingBox()),
            label + ": over " + other,
          ).toBe(false);
        }
        await noOverflow(label);
      };
      await loadAsked("/");
      expect(annotateAsks.at(-1)).toBe(true);
      await clear("home");
      await shot("21-notes-button");
      await page.setViewportSize({ width: 1280, height: 900 });
      await clear("home, wide");
      await page.setViewportSize({ width: 390, height: 844 });
      await loadAsked("/walk/");
      await clear("walk");
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
      const sent = notesSent.length;
      await notesSheet
        .getByRole("button", { name: "残す", exact: true })
        .click();
      await expect(toast).toContainText("注釈を残しました");
      await expect(notesMode).toHaveCount(0);
      expect(notesSent.length).toBe(sent + 1);
      const note = notesSent.at(-1);
      // Who left it is the database's to fill in.
      expect(note).not.toHaveProperty("user_id");
      expect(note).toMatchObject({
        page: "/books/solaris/",
        body: "戻るの字が小さい",
        layer: null,
        viewport_h: 844,
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
      await notesSheet
        .getByRole("button", { name: "残す", exact: true })
        .click();
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
