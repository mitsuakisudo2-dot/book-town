import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ean13Modules, withCheckDigit } from "./ean13.mjs";
import { restingBox, settleBeforeNavigating } from "./journey-layers.mjs";
import {
  coarse,
  expectKeyboardUp,
  expectNoKeyboard,
  expectTapWrites,
  watchFocus,
} from "./journey-keyboard.mjs";

// Registering books in the demo build, on a phone. First by hand, through
// ［手で入力］ in the scanner: openBD that never answers, an ISBN typed but
// not looked up, a book already in the library, another ISBN typed after a
// book was found, and one only the town knows. Then the continuous scanner,
// with a stand-in for the browser's barcode reader on the fake camera:
// twenty books in a row, the same book twice, price codes, a book openBD
// does not know, ［取り消す］, offline, ［終わる］, 書名を入れる, a tab closed
// before its books were saved, 390px, 戻る, the sound and the vibration;
// ISBNs typed where no barcode can be read; and ZXing in WebAssembly
// (served from out/zxing/) reading a book's barcode drawn on the camera, on
// an iPhone, where the browser's own reader is not for EAN-13, and on a
// computer; with the camera let go when the scanner closes while it loads.
// Nothing leaves this machine: openBD and Google Books are answered here,
// and every other outside address is refused.

const base = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/library-qa",
);
await mkdir(output, { recursive: true });
// Uses Playwright's own Chromium unless BOOK_TOWN_CHROME names another browser.
// The fake camera plays a test picture, and asking for it is allowed.
const browser = await chromium.launch({
  executablePath: process.env.BOOK_TOWN_CHROME || undefined,
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const passed = [],
  errors = [];
const phone = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  locale: "ja-JP",
};

const KOKORO = "9784101010137";
const WHEEL = "9784101092058";
const LONG = "9784003101018";
const MON = "9784101006017";
const LONG_TITLE = "長い題名の本".repeat(40);
/** A valid ISBN-13 of 978-4-09-…, which no book of the demo town has. */
const isbnOf = (n) => {
  const body = "978409" + String(n).padStart(6, "0");
  const sum = [...body].reduce(
    (total, digit, at) => total + Number(digit) * (at % 2 ? 3 : 1),
    0,
  );
  return body + ((10 - (sum % 10)) % 10);
};
/** The same book's ISBN-10. */
const isbn10Of = (isbn) => {
  const body = isbn.slice(3, 12);
  const sum = [...body].reduce(
    (total, digit, at) => total + Number(digit) * (10 - at),
    0,
  );
  const check = (11 - (sum % 11)) % 11;
  return body + (check === 10 ? "X" : check);
};
// openBD knows 「試験の本 n」 for isbnOf(n) up to 99, and nothing above.
const titleOf = (isbn) => {
  for (let n = 1; n < 100; n++) if (isbnOf(n) === isbn) return "試験の本 " + n;
  return null;
};
/** The price code printed under every Japanese book's ISBN. */
const PRICE = "1920193006000";

// "stall": openBD takes the question and never answers. "slow": it answers
// after a second and a half, well within the four seconds it is given.
let openBd = "answer";
const stalled = [];
async function answerOutside(context) {
  await context.route(
    (url) => !url.href.startsWith(base),
    (route) => {
      const url = new URL(route.request().url());
      if (url.host === "api.openbd.jp") {
        if (openBd === "stall") return void stalled.push(route);
        const isbns = url.searchParams.get("isbn").split(",");
        const answer = () =>
          route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(
              isbns.map((isbn) => {
                const title = isbn === LONG ? LONG_TITLE : titleOf(isbn);
                return title
                  ? {
                      summary: {
                        isbn,
                        title,
                        author: "試験 花子／著",
                        publisher: "試験書房",
                      },
                    }
                  : null;
              }),
            ),
          });
        if (openBd === "slow") return void setTimeout(answer, 1500);
        return answer();
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
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}

/**
 * A phone whose browser reads barcodes: the stand-in reader gives the codes
 * pushed to `__barcodes`, one frame each (an array is several codes in one
 * frame), and nothing in the frames between. `__emptyRun` counts the frames
 * with nothing since the last code, and the next `__throws` frames fail to
 * be read. What the phone did back is kept too: each vibration in `__buzz`,
 * and the tones started in `__tones`.
 */
async function scanningPage() {
  const context = await browser.newContext({
    ...phone,
    permissions: ["camera"],
  });
  await answerOutside(context);
  await watchFocus(context);
  await context.addInitScript(() => {
    window.__buzz = [];
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern) => (window.__buzz.push(pattern), true),
    });
    window.__tones = 0;
    const oscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      window.__tones += 1;
      return oscillator.call(this);
    };
    window.__barcodes = [];
    window.__emptyRun = 0;
    window.__throws = 0;
    window.BarcodeDetector = class {
      static async getSupportedFormats() {
        return ["ean_13"];
      }
      async detect() {
        if (window.__throws > 0) {
          window.__throws -= 1;
          throw new DOMException("unreadable", "NotSupportedError");
        }
        const code = window.__barcodes.shift();
        if (!code) {
          window.__emptyRun += 1;
          return [];
        }
        window.__emptyRun = 0;
        return [].concat(code).map((rawValue) => ({
          rawValue,
          format: "ean_13",
        }));
      }
    };
  });
  const opened = settleBeforeNavigating(await context.newPage());
  opened.on("pageerror", (e) => errors.push(e.message));
  return opened;
}

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

/**
 * A camera that shows a book's two barcodes, the ISBN above the price code,
 * as a phone held upright over the back of a Japanese book. What was asked
 * of it is kept: getUserMedia's constraints in `__asked`, and those given
 * to the track afterwards in `__applied`.
 */
async function bookCamera(context, isbn) {
  await context.addInitScript(
    ({ isbnBars, priceBars }) => {
      window.__asked = [];
      window.__applied = [];
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        window.__asked.push(constraints);
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const paint = canvas.getContext("2d");
        const draw = () => {
          paint.fillStyle = "#efece4";
          paint.fillRect(0, 0, 1280, 720);
          paint.fillStyle = "#262626";
          const wide = 3;
          const left = (1280 - 95 * wide) / 2;
          for (const [bars, top] of [
            [isbnBars, 300],
            [priceBars, 376],
          ])
            for (let at = 0; at < 95; at++)
              if (bars[at] === "1")
                paint.fillRect(left + at * wide, top, wide, 56);
        };
        draw();
        setInterval(draw, 100);
        const stream = canvas.captureStream(10);
        const track = stream.getVideoTracks()[0];
        const apply = track.applyConstraints.bind(track);
        track.applyConstraints = (wanted) => {
          window.__applied.push(wanted);
          return apply(wanted);
        };
        return stream;
      };
    },
    {
      isbnBars: ean13Modules(isbn),
      // A price code as printed: its check digit is right.
      priceBars: ean13Modules(withCheckDigit("192019300700")),
    },
  );
}

