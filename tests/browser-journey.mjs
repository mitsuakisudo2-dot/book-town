import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  enterWhileComposing,
  settleBeforeNavigating,
} from "./journey-layers.mjs";
import {
  coarse,
  expectNoKeyboard,
  expectTapWrites,
} from "./journey-keyboard.mjs";

const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/qa",
);
await mkdir(output, { recursive: true });
// Uses Playwright's own Chromium unless BOOK_TOWN_CHROME names another browser.
const browser = await chromium.launch({
  executablePath: process.env.BOOK_TOWN_CHROME || undefined,
  headless: true,
});
const errors = [];
const results = [];
function watch(page) {
  page.on("pageerror", (error) =>
    errors.push({
      page: page.url(),
      type: "pageerror",
      message: error.message,
    }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push({
        page: page.url(),
        type: "console",
        message: message.text(),
      });
  });
}
async function check(name, operation) {
  await operation();
  results.push(name);
  console.log(`PASS ${name}`);
}
async function go(page, route) {
  await page.goto(`${baseURL}${route}`);
  await expect(page.locator("main")).toBeVisible();
  await page.waitForFunction(
    () => localStorage.getItem("book-town-v1") !== null,
  );
}
async function stored(page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("book-town-v1")).data,
  );
}
async function noOverflow(page, name) {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(size.body, `${name}: body overflow`).toBeLessThanOrEqual(
    size.width + 1,
  );
  expect(size.document, `${name}: document overflow`).toBeLessThanOrEqual(
    size.width + 1,
  );
}
const unplaced = (dialog) =>
  dialog.locator(
    '.editor-book-choice:not([disabled]):not([aria-pressed="true"])',
  );
