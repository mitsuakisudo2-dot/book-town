import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { settleBeforeNavigating } from "./journey-layers.mjs";

// Registering a book in the demo build, on a phone: openBD that never
// answers, an ISBN typed but not looked up, a book already in the library,
// and one only the town knows. Nothing leaves this machine: openBD and
// Google Books are answered here, and every other outside address is refused.

const base = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/library-qa",
);
await mkdir(output, { recursive: true });
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
  isMobile: true,
  locale: "ja-JP",
});

const KOKORO = "9784101010137";
const WHEEL = "9784101092058";
const LONG = "9784003101018";
const LONG_TITLE = "長い題名の本".repeat(40);
// "stall": openBD takes the question and never answers.
let openBd = "answer";
const stalled = [];
await context.route(
  (url) => !url.href.startsWith(base),
  (route) => {
    const url = new URL(route.request().url());
    if (url.host === "api.openbd.jp") {
      if (openBd === "stall") return void stalled.push(route);
      const isbns = url.searchParams.get("isbn").split(",");
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          isbns.map((isbn) =>
            isbn === LONG
              ? {
                  summary: {
                    isbn,
                    title: LONG_TITLE,
                    author: "試験 花子／著",
                    publisher: "試験書房",
                  },
                }
              : null,
          ),
        ),
      });
    }
    if (url.host === "www.googleapis.com")
      return route.fulfill({ contentType: "application/json", body: "{}" });
    return route.abort();
  },
);
// Every message a toast shows, once each, to tell which ones a reader saw.
await context.addInitScript(() => {
  window.__toasts = [];
  const shown = new WeakMap();
  new MutationObserver(() => {
    for (const toast of document.querySelectorAll(".toast")) {
      const text = toast.textContent ?? "";
      if (shown.get(toast) === text) continue;
      shown.set(toast, text);
      window.__toasts.push(text);
    }
  }).observe(document, { childList: true, subtree: true, characterData: true });
});

const page = settleBeforeNavigating(await context.newPage());
page.on("pageerror", (e) => errors.push(e.message));
async function check(name, run) {
  await run();
  passed.push(name);
  console.log("PASS " + name);
}
async function go(route) {
  await page.goto(base + route);
  await expect(page.locator("main")).toBeVisible();
  await page.waitForFunction(() => localStorage.getItem("book-town-v1"));
  // Saved data can exist before this page hydrates; wait until React owns the page.
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("main") ?? {}).some((key) =>
      key.startsWith("__reactFiber"),
    ),
  );
}
const stored = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("book-town-v1")).data);
/** The toasts shown since the last call. */
const toasts = () => page.evaluate(() => window.__toasts.splice(0));
const dialog = () => page.getByRole("dialog", { name: "本を登録" });
const message = () => dialog().locator(".register-message");
const registerButton = () =>
  dialog().getByRole("button", { name: "登録する", exact: true });
async function openRegister() {
  await page.getByRole("button", { name: "本を登録", exact: true }).click();
  await expect(dialog()).toBeVisible();
}
async function registered(text) {
  await expect(dialog()).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText(text);
}