// The first phone's browser has no reader of its own, and the WebAssembly
// one never arrives (as on a network that fails), so the scanner takes typed
// ISBNs there. Its fake camera starts without asking.
const context = await browser.newContext(phone);
await answerOutside(context);
await context.addInitScript(() => {
  delete window.BarcodeDetector;
});
const readerAsked = [];
await context.route("**/zxing/**", (route) => {
  readerAsked.push(route.request().url());
  return route.abort();
});
const page = settleBeforeNavigating(await context.newPage());
page.on("pageerror", (e) => errors.push(e.message));
async function check(name, run) {
  await run();
  passed.push(name);
  console.log("PASS " + name);
}
/** Waits until the page is the reader's, with the town read. */
async function hydrated(on = page) {
  await expect(on.locator("main")).toBeVisible();
  await on.waitForFunction(() => localStorage.getItem("book-town-v1"));
  // Saved data can exist before this page hydrates; wait until React owns the page.
  await on.waitForFunction(() =>
    Object.keys(document.querySelector("main") ?? {}).some((key) =>
      key.startsWith("__reactFiber"),
    ),
  );
}
async function go(route, on = page) {
  await on.goto(base + route);
  await hydrated(on);
}
const stored = (on = page) =>
  on.evaluate(() => JSON.parse(localStorage.getItem("book-town-v1")).data);
/** The demo reader's scan journal: its items, or null when it is empty. */
const journal = (on) =>
  on.evaluate(
    () =>
      JSON.parse(localStorage.getItem("book-town-library-journal:demo"))
        ?.items ?? null,
  );
/** The toasts shown since the last call. */
const toasts = (on = page) => on.evaluate(() => window.__toasts.splice(0));
const scanner = (on = page) =>
  on.getByRole("dialog", { name: "本を続けて登録" });
const count = (on) => scanner(on).locator(".scan-count");
const cardTitle = (on) => scanner(on).locator(".scan-card-title span");
const cardStatus = (on) => scanner(on).locator(".scan-card-status");
const field = (on) => scanner(on).getByLabel("ISBN", { exact: true });
/**
 * Typing begun on a phone: the field waits for a tap, with no keyboard over
 * the scanner, and the focus stays in it (journey-keyboard.mjs).
 */
const waitsForTap = (on = page) =>
  expectNoKeyboard(on, "typing ISBNs", scanner(on));
/** The profile's own 「本を登録」, beside the reader's name. */
async function openScanner(on = page) {
  if (await scanner(on).count()) return;
  await on
    .locator(".profile-minor-actions")
    .getByRole("button", { name: "本を登録" })
    .click();
  await expect(scanner(on)).toBeVisible();
}
async function finishScanning(on = page) {
  await scanner(on).getByRole("button", { name: "終わる" }).click();
  await expect(scanner(on)).toHaveCount(0);
}
/** Shows the camera these frames, and waits until they have left its view. */
async function show(on, ...frames) {
  await on.evaluate((codes) => {
    window.__emptyRun = 0;
    window.__barcodes.push(...codes);
  }, frames);
  await on.waitForFunction(
    () => window.__barcodes.length === 0 && window.__emptyRun >= 4,
  );
}
/** The vibrations and the number of tones so far. */
const feedback = (on) =>
  on.evaluate(() => ({ buzz: [...window.__buzz], tones: window.__tones }));
const cameraRunning = (on) =>
  on.waitForFunction(
    () => document.querySelector(".scan-session video")?.readyState >= 2,
  );
/**
 * Watches the scanner's card light up from now on. The answer: whether it
 * did since the last time asked.
 */