async function addFirstBook(page, shelf) {
  await shelf.getByRole("button", { name: "本棚を編集", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "本棚を編集" });
  const title = await unplaced(dialog)
    .first()
    .locator(".editor-book-choice-title")
    .textContent();
  // Keep hold of this book: once placed it leaves the unplaced list.
  const choice = dialog.locator(".editor-book-choice").filter({
    has: page.locator(".editor-book-choice-title").getByText(title, {
      exact: true,
    }),
  });
  await choice.click();
  // The picker stays open for more books until 完了.
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "完了", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  return title;
}
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "ja-JP",
});
const page = settleBeforeNavigating(await context.newPage());
watch(page);
try {
  // Painted, not only parsed: a stylesheet that holds up rendering leaves the
  // page without a first contentful paint.
  async function townTextShownAt(reader) {
    const shownAt = await reader.waitForFunction(
      () => {
        const main = document.querySelector("main.town-main");
        return performance.getEntriesByName("first-contentful-paint").length >
          0 &&
          main?.checkVisibility({ opacityProperty: true }) &&
          main.innerText.trim() !== ""
          ? performance.now()
          : 0;
      },
      null,
      { polling: 100, timeout: 3000 },
    );
    return shownAt.jsonValue();
  }
  await check(
    "the town shows its text while Google's font CSS never answers",
    async () => {
      const stalled = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: "ja-JP",
      });
      // A line that drops Google: the request is never answered.
      await stalled.route("https://fonts.googleapis.com/**", () => {});
      const reader = await stalled.newPage();
      watch(reader);
      try {
        await reader.goto(`${baseURL}/`, { waitUntil: "commit" });
        expect(await townTextShownAt(reader)).toBeLessThan(3000);
      } finally {
        await stalled.close();
      }
    },
  );
  await check(
    "a reader back within a day turns the font CSS on before it arrives, and is not held up when it never does",
    async () => {
      const returning = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: "ja-JP",
      });
      // Google answers the first visit.
      let answer = (route) =>
        route.fulfill({
          contentType: "text/css",
          headers: { "access-control-allow-origin": "*" },
          body: "/* the font faces */",
        });
      await returning.route("https://fonts.googleapis.com/**", (route) =>
        answer(route),
      );
      const reader = await returning.newPage();
      watch(reader);
      try {
        await reader.goto(`${baseURL}/`);
        const fonts = reader.locator("#web-fonts");
        await expect(fonts).toHaveAttribute("media", "all");
        // Back again, and Google never answers.
        answer = () => {};
        await reader.goto(`${baseURL}/`, { waitUntil: "commit" });
        expect(await townTextShownAt(reader)).toBeLessThan(3000);
        // On for the screen without having arrived: with a cached copy, the
        // first layout asks for the font files.
        await expect(fonts).toHaveAttribute("media", "all");
      } finally {
        await returning.close();
      }
    },
  );
  await check(
    "an empty wishlist offers a few owners' POPs to start from",
    async () => {
      await go(page, "/reading-list/");
      const start = page.getByRole("region", {
        name: "店主のPOPから、気になる一冊を",
      });
      await expect(start.getByRole("link")).toHaveCount(3);
      await start.getByRole("link").first().click();
      await expect(page).toHaveURL(/\/books\//);
    },
  );
  await check(
    "Desktop town discovery and original bookstore signs",
    async () => {
      await go(page, "/");
      await expect(page.locator(".street-shop")).toHaveCount(6);
      await expect(
        page.getByRole("heading", {
          name: /本を探していたら、\s*人に出会った。/,
        }),
      ).toBeVisible();
      await noOverflow(page, "desktop town");
      await page.screenshot({
        path: path.join(output, "town-desktop.png"),
        fullPage: true,
        animations: "disabled",
      });
      const before = await page
        .locator(".street-shop-title a")
        .first()
        .getAttribute("aria-label");
      await page.getByRole("button", { name: "路地を変えてみる" }).click();
      expect(
        await page
          .locator(".street-shop-title a")
          .first()
          .getAttribute("aria-label"),
      ).not.toBe(before);
      await page
        .getByRole("button", { name: "軌道書房をフォロー", exact: true })
        .click();
      expect((await stored(page)).following).toContain("shop-orbit");
      await page
        .getByRole("button", { name: "フォロー中", exact: true })
        .click();
      await expect(page.locator(".street-shop")).toHaveCount(1);
      await page.getByRole("button", { name: "すべて", exact: true }).click();
    },
  );
  await check(
    "Book -> several different POPs -> exact shelf -> reader profile",
    async () => {
      // The street goes on in rounds, so a shop can appear more than once.
      // Its name leads into the walk; the footer opens its own page.
      const orbit = page
        .locator(".street-shop")
        .filter({ has: page.getByRole("link", { name: "軌道書房に入る" }) })
        .first();
      await expect(
        orbit.getByRole("link", { name: "軌道書房に入る" }),
      ).toHaveAttribute("href", "/walk/#shop-orbit");
      await orbit.getByRole("link", { name: /^紹介と/ }).click();
      // Demo shops have three public shelves, one per tier of the walk.
      await expect(page.locator(".store-shelf-section")).toHaveCount(3);
      await expect(
        page.locator(".shop-hero").getByRole("link", { name: "店内に入る" }),
      ).toHaveAttribute("href", "/walk/#shop-orbit");
      // Beside each shelf, the owner's POPs; one opens its book in hand.
      const firstPop = page.locator(".store-shelf-pops button").first();
      const words = await firstPop
        .locator(".store-shelf-pop-words")
        .textContent();
      await firstPop.click();
      await expect(
        page.getByRole("dialog").locator(".owner-pop .bh-pop-page.is-current"),
      ).toContainText(words.slice(0, 12));
      await page.getByRole("button", { name: "本を閉じて棚に戻る" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page
        .getByRole("button", { name: "ソラリス · 面陳 · POPあり", exact: true })
        .click();
      await expect(
        page.getByRole("dialog").locator(".owner-pop .bh-pop-page.is-current"),
      ).toContainText("自分の記憶に出会ってしまう");
      await page
        .getByRole("button", { name: "読みたいに加える", exact: true })
        .click();
      await page.getByRole("link", { name: "作品のページを開く" }).click();
      await expect(page).toHaveURL(/\/books\/solaris\/$/);
      await expect(
        page.getByRole("heading", { name: "ソラリス", exact: true }),
      ).toBeVisible();
      const cards = page.locator(".stockist");
      await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(4);
      const pops = await cards.locator("blockquote").allTextContents();
      expect(new Set(pops).size).toBe(pops.length);
      await cards
        .filter({
          has: page.getByRole("heading", { name: "雨と翻訳", exact: true }),
        })
        .getByRole("link", { name: "この棚を見に行く" })
        .click();
      await expect(page).toHaveURL(/\/shops\/shop-rain\/#shelf-rain-cities$/);
      await expect(page.locator("#shelf-rain-cities")).toBeInViewport();
      await page.locator(".owner-profile-link").click();
      await expect(
        page.getByRole("heading", { name: "すみれ", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".profile-nine-grid > div")).toHaveCount(9);
      // One link per public shelf; demo shops have three.
      await expect(page.locator(".profile-shelf-link")).toHaveCount(3);
      await page.locator(".profile-shelf-link").first().click();
      await expect(page).toHaveURL(/#shelf-rain-cities$/);
      expect((await stored(page)).wishlist).toContain("solaris");
    },
  );
  await check(
    "Create bookstore, change sign and theme, name shelves",
    async () => {
      await go(page, "/my-shop/");
      await page.getByRole("button", { name: "空の棚から始める" }).click();
      await page.getByLabel("書店の名前").fill("夜の寄り道書房");
      await page.getByRole("button", { name: "藍色", exact: true }).click();
      await page
        .getByRole("button", { name: "書店をひらく", exact: true })
        .click();
      await page.getByRole("button", { name: "棚を整える" }).click();
      await expect(page.locator(".editor-shelf-panel")).toHaveCount(1);
      // An empty shelf tells its room, not a count of nothing.
      await expect(page.locator(".editor-space-row")).toHaveText(
        "20スペース、まだ空いています",
      );
      await expect(page.locator(".editor-shelf-panel")).not.toContainText(
        /(?<!\d)0(?!\d)/,
      );
      const settings = page.locator(".editor-settings");
      await settings.locator("summary").click();
      await settings.getByLabel("書店の名前").fill("夜と寄り道書房");
      await settings.getByLabel("ひとこと").fill("一頁ぶん、遠回り。");
      await settings
        .getByRole("button", { name: "あずき", exact: true })
        .click();
      await settings
        .getByRole("button", { name: "変更を保存", exact: true })
        .click();
      await settings.locator("summary").click();
      const shelf = page.locator(".editor-shelf-panel").first();
      await shelf
        .getByRole("textbox", { name: "本棚の名前", exact: true })
        .fill("夜にひらく異世界");
      await shelf
        .getByRole("textbox", { name: "本棚の名前", exact: true })
        .press("Enter");
      await page
        .getByRole("button", { name: "本棚を追加", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("textbox", { name: "本棚の名前", exact: true })
        .fill("まだ内緒の一冊");
      await page
        .getByRole("button", { name: "この名前で本棚をつくる", exact: true })
        .click();
      const privateShelf = page.locator(".editor-shelf-panel").nth(1);
      await privateShelf
        .getByRole("button", { name: "本棚を非公開にする" })
        .click();
      await addFirstBook(page, privateShelf);
      const data = await stored(page);
      expect(data.ownShop.name).toBe("夜と寄り道書房");
      expect(data.ownShop.theme).toBe("rose");
      expect(data.ownShop.shelves.map((shelf) => shelf.name)).toEqual([
        "夜にひらく異世界",
        "まだ内緒の一冊",
      ]);
      expect(data.ownShop.shelves[1].isPublic).toBe(false);
    },
  );
  let reorderedBookId;
  await check(
    "Spine/face space accounting, owner POP and actual pointer drag reorder",
    async () => {
      const shelf = page.locator(".editor-shelf-panel").first();
      for (let n = 0; n < 3; n++) await addFirstBook(page, shelf);
      await shelf.locator(".shelf-book-button").first().click();
      await shelf
        .locator(".editor-selected-book")
        .getByRole("button", { name: /^面陳/ })
        .click();
      await expect(shelf.getByRole("meter")).toHaveAttribute(
        "aria-valuenow",
        "5",
      );
      await shelf
        .locator(".editor-selected-book textarea")
        .fill("理解できないもののそばに、静かに立ってみたい夜に。");
      await expect(shelf.locator(".shelf-book").first()).toHaveAttribute(
        "data-display",
        "face",
      );
      const before = (await stored(page)).ownShop.shelves[0].items.map(
        (item) => item.id,
      );
      const buttons = shelf.locator(".shelf-book-button");
      await buttons.first().scrollIntoViewIfNeeded();
      const source = await buttons.first().boundingBox();
      const target = await buttons.nth(2).boundingBox();
      await page.mouse.move(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        source.x + source.width / 2 + 10,
        source.y + source.height / 2,
        { steps: 3 },
      );
      await page.mouse.move(
        target.x + target.width / 2,
        target.y + target.height / 2,
        { steps: 20 },
      );
      await page.mouse.up();
      await expect
        .poll(async () =>
          (await stored(page)).ownShop.shelves[0].items
            .map((item) => item.id)
            .join(","),
        )
        .not.toBe(before.join(","));
      const after = (await stored(page)).ownShop.shelves[0].items;
      expect(after.map((item) => item.id)).toEqual([
        before[1],
        before[2],
        before[0],
      ]);
      expect(after[2].pop).toContain("理解できないもの");
      reorderedBookId = after[2].bookId;
      await shelf.locator(".shelf-book-button").last().click();
      await shelf
        .locator(".editor-selected-book")
        .getByRole("button", { name: /^背表紙/ })
        .click();
      await expect(shelf.getByRole("meter")).toHaveAttribute(
        "aria-valuenow",
        "3",
      );
    },
  );
  await check(
    "Capacity rejects face conversion and additions; removal frees space",
    async () => {
      const shelf = page.locator(".editor-shelf-panel").first();
      const openEditor = async () => {
        await shelf
          .getByRole("button", { name: "本棚を編集", exact: true })
          .click();
        return page.getByRole("dialog", { name: "本棚を編集" });
      };
      // One visit places many books in a row; a book just placed can be taken back.
      const picker = await openEditor();
      for (let n = 3; n < 19; n++) await unplaced(picker).first().click();
      const tally = picker.locator(".editor-picker-footer [role=status]");
      await expect(tally).toContainText("16冊並べました");
      await picker
        .locator(".editor-book-choice")
        .filter({ hasText: "並べました・押すと外す" })
        .last()
        .click();
      await expect(tally).toContainText("15冊並べました");
      await unplaced(picker).first().click();
      await expect(tally).toContainText("16冊並べました");
      // A book already on the shelf comes off with a tap, and back with its POP and place.
      const before = (await stored(page)).ownShop.shelves[0].items;
      const withPop = before.find((item) => item.pop);
      await picker
        .locator(".editor-book-choice")
        .filter({ hasText: "POPあり・押すと外す" })
        .click();
      await expect(tally).toContainText("1冊外しました");
      expect(
        (await stored(page)).ownShop.shelves[0].items.some(
          (item) => item.bookId === withPop.bookId,
        ),
      ).toBe(false);
      await picker
        .locator(".editor-book-choice")
        .filter({ hasText: "外しました・押すと戻す" })
        .click();
      await expect(tally).not.toContainText("外しました");
      const restored = (await stored(page)).ownShop.shelves[0].items;
      const index = (items) =>
        items.findIndex((item) => item.bookId === withPop.bookId);
      expect(index(restored)).toBe(index(before));
      expect(restored[index(restored)].pop).toBe(withPop.pop);
      expect(restored[index(restored)].display).toBe(withPop.display);
      await picker.getByRole("button", { name: "完了", exact: true }).click();
      await expect(picker).not.toBeVisible();
      await expect(shelf.getByRole("meter")).toHaveAttribute(
        "aria-valuenow",
        "19",
      );
      // Taken off and the picker closed, it still comes back from the picker
      // opened again, to its place and with its POP.
      const withPopAt = index(restored);
      const again = await openEditor();
      await again
        .locator(".editor-book-choice")
        .filter({ hasText: "POPあり・押すと外す" })
        .click();
      await expect(page.locator(".toast")).toContainText("POPごと元に戻せます");
      await again.getByRole("button", { name: "完了", exact: true }).click();
      await expect(again).not.toBeVisible();
      const reopened = await openEditor();
      // A visit counts only what it did itself.
      await expect(
        reopened.locator(".editor-picker-footer [role=status]"),
      ).toHaveText("押すたびに、並べる・外すを切り替えられます");
      await reopened
        .locator(".editor-book-choice")
        .filter({ hasText: "外しました・押すと戻す" })
        .click();
      await expect
        .poll(async () => index((await stored(page)).ownShop.shelves[0].items))
        .toBe(withPopAt);
      expect((await stored(page)).ownShop.shelves[0].items[withPopAt].pop).toBe(
        withPop.pop,
      );
      await reopened.getByRole("button", { name: "完了", exact: true }).click();
      await expect(reopened).not.toBeVisible();
      await shelf.locator(".shelf-book-button").first().click();
      await expect(
        shelf
          .locator(".editor-selected-book")
          .getByRole("button", { name: /^面陳/ }),
      ).toBeDisabled();
      const dialog = await openEditor();
      await dialog.getByRole("button", { name: /^面陳/ }).click();
      await expect(dialog.locator(".editor-capacity-warning")).toBeVisible();
      await expect(unplaced(dialog)).toHaveCount(0);
      await dialog.getByRole("button", { name: /^背表紙/ }).click();
      await unplaced(dialog).first().click();
      // The shelf is full: nothing more can be placed, but books on it can still come off.
      await expect(unplaced(dialog)).toHaveCount(0);
      // Full, it says so, with no room of nothing and no advice about spines.
      await expect(dialog.locator(".editor-picker-context")).toHaveText(
        "「夜にひらく異世界」は満席です。本を外すと、また並べられます。",
      );
      await expect(dialog.locator(".editor-capacity-warning")).toHaveCount(0);
      await dialog.getByRole("button", { name: "完了", exact: true }).click();
      await expect(shelf.getByRole("meter")).toHaveAttribute(
        "aria-valuenow",
        "20",
      );
      await expect(
        shelf.getByRole("button", { name: "本棚を編集", exact: true }),
      ).toBeEnabled();
      expect((await stored(page)).ownShop.shelves[0].items).toHaveLength(20);
      await expect(shelf.locator(".editor-space-row")).toContainText(
        "この棚は満席です",
      );
      // A book with a POP taken off from the shelf comes back with 元に戻す.
      const full = (await stored(page)).ownShop.shelves[0].items;
      await shelf.getByRole("button", { name: /POPあり/ }).click();
      await shelf.getByRole("button", { name: "この本を棚から外す" }).click();
      await expect(shelf.getByRole("meter")).toHaveAttribute(
        "aria-valuenow",
        "19",
      );
      await page
        .locator(".toast")
        .getByRole("button", { name: "元に戻す" })
        .click();
      await expect(page.locator(".toast")).toContainText(
        "元の場所に戻しました",
      );
      await expect(shelf.getByRole("meter")).toHaveAttribute(
        "aria-valuenow",
        "20",
      );
      expect(
        (await stored(page)).ownShop.shelves[0].items.map(
          ({ bookId, display, pop }) => [bookId, display, pop],
        ),
      ).toEqual(full.map(({ bookId, display, pop }) => [bookId, display, pop]));
      await shelf.locator(".shelf-book-button").first().click();
      await shelf.getByRole("button", { name: "この本を棚から外す" }).click();
      await expect(shelf.getByRole("meter")).toHaveAttribute(
        "aria-valuenow",
        "19",
      );
    },
  );
  await check(
    "Reload persistence and public/private shelf visibility",
    async () => {
      const before = await stored(page);
      await page.reload();
      await expect(page.locator(".editor-shelf-panel")).toHaveCount(2);
      expect(await stored(page)).toEqual(before);
      await page.getByRole("link", { name: "お店を眺める" }).click();
      await expect(
        page.getByRole("heading", { name: "夜と寄り道書房", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".store-shelf-section")).toHaveCount(1);
      await expect(page.locator(".shop-shelf-index")).not.toContainText(
        "まだ内緒",
      );
      const popBook = page
        .locator(".shelf-book-button")
        .filter({ hasText: "ソラリス" });
      await popBook.click();
      await expect(
        page.getByRole("dialog").locator(".owner-pop .bh-pop-page.is-current"),
      ).toContainText("理解できないもの");
      await page.getByRole("link", { name: "作品のページを開く" }).click();
      await expect(page).toHaveURL(/\/books\/solaris\/$/);
      const own = page.locator(".stockist").filter({
        has: page.getByRole("heading", {
          name: "夜と寄り道書房",
          exact: true,
        }),
      });
      await expect(own).toHaveCount(1);
      await expect(own).toContainText("夜にひらく異世界");
      await expect(own).not.toContainText("まだ内緒");
      await go(page, "/reading-list/");
      await expect(page.locator(".catalog-book")).toHaveCount(1);
      await expect(page.locator(".catalog-book")).toContainText("ソラリス");
    },
  );
  await check(
    "The shop's words and a shelf's new name stay through leaving and a reload",
    async () => {
      const kept = (key) =>
        page.evaluate((name) => localStorage.getItem(name), key);
      await go(page, "/my-shop/");
      const settings = page.locator(".editor-settings");
      await settings.locator("summary").click();
      await settings
        .getByLabel("書店の紹介")
        .fill("夜にだけ開く、小さな本屋です。");
      await settings.getByLabel("ひとこと").fill("書きかけのひとこと");
      // Out and back: the words are there, open where they were left.
      await page.getByRole("link", { name: "お店を眺める" }).click();
      await expect(page).toHaveURL(/\/shops\//);
      await go(page, "/my-shop/");
      await expect(settings).toHaveAttribute("open", "");
      await expect(settings.getByLabel("書店の紹介")).toHaveValue(
        "夜にだけ開く、小さな本屋です。",
      );
      await expect(settings.getByText("書きかけを続けています")).toBeVisible();
      await page.reload();
      await expect(settings.getByLabel("ひとこと")).toHaveValue(
        "書きかけのひとこと",
      );
      // Thrown away on purpose, asked once, the saved words come back.
      await settings.getByRole("button", { name: "書きかけを消す" }).click();
      await settings.getByRole("button", { name: "残す", exact: true }).click();
      await expect(settings.getByLabel("書店の紹介")).toHaveValue(
        "夜にだけ開く、小さな本屋です。",
      );
      await settings.getByRole("button", { name: "書きかけを消す" }).click();
      await settings.getByRole("button", { name: "消す", exact: true }).click();
      await expect(settings.getByLabel("書店の紹介")).toHaveValue("");
      await expect(settings.getByLabel("ひとこと")).toHaveValue(
        "一頁ぶん、遠回り。",
      );
      expect(await kept("book-town-shop-sign-drafts-v1")).toBeNull();
      // Saved, the words are the shop's and nothing is kept aside.
      await settings.getByLabel("書店の紹介").fill("夜にだけ開く本屋。");
      await settings
        .getByRole("button", { name: "変更を保存", exact: true })
        .click();
      expect((await stored(page)).ownShop.description).toBe(
        "夜にだけ開く本屋。",
      );
      expect(await kept("book-town-shop-sign-drafts-v1")).toBeNull();
      // A shelf's name being written is set when the page goes, as when the
      // field is left.
      const second = page.locator(".editor-shelf-panel").nth(1);
      const shelfName = second.getByRole("textbox", {
        name: "本棚の名前",
        exact: true,
      });
      await shelfName.fill("まだ内緒の二冊");
      // The Enter that confirms a kana conversion stays in the field; only
      // the reader's own Enter sets the name.
      await enterWhileComposing(page);
      await enterWhileComposing(page, { keyCode229: true });
      await expect(shelfName).toBeFocused();
      await expect(shelfName).toHaveValue("まだ内緒の二冊");
      await page.reload();
      await expect(shelfName).toHaveValue("まだ内緒の二冊");
      expect((await stored(page)).ownShop.shelves[1].name).toBe(
        "まだ内緒の二冊",
      );
      expect(await kept("book-town-shelf-name-drafts-v1")).toBeNull();
    },
  );
  await check(
    "A shelf removed takes its kept work along; a new one in its place starts clean",
    async () => {
      const kept = () =>
        page.evaluate(() =>
          localStorage.getItem("book-town-shelf-name-drafts-v1"),
        );
      await go(page, "/my-shop/");
      const panels = page.locator(".editor-shelf-panel");
      const count = await panels.count();
      const addShelf = async (name) => {
        await page
          .getByRole("button", { name: "本棚を追加", exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("textbox", { name: "本棚の名前", exact: true })
          .fill(name);
        await page
          .getByRole("button", { name: "この名前で本棚をつくる", exact: true })
          .click();
        await expect(panels).toHaveCount(count + 1);
        return (await stored(page)).ownShop.shelves.at(-1).id;
      };
      const goneId = await addShelf("消える棚");
      // A name half written for it, kept in this browser.
      const shopId = (await stored(page)).ownShop.id;
      await page.evaluate(
        (key) =>
          localStorage.setItem(
            "book-town-shelf-name-drafts-v1",
            JSON.stringify({
              version: 1,
              drafts: { [key]: { name: "消えた棚の書きかけ" } },
            }),
          ),
        `demo/${shopId}/${goneId}`,
      );
      await page.reload();
      const gone = panels.nth(count);
      const goneName = gone.getByRole("textbox", {
        name: "本棚の名前",
        exact: true,
      });
      await expect(goneName).toHaveValue("消えた棚の書きかけ");
      await expect(gone.getByText("書きかけを続けています")).toBeVisible();
      // A book placed and taken off is offered back in the picker.
      const title = await addFirstBook(page, gone);
      await gone.locator(".shelf-book-button").first().click();
      await gone.getByRole("button", { name: "この本を棚から外す" }).click();
      await gone
        .getByRole("button", { name: "本棚を編集", exact: true })
        .click();
      const picker = page.getByRole("dialog", { name: "本棚を編集" });
      await expect(
        picker.locator(".editor-book-choice").filter({ hasText: title }),
      ).toContainText("外しました・押すと戻す");
      await picker.getByRole("button", { name: "完了", exact: true }).click();
      await expect(picker).not.toBeVisible();
      // Removed, its book and its name go with it.
      await gone.getByRole("button", { name: "「消える棚」を削除" }).click();
      await expect(panels).toHaveCount(count);
      expect(await kept()).toBeNull();
      // A new shelf is given the same id, and nothing of the old one.
      expect(await addShelf("新しい棚")).toBe(goneId);
      const fresh = panels.nth(count);
      const freshName = fresh.getByRole("textbox", {
        name: "本棚の名前",
        exact: true,
      });
      await expect(freshName).toHaveValue("新しい棚");
      await expect(fresh.locator(".kept-note")).toHaveCount(0);
      await fresh
        .getByRole("button", { name: "本棚を編集", exact: true })
        .click();
      await expect(picker.getByText("外しました・押すと戻す")).toHaveCount(0);
      await expect(
        picker.locator(".editor-picker-footer [role=status]"),
      ).toHaveText("押すたびに、並べる・外すを切り替えられます");
      await picker.getByRole("button", { name: "完了", exact: true }).click();
      await page.reload();
      await expect(freshName).toHaveValue("新しい棚");
      await expect(fresh.locator(".kept-note")).toHaveCount(0);
      await fresh.getByRole("button", { name: "「新しい棚」を削除" }).click();
      await expect(panels).toHaveCount(count);
    },
  );
  await check(
    "Edit profile and life-nine ordering, add/remove, notes and reload",
    async () => {
      await go(page, "/profiles/me/");
      await expect(page.locator(".profile-nine-grid > div")).toHaveCount(9);
      await page.getByRole("button", { name: "プロフィールを編集" }).click();
      await page.getByLabel("ユーザー名", { exact: true }).fill("夜の読書家");
      await page
        .getByLabel("自己紹介", { exact: true })
        .fill("SFと翻訳文学のあいだを、ゆっくり歩いています。");
      await page.getByRole("button", { name: "保存する", exact: true }).click();
      await page.locator(".profile-edit-nine").click();
      const dialog = page.getByRole("dialog");
      const first = dialog.locator(".profile-nine-editor-item").first();
      const title = await first.locator("strong").textContent();
      await dialog
        .getByRole("button", { name: `${title}を後ろへ移動`, exact: true })
        .click();
      await dialog
        .getByRole("textbox", { name: `${title}へのひとこと`, exact: true })
        .fill("いつでも戻ってこられる、わたしの一冊。");
      await dialog
        .getByRole("button", { name: "伝奇集を人生の9冊に加える", exact: true })
        .click();
      await dialog
        .getByRole("textbox", { name: "ソラリスへのひとこと", exact: true })
        .fill("遠い惑星で、他者を思う。");
      const addedTitles = [];
      for (let n = 0; n < 4; n++) {
        const extra = dialog
          .locator(".profile-picker-book:not([disabled])")
          .first();
        addedTitles.push(await extra.locator("strong").textContent());
        await extra.click();
      }
      await expect(dialog.locator(".profile-nine-editor-item")).toHaveCount(9);
      await expect(
        dialog.locator(".profile-picker-book:not([disabled])"),
      ).toHaveCount(0);
      await expect(dialog.locator(".profile-picker-limit")).toBeVisible();
      for (const addedTitle of addedTitles)
        await dialog
          .getByRole("button", {
            name: `${addedTitle}を人生の9冊から外す`,
            exact: true,
          })
          .click();
      await expect(dialog.locator(".profile-nine-editor-item")).toHaveCount(5);
      await dialog
        .getByRole("button", { name: "この並びを保存", exact: true })
        .click();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "夜の読書家", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".profile-nine-item")).toHaveCount(5);
      expect((await stored(page)).me.lifeNine).toContain("solaris");
      await page
        .getByRole("button", { name: "ソラリスについてのひとことを読む" })
        .click();
      await expect(page.getByRole("dialog")).toContainText(
        "遠い惑星で、他者を思う。",
      );
      await page.getByRole("link", { name: "本の詳細へ" }).click();
      await expect(
        page.getByRole("heading", { name: "ソラリス", exact: true }),
      ).toBeVisible();
    },
  );
  await check(
    "Profile and nine being changed stay through Escape, a tap outside, 戻る and a reload",
    async () => {
      const kept = (key) =>
        page.evaluate((name) => localStorage.getItem(name), key);
      await go(page, "/profiles/me/");
      const editProfile = page.getByRole("button", {
        name: "プロフィールを編集",
      });
      const dialog = page.getByRole("dialog", { name: "読書家のプロフィール" });
      const bio = dialog.getByLabel("自己紹介", { exact: true });
      const saved = (await stored(page)).me.bio;
      await editProfile.click();
      await bio.fill("書きかけの自己紹介。まだ途中です。");
      // Escape keeps it.
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await editProfile.click();
      await expect(bio).toHaveValue("書きかけの自己紹介。まだ途中です。");
      await expect(dialog.getByText("書きかけを続けています")).toBeVisible();
      // A tap outside keeps it.
      await page.mouse.click(8, 8);
      await expect(dialog).toHaveCount(0);
      await editProfile.click();
      await expect(bio).toHaveValue("書きかけの自己紹介。まだ途中です。");
      // 戻る keeps it, and stays on the profile.
      await page.goBack();
      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL(/\/profiles\/me\/$/);
      // A reload keeps it.
      await page.reload();
      await editProfile.click();
      await expect(bio).toHaveValue("書きかけの自己紹介。まだ途中です。");
      expect((await stored(page)).me.bio).toBe(saved);
      // キャンセル asks once, for the words it would lose; 残す closes and
      // keeps them.
      await dialog.getByRole("button", { name: "キャンセル" }).click();
      await expect(dialog.getByText("書きかけを消しますか？")).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "残す", exact: true }),
      ).toBeFocused();
      await dialog.getByRole("button", { name: "残す", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await editProfile.click();
      await expect(bio).toHaveValue("書きかけの自己紹介。まだ途中です。");
      await dialog.getByRole("button", { name: "キャンセル" }).click();
      await dialog.getByRole("button", { name: "消す", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(await kept("book-town-profile-drafts-v1")).toBeNull();
      await editProfile.click();
      await expect(bio).toHaveValue(saved);
      await expect(dialog.getByText("書きかけを続けています")).toHaveCount(0);
      // Saved, it is the profile and nothing is kept aside.
      await bio.fill("書き終えた自己紹介。");
      await dialog.getByRole("button", { name: "保存する" }).click();
      await expect(dialog).toHaveCount(0);
      expect((await stored(page)).me.bio).toBe("書き終えた自己紹介。");
      expect(await kept("book-town-profile-drafts-v1")).toBeNull();

      // The nine: a new order and a word, kept the same ways.
      const nine = page.getByRole("dialog", { name: "人生の9冊を選ぶ" });
      const items = nine.locator(".profile-nine-editor-item strong");
      const before = (await stored(page)).me.lifeNine;
      await page.locator(".profile-edit-nine").click();
      const first = await items.first().textContent();
      await nine
        .getByRole("button", { name: `${first}を後ろへ移動`, exact: true })
        .click();
      await nine
        .getByRole("textbox", { name: `${first}へのひとこと`, exact: true })
        .fill("並べ直した夜の一冊。");
      const order = await items.allTextContents();
      expect(order[1]).toBe(first);
      await page.keyboard.press("Escape");
      await expect(nine).toHaveCount(0);
      await page.reload();
      await page.locator(".profile-edit-nine").click();
      await expect(items).toHaveText(order);
      await expect(
        nine.getByRole("textbox", {
          name: `${first}へのひとこと`,
          exact: true,
        }),
      ).toHaveValue("並べ直した夜の一冊。");
      await expect(nine.getByText("書きかけを続けています")).toBeVisible();
      expect((await stored(page)).me.lifeNine).toEqual(before);
      await page.goBack();
      await expect(nine).toHaveCount(0);
      await page.locator(".profile-edit-nine").click();
      await expect(items).toHaveText(order);
      // 書きかけを消す puts back the saved nine, asked once for the word.
      await nine.getByRole("button", { name: "書きかけを消す" }).click();
      await nine.getByRole("button", { name: "消す", exact: true }).click();
      await expect(items.first()).toHaveText(first);
      expect(await kept("book-town-nine-drafts-v1")).toBeNull();
      // Moved again and saved: the nine are the new order, nothing kept aside.
      await nine
        .getByRole("button", { name: `${first}を後ろへ移動`, exact: true })
        .click();
      await nine
        .getByRole("button", { name: "この並びを保存", exact: true })
        .click();
      await expect(nine).toHaveCount(0);
      expect((await stored(page)).me.lifeNine[1]).toBe(before[0]);
      expect(await kept("book-town-nine-drafts-v1")).toBeNull();
    },
  );
  const storageState = await context.storageState();
  await check(
    "a page opened directly leads to the town; one walked into goes back",
    async () => {
      await go(page, "/shops/shop-orbit/");
      await expect(page).toHaveTitle(/ \| Book Town$/);
      const nav = page.locator(".shop-journey-nav");
      await expect(nav.getByRole("link", { name: /本の街へ/ })).toBeVisible();
      // Each shop along the row is a step: 戻る returns to the one before,
      // and from the first shop opened directly, the way is to the town.
      const shopURL = page.url();
      await nav.getByRole("link", { name: /^次の書店/ }).click();
      await expect(page).not.toHaveURL(shopURL);
      await expect(nav.getByRole("button", { name: /戻る/ })).toBeVisible();
      const rowURL = page.url();
      await page.locator(".owner-profile-link").first().click();
      await expect(page).toHaveURL(/\/profiles\//);
      await expect(page.locator(".profile-back")).toHaveText(/戻る/);
      await page.locator(".profile-back").click();
      await expect(page).toHaveURL(rowURL);
      await nav.getByRole("button", { name: /戻る/ }).click();
      await expect(page).toHaveURL(shopURL);
      await expect(nav.getByRole("link", { name: /本の街へ/ })).toBeVisible();
    },
  );
  await check(
    "with a mouse, the profile's and the shop's sheets open with their field ready, and closing gives the focus back",
    async () => {
      expect(await coarse(page)).toBe(false);
      await go(page, "/profiles/me/");
      const editProfile = page.getByRole("button", {
        name: "プロフィールを編集",
      });
      const profile = page.getByRole("dialog", {
        name: "読書家のプロフィール",
      });
      const name = profile.getByLabel("ユーザー名", { exact: true });
      await editProfile.click();
      await expect(name).toBeFocused();
      await profile
        .getByLabel("自己紹介", { exact: true })
        .fill("消すための自己紹介。");
      await page.keyboard.press("Escape");
      await expect(profile).toHaveCount(0);
      await expect(editProfile).toBeFocused();
      // Thrown away, the name is ready again.
      await editProfile.click();
      await profile.getByRole("button", { name: "書きかけを消す" }).click();
      await profile.getByRole("button", { name: "消す", exact: true }).click();
      await expect(name).toBeFocused();
      await page.keyboard.press("Escape");
      const editNine = page.locator(".profile-edit-nine");
      const nine = page.getByRole("dialog", { name: "人生の9冊を選ぶ" });
      await editNine.click();
      await expect(nine.getByRole("textbox").first()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(editNine).toBeFocused();

      await go(page, "/my-shop/");
      const editShelf = page
        .locator(".editor-shelf-panel")
        .first()
        .getByRole("button", { name: "本棚を編集", exact: true });
      const picker = page.getByRole("dialog", { name: "本棚を編集" });
      await editShelf.click();
      await expect(picker.getByRole("searchbox")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(editShelf).toBeFocused();
      const addShelf = page.getByRole("button", {
        name: "本棚を追加",
        exact: true,
      });
      const newShelf = page.getByRole("dialog", { name: "新しい本棚をつくる" });
      await addShelf.click();
      await expect(
        newShelf.getByRole("textbox", { name: "本棚の名前" }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(addShelf).toBeFocused();
      // The sign's words thrown away: the shop's name is ready.
      const settings = page.locator(".editor-settings");
      await settings.locator("summary").click();
      await settings.getByLabel("書店の紹介").fill("消すための紹介。");
      await page.reload();
      await settings.getByRole("button", { name: "書きかけを消す" }).click();
      await settings.getByRole("button", { name: "消す", exact: true }).click();
      await expect(settings.getByLabel("書店の名前")).toBeFocused();
      // The walk's invitation to write the owner's words (a link here)
      // opens them ready.
      await go(page, "/");
      await go(page, "/my-shop/#shop-words");
      await expect(settings.getByLabel("ひとこと")).toBeFocused();
    },
  );
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: "ja-JP",
    storageState,
  });
  const phone = settleBeforeNavigating(await mobile.newPage());
  watch(phone);
  await check(
    "390px mobile discovery, store, book, profile and wishlist fit viewport",
    async () => {
      for (const [route, name] of [
        ["/", "town"],
        ["/shops/shop-orbit/", "store"],
        ["/books/solaris/", "book"],
        ["/profiles/r-sumire/", "profile"],
        ["/reading-list/", "wishlist"],
      ]) {
        await go(phone, route);
        await noOverflow(phone, `mobile ${name}`);
        await expect(
          phone.getByRole("navigation", {
            name: "スマートフォンナビゲーション",
          }),
        ).toBeVisible();
        if (name === "town" || name === "store" || name === "profile")
          await phone.screenshot({
            path: path.join(output, `${name}-mobile.png`),
            fullPage: true,
            animations: "disabled",
          });
      }
    },
  );
  await check(
    "Mobile move-button fallback, persistence and shelf horizontal scroll",
    async () => {
      await go(phone, "/my-shop/");
      await noOverflow(phone, "mobile editor");
      const shelf = phone.locator(".editor-shelf-panel").first();
      const before = (await stored(phone)).ownShop.shelves[0].items;
      await shelf.locator(".shelf-book-button").first().tap();
      await shelf.getByRole("button", { name: /を一つ右へ移動$/ }).tap();
      const after = (await stored(phone)).ownShop.shelves[0].items;
      expect(after[1].id).toBe(before[0].id);
      expect(after[0].id).toBe(before[1].id);
      await phone.reload();
      expect((await stored(phone)).ownShop.shelves[0].items).toEqual(after);
      const scroll = shelf.locator(".shelf-scroll");
      expect(
        await scroll.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
      ).toBe(true);
      await phone.screenshot({
        path: path.join(output, "editor-mobile.png"),
        fullPage: true,
        animations: "disabled",
      });
      expect(
        after.some(
          (item) =>
            item.bookId === reorderedBookId &&
            item.pop.includes("理解できないもの"),
        ),
      ).toBe(true);
    },
  );
  await check(
    "390px phone: the profile's and the shop's sheets open without the keyboard, and a tap on a field writes",
    async () => {
      expect(await coarse(phone)).toBe(true);
      const closer = (dialog) =>
        dialog.getByRole("button", { name: "閉じる", exact: true });
      await go(phone, "/profiles/me/");
      const editProfile = phone.getByRole("button", {
        name: "プロフィールを編集",
      });
      const profile = phone.getByRole("dialog", {
        name: "読書家のプロフィール",
      });
      const bio = profile.getByLabel("自己紹介", { exact: true });
      await editProfile.tap();
      await expectNoKeyboard(phone, "profile", profile);
      await expect(closer(profile)).toBeFocused();
      await expectTapWrites(bio);
      await phone.keyboard.type("指で書いた自己紹介。");
      // Closed, the focus goes back to the button that opened it.
      await phone.keyboard.press("Escape");
      await expect(profile).toHaveCount(0);
      await expect(editProfile).toBeFocused();
      // Thrown away, the words go, and the keyboard stays down.
      await editProfile.tap();
      await profile.getByRole("button", { name: "書きかけを消す" }).tap();
      await profile.getByRole("button", { name: "消す", exact: true }).tap();
      await expect(bio).not.toHaveValue(/指で書いた/);
      await expectNoKeyboard(phone, "profile thrown away", profile);
      await expectTapWrites(profile.getByLabel("ユーザー名", { exact: true }));
      await phone.keyboard.press("Escape");
      await expect(profile).toHaveCount(0);
      const nine = phone.getByRole("dialog", { name: "人生の9冊を選ぶ" });
      await phone.locator(".profile-edit-nine").tap();
      await expectNoKeyboard(phone, "nine", nine);
      await expectTapWrites(nine.getByRole("textbox").first());
      await phone.keyboard.press("Escape");
      // A sheet whose first control is a choice opens on 閉じる all the same.
      const settings = phone.getByRole("dialog", { name: "設定" });
      await phone
        .locator(".profile-minor-actions")
        .getByRole("button", { name: "設定" })
        .tap();
      await expectNoKeyboard(phone, "settings", settings);
      await expect(closer(settings)).toBeFocused();
      await phone.keyboard.press("Escape");

      await go(phone, "/my-shop/");
      const editShelf = phone
        .locator(".editor-shelf-panel")
        .first()
        .getByRole("button", { name: "本棚を編集", exact: true });
      const picker = phone.getByRole("dialog", { name: "本棚を編集" });
      await editShelf.tap();
      await expectNoKeyboard(phone, "shelf books", picker);
      await expectTapWrites(picker.getByRole("searchbox"));
      await phone.keyboard.press("Escape");
      await expect(editShelf).toBeFocused();
      const newShelf = phone.getByRole("dialog", {
        name: "新しい本棚をつくる",
      });
      await phone
        .getByRole("button", { name: "本棚を追加", exact: true })
        .tap();
      await expectNoKeyboard(phone, "new shelf", newShelf);
      await expectTapWrites(
        newShelf.getByRole("textbox", { name: "本棚の名前" }),
      );
      await phone.keyboard.press("Escape");
      // The sign's words thrown away: the field waits, and the form of the
      // words, named for keys and screen readers, has the focus.
      const sign = phone.locator(".editor-settings");
      const words = sign.getByRole("form", { name: "書店の看板と紹介" });
      await sign.locator("summary").tap();
      await sign.getByLabel("書店の紹介").fill("指で書いた紹介。");
      await phone.reload();
      await sign.getByRole("button", { name: "書きかけを消す" }).tap();
      await sign.getByRole("button", { name: "消す", exact: true }).tap();
      await expect(sign.getByLabel("書店の紹介")).not.toHaveValue(/指で/);
      await expect(words).toBeFocused();
      await expectNoKeyboard(phone, "sign thrown away", words);
      await expectTapWrites(sign.getByLabel("書店の名前"));
      // Loaded afresh at the owner's words (the walk's link reloaded, or
      // opened in a new tab): shown open with the field in view, the focus on
      // their form, and no ring drawn around what only holds the focus.
      await go(phone, "/");
      await go(phone, "/my-shop/#shop-words");
      await expect(words).toBeFocused();
      await expect(sign).toHaveAttribute("open", "");
      await expect(sign.getByLabel("ひとこと")).toBeInViewport();
      await expectNoKeyboard(phone, "the shop's words loaded", words);
      expect(
        await words.evaluate((form) => getComputedStyle(form).outlineStyle),
        "a ring around the form holding the focus",
      ).toBe("none");
      await expectTapWrites(sign.getByLabel("ひとこと"));
    },
  );
  await mobile.close();
  await check(
    "戻る returns to the tab, filter, search, lane and shop the reader left",
    async () => {
      await go(page, "/timeline/");
      await page
        .getByRole("button", { name: "フォロー中", exact: true })
        .click();
      await expect(page).toHaveURL(/show=following/);
      await page.locator("main a[href^='/']").first().click();
      await expect(page).not.toHaveURL(/timeline/);
      await page.goBack();
      await expect(
        page.getByRole("button", { name: "フォロー中", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");

      await go(page, "/search/");
      await page.getByRole("searchbox").first().fill("夜");
      await expect(page).toHaveURL(/q=%E5%A4%9C/);
      await page.locator("main a[href^='/books/']").first().click();
      await expect(page).toHaveURL(/\/books\//);
      await page.goBack();
      await expect(page.getByRole("searchbox").first()).toHaveValue("夜");

      await go(page, "/profile/");
      await page
        .getByRole("button", { name: /お気に入り/ })
        .first()
        .click();
      await expect(page).toHaveURL(/books=favorites/);
      await page.locator("main a[href^='/books/']").first().click();
      await expect(page).toHaveURL(/\/books\//);
      await page.goBack();
      await expect(
        page.getByRole("button", { name: /お気に入り/ }).first(),
      ).toHaveAttribute("aria-pressed", "true");

      // Each shop along the row is a step: 戻る goes to the one before.
      await go(page, "/shops/shop-orbit/");
      await page.getByRole("link", { name: /^次の書店：/ }).click();
      await expect(page).not.toHaveURL(/shop-orbit/);
      await page.goBack();
      await expect(page).toHaveURL(/shops\/shop-orbit/);

      // The walk comes back to the shop in view, not the one it began at.
      await go(page, "/walk/#shop-orbit");
      await page.mouse.move(720, 500);
      await page.mouse.wheel(0, 900);
      await expect(page).not.toHaveURL(/#shop-orbit$/);
      const walked = page.url();
      await page.locator("main a[href^='/profiles/']").first().click();
      await expect(page).toHaveURL(/\/profiles\//);
      await page.goBack();
      await expect(page).toHaveURL(walked);

      // The street keeps its lane, and a tap on a shop is not lost while
      // the street grows underneath it.
      await go(page, "/");
      await page.getByRole("button", { name: "路地を変えてみる" }).click();
      await expect(page).toHaveURL(/lane=1/);
      const first = await page
        .locator(".street-shop-title a")
        .first()
        .getAttribute("aria-label");
      await page
        .locator(".street-shop")
        .last()
        .getByRole("link", { name: /^紹介と/ })
        .click();
      await expect(page).toHaveURL(/\/shops\//);
      await page.goBack();
      await expect(page).toHaveURL(/lane=1/);
      expect(
        await page
          .locator(".street-shop-title a")
          .first()
          .getAttribute("aria-label"),
      ).toBe(first);
    },
  );
  await check(
    "戻る closes a dialog or a book in hand, and a book left for its page is in hand again",
    async () => {
      const dialog = page.locator(".bh-dialog");
      const book = page.locator("main .shelf-book-button").first();
      await go(page, "/");
      await page
        .locator(".street-shop")
        .filter({ has: page.getByRole("link", { name: "軌道書房に入る" }) })
        .getByRole("link", { name: /^紹介と/ })
        .click();
      await expect(page).toHaveURL(/shops\/shop-orbit/);
      const shopURL = page.url();

      // 戻る puts the book back on the shelf, and stays in the shop.
      await book.click();
      await expect(dialog).toBeVisible();
      await page.goBack();
      await expect(dialog).not.toBeVisible();
      await expect(page).toHaveURL(shopURL);

      // Put back by hand, the book leaves no step behind: 戻る leaves the shop.
      await book.click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "本を閉じて棚に戻る" }).click();
      await expect(dialog).not.toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(`${baseURL}/`);
      await page.goForward();
      await expect(page).toHaveURL(shopURL);

      // From the book's own page, 戻る returns with the same book in hand.
      await book.click();
      const title = await dialog.locator("h2").innerText();
      await dialog.locator("h2").getByRole("link").click();
      await expect(page).toHaveURL(/\/books\//);
      await page.goBack();
      await expect(page).toHaveURL(shopURL);
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("h2")).toHaveText(title);
      await page.goBack();
      await expect(dialog).not.toBeVisible();
      await expect(page).toHaveURL(shopURL);

      // A dialog closes on 戻る too; a link inside it leaves from the page.
      await go(page, "/timeline/");
      await page.getByRole("button", { name: "投稿する" }).click();
      const compose = page.getByRole("dialog", { name: "投稿する" });
      await expect(compose).toBeVisible();
      await page.goBack();
      await expect(compose).toHaveCount(0);
      await expect(page).toHaveURL(/\/timeline\/$/);
    },
  );
  await check("a link to a shop that is gone says it is closed", async () => {
    await page.goto(`${baseURL}/shop/?id=gone-shop`);
    await expect(
      page.getByRole("heading", { name: "この書店は、いまは閉まっています。" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /ほかの書店をめぐる/ }),
    ).toHaveAttribute("href", "/walk/");
  });
  await check(
    "No hydration failures, browser exceptions or console errors",
    async () => {
      expect(errors).toEqual([]);
    },
  );
  await writeFile(
    path.join(output, "browser-results.json"),
    JSON.stringify({ baseURL, passed: results, errors }, null, 2),
  );
} catch (error) {
  await page
    .screenshot({
      path: path.join(output, "failure-desktop.png"),
      fullPage: true,
      animations: "disabled",
    })
    .catch(() => {});
  await writeFile(
    path.join(output, "browser-results.json"),
    JSON.stringify(
      { baseURL, passed: results, errors, failure: String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
