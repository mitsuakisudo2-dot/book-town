import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

// The production site as a visitor who has not signed in, on a phone: the
// pages open, the bottom tabs move between them, the public town is read from
// Supabase, a book is found by searching and its page opens, and no page
// throws or loses its own files. Nothing is written: searching only reads.
// .github/workflows/watch.yml runs it every morning and right after each
// publish against https://booktown.page; BOOK_TOWN_URL points it at another
// build, BOOK_TOWN_SUPABASE=off skips the Supabase check for a build without
// one, and BOOK_TOWN_SEARCH is the word searched (one the library's catalog
// has many books for). WATCH_DETAILS names a file the failures are written
// to, for the watch's issue.

const baseURL = (process.env.BOOK_TOWN_URL ?? "https://booktown.page").replace(
  /\/$/,
  "",
);
const needsSupabase = process.env.BOOK_TOWN_SUPABASE !== "off";
const browser = await chromium.launch({
  executablePath: process.env.BOOK_TOWN_CHROME || undefined,
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
});
const page = await context.newPage();

const failures = [];
const notes = [];
let supabaseAnswers = 0;
page.on("pageerror", (error) =>
  failures.push(`${page.url()}: ${error.message}`),
);
page.on("console", (message) => {
  if (message.type() === "error")
    notes.push(`${page.url()}: console: ${message.text().slice(0, 200)}`);
});
const search = process.env.BOOK_TOWN_SEARCH ?? "日本";
page.on("response", (response) => {
  const url = new URL(response.url());
  // The build's own files: one missing leaves a page without its code.
  if (
    url.origin === baseURL &&
    url.pathname.startsWith("/_next/") &&
    response.status() >= 400
  )
    failures.push(`${url.pathname} answered ${response.status()}`);
  if (!url.hostname.endsWith(".supabase.co")) return;
  if (response.status() >= 500)
    failures.push(`Supabase answered ${response.status()} to ${url.pathname}`);
  else if (response.ok()) supabaseAnswers += 1;
});
page.on("requestfailed", (request) => {
  const url = new URL(request.url());
  const reason = request.failure()?.errorText ?? "";
  // A navigation cancels what the page before it was still asking for.
  if (reason.includes("ERR_ABORTED")) return;
  if (url.hostname.endsWith(".supabase.co") || url.origin === baseURL)
    failures.push(`${url.pathname} failed: ${reason}`);
});

const tabs = page.getByRole("navigation", {
  name: "スマートフォンナビゲーション",
});
let passed = 0;
async function check(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${String(error.message).split("\n")[0]}`);
    console.log(`FAIL ${name}`);
  }
}

// Next's own words when a page broke while drawing.
const broken = page.getByText(/Application error|client-side exception/);

await check("home opens with the bottom tabs", async () => {
  await page.goto(baseURL + "/");
  await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
  await expect(tabs).toBeVisible();
  const build = await page
    .locator('meta[name="booktown-build"]')
    .getAttribute("content")
    .catch(() => null);
  console.log(`The site names its build: ${build ?? "none"}`);
});

await check("the public town is read from Supabase", async () => {
  if (!needsSupabase) return;
  await expect
    .poll(() => supabaseAnswers, { timeout: 20_000 })
    .toBeGreaterThan(0);
});

for (const [label, route] of [
  ["検索", "/search/"],
  ["書店めぐり", "/walk/"],
]) {
  await check(`the ${label} tab opens ${route}`, async () => {
    await tabs.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(route.replace(/\//g, "\\/")));
    await expect(page.locator("main")).toBeVisible();
  });
}

await check("back returns to the page before", async () => {
  await page.goBack();
  await expect(page).toHaveURL(/\/search\//);
});

await check(`searching finds a book, and its page opens`, async () => {
  const box = page.getByRole("searchbox", { name: "本と書店を検索" });
  await box.fill(search);
  const found = page.locator(".search-results .search-book");
  await expect(found.first()).toBeVisible({ timeout: 20_000 });
  await found.first().click();
  await expect(page).toHaveURL(/\/books\//);
  const title = page.locator("main h1").first();
  await expect(title).toBeVisible({ timeout: 20_000 });
  // The page for a book it could not read says so in its heading.
  await expect(title).not.toHaveText(/見られません/, { timeout: 20_000 });
  await expect(broken).toHaveCount(0);
});

for (const route of ["/library/", "/credits/", "/login/"])
  await check(`${route} opens`, async () => {
    const response = await page.goto(baseURL + route);
    if (response && response.status() !== 200)
      throw new Error(`answered ${response.status()}`);
    await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
    await expect(broken).toHaveCount(0);
  });

await browser.close();
for (const note of notes) console.log(note);
if (failures.length) {
  for (const failure of failures) console.log(`::error::${failure}`);
  if (process.env.WATCH_DETAILS)
    await writeFile(process.env.WATCH_DETAILS, failures.join("\n") + "\n");
  console.log(
    `${passed} production checks passed, ${failures.length} problems`,
  );
  process.exit(1);
}
console.log(`${passed} production checks passed`);
