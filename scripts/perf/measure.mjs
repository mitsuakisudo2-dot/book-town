// How fast Home opens for a signed-in reader on a slow phone: 390px wide,
// Slow 4G (1.6Mbps, 562ms round trip) and the CPU four times slower. The
// built site (the build with the stand-in Supabase, as login-journey) is
// served by scripts/perf/serve.mjs; Supabase is answered here over CDP's
// Fetch (which keeps the HTTP cache, as Playwright's route does not), each
// answer and its preflight after 562ms.
//
//   node scripts/perf/measure.mjs [runs] [first|second]
//
// ran:         the page's code has run: its first question to Supabase
//              (with VISITOR, the head's town_view, town-ahead.ts).
// first:       the first 便り (.post-card) drawn, the frame after it shows.
// interactive: the first 便り, or the end of the last long task within 15
//              seconds of it if later: when a tap is answered at once.
// Prints each run and the medians. With SPEED_LIMITS="first=…,interactive=…"
// (ms) it fails when a median is over its limit (the CI check, AUD-048).
// BASE (https://127.0.0.1:5181) names the server; PAGE another page to open
// (/library/, …: ran and interactive only, or READY's selector for first); REQS=1 lists what was asked
// of Supabase, TIMING=1 when each file came, FONTS=1 lets Google's fonts come,
// VISITOR=1 opens it as someone who has not signed in (the first visit).
import fs from "node:fs";
import { chromium } from "@playwright/test";

const runs = Number(process.argv[2]) || 5;
const mode = process.argv[3] || "first";
const base = process.env.BASE || "https://127.0.0.1:5181";
const DELAY = 562;
const PAGE = process.env.PAGE || "/";
const READY = process.env.READY ?? (PAGE === "/" ? ".post-card" : "");

// A reader signed in on this browser, and a small town of others.
const USER = "8f6a2c1e-5b7d-4e1a-9c3f-2d4b6a8e0c11";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 36000;
const user = {
  id: USER,
  aud: "authenticated",
  role: "authenticated",
  email: "aki@example.jp",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-10-12T00:00:00Z",
};
const session = {
  access_token: [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub: USER, role: "authenticated", exp }),
    "sig",
  ].join("."),
  token_type: "bearer",
  expires_in: 36000,
  expires_at: exp,
  refresh_token: "r",
  user,
};
const uid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const t0 = Date.parse("2026-10-16T12:00:00Z");
const made = "2026-10-12T00:00:00Z";
const profiles = [
  {
    id: USER,
    handle: "aki",
    name: "あき",
    bio: "",
    color: "green",
    compose_icon: "",
    links: [],
    reading_visibility: "self",
    created_at: made,
    updated_at: made,
  },
];
for (let i = 1; i <= 20; i++)
  profiles.push({
    id: uid(i),
    handle: "r" + i,
    name: "読書家" + i,
    bio: "本が好きです。",
    color: "green",
    compose_icon: "",
    links: [],
    reading_visibility: "public",
    created_at: made,
    updated_at: made,
  });
const books = [];
for (let i = 1; i <= 30; i++)
  books.push({
    id: uid(1000 + i),
    work_id: uid(2000 + i),
    title: "本の題名その" + i,
    author: "著者" + i,
    publisher: "出版社",
    isbn: null,
    price: null,
    source: "manual",
    created_at: "2026-10-13T00:00:00Z",
    updated_at: "2026-10-13T00:00:00Z",
  });
const posts = [];
for (let i = 1; i <= 40; i++)
  posts.push({
    id: uid(3000 + i),
    author_id: uid(1 + (i % 20)),
    body:
      "この本を読んで、考えたことを少し書きます。" +
      "文章がつづきます。".repeat(i % 5),
    book_id: i % 3 ? uid(1000 + (i % 30) + 1) : null,
    created_at: new Date(t0 - i * 3600e3).toISOString(),
    parent_id: null,
    reading_mode: null,
    spoiler: false,
    spoiler_folded: false,
  });
