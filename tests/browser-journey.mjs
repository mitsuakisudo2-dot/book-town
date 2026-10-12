import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/qa",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.BOOK_TOWN_CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
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
const page = await context.newPage();
watch(page);
try {
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
      await page
        .getByRole("button", { name: "ソラリス · 面陳 · POPあり", exact: true })
        .click();
      await expect(
        page.getByRole("dialog").locator(".owner-pop"),
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
      await dialog.getByRole("button", { name: "完了", exact: true }).click();
      await expect(shelf.getByRole("meter")).toHaveAttribute(
        "aria-valuenow",
        "20",
      );
      await expect(
        shelf.getByRole("button", { name: "本棚を編集", exact: true }),
      ).toBeEnabled();
      expect((await stored(page)).ownShop.shelves[0].items).toHaveLength(20);
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
        page.getByRole("dialog").locator(".owner-pop"),
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
  const storageState = await context.storageState();
  await check(
    "a page opened directly leads to the town; one walked into goes back",
    async () => {
      await go(page, "/shops/shop-orbit/");
      await expect(page).toHaveTitle(/ \| Book Town$/);
      const nav = page.locator(".shop-journey-nav");
      await expect(nav.getByRole("link", { name: /本の街へ/ })).toBeVisible();
      // Walking along the row takes the shop's place, so going back still
      // leaves the row rather than stepping through each shop.
      const shopURL = page.url();
      await nav.getByRole("link", { name: /^次の書店/ }).click();
      await expect(page).not.toHaveURL(shopURL);
      await expect(nav.getByRole("link", { name: /本の街へ/ })).toBeVisible();
      const rowURL = page.url();
      await page.locator(".owner-profile-link").first().click();
      await expect(page).toHaveURL(/\/profiles\//);
      await expect(page.locator(".profile-back")).toHaveText(/戻る/);
      await page.locator(".profile-back").click();
      await expect(page).toHaveURL(rowURL);
      await expect(nav.getByRole("link", { name: /本の街へ/ })).toBeVisible();
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
  const phone = await mobile.newPage();
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
  await mobile.close();
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
