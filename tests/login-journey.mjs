import { chromium, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  escapeWhileComposing,
  layersSettled,
  settleBeforeNavigating,
} from "./journey-layers.mjs";
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
// How long the stand-in takes to read the signed-in person's own profile.
let ownProfileDelay = 0;
// The rest of the town, once a test fills it: rows by table.
let town = null;
const reportsSent = [];
// A change carrying these words is refused by the stand-in, as the database
// refuses one that breaks a rule, after the screen has moved on.
const REFUSED_MARK = "（断られる）";
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
      if (ownProfileDelay && url.searchParams.get("id") === "eq." + user.id)
        await new Promise((done) => setTimeout(done, ownProfileDelay));
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
  // What an owner's shop counts (followers, visitors): nobody yet.
  if (url.pathname.startsWith("/rest/v1/") && request.method() === "HEAD")
    return route.fulfill({ status: 200, headers: { "content-range": "*/0" } });
  if (url.pathname === "/rest/v1/rpc/shop_visitors") return json(200, 0);
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
/** The report drafts this browser keeps, by key. */
const keptReports = () =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("book-town-report-drafts-v1") ?? "null")
        ?.drafts ?? {},
  );
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
      await expect(name).toBeFocused();
      await page.reload();
      await expect(name).toHaveValue("");
      await expect(resumed).toHaveCount(0);
    },
  );

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
    await expect(
      page
        .locator(".store-shelf-label")
        .getByRole("link", { name: "本を並べる" }),
    ).toHaveAttribute("href", "/my-shop/");
    await shot("7-empty-shelf");
    town = null;
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
      await page.getByRole("button", { name: "本を登録", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "本を登録" });
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
      await page.unroute(supabase + "/rest/v1/**", hold);
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
      await post.getByRole("button", { name: "この投稿を通報" }).click();
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
      await page.goto(base + "/books/registered/?id=" + COVER_BOOK);
      await expect(page.locator(".cover-credit")).toContainText("openBD");
      await expect(
        page.getByRole("button", { name: "表紙の削除依頼はこちら" }),
      ).toHaveCount(0);
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
