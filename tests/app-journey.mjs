import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { settleBeforeNavigating } from "./journey-layers.mjs";
import { expectReadable } from "./journey-contrast.mjs";
import {
  expectKeyboardUp,
  expectNoKeyboard,
  expectNoZoomOnFocus,
  expectTapWrites,
  forgetFocus,
  watchFocus,
} from "./journey-keyboard.mjs";

const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/app-qa",
);
await mkdir(output, { recursive: true });
// Uses Playwright's own Chromium unless BOOK_TOWN_CHROME names another browser.
const browser = await chromium.launch({
  executablePath: process.env.BOOK_TOWN_CHROME || undefined,
  headless: true,
});
const errors = [];
const passed = [];
const GOOGLE_ISBN = "9784101092058";
const OPENBD_ISBN = "9784003101018";
let page;

async function check(name, operation) {
  await operation();
  passed.push(name);
  console.log(`PASS ${name}`);
}
async function go(route) {
  await page.goto(`${baseURL}${route}`);
  await expect(page.locator("main")).toBeVisible();
  await page.waitForFunction(() => localStorage.getItem("book-town-v1"));
  // Saved data can exist before this page hydrates; wait until React owns the page.
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("main") ?? {}).some((key) =>
      key.startsWith("__reactFiber"),
    ),
  );
}
/** Opens Home on ホーム: a fresh `/` opens the tab shown last. */
async function goHome() {
  await go("/");
  const home = page
    .getByRole("tablist", { name: "ホームの表示" })
    .getByRole("tab", { name: "ホーム" });
  if ((await home.getAttribute("aria-selected")) !== "true") await home.click();
  await expect(page).toHaveURL(`${baseURL}/`);
}
async function noOverflow(label) {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(size.document, `${label}: overflow`).toBeLessThanOrEqual(
    size.width + 1,
  );
}
/** Dispatches a one-finger horizontal swipe that starts on the given element. */
async function swipe(locator, dx) {
  await locator.evaluate((element, delta) => {
    const box = element.getBoundingClientRect();
    const start = {
      identifier: 1,
      target: element,
      clientX: box.left + box.width / 2,
      clientY: box.top + Math.min(box.height / 2, 40),
    };
    const first = new Touch(start);
    const last = new Touch({ ...start, clientX: start.clientX + delta });
    element.dispatchEvent(
      new TouchEvent("touchstart", {
        bubbles: true,
        touches: [first],
        changedTouches: [first],
      }),
    );
    element.dispatchEvent(
      new TouchEvent("touchmove", {
        bubbles: true,
        touches: [last],
        changedTouches: [last],
      }),
    );
    element.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        touches: [],
        changedTouches: [last],
      }),
    );
  }, dx);
}
/** Answers the reading confirmation and checks it greeted the reader with a phrase. */
async function confirmIn(title, answer) {
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog.locator(".reading-confirm-phrase")).not.toBeEmpty();
  await dialog.getByRole("button", { name: answer, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
const stored = () =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem("book-town-v1") ?? "{}").data,
  );

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await watchFocus(context);
  page = settleBeforeNavigating(await context.newPage());
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // The ISBN lookups and covers are answered locally so the test never
  // depends on the network. openBD has the cover of 表紙のある本; Google
  // Books has the one of QAの本.
  await page.route("https://api.openbd.jp/**", (route) => {
    const isbns = new URL(route.request().url()).searchParams
      .get("isbn")
      .split(",");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        isbns.map((isbn) =>
          isbn === OPENBD_ISBN
            ? {
                summary: {
                  isbn,
                  title: "表紙のある本",
                  author: "試験 花子／著",
                  cover: `https://cover.openbd.jp/${isbn}.jpg`,
                },
              }
            : { summary: { isbn, title: "QAの本", author: "試験 太郎／著" } },
        ),
      ),
    });
  });
  await page.route("https://www.googleapis.com/books/**", (route) => {
    const isbn = new URL(route.request().url()).searchParams
      .get("q")
      .replace("isbn:", "");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        isbn === GOOGLE_ISBN
          ? {
              items: [
                {
                  volumeInfo: {
                    industryIdentifiers: [
                      { type: "ISBN_13", identifier: isbn },
                    ],
                    imageLinks: {
                      thumbnail:
                        "http://books.google.com/books/content?id=qa&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api",
                    },
                    canonicalVolumeLink:
                      "https://books.google.com/books/about/QA.html?id=qa",
                  },
                },
              ],
            }
          : {},
      ),
    });
  });
  const coverImage = await readFile(
    new URL("../public/favicon.ico", import.meta.url),
  );
  await page.route(
    /^https:\/\/(cover\.openbd\.jp|books\.google\.com\/books\/content)/,
    (route) => route.fulfill({ contentType: "image/png", body: coverImage }),
  );

  await check(
    "bottom bar reads home, search, walk, shelf, record, me",
    async () => {
      await go("/");
      const nav = page.getByRole("navigation", {
        name: "スマートフォンナビゲーション",
      });
      await expect(nav.getByRole("link")).toHaveText([
        "ホーム",
        "検索",
        "書店めぐり",
        "本棚",
        "記録",
        "わたし",
      ]);
      await expect(nav.getByRole("link", { name: "ホーム" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(
        page.getByRole("tablist", { name: "ホームの表示" }).getByRole("tab"),
      ).toHaveText(["ホーム", "便りだけ"]);
      await expect(page.getByRole("link", { name: "お知らせ" })).toBeVisible();
      await noOverflow("home");
    },
  );

  await check(
    "本棚 opens the library, its shelves stay in the address, and books change together",
    async () => {
      const nav = page.getByRole("navigation", {
        name: "スマートフォンナビゲーション",
      });
      const shelfTab = nav.getByRole("link", { name: "本棚" });
      const meTab = nav.getByRole("link", { name: "わたし" });
      const lit = async (on, off) => {
        await expect(on).toHaveAttribute("aria-current", "page");
        await expect(on).toHaveClass(/active/);
        await expect(off).not.toHaveAttribute("aria-current");
        await expect(off).not.toHaveClass(/active/);
      };

      // From another page, 本棚 opens the library.
      await go("/reading/");
      await lit(nav.getByRole("link", { name: "記録" }), shelfTab);
      await shelfTab.click();
      await expect(page).toHaveURL(`${baseURL}/library/`);
      await lit(shelfTab, meTab);
      await expect(
        page.getByRole("heading", { name: "ライブラリ", level: 1 }),
      ).toBeVisible();
      const shelves = page.getByRole("group", { name: "棚" });
      await expect(
        shelves.getByRole("button", { name: "すべて", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      // No shelf, filter or number says 0.
      await expect(page.locator(".library-page")).not.toContainText(
        /(^|\D)0冊/,
      );
      for (const chip of await page.locator(".library-count").allTextContents())
        expect(chip).not.toBe("0");

      // Picking books is one step of 戻る; a change is undone from its notice.
      await page.getByRole("button", { name: "選ぶ", exact: true }).click();
      const bar = page.getByRole("region", { name: "選んだ本を変える" });
      await expect(bar).toContainText("本を選んでください");
      const first = page.locator(".library-book").first();
      const title = (await first.locator("strong").textContent()).trim();
      await first.click();
      await expect(bar).toContainText("1冊を選択中");
      const tsundoku = bar.getByRole("button", { name: "積読" });
      await tsundoku.click();
      const toast = page.locator(".toast");
      await expect(toast).toContainText(`『${title}』を積読にしました`);
      await expect(tsundoku).toHaveAttribute("aria-pressed", "true");
      await expect(first).toContainText("積読");
      await toast.getByRole("button", { name: "元に戻す" }).click();
      await expect(toast).toContainText(`『${title}』を元に戻しました`);
      await expect(tsundoku).toHaveAttribute("aria-pressed", "false");
      await tsundoku.click();
      await expect(tsundoku).toHaveAttribute("aria-pressed", "true");
      await page.goBack();
      await expect(bar).toHaveCount(0);
      await expect(page).toHaveURL(`${baseURL}/library/`);
      await expect(
        page.getByRole("button", { name: "選ぶ", exact: true }),
      ).toBeFocused();

      // A filter is chosen in place: the address says it, with no step of 戻る.
      const steps = await page.evaluate(() => history.length);
      const unsorted = page
        .getByRole("group", { name: "絞り込み" })
        .getByRole("button", { name: /^未整理/ });
      await unsorted.click();
      await expect(page).toHaveURL(`${baseURL}/library/?unsorted=1`);
      await expect(unsorted).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.locator(".library-book", { hasText: title }),
      ).toHaveCount(0);
      expect(await page.evaluate(() => history.length)).toBe(steps);
      await page.reload();
      await expect(unsorted).toHaveAttribute("aria-pressed", "true");
      await lit(shelfTab, meTab);

      // 戻る returns to 記録; わたし opens the profile.
      await page.goBack();
      await expect(page).toHaveURL(`${baseURL}/reading/`);
      await lit(nav.getByRole("link", { name: "記録" }), shelfTab);
      await meTab.click();
      await expect(page).toHaveURL(`${baseURL}/profiles/me/`);
      await lit(meTab, shelfTab);

      // The six labels keep to one line, inside their own tab and the screen.
      await go("/profiles/me/");
      for (const width of [375, 390]) {
        await page.setViewportSize({ width, height: 844 });
        const tabs = await nav.evaluate((bar) =>
          [...bar.querySelectorAll("a")].map((tab) => {
            const box = tab.getBoundingClientRect();
            const label = tab.querySelector("span");
            const words = label.getBoundingClientRect();
            const size = parseFloat(getComputedStyle(label).fontSize);
            return {
              name: label.textContent,
              fits:
                words.left >= box.left - 0.5 &&
                words.right <= box.right + 0.5 &&
                box.left >= -0.5 &&
                box.right <= innerWidth + 0.5 &&
                words.height < size * 2,
            };
          }),
        );
        expect(tabs.map((tab) => tab.name)).toEqual([
          "ホーム",
          "検索",
          "書店めぐり",
          "本棚",
          "記録",
          "わたし",
        ]);
        for (const tab of tabs)
          expect(tab.fits, `${width}px: ${tab.name} fits`).toBe(true);
        await noOverflow(`${width}px profile`);
        await page.screenshot({
          path: path.join(output, `bottom-bar-${width}.png`),
          clip: { x: 0, y: 844 - 90, width, height: 90 },
        });
      }
      await page.setViewportSize({ width: 390, height: 844 });
    },
  );

  await check(
    "a shelf of the reader's own is made, filled from the library, kept, and put away with undo",
    async () => {
      await go("/library/");
      const shelves = page.getByRole("group", { name: "棚" });
      const toast = page.locator(".toast");
      const books = page.locator(".library-book");
      const all = await books.count();

      // Made from the chip row: its words are kept while it is written.
      await shelves.getByRole("button", { name: "棚を作る" }).click();
      const sheet = page.getByRole("dialog", { name: "棚を作る" });
      await sheet.getByLabel("棚の名前").fill("雨の日に読みたい");
      await page.goBack();
      await expect(sheet).toHaveCount(0);
      await shelves.getByRole("button", { name: "棚を作る" }).click();
      await expect(sheet.getByLabel("棚の名前")).toHaveValue(
        "雨の日に読みたい",
      );
      await expect(sheet).toContainText("書きかけを続けています");
      await sheet.getByRole("button", { name: "作る", exact: true }).click();
      await expect(toast).toContainText("「雨の日に読みたい」を作りました");
      await expect(page).toHaveURL(/\/library\/\?shelf=[\w-]+$/);
      const shelf = shelves.getByRole("button", { name: "雨の日に読みたい" });
      await expect(shelf).toHaveAttribute("aria-pressed", "true");
      // The sheet's step is gone: 戻る leaves the library for the page
      // before it, and 進む comes back to the new shelf.
      const shelfAddress = page.url();
      await page.goBack();
      await expect(page).not.toHaveURL(/\/library\//);
      await page.goForward();
      await expect(page).toHaveURL(shelfAddress);
      await expect(shelf).toHaveAttribute("aria-pressed", "true");
      // The next shelf starts from a clear form.
      await shelves.getByRole("button", { name: "棚を作る" }).click();
      await expect(sheet.getByLabel("棚の名前")).toHaveValue("");
      await expect(sheet).not.toContainText("書きかけ");
      await page.goBack();
      await expect(sheet).toHaveCount(0);
      // An empty shelf shows no number, and asks for its books.
      await expect(page.locator(".library-page")).not.toContainText(
        /(^|\D)0冊/,
      );
      await page.getByRole("button", { name: "ライブラリから選ぶ" }).click();
      const bar = page.getByRole("region", { name: "選んだ本を変える" });
      await expect(books).toHaveCount(all);
      const titles = [];
      for (const i of [0, 1]) {
        titles.push(
          (await books.nth(i).locator("strong").textContent()).trim(),
        );
        await books.nth(i).click();
      }
      await bar
        .getByRole("button", { name: "「雨の日に読みたい」に入れる" })
        .click();
      await expect(toast).toContainText(
        "2冊を「雨の日に読みたい」に入れました",
      );
      await expect(bar).toHaveCount(0);
      await expect(shelf).toHaveAttribute("aria-pressed", "true");
      await expect(books).toHaveCount(2);
      await expect(shelf).toHaveAccessibleName("雨の日に読みたい 2冊");

      // Kept: a reload comes back to the shelf and its books.
      await page.reload();
      await expect(books).toHaveCount(2);
      await expect(books.first()).toContainText(titles[0]);

      // From the whole library, a book picked goes on the shelf, and its
      // card says which of the reader's shelves it is on.
      await shelves
        .getByRole("button", { name: "すべて", exact: true })
        .click();
      await page.getByRole("button", { name: "選ぶ", exact: true }).click();
      const third = books.nth(2);
      await third.click();
      const onShelf = bar
        .getByRole("group", { name: "自分の棚" })
        .getByRole("button", { name: "雨の日に読みたい" });
      await expect(onShelf).toHaveAttribute("aria-pressed", "false");
      await onShelf.click();
      await expect(onShelf).toHaveAttribute("aria-pressed", "true");
      await page.goBack();
      await expect(bar).toHaveCount(0);
      await expect(third).toContainText("雨の日に読みたい");

      // Changed, then put away: the books stay in the library, and undo
      // brings the shelf back with them.
      await shelf.click();
      await page.getByRole("button", { name: "棚を編集" }).click();
      const edit = page.getByRole("dialog", { name: "棚を編集" });
      await edit.getByLabel(/どんな棚か/).fill("しとしと降る日に。");
      await edit.getByRole("button", { name: "保存する" }).click();
      await expect(page.locator(".library-shelf-head")).toContainText(
        "しとしと降る日に。",
      );
      await page.getByRole("button", { name: "棚を編集" }).click();
      await edit.getByRole("button", { name: "この棚を消す" }).click();
      await expect(toast).toContainText("「雨の日に読みたい」を消しました");
      await expect(page).toHaveURL(`${baseURL}/library/`);
      await expect(shelf).toHaveCount(0);
      await expect(books).toHaveCount(all);
      await toast.getByRole("button", { name: "元に戻す" }).click();
      await expect(shelf).toHaveAccessibleName("雨の日に読みたい 3冊");
      await noOverflow("library shelves");
    },
  );

  await check(
    "a shelf's long name ends in … on a book's card, and the page keeps to the screen",
    async () => {
      const shelves = page.getByRole("group", { name: "棚" });
      const books = page.locator(".library-book");
      const toast = page.locator(".toast");
      const nav = page.getByRole("navigation", {
        name: "スマートフォンナビゲーション",
      });
      await go("/library/");
      // The town as it was, put back after each name.
      const town = await page.evaluate(() =>
        localStorage.getItem("book-town-v1"),
      );
      const names = [
        // As long as a shelf's name can be (40)…
        [
          "ja",
          "遠い国の旅と海と星の物語を、雨の降る静かな夜にゆっくり読みたい本をそっと集めた棚",
        ],
        // …one English word with nowhere to break…
        ["en", "Supercalifragilisticexpialidociousbooksz"],
        // …and emoji among the words.
        ["emoji", "📚🌙夜更けに読む本 Late night reads☕👨‍👩‍👧"],
      ];
      expect([...names[0][1]]).toHaveLength(40);
      expect([...names[1][1]]).toHaveLength(40);
      for (const [key, name] of names) {
        await go("/library/");
        await page.setViewportSize({ width: 320, height: 844 });
        await shelves.getByRole("button", { name: "棚を作る" }).click();
        const sheet = page.getByRole("dialog", { name: "棚を作る" });
        await sheet.getByLabel("棚の名前").fill(name);
        await sheet.getByRole("button", { name: "作る", exact: true }).click();
        await expect(page).toHaveURL(/\/library\/\?shelf=[\w-]+$/);
        // On the book at the right of the first row (it is on 雨の日に読みたい
        // too, from the check before).
        await page.getByRole("button", { name: "ライブラリから選ぶ" }).click();
        const bar = page.getByRole("region", { name: "選んだ本を変える" });
        await books.nth(2).click();
        await bar.getByRole("button", { name: `「${name}」に入れる` }).click();
        await expect(bar).toHaveCount(0);
        // What was done, and the way back, fold into the narrow screen.
        const undo = toast.getByRole("button", { name: "元に戻す" });
        await expect(undo).toBeVisible();
        expect(
          await toast.evaluate((t) => t.scrollWidth <= t.clientWidth),
          `${key}: the toast holds its words`,
        ).toBe(true);
        const tick = await toast.locator("svg").first().boundingBox();
        expect(tick.width, `${key}: the tick keeps its size`).toBeCloseTo(
          17,
          0,
        );
        const back = await undo.boundingBox();
        expect(back.x, `${key}: 元に戻す on the screen`).toBeGreaterThanOrEqual(
          0,
        );
        expect(back.x + back.width).toBeLessThanOrEqual(320 + 1);
        await page.screenshot({
          path: path.join(output, `library-long-shelf-${key}-toast-320.png`),
        });
        await shelves
          .getByRole("button", { name: "すべて", exact: true })
          .click();
        for (const width of [390, 320]) {
          await page.setViewportSize({ width, height: 844 });
          const mark = books.locator(".library-marks span", { hasText: name });
          await expect(mark).toHaveCount(1);
          // The whole name is there to be read out; the eye sees it end in ….
          await expect(mark).toContainText(name);
          const fit = await mark.evaluate((span) => {
            const own = span.getBoundingClientRect();
            const box = span.closest(".library-book").getBoundingClientRect();
            return {
              cut: span.scrollWidth > span.clientWidth,
              ellipsis: getComputedStyle(span).textOverflow,
              inside:
                own.left >= box.left - 0.5 && own.right <= box.right + 0.5,
            };
          });
          expect(fit, `${key} ${width}px: the mark ends in …`).toEqual({
            cut: true,
            ellipsis: "ellipsis",
            inside: true,
          });
          await noOverflow(`${key} ${width}px library with a long shelf name`);
          // The bottom tabs stay on the screen.
          const tabs = await nav.boundingBox();
          expect(tabs.x).toBeGreaterThanOrEqual(0);
          expect(tabs.x + tabs.width).toBeLessThanOrEqual(width + 1);
          expect(tabs.y + tabs.height).toBeLessThanOrEqual(844 + 1);
          await page.screenshot({
            path: path.join(output, `library-long-shelf-${key}-${width}.png`),
          });
        }
        await page.evaluate(
          (kept) => localStorage.setItem("book-town-v1", kept),
          town,
        );
        await page.reload();
      }
      await page.setViewportSize({ width: 390, height: 844 });
    },
  );

  await check(
    "a smart shelf gathers by its conditions, and each shelf says who may see it",
    async () => {
      await go("/library/");
      const shelves = page.getByRole("group", { name: "棚" });
      const toast = page.locator(".toast");
      const books = page.locator(".library-book");
      // The town as it was, put back at the end: the checks after count
      // on the books it has finished.
      const town = await page.evaluate(() =>
        localStorage.getItem("book-town-v1"),
      );
      // Two books finished, to be the books the smart shelf gathers.
      await page.getByRole("button", { name: "選ぶ", exact: true }).click();
      const picking = page.getByRole("region", { name: "選んだ本を変える" });
      await books.nth(0).click();
      await books.nth(1).click();
      const done = picking
        .getByRole("group", { name: "状態" })
        .getByRole("button", { name: "読了" });
      if ((await done.getAttribute("aria-pressed")) !== "true")
        await done.click();
      await page.goBack();
      await expect(picking).toHaveCount(0);
      const finishedChip = shelves.getByRole("button", { name: /^読了/ });
      await finishedChip.click();
      await expect(finishedChip).toHaveAttribute("aria-pressed", "true");
      const finished = await books.count();
      expect(finished).toBeGreaterThan(0);

      // Who may see 読了: 自分だけ, changed to 公開 and kept.
      const audience = page.locator(".library-audience");
      await expect(audience).toContainText("見せる範囲：自分だけ");
      await audience
        .getByRole("button", { name: /見せる範囲を変える/ })
        .click();
      const choose = page.getByRole("dialog", { name: "「読了」の見せる範囲" });
      await expect(choose).toContainText(
        "ほかの読書家に本棚を見せる場所はありません",
      );
      // Chosen, the sheet closes at once.
      await choose.getByRole("radio", { name: /公開/ }).click();
      await expect(toast).toContainText("「読了」を公開にしました");
      await expect(choose).toHaveCount(0);
      await page.reload();
      await expect(audience).toContainText("見せる範囲：公開");

      // Made in 棚を作る with 条件で集める: no condition, no shelf.
      await shelves.getByRole("button", { name: "棚を作る" }).click();
      const sheet = page.getByRole("dialog", { name: "棚を作る" });
      await sheet.getByRole("radio", { name: /条件で集める/ }).check();
      await sheet.getByLabel("棚の名前").fill("読み終えた本");
      const make = sheet.getByRole("button", { name: "作る", exact: true });
      await expect(make).toBeDisabled();
      await expect(sheet).toContainText("条件を1つ以上選んでください");
      await sheet
        .getByRole("group", { name: "読書の状態" })
        .getByRole("button", { name: "読了" })
        .click();
      await noOverflow("smart shelf sheet");
      await page.screenshot({
        path: path.join(output, "smart-shelf-sheet.png"),
      });
      await make.click();
      await expect(toast).toContainText("「読み終えた本」を作りました");
      const smart = shelves.getByRole("button", { name: /^読み終えた本/ });
      await expect(smart).toHaveAttribute("aria-pressed", "true");
      await expect(books).toHaveCount(finished);
      const head = page.locator(".library-shelf-head");
      await expect(head).toContainText("集める条件：読了");
      await expect(head).toContainText("見せる範囲：自分だけ");
      await page.screenshot({ path: path.join(output, "smart-shelf.png") });

      // A smart shelf takes no book by hand: it is not among 自分の棚.
      await shelves
        .getByRole("button", { name: "すべて", exact: true })
        .click();
      await page.getByRole("button", { name: "選ぶ", exact: true }).click();
      await books.first().click();
      const bar = page.getByRole("region", { name: "選んだ本を変える" });
      await expect(
        bar.getByRole("button", { name: "読み終えた本" }),
      ).toHaveCount(0);
      await page.goBack();
      await expect(bar).toHaveCount(0);

      // Its conditions change in 棚を編集, and it is made public there.
      await smart.click();
      await page.getByRole("button", { name: "棚を編集" }).click();
      const edit = page.getByRole("dialog", { name: "棚を編集" });
      await expect(
        edit.getByRole("radio", { name: /条件で集める/ }),
      ).toHaveCount(0);
      await edit
        .getByRole("group", { name: "読書の状態" })
        .getByRole("button", { name: "読書中" })
        .click();
      await edit.getByRole("radio", { name: /公開/ }).check();
      await edit.getByRole("button", { name: "保存する" }).click();
      await expect(head).toContainText("集める条件：読書中・読了");
      await expect(head).toContainText("見せる範囲：公開");
      await page.reload();
      await expect(head).toContainText("集める条件：読書中・読了");
      await expect(page.locator(".library-page")).not.toContainText(
        /(^|\D)0冊/,
      );
      await noOverflow("smart shelf");
      await page.evaluate(
        (kept) => localStorage.setItem("book-town-v1", kept),
        town,
      );
      await page.reload();
    },
  );

  await check(
    "swipes on a shelf stay on the shelf; other swipes switch the Home tabs",
    async () => {
      await goHome();
      const shelf = page.locator(".street-shelf").first();
      await shelf.scrollIntoViewIfNeeded();
      await swipe(shelf, -160);
      await page.waitForTimeout(400);
      await expect(page).toHaveURL(`${baseURL}/`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await swipe(page.getByRole("navigation", { name: "できること" }), -160);
      await expect(page).toHaveURL(/\/timeline\/$/);
      await expect(page.getByRole("tab", { name: "便りだけ" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await swipe(page.locator('[role="tabpanel"][data-pane="letters"]'), 160);
      await expect(page).toHaveURL(`${baseURL}/`);
      await expect(page.getByRole("tab", { name: "ホーム" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    },
  );

  await check(
    "search finds books and shops, by feeling, talk, shelves and quiet corners",
    async () => {
      await go("/search/");
      await expect(
        page.getByRole("heading", { name: "話題の本" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "多くの棚に並ぶ本" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "棚の隅の本" }),
      ).toBeVisible();
      // Feelings readers kept lead to the books they felt them with.
      const feelings = page.getByRole("group", { name: "気持ち" });
      await feelings.getByRole("button", { name: "誰かと話したい" }).click();
      const felt = page.locator(
        "[aria-labelledby=search-feelings-title] .search-book",
      );
      await expect(felt.filter({ hasText: "ソラリス" })).toHaveCount(1);
      await expect(felt.filter({ hasText: "モモ" })).toContainText(
        "ほか4軒の棚に",
      );
      await expect(page.getByText(/0件|0人|0軒/)).toHaveCount(0);
      await feelings.getByRole("button", { name: "誰かと話したい" }).click();
      await expect(felt).toHaveCount(0);
      const box = page.getByRole("searchbox", { name: "本と書店を検索" });
      await box.fill("ル＝グウィン");
      await expect(page.locator(".search-results .search-book")).toHaveCount(2);
      await box.fill("雨と翻訳");
      await expect(page.locator(".search-results .search-shop")).toHaveCount(1);
      await page.getByRole("link", { name: /雨と翻訳/ }).click();
      await expect(page).toHaveURL(/shops\/shop-rain/);
    },
  );

  await check(
    "a kanji title is found by its reading and romaji, best match first, with no counts",
    async () => {
      await go("/search/");
      const box = page.getByRole("searchbox", { name: "本と書店を検索" });
      const found = page.locator(
        "[aria-labelledby=search-books-title] > ul:not([aria-labelledby]) .search-book",
      );
      for (const typed of ["ぎんがてつどう", "gingatetsudou", "銀河 鉄道"]) {
        await box.fill(typed);
        await expect(found).toHaveCount(1);
        await expect(found.first()).toContainText("銀河鉄道の夜");
      }
      // Found through its reading, the row says how it is read.
      await box.fill("ぎんがてつどう");
      await expect(found.first()).toContainText(
        "よみ：ぎんが てつどう の よる",
      );
      // The title itself first, then titles that hold the word.
      await box.fill("夜");
      await expect(found.nth(0)).toContainText("夜と霧");
      await expect(found).toHaveCount(3);
      // Result headings and rows carry no counts.
      await expect(page.locator(".search-results h2").first()).toHaveText("本");
      await expect(page.locator(".search-results")).not.toContainText(
        /軒の棚に|\d+冊/,
      );
      // Close spellings wait under their own quiet heading, and the page
      // does not say first that nothing was found.
      await box.fill("秘密の森の花園");
      await expect(found).toHaveCount(0);
      await expect(
        page.getByRole("list", { name: "近い題名の本" }),
      ).toContainText("秘密の花園");
      // The quiet heading is small, but still readable.
      await expectReadable(page.locator(".search-near"), "近い題名の本");
      await expect(
        page.getByText("ぴったり合う本はありませんでした。"),
      ).toBeVisible();
      await expect(
        page.getByText("合う本は見つかりませんでした。", { exact: true }),
      ).toHaveCount(0);
      // A name spelled a little differently is a close author, not a title.
      await box.fill("ミハエル・エンデ");
      await expect(
        page.getByRole("list", { name: "著者名が近い本" }),
      ).toContainText("モモ");
      // Found by the author's reading, the row shows no title reading.
      await box.fill("みやざわけんじ");
      await expect(found.first()).toContainText("銀河鉄道の夜");
      await expect(found.first()).not.toContainText("よみ：");
      // A word of a reading that begins with a vowel: ロウジン ト ウミ.
      await box.fill("うみ");
      await expect(found.first()).toContainText("老人と海");
      // A genre chip lists its books and nothing close.
      await box.fill("");
      await page
        .getByRole("group", { name: "ジャンルで探す" })
        .getByRole("button", { name: "ファンタジー" })
        .click();
      await expect(found).toHaveCount(2);
      await expect(page.locator(".search-near")).toHaveCount(0);
      // A search with nothing to find says so in words, never 0.
      await box.fill("量子力学");
      await expect(
        page.getByText("合う本は見つかりませんでした。"),
      ).toBeVisible();
      await expect(page.locator(".search-results")).not.toContainText(/0/);
      // In a picker, Enter never sends the post being written, and takes
      // only a sure match: several equal ones or a near one wait for a tap.
      await go("/timeline/");
      await page.locator(".compose-fab").click();
      const compose = page.getByRole("dialog", { name: "投稿する" });
      await compose.locator("textarea").fill("下書きのつもりの文章");
      await compose.getByRole("button", { name: "本を添える" }).click();
      const picker = compose.getByRole("searchbox");
      for (const [typed, shown] of [
        ["孤独", /^百年の孤独/],
        ["グウィン", /^闇の左手/],
        ["秘密の森の花園", /^秘密の花園/],
      ]) {
        await picker.fill(typed);
        await expect(
          compose.getByRole("button", { name: shown }),
        ).toBeVisible();
        if (typed === "秘密の森の花園")
          await expectReadable(compose.locator(".search-near"), "近い題名の本");
        await picker.press("Enter");
        await expect(compose).toBeVisible();
        await expect(compose.locator(".picker-chosen")).toHaveCount(0);
      }
      await expect(page.getByText(/に投稿しました/)).toHaveCount(0);
      await expect(compose.locator("textarea")).toHaveValue(
        "下書きのつもりの文章",
      );
      await picker.fill("よるときり");
      await expect(
        compose.getByRole("button", { name: /^夜と霧/ }),
      ).toBeVisible();
      await picker.press("Enter");
      await expect(compose.locator(".picker-chosen")).toContainText("夜と霧");
      await compose.getByRole("button", { name: "夜と霧を外す" }).click();
      await compose.locator("textarea").fill("");
      await page.keyboard.press("Escape");
      await expect(compose).toHaveCount(0);
      await expect(page.getByText(/に投稿しました/)).toHaveCount(0);
    },
  );

  await check(
    "reading together: default book, timer, public memo and readers now",
    async () => {
      await go("/reading/");
      await expect(
        page.getByRole("heading", { name: /いま4人が、みんなで読んでいます/ }),
      ).toBeVisible();
      // Everyone's reading posts show before starting, whatever book they are on.
      const feed = page.locator(".reading-memos");
      await expect(
        page.getByRole("heading", { name: "みんなの読書中のつぶやき" }),
      ).toBeVisible();
      await expect(feed).toContainText("もう三つ目");
      await expect(feed).toContainText("時計の音がよく聞こえる");
      await page
        .getByRole("searchbox", { name: "読む本を探す" })
        .fill("ソラリス");
      await page.getByRole("button", { name: /^ソラリス/ }).click();
      await page.getByRole("button", { name: /みんなで読む/ }).click();
      await confirmIn("読書をはじめますか？", "本を開く");
      await expect(
        page.getByRole("heading", { name: "ソラリス" }),
      ).toBeVisible();
      await expect(page.getByRole("timer")).toHaveText(/00:0[1-9]/, {
        timeout: 5000,
      });
      await expect(
        page.getByRole("heading", { name: /同じ本を、いま3人が読んでいます/ }),
      ).toBeVisible();
      const nav = page.getByRole("navigation", {
        name: "スマートフォンナビゲーション",
      });
      await expect(nav.getByRole("link", { name: "読書中" })).toBeVisible();
      await page
        .getByRole("textbox", { name: "読書中のつぶやき" })
        .fill("ちょうど第二章。");
      await page.getByRole("button", { name: "つぶやく" }).click();
      const memo = page
        .getByRole("region", { name: "今回書いたこと" })
        .locator("article.post-card")
        .filter({ hasText: "ちょうど第二章。" });
      await expect(memo).toBeVisible();
      await memo.getByRole("button", { name: /いいね/ }).click();
      await expect(
        memo.getByRole("button", { name: /いいね/ }),
      ).toHaveAttribute("aria-pressed", "true");
      await go("/timeline/");
      await expect(page.getByText("ちょうど第二章。")).toBeVisible();
    },
  );

  await check("notifications show readers reading the same book", async () => {
    await goHome();
    // While a book is open, ホーム says it is being read, under the doors.
    const reading = page.locator(".home-reading");
    await expect(reading).toContainText("読書中");
    await expect(reading).toContainText("ソラリス");
    await expect(
      page.getByRole("link", { name: "お知らせ（新しいお知らせがあります）" }),
    ).toBeVisible();
    await page.getByRole("link", { name: /お知らせ/ }).click();
    await expect(
      page.getByText("凪さんも今『ソラリス』を読んでいます"),
    ).toBeVisible();
    await page.reload();
    await page.waitForFunction(() => localStorage.getItem("book-town-v1"));
    await expect(page.getByRole("link", { name: "お知らせ" })).toBeVisible();
  });

  await check(
    "ending a session records time and the book stays the default",
    async () => {
      await go("/reading/");
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: "読書を終える" }).click();
      await confirmIn("読書を終えますか？", "本を閉じる");
      await expect(
        page.getByRole("heading", { name: "読書を開始" }),
      ).toBeVisible();
      // Closing the book leaves this sitting's time, the book and a line written.
      const closed = page.getByRole("status", { name: "今日の読書" });
      await expect(closed).toContainText("今日の読書");
      await expect(closed).toContainText("『ソラリス』");
      await expect(closed).toContainText("ちょうど第二章。");
      await expect(
        closed.getByRole("link", { name: "『ソラリス』の作品ページへ" }),
      ).toHaveAttribute("href", "/books/solaris/");
      await closed.getByRole("button", { name: "閉じる" }).click();
      await expect(closed).toHaveCount(0);
      await expect(page.locator(".picker-chosen")).toContainText("ソラリス");
      await expect(
        page.getByText("いま読んでいる本を選んでいます。"),
      ).toBeVisible();
      const data = await stored();
      expect(data.readingSessions).toHaveLength(1);
      expect(data.readingSessions[0].endedAt).not.toBeNull();
      await expect(page.locator(".reading-log li")).toHaveCount(1);
      // ホーム keeps the unfinished book a tap away, as 読みかけ, under the
      // doors: one line, the book and 記録する.
      await goHome();
      const reading = page.locator(".home-reading");
      await expect(reading).toContainText("読みかけ");
      await expect(reading).not.toContainText("読書中");
      const next = page.getByRole("link", {
        name: "『ソラリス』の読書を記録する",
      });
      await expect(next).toHaveText("記録する");
      // The jacket is its own link, to the book's page (where its cover is
      // credited); the two links sit side by side, not nested.
      await expect(
        page.getByRole("link", { name: "『ソラリス』の作品ページへ" }),
      ).toHaveAttribute("href", "/books/solaris/");
      await expect(page.locator(".home-reading a a")).toHaveCount(0);
      await next.click();
      await expect(page).toHaveURL(/\/reading\/$/);
      await expect(page.locator(".picker-chosen")).toContainText("ソラリス");
    },
  );

  await check(
    "reading alone keeps memos private and off the timeline",
    async () => {
      await page.getByRole("button", { name: /一人で読む/ }).click();
      await confirmIn("読書をはじめますか？", "本を開く");
      // Reading alone, the town's readers and words wait behind a fold.
      const others = page.getByRole("heading", {
        name: /同じ本を、いま2人が読んでいます/,
      });
      await expect(others).toBeHidden();
      await expect(
        page.getByRole("heading", { name: "みんなの読書中のつぶやき" }),
      ).toBeHidden();
      await page.getByText("ひと休みに、街の読書をのぞく").click();
      await expect(others).toBeVisible();
      // Kept open, the fold stays open the next time the page is shown.
      await page.getByLabel("読書中はいつも開いておく").check();
      await page.reload();
      await expect(others).toBeVisible();
      await page.getByLabel("読書中はいつも開いておく").uncheck();
      await page.reload();
      await expect(others).toBeHidden();
      await page
        .getByLabel("読書メモ（自分だけ）")
        .fill("ここは自分だけのメモ。");
      await page.getByRole("button", { name: "メモする" }).click();
      await expect(
        page.getByText("自分だけのメモ", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "読み終えた！" }).click();
      await confirmIn("読み終えましたか？", "読み終えた");
      expect((await stored()).finishedBooks).toEqual(["solaris"]);
      await go("/timeline/");
      await expect(page.getByText("ここは自分だけのメモ。")).toHaveCount(0);
      await go("/books/solaris/");
      await expect(page.getByText("ここは自分だけのメモ。")).toHaveCount(0);
    },
  );

  await check("the compose button icon follows the setting", async () => {
    await go("/profiles/me/");
    await expect(page.locator(".profile-stats")).toContainText("読書時間");
    // Before a shop opens, the profile's main step is opening one.
    await expect(
      page
        .locator(".profile-reader-actions")
        .getByRole("link", { name: "書店をひらく" }),
    ).toHaveAttribute("href", "/my-shop/");
    await page.getByRole("button", { name: "設定" }).click();
    await page
      .getByRole("dialog", { name: "設定" })
      .locator("label", { hasText: "タイプライター" })
      .click();
    await expect(page.getByLabel("タイプライター")).toBeChecked();
    await page.keyboard.press("Escape");
    await go("/");
    await expect(page.locator(".compose-fab")).toHaveClass(/icon-typewriter/);
    expect((await stored()).settings.composeIcon).toBe("typewriter");
  });

  await check(
    "a book registered by ISBN can be read and attached to posts",
    async () => {
      await go("/profiles/me/");
      // 「本を登録」 opens the scanner; one book by hand is ［手で入力］ there.
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
      await dialog.getByLabel("ISBN").fill("978-4-00-000000-2");
      await dialog.getByRole("button", { name: "ISBNで探す" }).click();
      await expect(
        dialog.getByText("ISBNとして読めませんでした"),
      ).toBeVisible();
      await dialog.getByLabel("ISBN").fill("978-4-10-109205-8");
      await dialog.getByRole("button", { name: "ISBNで探す" }).click();
      await expect(dialog.getByLabel("タイトル")).toHaveValue("QAの本");
      await expect(dialog.getByLabel("著者")).toHaveValue("試験 太郎");
      await dialog.getByRole("button", { name: "登録する" }).click();
      await expect(dialog).toHaveCount(0);
      await scanner.getByRole("button", { name: "終わる" }).click();
      await expect(scanner).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /^登録\s*\d*$/ }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".profile-saved-book")).toContainText("QAの本");
      await page.reload();
      await page.waitForFunction(() => localStorage.getItem("book-town-v1"));
      await go("/reading/");
      await page
        .getByRole("searchbox", { name: "読む本を探す" })
        .fill("9784101092058");
      await expect(page.getByRole("button", { name: /^QAの本/ })).toBeVisible();
    },
  );

  await check(
    "a registered book shows its real cover, unaltered, with where it came from",
    async () => {
      await go("/profiles/me/?books=library");
      // QAの本 has no cover at openBD, so it is Google's, credited on the page.
      const saved = page.locator(".profile-saved-book", { hasText: "QAの本" });
      const google = saved.locator(".book-jacket.has-cover img");
      await expect(google).toHaveAttribute(
        "src",
        "https://books.google.com/books/content?id=qa&printsec=frontcover&img=1&zoom=1&source=gbs_api",
      );
      await expect(google).toHaveCSS("object-fit", "contain");
      await expect(saved.locator(".jacket-title")).toBeHidden();
      await expect(page.locator(".google-covers-credit")).toHaveText(
        "表紙の一部: powered by Google",
      );

      // On its own page, the cover names Google and links the book there.
      await saved.locator("a, button").first().click();
      const credit = page.locator(".cover-credit").first();
      await expect(credit).toContainText("powered by Google");
      await expect(
        credit.getByRole("link", { name: "Google Books でこの本を見る" }),
      ).toHaveAttribute(
        "href",
        "https://books.google.com/books/about/QA.html?id=qa",
      );

      // A book openBD has a cover for shows openBD's.
      await go("/profiles/me/?books=library");
      await page
        .locator(".profile-minor-actions")
        .getByRole("button", { name: "本を登録" })
        .click();
      const scanner = page.getByRole("dialog", { name: "本を続けて登録" });
      const dialog = page.getByRole("dialog", {
        name: "本を登録",
        exact: true,
      });
      await scanner.getByRole("button", { name: "手で入力" }).click();
      await dialog.getByLabel("ISBN").fill(OPENBD_ISBN);
      await dialog.getByRole("button", { name: "ISBNで探す" }).click();
      await expect(dialog.getByLabel("タイトル")).toHaveValue("表紙のある本");
      await dialog.getByRole("button", { name: "登録する" }).click();
      await expect(dialog).toHaveCount(0);

      // A book without an ISBN, by hand from the same scanner.
      await scanner.getByRole("button", { name: "手で入力" }).click();
      await dialog.getByLabel("タイトル").fill("手で書いた本");
      await dialog.getByLabel("著者").fill("試験 次郎");
      await dialog.getByRole("button", { name: "登録する" }).click();
      await expect(dialog).toHaveCount(0);
      await scanner.getByRole("button", { name: "終わる" }).click();
      await expect(scanner).toHaveCount(0);

      const openBd = page
        .locator(".profile-saved-book", { hasText: "表紙のある本" })
        .locator(".book-jacket.has-cover img");
      await expect(openBd).toHaveAttribute(
        "src",
        `https://cover.openbd.jp/${OPENBD_ISBN}.jpg`,
      );

      // A book without an ISBN keeps its 装丁カード, set top to bottom.
      const card = page
        .locator(".profile-saved-book", { hasText: "手で書いた本" })
        .locator(".book-jacket");
      await expect(card).not.toHaveClass(/has-cover/);
      await expect(card).toHaveClass(/is-tate/);
      await expect(card.locator(".jacket-title")).toHaveCSS(
        "writing-mode",
        "vertical-rl",
      );
      await page.screenshot({ path: path.join(output, "covers.png") });
    },
  );

  await check(
    "on a narrow phone, a long title on a 装丁カード stays above its author",
    async () => {
      const town = JSON.parse(
        await page.evaluate(() => localStorage.getItem("book-town-v1")),
      );
      const long = [
        ["まよなかの町のちいさな図書館 上 ある町の話 新訳版", "山田一郎"],
        [
          "銀河の夜をわたるための覚え書き――ある鉄道員と星をめぐる三十七の短い物語",
          "試験 太郎",
        ],
        ["The Remains of the Day and Other Stories", "Kazuo Ishiguro"],
        ["あ".repeat(120), "試験 花子"],
      ];
      town.data.addedBooks = [
        ...(town.data.addedBooks ?? []),
        ...long.map(([title, author], at) => ({
          id: `my-book-${950 + at}`,
          title,
          author,
        })),
      ];
      for (const width of [390, 320]) {
        const narrow = await browser.newContext({
          viewport: { width, height: 700 },
          storageState: {
            cookies: [],
            origins: [
              {
                origin: new URL(baseURL).origin,
                localStorage: [
                  { name: "book-town-v1", value: JSON.stringify(town) },
                ],
              },
            ],
          },
        });
        const tab = settleBeforeNavigating(await narrow.newPage());
        tab.on("pageerror", (error) => errors.push(error.message));
        for (const at of long.keys()) {
          await tab.goto(`${baseURL}/books/registered/?id=my-book-${950 + at}`);
          const jacket = tab.locator(".book-page-hero > .book-jacket");
          await expect(jacket).not.toHaveClass(/is-tate/);
          const [title, author] = await Promise.all(
            [".jacket-title", ".jacket-author"].map((part) =>
              jacket.locator(part).boundingBox(),
            ),
          );
          expect(
            title.y + title.height,
            `${width}px, ${long[at][0]}: title ends at ${title.y + title.height}, author starts at ${author.y}`,
          ).toBeLessThanOrEqual(author.y);
        }
        await narrow.close();
      }
    },
  );

  await check("following list opens from the profile", async () => {
    await go("/profiles/r-nagi/");
    await page.getByRole("button", { name: "書店をフォロー" }).click();
    await go("/profiles/me/");
    await page.getByRole("button", { name: /1 フォロー/ }).click();
    const dialog = page.getByRole("dialog", { name: "フォロー" });
    await expect(dialog.getByRole("link", { name: /凪/ })).toBeVisible();
    // A link in the list leaves from the profile: 戻る returns to the
    // profile, and the next 戻る leaves it.
    const href = await dialog
      .getByRole("link", { name: /凪/ })
      .getAttribute("href");
    const there = new URL(href, page.url()).href;
    await dialog.getByRole("link", { name: /凪/ }).click();
    await expect(page).toHaveURL(there);
    await page.goBack();
    await expect(page).toHaveURL(/\/profiles\/me\/$/);
    await expect(dialog).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/profiles\/r-nagi\/$/);
    await go("/notifications/");
    await expect(
      page.getByText(/フォロー中の凪さんが投稿しました/).first(),
    ).toBeVisible();
    await noOverflow("notifications");
  });

  await check("reading can start without choosing a book", async () => {
    await go("/reading/");
    const clear = page.locator(".picker-chosen .picker-clear");
    if (await clear.count()) await clear.click();
    await page.getByRole("button", { name: /一人で読む/ }).click();
    await confirmIn("読書をはじめますか？", "はじめる");
    await expect(
      page.getByRole("heading", { name: "読書中", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("本を選ばずに読んでいます")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "読み終えた！" }),
    ).toHaveCount(0);
    await expect(page.getByText("ネタバレあり")).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "読書メモ（自分だけ）" })
      .fill("本を決めずに、ぱらぱらと。");
    await page.getByRole("button", { name: "メモする" }).click();
    await expect(
      page.getByRole("region", { name: "今回書いたこと" }),
    ).toContainText("本を決めずに、ぱらぱらと。");
    await page.getByRole("button", { name: "読書を終える" }).click();
    await confirmIn("読書を終えますか？", "本を閉じる");
    await expect(page.locator(".reading-log")).toContainText("本を選ばずに");
  });

  await check(
    "profile links accept web pages and refuse other schemes",
    async () => {
      await go("/profiles/me/");
      await page.getByRole("button", { name: "プロフィールを編集" }).click();
      const dialog = page.getByRole("dialog", { name: "読書家のプロフィール" });
      await dialog
        .getByLabel("リンク1", { exact: true })
        .fill("javascript:alert(1)");
      await dialog.getByRole("button", { name: "保存する" }).click();
      await expect(dialog.getByRole("alert")).toContainText(
        "URLとして読めない",
      );
      await dialog
        .getByLabel("リンク1", { exact: true })
        .fill("note.com/qa_reader");
      await dialog.getByRole("button", { name: "リンクを追加" }).click();
      await dialog
        .getByLabel("リンク2", { exact: true })
        .fill("https://www.youtube.com/@qa");
      await dialog.getByRole("button", { name: "保存する" }).click();
      await expect(dialog).toHaveCount(0);
      const links = page.getByRole("list", { name: "リンク" });
      await expect(links.getByRole("link")).toHaveText(["note", "YouTube"]);
      await expect(links.getByRole("link", { name: "note" })).toHaveAttribute(
        "href",
        "https://note.com/qa_reader",
      );
      await expect(links.getByRole("link", { name: "note" })).toHaveAttribute(
        "target",
        "_blank",
      );
      await page.reload();
      await page.waitForFunction(() => localStorage.getItem("book-town-v1"));
      await expect(links.getByRole("link")).toHaveCount(2);
    },
  );

  await check("reading confirmations can be declined", async () => {
    await go("/reading/");
    await page.getByRole("button", { name: /一人で読む/ }).click();
    const dialog = page.getByRole("dialog", { name: "読書をはじめますか？" });
    await expect(dialog.locator(".reading-confirm-phrase")).not.toBeEmpty();
    await dialog.getByRole("button", { name: "もう少し準備する" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "読書を開始" }),
    ).toBeVisible();
    expect((await stored()).readingSessions.every((s) => s.endedAt)).toBe(true);
  });

  await check("tags link to every post that shares them", async () => {
    // 宗's 便り, on his page: the reader follows nobody yet.
    await go("/profiles/r-sou/");
    await page.getByRole("link", { name: "#積読" }).first().click();
    await expect(page).toHaveURL(/\/search\//);
    await expect(
      page.getByRole("heading", { name: /#積読 の投稿/ }),
    ).toBeVisible();
    await expect(page.locator(".search-results")).toContainText(
      "今週は一冊も買わない",
    );
    // The sheet offers no tags to pick: a #word written in the words is
    // the tag, a link on the post.
    await go("/timeline/");
    await page.locator(".compose-fab").click();
    const compose = page.getByRole("dialog", { name: "投稿する" });
    await expect(compose.locator(".tag-chip")).toHaveCount(0);
    await compose.locator("textarea").fill("雨の日は #雨読 にかぎる");
    await compose.getByRole("button", { name: "投稿する" }).click();
    await expect(compose).toHaveCount(0);
    await page
      .locator("main article.post-card")
      .filter({ hasText: "雨の日は" })
      .getByRole("link", { name: "#雨読" })
      .click();
    await expect(page).toHaveURL(/\/search\//);
    await expect(
      page.getByRole("heading", { name: /#雨読 の投稿/ }),
    ).toBeVisible();
    await expect(page.locator(".search-results")).toContainText(
      "雨の日は #雨読 にかぎる",
    );
  });

  await check(
    "every reader has an @ID; the viewer can set a free one",
    async () => {
      await go("/timeline/");
      await expect(page.locator(".post-handle").first()).toHaveText(
        /^@[a-z0-9_]+$/,
      );
      await go("/profiles/me/");
      await expect(page.locator(".profile-handle")).toHaveText("@reader");
      await page.getByRole("button", { name: "プロフィールを編集" }).click();
      const dialog = page.getByRole("dialog", { name: "読書家のプロフィール" });
      await dialog.getByLabel("ユーザーID").fill("nagi");
      await dialog.getByRole("button", { name: "保存する" }).click();
      await expect(dialog.getByRole("alert")).toContainText("ほかの読書家");
      await dialog.getByLabel("ユーザーID").fill("Book_Reader");
      await dialog.getByRole("button", { name: "保存する" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator(".profile-handle")).toHaveText("@book_reader");
      await go("/search/");
      await page
        .getByRole("searchbox", { name: "本と書店を検索" })
        .fill("@book_r");
      await expect(page.getByRole("heading", { name: /読書家/ })).toBeVisible();
      await expect(page.locator(".search-results")).toContainText(
        "@book_reader",
      );
    },
  );

  await check(
    "book page shows the price, open shop links and three reviews first",
    async () => {
      await go("/books/solaris/");
      await expect(page.locator(".book-page-hero .book-price")).toContainText(
        "¥1,540",
      );
      await expect(
        page
          .locator(".book-page-hero")
          .getByRole("link", { name: /^Amazonで探す/ }),
      ).toBeVisible();
      await expect(
        page
          .locator(".book-page-hero")
          .getByRole("link", { name: /^この本についてGoogleで調べる/ }),
      ).toHaveAttribute(
        "href",
        "https://google.com/search?q=" + encodeURIComponent("ソラリス"),
      );
      const reviews = page.locator(
        ".book-reviews > .post-feed > article.post-card",
      );
      await expect(reviews).toHaveCount(3);
      const more = page.getByRole("button", {
        name: /残りのレビューをすべて表示/,
      });
      await more.click();
      await expect(more).toHaveCount(0);
      expect(await reviews.count()).toBeGreaterThan(3);
    },
  );

  await check(
    "closing the book can lead straight to writing a review",
    async () => {
      await go("/reading/");
      await page.getByRole("searchbox", { name: "読む本を探す" }).fill("モモ");
      await page.getByRole("button", { name: /^モモ/ }).click();
      await page.getByRole("button", { name: /一人で読む/ }).click();
      await confirmIn("読書をはじめますか？", "本を開く");
      await page.getByRole("button", { name: "読書を終える" }).click();
      await forgetFocus(page);
      await page
        .getByRole("dialog", { name: "読書を終えますか？" })
        .getByRole("button", { name: "感想を書く" })
        .tap();
      const review = page.getByRole("dialog", { name: "『モモ』の感想" });
      // A review is a writing screen: on a touch screen it opens with its
      // text box ready, focused within the tap, and the keyboard up.
      await expectKeyboardUp(page, review.locator("textarea"), "感想を書く");
      // In the town's shell still, at a phone's sizes: the text box at 16px,
      // and the words around it readable.
      await expectNoZoomOnFocus(review.locator("textarea"), "感想を書く");
      await expectReadable(review.locator(".composer-spoiler"), "ネタバレあり");
      await page.keyboard.type("時間どろぼうの話を、時間をかけて読んだ。");
      await review.getByRole("button", { name: "投稿する" }).tap();
      await expect(review).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "読書を開始" }),
      ).toBeVisible();
      await go("/books/momo/");
      await expect(page.locator(".book-reviews")).toContainText(
        "時間どろぼうの話を、時間をかけて読んだ。",
      );
    },
  );

  await check(
    "a shop being opened keeps its book, POP and sign through 戻る and a reload",
    async () => {
      const kept = () =>
        page.evaluate(() =>
          localStorage.getItem("book-town-open-shop-drafts-v1"),
        );
      const popField = page.getByLabel(
        "この1冊を渡したい理由（POPになります）",
      );
      await go("/my-shop/");
      await page.getByRole("button", { name: /たった1冊の本屋/ }).click();
      await page
        .getByRole("searchbox", { name: "棚に並べる本" })
        .fill("ソラリス");
      await page
        .getByRole("list", { name: "棚に並べる本の候補" })
        .getByRole("button", { name: /ソラリス/ })
        .click();
      await expect(page.locator(".open-shelf-book")).toHaveCount(1);
      await popField.fill("眠れない夜に、そっと渡したい。");
      await page.getByRole("button", { name: "看板を決める" }).click();
      await page.getByLabel("書店の名前").fill("夜更けの一冊堂");
      await page.getByLabel("ひとこと").fill("一冊だけ、深く。");
      await page.getByRole("button", { name: "あずき", exact: true }).click();
      // Out to Home (the tab last open there) and 戻る: the sign is as it
      // was left.
      await page
        .getByRole("navigation", { name: "スマートフォンナビゲーション" })
        .getByRole("link", { name: "ホーム" })
        .click();
      await expect(page).toHaveURL(
        (url) => url.pathname === "/" || url.pathname === "/timeline/",
      );
      await page.goBack();
      await expect(page.getByLabel("書店の名前")).toHaveValue("夜更けの一冊堂");
      await expect(page.getByLabel("ひとこと")).toHaveValue("一冊だけ、深く。");
      await expect(
        page.getByRole("button", { name: "あずき", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      // A reload starts at the first step, with a way to go on from there.
      const resume = page.locator(".open-resume");
      const goOn = page.getByRole("button", { name: "続きから", exact: true });
      await page.reload();
      await expect(resume).toContainText("書きかけを続けています");
      await expect(resume).toContainText("「夜更けの一冊堂」");
      await goOn.click();
      await expect(page.getByLabel("書店の名前")).toHaveValue("夜更けの一冊堂");
      await expect(page.getByText("書きかけを続けています")).toBeVisible();
      // A long name with no place to break stays inside the phone's width.
      const long = "TheMidnightLibrary".repeat(5).slice(0, 80);
      await page.getByLabel("書店の名前").fill(long);
      await page.reload();
      await expect(resume).toContainText(long);
      await noOverflow("a long shop name kept on the first step");
      await goOn.click();
      await page.getByLabel("書店の名前").fill("夜更けの一冊堂");
      await page.getByRole("button", { name: "本を選び直す" }).click();
      await expect(page.locator(".open-shelf-book")).toHaveCount(1);
      await expect(page.locator(".open-shelf-book")).toContainText("ソラリス");
      await expect(popField).toHaveValue("眠れない夜に、そっと渡したい。");
      // 戻る to the kinds and 進む again finds the same book and words.
      await page.goBack();
      await expect(
        page.getByRole("button", { name: /たった1冊の本屋/ }),
      ).toBeVisible();
      await page.goForward();
      await expect(popField).toHaveValue("眠れない夜に、そっと渡したい。");
      // Thrown away on purpose, asked once for the words in it, it is gone.
      await page.getByRole("button", { name: "書きかけを消す" }).click();
      await expect(page.getByText("書きかけを消しますか？")).toBeVisible();
      await page.getByRole("button", { name: "消す", exact: true }).click();
      await expect(page.locator(".open-shelf-book")).toHaveCount(0);
      await expect(popField).toHaveValue("");
      expect(await kept()).toBeNull();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "3分で、あなたの本屋を開く" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /たった1冊の本屋/ }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "続きから", exact: true }),
      ).toHaveCount(0);
      // The empty first step shows no count of nothing.
      await expect(page.locator(".open-shop")).not.toContainText(
        /(?<!\d)0(?!\d)/,
      );
    },
  );

  await check(
    "on a slow phone, 戻る from another page returns to the step left",
    async () => {
      // A slow phone may hold the page it leaves for seconds before letting
      // go of its steps: 戻る from Home still finds the sign as it was, and
      // each 戻る after that goes back one step.
      const sign = page.getByLabel("書店の名前");
      const slow = { timeout: 20_000 };
      await go("/my-shop/");
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
      try {
        await page.getByRole("button", { name: /たった1冊の本屋/ }).click();
        await page
          .getByRole("searchbox", { name: "棚に並べる本" })
          .fill("ソラリス");
        await page
          .getByRole("list", { name: "棚に並べる本の候補" })
          .getByRole("button", { name: /ソラリス/ })
          .click();
        await page.getByRole("button", { name: "看板を決める" }).click();
        await sign.fill("遠回り書房", slow);
        await page
          .getByRole("navigation", { name: "スマートフォンナビゲーション" })
          .getByRole("link", { name: "ホーム" })
          .click();
        await expect(page).toHaveURL(
          (url) => url.pathname === "/" || url.pathname === "/timeline/",
          slow,
        );
        await page.goBack();
        await expect(sign).toHaveValue("遠回り書房", slow);
        await page.goBack();
        await expect(page.locator(".open-shelf-book")).toContainText(
          "ソラリス",
          slow,
        );
        await page.goBack();
        await expect(
          page.getByRole("button", { name: /たった1冊の本屋/ }),
        ).toBeVisible(slow);
        await expect(page).toHaveURL(/\/my-shop\/$/);
      } finally {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        await cdp.detach();
      }
      // The next shop starts afresh.
      await page.evaluate(() =>
        localStorage.removeItem("book-town-open-shop-drafts-v1"),
      );
    },
  );

  await check(
    "a shop opens in three minutes: the nine, a sign, the lights",
    async () => {
      await go("/my-shop/");
      await page.getByRole("button", { name: /人生の9冊の本屋/ }).click();
      // The life nine already on the profile stand on the shelf.
      await expect(page.locator(".open-shelf-book")).toHaveCount(4);
      await expect(page.getByText("あと5冊まで並べられます。")).toBeVisible();
      await page
        .getByRole("searchbox", { name: "棚に並べる本" })
        .fill("見えない都市");
      await page
        .getByRole("list", { name: "棚に並べる本の候補" })
        .getByRole("button", { name: /見えない都市/ })
        .click();
      await expect(page.locator(".open-shelf-book")).toHaveCount(5);
      await page.getByRole("button", { name: "看板を決める" }).click();
      // 戻る goes back one step at a time, keeping what was chosen.
      await page.goBack();
      await expect(page.locator(".open-shelf-book")).toHaveCount(5);
      await page.goBack();
      await expect(
        page.getByRole("button", { name: /人生の9冊の本屋/ }),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/my-shop\/$/);
      await page.goForward();
      await expect(page.locator(".open-shelf-book")).toHaveCount(5);
      await page.goForward();
      await page.getByRole("button", { name: "名前の例" }).click();
      await expect(page.getByLabel("書店の名前")).toHaveValue("雨音書店");
      await page.getByLabel("ひとこと").fill("一頁ぶん、遠回り。");
      await page.getByRole("button", { name: "藍色", exact: true }).click();
      await page
        .getByRole("button", { name: "書店をひらく", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "「雨音書店」が開店しました",
      );
      // The steps that led to the opening are behind it: 戻る leaves the page.
      await expect
        .poll(() => page.evaluate(() => history.state?.booktownLayers ?? null))
        .toBeNull();
      // Open, the shop's opening is no longer kept as work in progress.
      expect(
        await page.evaluate(() =>
          localStorage.getItem("book-town-open-shop-drafts-v1"),
        ),
      ).toBeNull();
      const shop = (await stored()).ownShop;
      expect(shop.name).toBe("雨音書店");
      expect(shop.tagline).toBe("一頁ぶん、遠回り。");
      expect(shop.theme).toBe("ink");
      expect(shop.shelves[0].name).toBe("人生の9冊");
      expect(shop.shelves[0].isPublic).toBe(true);
      expect(shop.shelves[0].items.map((item) => item.display)).toEqual([
        "face",
        "spine",
        "spine",
        "spine",
        "spine",
      ]);
      await page.getByRole("button", { name: "棚を整える" }).click();
      await expect(page.locator(".editor-shelf-panel")).toHaveCount(1);
      // For a day, the street opens with the new shop and says it joined.
      await goHome();
      const first = page.locator(".street-shop").first();
      await expect(first.locator(".street-new-own")).toContainText(
        "あなたの書店が、街に加わりました",
      );
      await expect(first.locator("h2")).toHaveText("雨音書店");
      await expect(first.locator(".street-shop-tagline")).toHaveText(
        "一頁ぶん、遠回り。",
      );
      await expect(page.locator(".street-new-own")).toHaveCount(1);
      await go("/profiles/me/");
      await expect(
        page
          .locator(".profile-reader-actions")
          .getByRole("link", { name: "書店を整える" }),
      ).toHaveAttribute("href", "/my-shop/");
    },
  );

  await check(
    "a new shop's few books stand together under one chalkboard",
    async () => {
      await go("/walk/#mine");
      await expect(page.locator(".walk-sign")).toContainText("雨音書店");
      // One's own shop is tended, not liked or kept for later.
      await expect(
        page.getByRole("link", { name: "自分の店を整える" }),
      ).toHaveAttribute("href", "/my-shop/");
      await expect(
        page.getByRole("button", { name: "この店が好き" }),
      ).toHaveCount(0);
      await expect(page.locator('[data-row="row-0"] .walk-book')).toHaveCount(
        5,
      );
      await expect(page.locator(".walk-row-board")).toHaveCount(1);
      // The empty tiers hold a few things instead of bare boards.
      await expect(page.locator(".walk-row-still")).toHaveCount(2);
      await expect(page.locator(".walk-ownerPop")).toContainText(
        "一頁ぶん、遠回り。",
      );
      // Short words are shown whole, with nothing more to read.
      await expect(page.locator(".walk-floor-pop-more")).toHaveCount(0);
      // Without words of the owner's, the floor POP invites only the owner.
      await go("/my-shop/");
      await page.getByText("書店の看板と紹介").click();
      await page.getByLabel("ひとこと").fill("");
      await page.getByRole("button", { name: "変更を保存" }).click();
      await go("/walk/#mine");
      await page.getByRole("link", { name: /ひとことを書く/ }).click();
      await expect(page).toHaveURL(/\/my-shop\/#shop-words$/);
      // On a touch screen the words are shown open and wait for a tap: the
      // keyboard does not rise over them, and their form has the focus.
      const words = page.locator("#shop-words");
      await expect(words).toHaveAttribute("open", "");
      await expect(words.getByLabel("ひとこと")).toBeInViewport();
      const form = words.getByRole("form", { name: "書店の看板と紹介" });
      await expect(form).toBeFocused();
      await expectNoKeyboard(page, "the shop's words", form);
      await expectTapWrites(words.getByLabel("ひとこと"));
    },
  );

  // Enter while a kana conversion is still open: the keyboard's, never a search's.
  const composingEnter = (box) =>
    box.evaluate((input) =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 229,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

  await check(
    "every search box reads kana and romaji, and Enter takes only a sure match",
    async () => {
      // The shelf picker: reading and romaji find the book, Enter places only
      // the one surely meant and never takes a book off.
      await go("/my-shop/");
      await page
        .locator(".editor-shelf-panel")
        .first()
        .getByRole("button", { name: "本棚を編集", exact: true })
        .click();
      const shelfPicker = page.getByRole("dialog", { name: "本棚を編集" });
      const shelfSearch = shelfPicker.getByLabel("追加する本を検索");
      const shelfTitles = shelfPicker.locator(
        ".editor-picker-grid:not([role]) .editor-book-choice-title",
      );
      const shelved = async () =>
        (await stored()).ownShop.shelves[0].items.map((item) => item.bookId);
      const before = await shelved();
      expect(before).toContain("galaxy-railroad");
      expect(before).not.toContain("night-fog");
      await shelfSearch.fill("chinmoku");
      await expect(shelfTitles.first()).toHaveText("沈黙");
      await shelfSearch.fill("孤独");
      await expect(shelfTitles.first()).toContainText("孤独");
      await shelfSearch.press("Enter");
      await shelfSearch.fill("gingatetsudou");
      await expect(shelfTitles.first()).toHaveText("銀河鉄道の夜");
      await shelfSearch.press("Enter");
      // Near titles wait under a quiet heading that is still readable.
      await shelfSearch.fill("秘密の森の花園");
      await expect(shelfPicker.locator(".search-near")).toBeVisible();
      await expectReadable(shelfPicker.locator(".search-near"), "近い題名の本");
      await shelfSearch.fill("よるときり");
      await expect(shelfTitles.first()).toHaveText("夜と霧");
      await composingEnter(shelfSearch);
      await expect(shelfSearch).toHaveValue("よるときり");
      expect(await shelved()).toEqual(before);
      await shelfSearch.press("Enter");
      await expect(shelfSearch).toHaveValue("");
      await expect(shelfPicker).toBeVisible();
      await expect.poll(shelved).toContain("night-fog");
      expect(await shelved()).toHaveLength(before.length + 1);
      await shelfPicker
        .getByRole("button", { name: "完了", exact: true })
        .click();
      await expect(shelfPicker).toHaveCount(0);

      // The 人生の9冊 picker, the same way.
      await go("/profiles/me/");
      await page.locator(".profile-edit-nine").click();
      const nine = page.getByRole("dialog", { name: "人生の9冊を選ぶ" });
      const nineSearch = nine.getByRole("searchbox", {
        name: "人生の9冊に追加する本を検索",
      });
      const chosen = nine.locator(".profile-nine-editor-item");
      await expect(chosen).toHaveCount(4);
      await nineSearch.fill("roujintoumi");
      await expect(
        nine.locator(".profile-picker-book strong").first(),
      ).toHaveText("老人と海");
      await nineSearch.fill("秘密の森の花園");
      await expect(nine.locator(".search-near")).toBeVisible();
      await expectReadable(nine.locator(".search-near"), "近い題名の本");
      await nineSearch.fill("ヒミツノハナゾノ");
      await expect(
        nine.locator(".profile-picker-book strong").first(),
      ).toHaveText("秘密の花園");
      await composingEnter(nineSearch);
      await expect(chosen).toHaveCount(4);
      await nineSearch.press("Enter");
      await expect(chosen).toHaveCount(5);
      await expect(chosen.last()).toContainText("秘密の花園");
      await expect(nineSearch).toHaveValue("");
      await nineSearch.fill("孤独");
      await nineSearch.press("Enter");
      await expect(chosen).toHaveCount(5);
      await expect(nine).toBeVisible();
      await nine
        .getByRole("button", { name: "キャンセル", exact: true })
        .click();
      await expect(nine).toHaveCount(0);
      expect((await stored()).me.lifeNine).not.toContain("secret-garden");

      // Readers by name or @ID in either kana, either width, or romaji; no counts.
      await go("/search/");
      const box = page.getByRole("searchbox", { name: "本と書店を検索" });
      const people = page.locator(
        "[aria-labelledby=search-people-title] .search-list",
      );
      for (const [typed, handle] of [
        ["スミレ", "@sumire"],
        ["ＨＡＲＵ", "@haru"],
        ["＠ｓｕｍｉ", "@sumire"],
      ]) {
        await box.fill(typed);
        await expect(
          page.getByRole("heading", { name: "読書家", exact: true }),
        ).toBeVisible();
        await expect(people.locator("li")).toHaveCount(1);
        await expect(people).toContainText(handle);
      }
      const shopsFound = page.locator(
        "[aria-labelledby=search-shops-title] .search-shop",
      );
      // Typed one letter at a time, a reader stays found at a last n.
      for (const typed of ["a", "an", "ana"]) {
        await box.fill(typed);
        await expect(people.locator("b").first()).toHaveText("あなた");
      }
      // A kanji name typed in kana finds the reader by their romaji @ID,
      // and the ID finds the shop they keep.
      await box.fill("なぎ");
      await expect(people).toContainText("@nagi");
      await expect(shopsFound).toHaveText([/^軌道書房/]);
      // After @, readers and shops are both found by @ID only.
      await box.fill("@sumire");
      await expect(people).toContainText("@sumire");
      await expect(shopsFound).toHaveText([/^雨と翻訳/]);
      await box.fill("@スミレ");
      await expect(page.locator(".search-results")).toContainText(
        "合う書店は見つかりませんでした。",
      );
      await expect(people).toHaveCount(0);
      await expect(shopsFound).toHaveCount(0);
      // A shop named for the word comes before one whose owner is.
      await box.fill("灯");
      await expect(shopsFound.first()).toContainText("小さな灯り");
      await expect(shopsFound.nth(1)).toContainText("問いの余白");
      // A book's reading also finds the shops that shelve it.
      await box.fill("ぎんがてつどう");
      await expect(shopsFound).not.toHaveCount(0);
      expect(
        (await page.locator(".search-results h2").allTextContents()).join(""),
      ).not.toMatch(/\d/);

      // The top search (on wider screens; phones have 検索 in the bottom bar)
      // opens the search page, and 戻る comes back to where it was.
      await page.setViewportSize({ width: 1280, height: 900 });
      await go("/timeline/");
      const top = page.getByRole("textbox", {
        name: "本や書店を検索",
        exact: true,
      });
      await top.fill("ぎんがてつどう");
      await composingEnter(top);
      await page.waitForTimeout(300);
      await expect(page).toHaveURL(/\/timeline\/$/);
      await top.press("Enter");
      await expect(page).toHaveURL(
        `${baseURL}/search/?q=${encodeURIComponent("ぎんがてつどう")}`,
      );
      await expect(box).toHaveValue("ぎんがてつどう");
      await expect(
        page
          .locator(
            "[aria-labelledby=search-books-title] > ul:not([aria-labelledby]) .search-book",
          )
          .first(),
      ).toContainText("銀河鉄道の夜");
      await page.goBack();
      await expect(page).toHaveURL(/\/timeline\/$/);
      // On ホーム too: the words do not narrow the alley as typed; Enter
      // asks the search page, and 戻る comes back to the alley as it was.
      await goHome();
      // The alley comes a frame or two after the first 便り.
      await expect(page.locator(".street-shop").nth(1)).toBeAttached();
      const fronts = await page.locator(".street-shop").count();
      expect(fronts).toBeGreaterThan(1);
      await top.fill("雨と翻訳");
      await expect(page.locator(".street-shop")).toHaveCount(fronts);
      await top.press("Enter");
      await expect(page).toHaveURL(/\/search\/\?q=/);
      await expect(
        page
          .locator("[aria-labelledby=search-shops-title] .search-shop")
          .filter({ hasText: "雨と翻訳" }),
      ).toHaveCount(1);
      await page.goBack();
      await expect(page).toHaveURL(`${baseURL}/`);
      await expect(page.locator(".street-shop")).toHaveCount(fronts);
      await top.fill("");
      await page.setViewportSize({ width: 390, height: 844 });
    },
  );

  await check(
    "the lookup is Google's on every device, Safari on an iPhone or iPad too",
    async () => {
      const words = encodeURIComponent("ソラリス");
      const google = `https://google.com/search?q=${words}`;
      const served = await (
        await page.request.get(`${baseURL}/books/solaris/`)
      ).text();
      expect(served).toContain(`href="${google}"`);
      expect(served).not.toContain("x-web-search:");
      const MAC_SAFARI =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
      const devices = [
        {
          name: "iPhone Safari",
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
          viewport: { width: 390, height: 844 },
          touchPoints: 5,
        },
        // iPadOS asks for the computer's page, as a Mac with a touch screen.
        {
          name: "iPadOS Safari",
          userAgent: MAC_SAFARI,
          viewport: { width: 820, height: 1180 },
          touchPoints: 5,
        },
        {
          name: "Mac Safari",
          userAgent: MAC_SAFARI,
          viewport: { width: 1280, height: 900 },
          touchPoints: 0,
        },
        {
          name: "iPhone Chrome",
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
          viewport: { width: 390, height: 844 },
          touchPoints: 5,
        },
        {
          name: "iPhone LINE",
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.12.0",
          viewport: { width: 390, height: 844 },
          touchPoints: 5,
        },
      ];
      for (const device of devices) {
        const other = await browser.newContext({
          userAgent: device.userAgent,
          viewport: device.viewport,
          isMobile: device.name.startsWith("iPhone"),
          hasTouch: device.touchPoints > 0,
        });
        await other.addInitScript((points) => {
          Object.defineProperty(Navigator.prototype, "maxTouchPoints", {
            get: () => points,
          });
        }, device.touchPoints);
        const tab = settleBeforeNavigating(await other.newPage());
        tab.on("pageerror", (error) =>
          errors.push(`${device.name}: ${error.message}`),
        );
        tab.on("console", (message) => {
          if (message.type() === "error")
            errors.push(`${device.name}: ${message.text()}`);
        });
        await tab.goto(`${baseURL}/books/solaris/`);
        await tab.waitForFunction(() =>
          Object.keys(document.querySelector("main") ?? {}).some((key) =>
            key.startsWith("__reactFiber"),
          ),
        );
        // A frame and a task more, so an address put in once the page has
        // started would be in by the time Google's is checked.
        await tab.evaluate(
          () =>
            new Promise((done) =>
              requestAnimationFrame(() => setTimeout(done, 0)),
            ),
        );
        const lookup = tab.locator(".book-page-hero .book-lookup");
        await expect(lookup, device.name).toHaveAttribute("href", google);
        await expect(lookup, device.name).toHaveAccessibleName(
          "この本についてGoogleで調べる（新しいタブで開きます）",
        );
        // Still a plain link to a new tab, with the same words and icon.
        await expect(lookup).toHaveAttribute("target", "_blank");
        await expect(lookup).toHaveAttribute("rel", "noopener noreferrer");
        await expect(lookup).toHaveText("この本について調べる↗");
        await expect(lookup.locator("svg")).toHaveCount(1);
        await other.close();
      }
    },
  );

  await check(
    "No hydration errors, uncaught exceptions or console errors",
    async () => {
      expect(errors).toEqual([]);
    },
  );
  await context.close();
  await writeFile(
    path.join(output, "app-results.json"),
    JSON.stringify({ baseURL, passed, errors }, null, 2),
  );
} catch (error) {
  await page
    ?.screenshot({ path: path.join(output, "app-failure.png"), fullPage: true })
    .catch(() => {});
  await writeFile(
    path.join(output, "app-results.json"),
    JSON.stringify(
      { baseURL, passed, errors, failure: String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