try {
  await go("/profiles/me/?books=library");

  await check("an empty library offers registering, with no 0", async () => {
    await expect(
      page.getByRole("button", { name: /^登録/, pressed: true }),
    ).toHaveText("登録");
    await expect(
      page.getByRole("button", { name: "バーコードで本を登録" }),
    ).toBeVisible();
  });

  await check(
    "when openBD never answers, the title can be typed within four seconds",
    async () => {
      openBd = "stall";
      await openRegister();
      await dialog().getByLabel("ISBN").fill(KOKORO);
      const asked = Date.now();
      await dialog().getByRole("button", { name: "ISBNで探す" }).click();
      await expect(message()).toHaveText("書籍情報を探しています…");
      // Typed while openBD is asked; the button waits for the answer.
      await dialog().getByLabel("タイトル").fill("こころ");
      await dialog().getByLabel("著者").fill("夏目漱石");
      await expect(registerButton()).toBeDisabled();
      await expect(message()).toContainText("書籍情報を取得できませんでした", {
        timeout: 6000,
      });
      const waited = Date.now() - asked;
      expect(waited).toBeGreaterThanOrEqual(3500);
      expect(waited).toBeLessThan(6000);
      expect(stalled.length).toBeGreaterThan(0);
      // What was typed stays, and the book can be registered.
      await expect(dialog().getByLabel("タイトル")).toHaveValue("こころ");
      await expect(registerButton()).toBeEnabled();
      await page.screenshot({ path: path.join(output, "openbd-stalled.png") });
      await registerButton().click();
      await registered("『こころ』を登録しました");
      const data = await stored();
      expect(data.library).toEqual(["isbn-" + KOKORO]);
      expect(data.addedBooks).toContainEqual(
        expect.objectContaining({
          id: "isbn-" + KOKORO,
          title: "こころ",
          author: "夏目漱石",
          isbn: KOKORO,
        }),
      );
      openBd = "answer";
    },
  );

  await check(
    "a typed ISBN is registered without pressing ISBNで探す",
    async () => {
      await toasts();
      await openRegister();
      // One that does not check out is not dropped silently: it is refused.
      await dialog().getByLabel("ISBN").fill("978-4-00-000000-2");
      await dialog().getByLabel("タイトル").fill("車輪の下");
      await registerButton().click();
      await expect(message()).toContainText("ISBNとして読めませんでした");
      await expect(dialog()).toBeVisible();
      expect((await stored()).library).toEqual(["isbn-" + KOKORO]);
      // Typed with hyphens, never looked up: kept as the ISBN it is.
      await dialog().getByLabel("ISBN").fill("978-4-10-109205-8");
      await registerButton().click();
      await registered("『車輪の下』を登録しました");
      const data = await stored();
      expect(data.library).toEqual(["isbn-" + KOKORO, "isbn-" + WHEEL]);
      expect(data.addedBooks).toContainEqual(
        expect.objectContaining({
          id: "isbn-" + WHEEL,
          title: "車輪の下",
          isbn: WHEEL,
        }),
      );
    },
  );

  await check(
    "a book already in the library says so, never that it was registered",
    async () => {
      await toasts();
      const before = await stored();
      await openRegister();
      await dialog().getByLabel("ISBN").fill(KOKORO);
      await dialog().getByRole("button", { name: "ISBNで探す" }).click();
      await expect(message()).toHaveText("もうライブラリにあります。");
      await expect(dialog().getByLabel("タイトル")).toHaveValue("こころ");
      await page.screenshot({ path: path.join(output, "already.png") });
      await registerButton().click();
      await registered("『こころ』はもうライブラリにあります");
      const seen = await toasts();
      expect(
        seen.some((text) => text.includes("もうライブラリにあります")),
      ).toBe(true);
      expect(seen.some((text) => text.includes("登録しました"))).toBe(false);
      const after = await stored();
      expect(after.library).toEqual(before.library);
      expect(after.addedBooks).toEqual(before.addedBooks);
    },
  );

  await check(
    "a book the town knows, but not the library, is registered as usual",
    async () => {
      await page
        .getByRole("button", { name: "こころを登録した本から外す" })
        .click();
      await expect
        .poll(async () => (await stored()).library)
        .toEqual(["isbn-" + WHEEL]);
      await toasts();
      await openRegister();
      await dialog().getByLabel("ISBN").fill(KOKORO);
      await dialog().getByRole("button", { name: "ISBNで探す" }).click();
      await expect(message()).toHaveText(
        "書籍情報が見つかりました。確認して登録してください。",
      );
      await registerButton().click();
      await registered("『こころ』を登録しました");
      const seen = await toasts();
      expect(
        seen.some((text) => text.includes("もうライブラリにあります")),
      ).toBe(false);
      const data = await stored();
      expect(data.library).toEqual(["isbn-" + WHEEL, "isbn-" + KOKORO]);
      expect(
        data.addedBooks.filter((book) => book.id === "isbn-" + KOKORO),
      ).toHaveLength(1);
    },
  );

  await check(
    "openBD's answer fills the book in, and a long title ends in …",
    async () => {
      await openRegister();
      await dialog().getByLabel("ISBN").fill(LONG);
      await dialog().getByRole("button", { name: "ISBNで探す" }).click();
      await expect(message()).toHaveText(
        "書籍情報が見つかりました。確認して登録してください。",
      );
      await expect(dialog().getByLabel("著者")).toHaveValue("試験 花子");
      await registerButton().click();
      await registered("を登録しました");
      const book = (await stored()).addedBooks.find(
        (entry) => entry.id === "isbn-" + LONG,
      );
      expect(book.title).toHaveLength(200);
      expect(book.title).toBe(LONG_TITLE.slice(0, 199) + "…");
      // Kept through a reload: the saved town never drops it for its length.
      await go("/profiles/me/?books=library");
      await expect(
        page.locator(".profile-saved-book").filter({ hasText: "…" }),
      ).toHaveCount(1);
    },
  );

  await check("the dialog fits 390px, and 戻る closes it", async () => {
    await openRegister();
    await dialog().getByLabel("ISBN").fill(WHEEL);
    const size = await page.evaluate(() => ({
      width: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(size.width).toBe(390);
    expect(size.document).toBeLessThanOrEqual(size.width + 1);
    for (const target of [
      dialog().getByLabel("ISBN"),
      dialog().getByRole("button", { name: "ISBNで探す" }),
      registerButton(),
    ]) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    await page.screenshot({ path: path.join(output, "dialog-390.png") });
    await page.goBack();
    await expect(dialog()).toHaveCount(0);
    await expect(page).toHaveURL(/\/profiles\/me\//);
    // Nothing was registered by closing.
    expect((await stored()).library).toHaveLength(3);
  });

  expect(errors).toEqual([]);
  console.log(passed.length + " library browser checks passed");
} finally {
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ passed, errors }, null, 2),
  );
  await browser.close();
}