async function watchFlash(on) {
  await on.evaluate(() => {
    window.__flashed = false;
    new MutationObserver((changes) => {
      for (const change of changes)
        if (change.target.matches(".scan-card.is-flash"))
          window.__flashed = true;
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  });
  return () =>
    on.evaluate(() => {
      const was = window.__flashed;
      window.__flashed = false;
      return was;
    });
}
/** Until the card's last flash is over: a new one changes nothing before. */
const flashOver = (on) =>
  expect(scanner(on).locator(".scan-card")).not.toHaveClass(/is-flash/);
const dialog = () =>
  page.getByRole("dialog", { name: "本を登録", exact: true });
const message = () => dialog().locator(".register-message");
const registerButton = () =>
  dialog().getByRole("button", { name: "登録する", exact: true });
/** 「本を登録」, then ［手で入力］ in the scanner: the one-book form. */
async function openRegister() {
  await openScanner();
  await scanner().getByRole("button", { name: "手で入力" }).click();
  await expect(dialog()).toBeVisible();
}
/** The one-book form closed back to the scanner, saying so. */
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
      page
        .locator(".profile-library-head")
        .getByRole("button", { name: "本を登録" }),
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
      // The book entered by hand joins the scanner's count.
      await expect(count(page)).toHaveText("この回 1冊");
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
    "another ISBN takes the found book back out, so its title is not kept",
    async () => {
      await toasts();
      await openRegister();
      await dialog().getByLabel("ISBN").fill(KOKORO);
      await dialog().getByRole("button", { name: "ISBNで探す" }).click();
      await expect(message()).toHaveText("もうライブラリにあります。");
      await expect(dialog().getByLabel("タイトル")).toHaveValue("こころ");
      // What the reader changed by hand stays.
      await dialog().getByLabel("著者").fill("夏目 漱石");
      await dialog().getByLabel("ISBN").fill(MON);
      await expect(message()).toHaveCount(0);
      await expect(dialog().getByLabel("タイトル")).toHaveValue("");
      await expect(dialog().getByLabel("著者")).toHaveValue("夏目 漱石");
      await expect(registerButton()).toBeDisabled();
      await dialog().getByLabel("タイトル").fill("門");
      await registerButton().click();
      await registered("『門』を登録しました");
      const seen = await toasts();
      expect(
        seen.some((text) => text.includes("もうライブラリにあります")),
      ).toBe(false);
      const data = await stored();
      expect(data.library).toEqual([
        "isbn-" + KOKORO,
        "isbn-" + WHEEL,
        "isbn-" + MON,
      ]);
      expect(data.addedBooks).toContainEqual(
        expect.objectContaining({
          id: "isbn-" + MON,
          title: "門",
          author: "夏目 漱石",
          isbn: MON,
        }),
      );
      expect(
        data.addedBooks
          .filter((book) => book.title === "こころ")
          .map((book) => book.id),
      ).toEqual(["isbn-" + KOKORO]);
    },
  );

  await check(
    "a book the town knows, but not the library, is registered as usual",
    async () => {
      // ［終わる］ says what this time registered, and the library is there.
      await finishScanning();
      await expect(page.locator(".toast")).toContainText("3冊を登録しました");
      await page
        .getByRole("button", { name: "こころを登録した本から外す" })
        .click();
      await expect
        .poll(async () => (await stored()).library)
        .toEqual(["isbn-" + WHEEL, "isbn-" + MON]);
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
      expect(data.library).toEqual([
        "isbn-" + WHEEL,
        "isbn-" + MON,
        "isbn-" + KOKORO,
      ]);
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
      // The toast names the book as kept, not as openBD wrote it.
      await registered(`『${LONG_TITLE.slice(0, 199)}…』を登録しました`);
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

  await check(
    "the dialog fits 390px, and 戻る closes it, then the scanner",
    async () => {
      await openRegister();
      await dialog().getByLabel("ISBN").fill(WHEEL);
      const size = await page.evaluate(() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
      }));
      expect(size.width).toBe(390);
      expect(size.document).toBeLessThanOrEqual(size.width + 1);
      // Each place to press fits, and is at least 44px tall (plan 7-0).
      for (const target of [
        dialog().getByLabel("ISBN"),
        dialog().getByRole("button", { name: "ISBNで探す" }),
        registerButton(),
      ]) {
        await target.scrollIntoViewIfNeeded();
        const box = await target.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: path.join(output, "dialog-390.png") });
      // One 戻る for each layer: the form, then the scanner beneath it.
      await page.goBack();
      await expect(dialog()).toHaveCount(0);
      await expect(scanner()).toBeVisible();
      await page.goBack();
      await expect(scanner()).toHaveCount(0);
      await expect(page).toHaveURL(/\/profiles\/me\//);
      // Nothing was registered by closing.
      expect((await stored()).library).toHaveLength(4);
    },
  );

  await check(
    "with the reader not loaded, ISBNs are typed one after another",
    async () => {
      await toasts();
      await openScanner();
      const failed =
        "読み取りの準備ができませんでした。電波のよい所で［カメラで読む］をもう一度";
      await expect(scanner().locator(".scan-notes")).toContainText(failed);
      // Said once: the field's line, and why, with nothing more on the card.
      await expect(scanner().locator(".scan-notes")).toHaveText(
        "13桁そろうと登録します" + failed,
      );
      await expect(cardStatus()).toHaveText("");
      await expect(scanner()).not.toContainText("ISBNを続けて打");
      // The settings would not help here, so they are not mentioned.
      await expect(scanner()).not.toContainText("端末の設定");
      // Typing once the camera gives way: the keyboard waits for a tap on the
      // field, which is the reader's then.
      await waitsForTap();
      await expectTapWrites(field());
      await page.screenshot({
        path: path.join(output, "scan-reader-failed.png"),
      });
      // ［カメラで読む］ tries the reader again from the beginning.
      const asked = readerAsked.length;
      expect(asked).toBeGreaterThan(0);
      await scanner().getByRole("button", { name: "カメラで読む" }).click();
      await expect.poll(() => readerAsked.length).toBeGreaterThan(asked);
      await expect(scanner().locator(".scan-notes")).toContainText(failed);
      await waitsForTap();
      // Thirteen digits register at once, and the field is ready for the next.
      const typed = isbnOf(41);
      await field().pressSequentially(typed);
      await expect(cardTitle()).toHaveText("試験の本 41");
      await expect(cardStatus()).toHaveText("登録しました");
      await expect(field()).toHaveValue("");
      await expect(field()).toBeFocused();
      // An ISBN-10 is taken with Enter.
      const ten = isbnOf(42);
      await field().fill(isbn10Of(ten));
      await field().press("Enter");
      await expect(cardTitle()).toHaveText("試験の本 42");
      await expect(count()).toHaveText("この回 2冊");
      // A code that does not check out stays, to be corrected.
      const wrong = typed.slice(0, 12) + ((Number(typed[12]) + 1) % 10);
      await field().fill(wrong);
      await expect(scanner().locator(".scan-notes")).toContainText(
        "ISBNとして読めませんでした",
      );
      await expect(field()).toHaveValue(wrong);
      await expect(count()).toHaveText("この回 2冊");
      const data = await stored();
      expect(data.library).toEqual(
        expect.arrayContaining(["isbn-" + typed, "isbn-" + ten]),
      );
      expect(data.library).toHaveLength(6);
      await finishScanning();
      await expect(page.locator(".toast")).toContainText("2冊を登録しました");
    },
  );

  await check(
    "on a phone, the scanner's buttons and ［手で入力］ leave the keyboard down until a field is tapped",
    async () => {
      expect(await coarse(page)).toBe(true);
      await openScanner();
      await waitsForTap();
      await expect(
        scanner().getByRole("button", { name: "閉じる" }),
      ).toBeFocused();
      // ♪ beside a field not tapped yet does not put the keyboard up.
      const sound = scanner().getByRole("button", { name: "音" });
      await sound.tap();
      await waitsForTap();
      await sound.tap();
      await expect(sound).toHaveAttribute("aria-pressed", "true");
      // Typing in it, the field is the reader's: a code that does not check
      // out is marked and chosen there, to be typed again.
      await expectTapWrites(field());
      const typed = isbnOf(43);
      await page.keyboard.type(
        typed.slice(0, 12) + ((Number(typed[12]) + 1) % 10),
      );
      await expect(scanner().locator(".scan-notes")).toContainText(
        "ISBNとして読めませんでした",
      );
      await expect(field()).toBeFocused();
      await expect(field()).toHaveAttribute("aria-invalid", "true");
      await expect
        .poll(() =>
          field().evaluate(
            (input) => input.selectionEnd - input.selectionStart,
          ),
        )
        .toBe(13);
      await page.keyboard.type("9");
      await expect(field()).toHaveValue("9");
      await expect(field()).not.toHaveAttribute("aria-invalid");
      await field().fill("");
      // The one-book form opens without the keyboard too, and closing it
      // gives the focus back to the button that opened it.
      const byHand = scanner().getByRole("button", { name: "手で入力" });
      await byHand.tap();
      await expectNoKeyboard(page, "本を登録", dialog());
      await expectTapWrites(dialog().getByLabel("ISBN"));
      await dialog().getByRole("button", { name: "閉じる" }).tap();
      await expect(dialog()).toHaveCount(0);
      await expect(byHand).toBeFocused();
      await finishScanning();
    },
  );

  // The scanner on a phone that reads barcodes.
  const scan = await scanningPage();
  const inLibrary = new Set();
  const libraryNow = async () => (await stored(scan)).library;
  const expectLibrary = () =>
    expect
      .poll(async () => [...(await libraryNow())].sort())
      .toEqual([...inLibrary].sort());
  await go("/profiles/me/?books=library", scan);
  const before = await stored(scan);

  await check(
    "「本を登録」 opens the camera at once, with no 0 anywhere",
    async () => {
      await openScanner(scan);
      await cameraRunning(scan);
      await expect(scanner(scan).locator(".scan-guide")).toHaveText(
        "上の段（978…）を枠に",
      );
      // Said once: the card says what a read does.
      await expect(cardStatus(scan)).toHaveText("読むと、その場で登録します");
      // Nothing is counted before the first book.
      await expect(count(scan)).toHaveText("");
      await expect(scanner(scan)).not.toContainText(/(^|\D)0(冊|件)/);
      await scan.screenshot({ path: path.join(output, "scan-first.png") });
    },
  );

  const twenty = Array.from({ length: 20 }, (_, at) => isbnOf(at + 1));
  await check("twenty books in a row, with no tap between", async () => {
    await show(scan, ...twenty);
    await expect(count(scan)).toHaveText("この回 20冊", { timeout: 15000 });
    await expect(scanner(scan).locator(".scan-spine.is-added")).toHaveCount(20);
    for (const isbn of twenty) inLibrary.add("isbn-" + isbn);
    await expectLibrary();
    const data = await stored(scan);
    expect(data.library).toHaveLength(20);
    for (const isbn of twenty)
      expect(data.addedBooks.filter((book) => book.isbn === isbn)).toHaveLength(
        1,
      );
    // The last read is on the card, with its title.
    await expect(cardTitle(scan)).toHaveText("試験の本 20");
    await expect(cardStatus(scan)).toHaveText("登録しました");
  });

  await check(
    "the price code under an ISBN is passed over, and read alone gets a hint",
    async () => {
      // In one frame with an ISBN, only the ISBN counts.
      const isbn = isbnOf(21);
      await show(scan, [isbn, PRICE]);
      await expect(count(scan)).toHaveText("この回 21冊");
      inLibrary.add("isbn-" + isbn);
      await expectLibrary();
      const guide = scanner(scan).locator(".scan-guide");
      await expect(guide).toHaveText("上の段（978…）を枠に");
      const kept = await journal(scan);
      // Alone: the first read is let go, the second says what to read, in
      // a mark of its own rather than the guide's words.
      await show(scan, PRICE);
      await expect(guide).toHaveText("上の段（978…）を枠に");
      await expect(guide).not.toHaveClass(/is-hint/);
      await show(scan, PRICE);
      await expect(guide).toHaveText(
        "上の段のバーコード（978…）を読んでください",
      );
      await expect(guide).toHaveClass(/is-hint/);
      await expect(count(scan)).toHaveText("この回 21冊");
      await expectLibrary();
      expect(await journal(scan)).toEqual(kept);
    },
  );

  const untitled = isbnOf(901);
  const known = isbnOf(22);
  await check(
    "a book openBD does not know is kept as 書名待ち, and the next one registers",
    async () => {
      await show(scan, untitled);
      await expect(cardTitle(scan)).toHaveText("書名がわからない本");
      await expect(cardStatus(scan)).toHaveText(
        `${untitled}・控えに置きました`,
      );
      await expect(count(scan)).toHaveText("この回 21冊・書名待ち 1冊");
      await expect(scanner(scan).locator(".scan-spine.is-kept")).toHaveCount(1);
      await show(scan, known);
      await expect(cardTitle(scan)).toHaveText("試験の本 22");
      await expect(count(scan)).toHaveText("この回 22冊・書名待ち 1冊");
      inLibrary.add("isbn-" + known);
      await expectLibrary();
      // On this device only: in the journal, and in no stored book.
      expect(await journal(scan)).toEqual([
        expect.objectContaining({ isbn: untitled, state: "untitled" }),
      ]);
      expect(
        (await stored(scan)).addedBooks.some((book) => book.isbn === untitled),
      ).toBe(false);
    },
  );

  const undoKnown = () =>
    scanner(scan).getByRole("button", {
      name: "試験の本 22の登録を取り消す",
    });
  await check(
    "［取り消す］ takes the last book back out, and it can be read again",
    async () => {
      await undoKnown().click();
      await expect(cardStatus(scan)).toHaveText("取り消しました");
      await expect(count(scan)).toHaveText("この回 21冊・書名待ち 1冊");
      await expect(scanner(scan).locator(".scan-spine.is-added")).toHaveCount(
        21,
      );
      inLibrary.delete("isbn-" + known);
      await expectLibrary();
      expect((await journal(scan)).some((item) => item.isbn === known)).toBe(
        false,
      );
      // Read again, it is a new book again.
      await show(scan, known);
      await expect(cardStatus(scan)).toHaveText("登録しました");
      await expect(count(scan)).toHaveText("この回 22冊・書名待ち 1冊");
      inLibrary.add("isbn-" + known);
      await expectLibrary();
      // Taken out once more: the town knows it, the library does not.
      await undoKnown().click();
      await expect(count(scan)).toHaveText("この回 21冊・書名待ち 1冊");
      inLibrary.delete("isbn-" + known);
      await expectLibrary();
    },
  );

  const offline = isbnOf(23);
  await check(
    "offline, a known book registers at once and an unknown one waits for the network",
    async () => {
      await scan.context().setOffline(true);
      await expect(scanner(scan).locator(".scan-banner")).toContainText(
        "オフラインです",
      );
      await show(scan, known);
      await expect(cardTitle(scan)).toHaveText("試験の本 22");
      await expect(cardStatus(scan)).toHaveText("登録しました");
      await expect(count(scan)).toHaveText("この回 22冊・書名待ち 1冊");
      inLibrary.add("isbn-" + known);
      await expectLibrary();
      await show(scan, offline);
      await expect(cardStatus(scan)).toHaveText(
        `${offline}・つながったら書名を調べます`,
      );
      await expect(count(scan)).toHaveText("この回 22冊・書名待ち 2冊");
      // Back online, it is looked up and registered.
      await scan.context().setOffline(false);
      await expect(cardTitle(scan)).toHaveText("試験の本 23");
      await expect(cardStatus(scan)).toHaveText("登録しました");
      await expect(count(scan)).toHaveText("この回 23冊・書名待ち 1冊");
      await expect(scanner(scan).locator(".scan-banner")).toHaveCount(0);
      inLibrary.add("isbn-" + offline);
      await expectLibrary();
    },
  );

  await check("the scanner fits 390px, typing too", async () => {
    const size = await scan.evaluate(() => ({
      width: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(size.width).toBe(390);
    expect(size.document).toBeLessThanOrEqual(size.width + 1);
    const inside = async (target, height = 844) => {
      const box = await restingBox(target);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      return box;
    };
    await inside(count(scan));
    await inside(scanner(scan).locator(".scan-card"));
    // Each place to press is at least 44px tall (plan 7-0).
    const buttons = [
      scanner(scan).getByRole("button", {
        name: "試験の本 23の登録を取り消す",
      }),
      scanner(scan).getByRole("button", { name: "終わる" }),
      scanner(scan).getByRole("button", { name: "ISBNを打つ" }),
      scanner(scan).getByRole("button", { name: "手で入力" }),
      scanner(scan).getByRole("button", { name: "閉じる" }),
      scanner(scan).getByRole("button", { name: "音" }),
    ];
    for (const button of buttons)
      expect((await inside(button)).height).toBeGreaterThanOrEqual(44);
    await scan.screenshot({ path: path.join(output, "scan-390.png") });
    // ［ISBNを打つ］ is the reader asking to type: the field takes the focus
    // within the tap, so the keyboard rises with it. (Typing begun by the
    // scanner itself waits for a tap: no camera, refused, no reader.)
    await scanner(scan).getByRole("button", { name: "ISBNを打つ" }).tap();
    await expectKeyboardUp(scan, field(scan), "ISBNを打つ");
    await expect(scanner(scan)).toContainText("13桁そろうと登録します");
    // Typing, with the keyboard taking half the screen: the field, the card
    // and ［終わる］ stay in what is left.
    // On a phone nothing of the page shows past the sheet: it is the page's
    // own paper, with nothing see-through.
    const [sheet, paper] = await scanner(scan).evaluate((layer) => [
      getComputedStyle(layer).backgroundColor,
      getComputedStyle(document.documentElement).backgroundColor,
    ]);
    expect(sheet).toMatch(/^rgb\(/);
    expect(sheet).toBe(paper);
    await scan.setViewportSize({ width: 390, height: 420 });
    for (const target of [
      field(scan),
      scanner(scan).getByRole("button", { name: "登録", exact: true }),
      scanner(scan).getByRole("button", { name: "終わる" }),
    ])
      expect((await inside(target, 420)).height).toBeGreaterThanOrEqual(44);
    await inside(scanner(scan).locator(".scan-card"), 420);
    await scan.screenshot({ path: path.join(output, "scan-typing-420.png") });
    await scan.setViewportSize({ width: 390, height: 844 });
    await scanner(scan).getByRole("button", { name: "カメラで読む" }).click();
    await expect(scanner(scan).locator(".scan-guide")).toBeVisible();
  });

  await check(
    "［終わる］ closes at once, says what was read in, and lands on the library",
    async () => {
      await toasts(scan);
      const counted = /^この回 (\d+)冊・書名待ち 1冊$/.exec(
        await count(scan).innerText(),
      );
      expect(counted).not.toBeNull();
      await scanner(scan).getByRole("button", { name: "終わる" }).click();
      // No question first.
      await expect(scan.getByRole("dialog")).toHaveCount(0);
      await expect(scan.locator(".toast")).toContainText(
        `${counted[1]}冊を登録しました・書名待ち 1冊`,
      );
      expect(Number(counted[1])).toBe(inLibrary.size);
      await expect(scan).toHaveURL(/[?&]books=library/);
      const waiting = scan
        .locator(".journal-note")
        .filter({ hasText: "書名待ち 1冊" });
      await expect(waiting).toBeInViewport();
      await expect(
        waiting.getByRole("button", { name: "書名を入れる" }),
      ).toBeVisible();
      await expect(
        scan.getByRole("button", { name: /^登録/, pressed: true }),
      ).toBeFocused();
      await expectLibrary();
      // Nothing was asked about the books, and nothing else changed.
      const after = await stored(scan);
      for (const key of [
        "wishlist",
        "favorites",
        "finishedBooks",
        "readingSessions",
        "ownShop",
        "posts",
      ])
        expect(after[key], key).toEqual(before[key]);
      await scan.screenshot({ path: path.join(output, "scan-landed.png") });
    },
  );

  await check(
    "a title typed for a 書名待ち book registers it, and the line goes",
    async () => {
      await scan.getByRole("button", { name: "書名を入れる" }).click();
      const titles = scan.getByRole("dialog", { name: "書名を入れる" });
      await expect(titles).toContainText("ISBN " + untitled);
      // On a phone the sheet opens without the keyboard over it.
      await expectNoKeyboard(scan, "書名を入れる", titles);
      await expectTapWrites(titles.getByLabel("タイトル"));
      await titles.getByLabel("タイトル").fill("控えの本");
      await titles.getByRole("button", { name: "登録する" }).click();
      await expect(scan.locator(".toast")).toContainText(
        "『控えの本』を登録しました",
      );
      await expect(titles).toHaveCount(0);
      await expect(scan.locator(".journal-notes")).toHaveCount(0);
      await expect(scan.locator("main")).not.toContainText("書名待ち");
      inLibrary.add("isbn-" + untitled);
      await expectLibrary();
      expect(await journal(scan)).toBeNull();
    },
  );

  await check(
    "戻る closes the scanner in one step, and the next leaves the page",
    async () => {
      await go("/", scan);
      await go("/profiles/me/?books=library", scan);
      await toasts(scan);
      await openScanner(scan);
      await cameraRunning(scan);
      // A book in the library already: said, with the other sound, and
      // nothing written or counted.
      const kept = await stored(scan);
      await show(scan, twenty[0]);
      await expect(cardTitle(scan)).toHaveText("試験の本 1");
      await expect(cardStatus(scan)).toHaveText("もうライブラリにあります");
      await expect(count(scan)).toHaveText("");
      expect(await stored(scan)).toEqual(kept);
      expect(await journal(scan)).toBeNull();
      expect((await feedback(scan)).buzz).toEqual([[20, 60, 20]]);
      const isbn = isbnOf(24);
      await show(scan, isbn);
      await expect(count(scan)).toHaveText("この回 1冊");
      await scan.goBack();
      await expect(scanner(scan)).toHaveCount(0);
      await expect(scan).toHaveURL(/\/profiles\/me\//);
      await expect(scan.locator(".toast")).toContainText("1冊を登録しました");
      inLibrary.add("isbn-" + isbn);
      await expectLibrary();
      await scan.goBack();
      await expect(scan).toHaveURL(base + "/");
    },
  );

  await check(
    "closed by hand from another tab, the scanner leaves no step behind",
    async () => {
      await go("/profiles/me/", scan);
      const wishTab = scan
        .locator(".profile-collection-tabs")
        .getByRole("button", { name: /^読みたい/ });
      await expect(wishTab).toHaveAttribute("aria-pressed", "true");
      // Nothing read: ✕ leaves the tab and the history as they were.
      await openScanner(scan);
      await scanner(scan).getByRole("button", { name: "閉じる" }).click();
      await expect(scanner(scan)).toHaveCount(0);
      await expect(wishTab).toHaveAttribute("aria-pressed", "true");
      await expect(scan).toHaveURL(base + "/profiles/me/");
      // A book read: ［終わる］ lands on the 登録 tab, the book first, and
      // one 戻る leaves the profile.
      await openScanner(scan);
      await cameraRunning(scan);
      const isbn = isbnOf(29);
      await show(scan, isbn);
      await expect(count(scan)).toHaveText("この回 1冊");
      await finishScanning(scan);
      await expect(scan.locator(".toast")).toContainText("1冊を登録しました");
      await expect(scan).toHaveURL(/[?&]books=library/);
      await expect(
        scan.getByRole("button", { name: /^登録/, pressed: true }),
      ).toBeFocused();
      await expect(scan.locator(".profile-saved-book").first()).toContainText(
        "試験の本 29",
      );
      await expect(
        scan.locator(".profile-saved-book").first(),
      ).toBeInViewport();
      inLibrary.add("isbn-" + isbn);
      await expectLibrary();
      await scan.goBack();
      await expect(scan).toHaveURL(base + "/");
    },
  );

  await check("♪ off is remembered on this device", async () => {
    await go("/profiles/me/?books=library", scan);
    await openScanner(scan);
    const sound = scanner(scan).getByRole("button", { name: "音" });
    await expect(sound).toHaveAttribute("aria-pressed", "true");
    await sound.click();
    await expect(sound).toHaveAttribute("aria-pressed", "false");
    await expect(sound).toContainText("オフ");
    await scan.reload();
    await hydrated(scan);
    await openScanner(scan);
    await expect(sound).toHaveAttribute("aria-pressed", "false");
    await cameraRunning(scan);
  });

  await check(
    "books read before the tab closed are registered when it opens again",
    async () => {
      // The town can no longer be saved in this tab, as when it is closed
      // before the save: the books are in the journal only.
      await scan.evaluate(() => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "book-town-v1")
            throw new DOMException("full", "QuotaExceededError");
          return setItem.call(this, key, value);
        };
      });
      const read = [25, 26, 27].map(isbnOf);
      const before = await feedback(scan);
      await show(scan, ...read);
      await expect(count(scan)).toHaveText("この回 3冊");
      // ♪ is off: a vibration for each book, and no sound.
      const after = await feedback(scan);
      expect(after.buzz).toEqual([...before.buzz, 30, 30, 30]);
      expect(after.tones).toBe(before.tones);
      // And one whose title openBD is still being asked for: after four
      // seconds the card says so, and the next book can be read.
      openBd = "stall";
      const asking = isbnOf(28);
      await show(scan, asking);
      await expect(cardTitle(scan)).toHaveText("書名がわからない本", {
        timeout: 8000,
      });
      await expect(cardStatus(scan)).toHaveText(`${asking}・控えに置きました`);
      await expect(count(scan)).toHaveText("この回 3冊・書名待ち 1冊");
      await expect
        .poll(async () =>
          ((await journal(scan)) ?? []).map((item) => item.state).sort(),
        )
        .toEqual(["lookup", "registered", "registered", "registered"]);
      expect(await libraryNow()).not.toContain("isbn-" + read[0]);
      openBd = "answer";
      await scan.reload();
      await hydrated(scan);
      await scan.waitForFunction(() =>
        window.__toasts.includes("前回のスキャンの続き 4冊を登録しました"),
      );
      for (const isbn of [...read, asking]) inLibrary.add("isbn-" + isbn);
      await expectLibrary();
      const data = await stored(scan);
      for (const isbn of [...read, asking]) {
        expect(data.library.filter((id) => id === "isbn-" + isbn)).toHaveLength(
          1,
        );
        expect(
          data.addedBooks.filter((book) => book.isbn === isbn),
        ).toHaveLength(1);
      }
      expect(await journal(scan)).toBeNull();
      // Once only.
      await scan.reload();
      await hydrated(scan);
      await expect(
        scan.getByRole("button", { name: /^登録/, pressed: true }),
      ).toBeVisible();
      expect(
        (await toasts(scan)).some((text) => text.includes("前回のスキャン")),
      ).toBe(false);
      expect(await journal(scan)).toBeNull();
    },
  );

  await check(
    "with the camera refused or missing, ISBNs are typed, and why is said",
    async () => {
      const refused = await scanningPage();
      await refused.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () =>
          Promise.reject(new DOMException("denied", "NotAllowedError"));
      });
      await go("/profiles/me/?books=library", refused);
      await openScanner(refused);
      await expect(scanner(refused).locator(".scan-notes")).toHaveText(
        "13桁そろうと登録しますカメラが使えませんカメラは端末の設定で許可できます",
      );
      await expect(scanner(refused)).toContainText(
        "カメラは端末の設定で許可できます",
      );
      await expect(
        scanner(refused).getByRole("button", { name: "カメラで読む" }),
      ).toHaveCount(0);
      await waitsForTap(refused);
      // ［終わる］ is wide, and in the bottom third of the screen (plan 7-0).
      const end = await restingBox(
        scanner(refused).getByRole("button", { name: "終わる" }),
      );
      expect(end.y).toBeGreaterThanOrEqual((844 * 2) / 3);
      expect(end.width).toBeGreaterThan(390 / 2);
      await refused.screenshot({ path: path.join(output, "scan-refused.png") });
      await field(refused).fill(isbnOf(30));
      await expect(cardTitle(refused)).toHaveText("試験の本 30");
      await expect(cardStatus(refused)).toHaveText("登録しました");
      await expect(count(refused)).toHaveText("この回 1冊");
      // The Escape that cancels a kana conversion in the field is the
      // keyboard's, as in every dialog: the scanner and the digits stay.
      await field(refused).fill("９７８");
      await field(refused).evaluate((input) =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            keyCode: 229,
            isComposing: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      await expect(scanner(refused)).toBeVisible();
      await expect(field(refused)).toHaveValue("９７８");
      await field(refused).press("Escape");
      await expect(scanner(refused)).toHaveCount(0);
      await refused.context().close();
      // No camera at all, after one more try without asking for the back
      // one (plan 10-8): said, and the camera is not offered again.
      const none = await scanningPage();
      await none.addInitScript(() => {
        window.__asked = 0;
        navigator.mediaDevices.getUserMedia = () => {
          window.__asked += 1;
          return Promise.reject(new DOMException("none", "NotFoundError"));
        };
      });
      await go("/profiles/me/?books=library", none);
      await openScanner(none);
      await expect(scanner(none).locator(".scan-notes")).toHaveText(
        "13桁そろうと登録しますカメラが見つかりません",
      );
      await expect(
        scanner(none).getByRole("button", { name: "カメラで読む" }),
      ).toHaveCount(0);
      await expect(scanner(none)).not.toContainText("端末の設定");
      expect(await none.evaluate(() => window.__asked)).toBe(2);
      await none.context().close();
    },
  );

  await check(
    "a reader failing five frames in a row gives way to typing, and ［カメラで読む］ reads again",
    async () => {
      const failing = await scanningPage();
      await go("/profiles/me/?books=library", failing);
      await openScanner(failing);
      await cameraRunning(failing);
      // Four frames unread, then a book: it goes on.
      await failing.evaluate(() => (window.__throws = 4));
      await failing.waitForFunction(() => window.__throws === 0);
      await show(failing, isbnOf(34));
      await expect(cardStatus(failing)).toHaveText("登録しました");
      await expect(scanner(failing).locator(".scan-guide")).toBeVisible();
      // Five in a row: the reader is not working.
      await failing.evaluate(() => (window.__throws = 5));
      await expect(scanner(failing).locator(".scan-notes")).toContainText(
        "読み取りの準備ができませんでした",
      );
      await waitsForTap(failing);
      await scanner(failing)
        .getByRole("button", { name: "カメラで読む" })
        .click();
      await cameraRunning(failing);
      await show(failing, isbnOf(35));
      await expect(cardTitle(failing)).toHaveText("試験の本 35");
      await expect(count(failing)).toHaveText("この回 2冊");
      await failing.context().close();
    },
  );

  await check(
    "a 書名待ち book entered by hand is in, and ［終わる］ waits for openBD",
    async () => {
      const typing = await scanningPage();
      await typing.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () =>
          Promise.reject(new DOMException("denied", "NotAllowedError"));
      });
      await go("/profiles/me/?books=library", typing);
      await openScanner(typing);
      const unknown = isbnOf(902);
      await field(typing).fill(unknown);
      await expect(cardTitle(typing)).toHaveText("書名がわからない本");
      await expect(count(typing)).toHaveText("書名待ち 1冊");
      // ［手で入力］ over the scanner offers no second camera.
      await scanner(typing).getByRole("button", { name: "手で入力" }).click();
      const form = typing.getByRole("dialog", {
        name: "本を登録",
        exact: true,
      });
      await expect(form).toContainText(
        "ISBNがあれば探せます。書名だけでも登録できます。",
      );
      await expect(form).not.toContainText("読み取ります");
      await expect(
        form.getByRole("button", { name: "カメラで読み取る" }),
      ).toHaveCount(0);
      await form.getByLabel("ISBN").fill(unknown);
      await form.getByLabel("タイトル").fill("手で入れた本");
      await form.getByRole("button", { name: "登録する", exact: true }).click();
      await expect(form).toHaveCount(0);
      // The book read before is that book: no 書名待ち left anywhere.
      await expect(count(typing)).toHaveText("この回 1冊");
      await expect.poll(() => journal(typing)).toBeNull();
      await expect(typing.locator(".journal-note")).toHaveCount(0);
      // A title still on its way from openBD as the scanner closes: the
      // notice waits for it, and the 登録 tab never shows it as 書名待ち.
      await typing.evaluate(() => {
        window.__noted = false;
        new MutationObserver(() => {
          if (document.querySelector(".journal-note")) window.__noted = true;
        }).observe(document.body, { childList: true, subtree: true });
      });
      openBd = "slow";
      const slow = isbnOf(33);
      await field(typing).fill(slow);
      await expect(cardStatus(typing)).toHaveText("書名を調べています…");
      await toasts(typing);
      await finishScanning(typing);
      await typing.waitForFunction(() =>
        window.__toasts.includes("2冊を登録しました"),
      );
      expect(await typing.evaluate(() => window.__noted)).toBe(false);
      expect(
        (await toasts(typing)).filter((text) => text.includes("控え")),
      ).toEqual([]);
      await expect(typing.locator(".journal-note")).toHaveCount(0);
      expect((await stored(typing)).library).toEqual(
        expect.arrayContaining(["isbn-" + unknown, "isbn-" + slow]),
      );
      expect(await journal(typing)).toBeNull();
      openBd = "answer";
      await typing.context().close();
    },
  );

  await check(
    "the same book within 3 seconds is one read; later it was put in already",
    async () => {
      const timed = await scanningPage();
      // Date is fixed; timers keep running. The 3 seconds pass when it moves.
      const start = Date.now();
      await timed.clock.setFixedTime(start);
      await go("/profiles/me/?books=library", timed);
      await openScanner(timed);
      await cameraRunning(timed);
      const [first, second] = [isbnOf(31), isbnOf(32)];
      // Every read flashes the card: an iPhone neither vibrates nor, on
      // silent, sounds.
      const flashed = await watchFlash(timed);
      await show(timed, first);
      await expect(count(timed)).toHaveText("この回 1冊");
      await expect(cardStatus(timed)).toHaveText("登録しました");
      await expect.poll(flashed).toBe(true);
      // In: one short vibration, and a tone (♪ is on).
      await expect.poll(async () => (await feedback(timed)).buzz).toEqual([30]);
      const sounded = await feedback(timed);
      expect(sounded.tones).toBeGreaterThan(0);
      const kept = await stored(timed);
      // Past the first flash, within the 3 seconds.
      await timed.clock.setFixedTime(start + 900);
      await show(timed, first);
      await expect(cardStatus(timed)).toHaveText("同じ本です");
      await expect.poll(flashed).toBe(true);
      await expect(count(timed)).toHaveText("この回 1冊");
      expect(await stored(timed)).toEqual(kept);
      // Within 3 seconds: no sound, no vibration.
      expect(await feedback(timed)).toEqual(sounded);
      await timed.clock.setFixedTime(start + 4000);
      await flashOver(timed);
      await flashed();
      await show(timed, first);
      await expect(cardStatus(timed)).toHaveText("この回でもう入れました");
      await expect.poll(flashed).toBe(true);
      // Later: the other vibration, and the two lower tones.
      const again = await feedback(timed);
      expect(again.buzz).toEqual([30, [20, 60, 20]]);
      expect(again.tones).toBe(sounded.tones + 2);
      // Another book between does not make it new either.
      await show(timed, second);
      await expect(count(timed)).toHaveText("この回 2冊");
      await show(timed, first);
      await expect(cardStatus(timed)).toHaveText("この回でもう入れました");
      await expect(count(timed)).toHaveText("この回 2冊");
      expect((await stored(timed)).library).toEqual([
        "isbn-" + first,
        "isbn-" + second,
      ]);
      await timed.context().close();
    },
  );

  await check(
    "with no WebAssembly either, the browser cannot read barcodes",
    async () => {
      const bare = await browser.newContext(phone);
      await answerOutside(bare);
      await bare.addInitScript(() => {
        delete window.BarcodeDetector;
        delete window.WebAssembly;
        window.__asked = 0;
        navigator.mediaDevices.getUserMedia = () => {
          window.__asked += 1;
          return Promise.reject(new DOMException("none", "NotFoundError"));
        };
      });
      const on = settleBeforeNavigating(await bare.newPage());
      on.on("pageerror", (e) => errors.push(e.message));
      await go("/profiles/me/?books=library", on);
      await openScanner(on);
      await expect(scanner(on).locator(".scan-notes")).toHaveText(
        "13桁そろうと登録しますこのブラウザはバーコードを読み取れません",
      );
      await expect(
        scanner(on).getByRole("button", { name: "カメラで読む" }),
      ).toHaveCount(0);
      await waitsForTap(on);
      // The camera is not asked for, for nothing.
      expect(await on.evaluate(() => window.__asked)).toBe(0);
      await bare.close();
    },
  );

  await check(
    "on an iPhone, ZXing in WebAssembly reads a book on the camera",
    async () => {
      const book = isbnOf(61);
      const zxing = await browser.newContext({
        ...phone,
        userAgent: IPHONE_SAFARI,
        permissions: ["camera"],
      });
      await answerOutside(zxing);
      // WebKit's own reader, turned on in Safari's settings, says it reads
      // EAN-13 and reads nothing: only ZXing can register the book.
      await zxing.addInitScript(() => {
        window.BarcodeDetector = class {
          static async getSupportedFormats() {
            return ["ean_13", "qr_code"];
          }
          async detect() {
            return [];
          }
        };
      });
      await bookCamera(zxing, book);
      const on = settleBeforeNavigating(await zxing.newPage());
      on.on("pageerror", (e) => errors.push(e.message));
      const fetched = [];
      on.on("response", (response) => {
        if (response.url().includes("/zxing/"))
          fetched.push([new URL(response.url()).pathname, response.status()]);
      });
      await go("/profiles/me/?books=library", on);
      // A phone (pointer: coarse): the camera opens at once.
      await openScanner(on);
      await expect(scanner(on).locator(".scan-guide")).toHaveText(
        "上の段（978…）を枠に",
      );
      await expect(count(on)).toHaveText("この回 1冊", { timeout: 15000 });
      await expect(cardTitle(on)).toHaveText("試験の本 61");
      await expect(cardStatus(on)).toHaveText("登録しました");
      // The price code under it is passed over, and nothing is said of it.
      await expect(scanner(on).locator(".scan-guide")).not.toHaveClass(
        /is-hint/,
      );
      await on.screenshot({ path: path.join(output, "scan-zxing.png") });
      expect((await stored(on)).library).toEqual(["isbn-" + book]);
      // Held in view, it is one book.
      await on.waitForTimeout(1500);
      await expect(count(on)).toHaveText("この回 1冊");
      // From this site, once; and a larger picture was asked for.
      expect(fetched).toEqual([
        [expect.stringMatching(/^\/zxing\/zxing_reader-[\d.]+\.wasm$/), 200],
      ]);
      const asked = await on.evaluate(() => window.__asked);
      expect(asked[0].video).toEqual(
        expect.objectContaining({
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        }),
      );
      // Reopened, the reader is the one already loaded, and the book read
      // again lights the card up too.
      await finishScanning(on);
      const flashed = await watchFlash(on);
      await openScanner(on);
      await expect(cardStatus(on)).toHaveText("もうライブラリにあります", {
        timeout: 15000,
      });
      await expect.poll(flashed).toBe(true);
      expect(fetched).toHaveLength(1);
      expect((await stored(on)).library).toEqual(["isbn-" + book]);
      await finishScanning(on);
      await zxing.close();
    },
  );

  await check(
    "a browser's own reader without EAN-13 gives way to ZXing, with the larger picture",
    async () => {
      const book = isbnOf(62);
      const other = await browser.newContext({
        ...phone,
        permissions: ["camera"],
      });
      await answerOutside(other);
      // Chrome on an Android phone without Google's services: a reader of
      // its own, for QR codes only.
      await other.addInitScript(() => {
        window.__ownReads = 0;
        window.BarcodeDetector = class {
          static async getSupportedFormats() {
            return ["qr_code"];
          }
          async detect() {
            window.__ownReads += 1;
            return [];
          }
        };
      });
      await bookCamera(other, book);
      const on = settleBeforeNavigating(await other.newPage());
      on.on("pageerror", (e) => errors.push(e.message));
      await go("/profiles/me/?books=library", on);
      await openScanner(on);
      await expect(count(on)).toHaveText("この回 1冊", { timeout: 15000 });
      await expect(cardTitle(on)).toHaveText("試験の本 62");
      // Asked for at the size kept for the browser's own reader, the camera
      // is given ZXing's larger picture once ZXing is the one reading.
      const seen = await on.evaluate(() => ({
        asked: window.__asked,
        applied: window.__applied,
        ownReads: window.__ownReads,
      }));
      expect(seen.asked).toHaveLength(1);
      expect(seen.asked[0].video).not.toHaveProperty("width");
      expect(seen.applied).toContainEqual(
        expect.objectContaining({
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        }),
      );
      expect(seen.ownReads).toBe(0);
      await finishScanning(on);
      await other.close();
    },
  );

  await check(
    "closed while the reader loads, the camera is let go at once",
    async () => {
      const slow = await browser.newContext({
        ...phone,
        permissions: ["camera"],
      });
      await answerOutside(slow);
      // The WebAssembly is held back until let through, as on a slow network.
      let letThrough;
      const held = new Promise((resolve) => (letThrough = resolve));
      await slow.route("**/zxing/**", async (route) => {
        await held;
        await route.continue().catch(() => {});
      });
      // Every camera given out, to see whether it is still on; and, with
      // `__takenAfter` set, one that another app takes that long after.
      await slow.addInitScript(() => {
        delete window.BarcodeDetector;
        window.__streams = [];
        window.__takenAfter = null;
        const ask = navigator.mediaDevices.getUserMedia.bind(
          navigator.mediaDevices,
        );
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          const stream = await ask(constraints);
          window.__streams.push(stream);
          if (window.__takenAfter !== null)
            setTimeout(() => {
              const track = stream.getVideoTracks()[0];
              track.stop();
              track.dispatchEvent(new Event("ended"));
            }, window.__takenAfter);
          return stream;
        };
      });
      const on = settleBeforeNavigating(await slow.newPage());
      on.on("pageerror", (e) => errors.push(e.message));
      const cameras = () =>
        on.evaluate(() =>
          window.__streams.map(
            (stream) => stream.getVideoTracks()[0].readyState,
          ),
        );
      await go("/profiles/me/?books=library", on);
      // ［終わる］ while the reader loads: the camera goes with the scanner.
      await openScanner(on);
      await expect.poll(cameras).toEqual(["live"]);
      await expect(scanner(on).locator(".scan-camera-note")).toHaveText(
        "カメラを起動しています…",
      );
      await finishScanning(on);
      await expect.poll(cameras, { timeout: 2000 }).toEqual(["ended"]);
      // ［ISBNを打つ］ too.
      await openScanner(on);
      await expect.poll(cameras).toEqual(["ended", "live"]);
      await scanner(on).getByRole("button", { name: "ISBNを打つ" }).click();
      await expect(field(on)).toBeFocused();
      await expect.poll(cameras, { timeout: 2000 }).toEqual(["ended", "ended"]);
      // Taken by another app meanwhile: typed instead, then and there.
      await on.evaluate(() => (window.__takenAfter = 300));
      await scanner(on).getByRole("button", { name: "カメラで読む" }).click();
      await expect(scanner(on).locator(".scan-notes")).toContainText(
        "カメラをほかのアプリが使っているようです",
        { timeout: 3000 },
      );
      expect(await cameras()).toEqual(["ended", "ended", "ended"]);
      // The reader here at last: ［カメラで読む］ reads.
      await on.evaluate(() => (window.__takenAfter = null));
      letThrough();
      await scanner(on).getByRole("button", { name: "カメラで読む" }).click();
      await expect(scanner(on).locator(".scan-guide")).toHaveText(
        "上の段（978…）を枠に",
        { timeout: 15000 },
      );
      await finishScanning(on);
      await expect.poll(cameras).toEqual(["ended", "ended", "ended", "ended"]);
      await slow.close();
    },
  );

  await check(
    "a computer with no reader of its own starts typing, and asks for the camera on ［カメラで読む］",
    async () => {
      const desk = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: "ja-JP",
        permissions: ["camera"],
      });
      await answerOutside(desk);
      await desk.addInitScript(() => {
        delete window.BarcodeDetector;
        window.__asked = 0;
        const ask = navigator.mediaDevices.getUserMedia.bind(
          navigator.mediaDevices,
        );
        navigator.mediaDevices.getUserMedia = (constraints) => {
          window.__asked += 1;
          return ask(constraints);
        };
      });
      const on = settleBeforeNavigating(await desk.newPage());
      on.on("pageerror", (e) => errors.push(e.message));
      await go("/profiles/me/?books=library", on);
      await openScanner(on);
      // Typing is this computer's way: nothing to say why.
      await expect(field(on)).toBeFocused();
      await expect(scanner(on).locator(".scan-notes")).toHaveText(
        "13桁そろうと登録します",
      );
      expect(await on.evaluate(() => window.__asked)).toBe(0);
      await scanner(on).getByRole("button", { name: "カメラで読む" }).click();
      await expect(scanner(on).locator(".scan-guide")).toHaveText(
        "上の段（978…）を枠に",
        { timeout: 15000 },
      );
      expect(await on.evaluate(() => window.__asked)).toBe(1);
      await finishScanning(on);
      await desk.close();
    },
  );

  expect(errors).toEqual([]);
  console.log(passed.length + " library browser checks passed");
} finally {
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ passed, errors }, null, 2),
  );
  await browser.close();
}