const shops = profiles.slice(1, 11).map((p, i) => ({
  id: uid(4000 + i),
  owner_id: p.id,
  name: p.name + "の本屋",
  tagline: "",
  description: "",
  is_open: true,
  theme: "wood",
  public_scene: null,
  public_scene_books: [],
  public_shelves: [],
  created_at: made,
}));
const tables = { profiles, books, posts, shops };
// The town's shared rows come in one answer (town_view, town-backend.ts).
const rpcs = {
  town_view: { profiles, shops, posts, catalog: books },
  town_books: [],
  my_books: [],
};

function answer(url, method, headers) {
  const u = new URL(url);
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "*",
    "access-control-expose-headers": "content-range",
  };
  const json = { ...cors, "content-type": "application/json" };
  if (method === "OPTIONS") return { status: 204, headers: cors, body: "" };
  if (u.pathname.startsWith("/auth/v1/user"))
    return { status: 200, headers: json, body: JSON.stringify(user) };
  if (u.pathname.startsWith("/auth/v1/token"))
    return { status: 200, headers: json, body: JSON.stringify(session) };
  if (u.pathname.startsWith("/auth/"))
    return { status: 200, headers: json, body: "{}" };
  const m = u.pathname.match(/\/rest\/v1\/(rpc\/)?([^/?]+)/);
  if (!m) return { status: 404, headers: json, body: "{}" };
  if (m[1]) {
    const rows = rpcs[m[2]] ?? [];
    const h = { ...json, "content-range": "*/" + (rows.length ?? 0) };
    return { status: 200, headers: h, body: JSON.stringify(rows) };
  }
  let rows = tables[m[2]] ?? [];
  const id = u.searchParams.get("id");
  if (id?.startsWith("eq.")) rows = rows.filter((r) => r.id === id.slice(3));
  if (id?.startsWith("in.(")) {
    const ids = id
      .slice(4, -1)
      .split(",")
      .map((s) => s.replace(/"/g, ""));
    rows = rows.filter((r) => ids.includes(r.id));
  }
  for (const key of ["owner_id", "author_id", "user_id", "profile_id"]) {
    const value = u.searchParams.get(key);
    if (value?.startsWith("eq."))
      rows = rows.filter((r) => r[key] === value.slice(3));
  }
  const accept =
    Object.entries(headers).find(([k]) => k.toLowerCase() === "accept")?.[1] ||
    "";
  const h = {
    ...json,
    "content-range": rows.length
      ? "0-" + (rows.length - 1) + "/" + rows.length
      : "*/0",
  };
  if (method === "HEAD") return { status: 200, headers: h, body: "" };
  if (accept.includes("vnd.pgrst.object"))
    return rows.length
      ? { status: 200, headers: h, body: JSON.stringify(rows[0]) }
      : {
          status: 406,
          headers: h,
          body: JSON.stringify({ code: "PGRST116", message: "none" }),
        };
  return { status: 200, headers: h, body: JSON.stringify(rows) };
}

// Uses Playwright's own Chromium unless BOOK_TOWN_CHROME names another browser.
const browser = await chromium.launch({
  executablePath: process.env.BOOK_TOWN_CHROME || undefined,
});
/** In the page: its first 便り has shown, or (no READY) its code has run. */
const shown = (ready) =>
  ready
    ? window.__first > 0
    : performance
        .getEntriesByType("resource")
        .some((e) => e.name.includes("supabase.co"));
const results = [];
for (let r = 0; r < runs; r++) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "ja-JP",
    // serve.mjs's certificate, made for the run.
    ignoreHTTPSErrors: true,
  });
  await context.addInitScript(
    ([signedIn, ready]) => {
      try {
        if (signedIn && !localStorage.getItem("sb-test-project-auth-token"))
          localStorage.setItem("sb-test-project-auth-token", signedIn);
      } catch {}
      window.__long = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries())
            window.__long.push([e.startTime, e.duration]);
        }).observe({ type: "longtask", buffered: true });
      } catch {}
      const seen = () => {
        if (window.__first) return;
        if (ready && document.querySelector(ready)) {
          window.__first = -1;
          requestAnimationFrame(() => (window.__first = performance.now()));
        }
      };
      new MutationObserver(seen).observe(document, {
        childList: true,
        subtree: true,
      });
    },
    [process.env.VISITOR ? "" : JSON.stringify(session), READY],
  );
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 562.5,
    downloadThroughput: ((1.6 * 1024 * 1024) / 8) * 0.9,
    uploadThroughput: ((750 * 1024) / 8) * 0.9,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Fetch.enable", {
    patterns: [
      { urlPattern: "*test-project.supabase.co*", requestStage: "Request" },
      // Google's fonts are another site's speed, and not on CI's network
      // (FONTS=1 lets them come, to see what a page reads of them).
      ...(process.env.FONTS
        ? []
        : [{ urlPattern: "*fonts.g*", requestStage: "Request" }]),
    ],
  });
  const asked = [];
  cdp.on("Fetch.requestPaused", (e) => {
    if (/fonts\.g/.test(e.request.url))
      return cdp
        .send("Fetch.failRequest", {
          requestId: e.requestId,
          errorReason: "BlockedByClient",
        })
        .catch(() => {});
    const a = answer(e.request.url, e.request.method, e.request.headers);
    asked.push(
      e.request.method +
        " " +
        e.request.url.replace(/^https:\/\/test-project.supabase.co/, ""),
    );
    setTimeout(
      () =>
        cdp
          .send("Fetch.fulfillRequest", {
            requestId: e.requestId,
            responseCode: a.status,
            responseHeaders: Object.entries(a.headers).map(([name, value]) => ({
              name,
              value: String(value),
            })),
            body: Buffer.from(a.body).toString("base64"),
          })
          .catch(() => {}),
      DELAY,
    );
  });
  if (mode === "second") {
    await page.goto(base + PAGE, { waitUntil: "load" });
    await page.waitForFunction(shown, READY, { timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.goto("about:blank");
  }
  let bytes = 0;
  cdp.on("Network.loadingFinished", (e) => (bytes += e.encodedDataLength));
  await page.goto(base + PAGE, { waitUntil: "commit" });
  await page.waitForFunction(shown, READY, { timeout: 90000 });
  await page.waitForTimeout(5000);
  const m = await page.evaluate(() => {
    const ran = Math.min(
      ...performance
        .getEntriesByType("resource")
        .filter((e) => e.name.includes("supabase.co"))
        .map((e) => e.startTime),
    );
    // Without a first 便り to wait for, the page is taken from its code's run.
    const first = window.__first || ran;
    let quiet = 0;
    for (const [start, duration] of window.__long)
      if (start + duration > quiet && start < first + 15000)
        quiet = start + duration;
    return {
      ran: Math.round(ran),
      ...(window.__first ? { first: Math.round(first) } : {}),
      interactive: Math.round(Math.max(first, quiet)),
    };
  });
  m.kb = Math.round(bytes / 1024);
  if (process.env.TIMING)
    m.timing = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map(
          (e) =>
            `${Math.round(e.startTime)}→${Math.round(e.responseEnd)} ${Math.round(e.transferSize / 1024)}K ${e.name.replace(location.origin, "")}`,
        ),
    );
  if (process.env.REQS) m.asked = asked;
  results.push(m);
  console.log(JSON.stringify(m));
  await context.close();
}
await browser.close();

const median = (key) => {
  const values = results.map((x) => x[key]).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
};
const medians = Object.fromEntries(
  ["ran", "first", "interactive", "kb"]
    .filter((key) => results[0][key] !== undefined)
    .map((key) => [key, median(key)]),
);
console.log("median", JSON.stringify(medians));
if (process.env.SPEED_OUT)
  fs.writeFileSync(process.env.SPEED_OUT, JSON.stringify(medians) + "\n");

const limits = Object.fromEntries(
  (process.env.SPEED_LIMITS || "")
    .split(",")
    .filter(Boolean)
    .map((pair) => pair.split("=").map((s) => s.trim()))
    .map(([key, value]) => [key, Number(value)]),
);
const over = Object.entries(limits).filter(([key, ms]) => medians[key] > ms);
for (const [key, ms] of over)
  console.error(`${key}: ${medians[key]}ms, over its limit of ${ms}ms`);
if (over.length) process.exit(1);
