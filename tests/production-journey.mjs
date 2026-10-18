import { chromium, expect } from "@playwright/test";

// The production site as a visitor who has not signed in, on a phone: the
// pages open, the bottom tabs move between them, the public town is read from
// Supabase, and no page throws. Nothing is written. .github/workflows/watch.yml
// runs it every morning against https://booktown.page; BOOK_TOWN_URL points it
// at another build, and BOOK_TOWN_SUPABASE=off skips the Supabase check for a
// build without one.

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
page.on("response", (response) => {
  const url = new URL(response.url());
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

await check("home opens with the bottom tabs", async () => {
  await page.goto(baseURL + "/");
  await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
  await expect(tabs).toBeVisible();
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

for (const route of ["/library/", "/credits/", "/login/"])
  await check(`${route} opens`, async () => {
    const response = await page.goto(baseURL + route);
    if (response && response.status() !== 200)
      throw new Error(`answered ${response.status()}`);
    await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
  });

await browser.close();
for (const note of notes) console.log(note);
if (failures.length) {
  for (const failure of failures) console.log(`::error::${failure}`);
  console.log(
    `${passed} production checks passed, ${failures.length} problems`,
  );
  process.exit(1);
}
console.log(`${passed} production checks passed`);
