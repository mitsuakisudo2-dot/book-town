import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/street-qa",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.BOOK_TOWN_CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const errors = [];
const passed = [];
let currentPage;

function watch(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
}
async function check(name, operation) {
  await operation();
  passed.push(name);
  console.log(`PASS ${name}`);
}
async function go(page, route = "/") {
  await page.goto(`${baseURL}${route}`);
  await expect(page.locator("main")).toBeVisible();
  await page.waitForFunction(() => localStorage.getItem("book-town-v1"));
}
async function noOverflow(page, label) {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(size.body, `${label}: body overflow`).toBeLessThanOrEqual(
    size.width + 1,
  );
  expect(size.document, `${label}: root overflow`).toBeLessThanOrEqual(
    size.width + 1,
  );
}
function shop(page, name) {
  return page.locator(".street-shop").filter({
    has: page.getByRole("link", { name: `${name}に入る`, exact: true }),
  });
}
async function shelfTitles(shelf) {
  const labels = await shelf
    .locator(".shelf-book-button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );
  return labels.map((label) => label.split(" · ")[0]);
}
async function expectBook(page, title) {
  await expect(
    page
      .locator(".bh-dialog")
      .getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}

// Synthetic touch checks exercise intent detection; real-device gesture arbitration
// remains a separate manual check and is not claimed by this browser suite.
async function touchGesture(page, dx, dy) {
  await page.locator(".bh-content").evaluate(
    (element, delta) => {
      const start = {
        identifier: 1,
        target: element,
        clientX: 190,
        clientY: 280,
      };
      const first = new Touch(start);
      element.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          touches: [first],
          changedTouches: [first],
        }),
      );
      const last = new Touch({
        ...start,
        clientX: start.clientX + delta.dx,
        clientY: start.clientY + delta.dy,
      });
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
    },
    { dx, dy },
  );
}

try {
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "ja-JP",
  });
  const page = await desktop.newPage();
  currentPage = page;
  watch(page);
  await check(
    "Street shows six unique demo bookstores with public shelves",
    async () => {
      await go(page);
      await expect(page.locator(".street-shop")).toHaveCount(6);
      await expect(
        page.getByRole("heading", {
          name: /本を探していたら、\s*人に出会った。/,
        }),
      ).toBeVisible();
      const names = await page.locator(".street-shop-title").allTextContents();
      expect(new Set(names).size).toBe(6);
      await expect(page.locator(".street-shop .shelf-scroll")).toHaveCount(12);
      await noOverflow(page, "1440px street");
      await page.screenshot({
        path: path.join(output, "street-desktop.png"),
        fullPage: false,
        animations: "disabled",
      });
    },
  );
  await check(
    "Shelf order and exact owner POP survive every adjacent-book step",
    async () => {
      const shelf = shop(page, "軌道書房").locator(".shelf-scroll").first();
      const titles = await shelfTitles(shelf);
      await shelf.locator(".shelf-book-button").first().click();
      await expectBook(page, titles[0]);
      const dialog = page.locator(".bh-dialog");
      await expect(dialog).toContainText("わからないものと暮らす");
      await expect(dialog).toContainText(
        "異星人の話を読むつもりが、自分の記憶に出会ってしまう。わからない相手を、わからないまま大切にできるだろうか。",
      );
      await expect(
        dialog.getByRole("button", { name: "前の本", exact: true }),
      ).toBeDisabled();
      for (const title of titles.slice(1)) {
        await dialog
          .getByRole("button", { name: "次の本", exact: true })
          .click();
        await expectBook(page, title);
      }
      await expect(
        dialog.getByRole("button", { name: "次の本", exact: true }),
      ).toBeDisabled();
      await page.keyboard.press("ArrowRight");
      await expectBook(page, titles.at(-1));
      for (const title of titles.slice(0, -1).reverse()) {
        await dialog
          .getByRole("button", { name: "前の本", exact: true })
          .click();
        await expectBook(page, title);
      }
      await expect(
        dialog.getByRole("button", { name: "前の本", exact: true }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      const rainShelf = shop(page, "雨と翻訳").locator(".shelf-scroll").first();
      await rainShelf
        .getByRole("button", {
          name: "ソラリス · 背表紙 · POPあり",
          exact: true,
        })
        .click();
      await expect(dialog).toContainText(
        "翻訳で読む、理解の届かなさ。異なる世界に触れる入口として。",
      );
      await expect(dialog).not.toContainText("自分の記憶に出会ってしまう");
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "Native dialog traps keyboard focus and restores the source book",
    async () => {
      const trigger = shop(page, "軌道書房")
        .locator(".shelf-book-button")
        .first();
      await trigger.click();
      const dialog = page.locator(".bh-dialog");
      for (let n = 0; n < 14; n++) {
        await page.keyboard.press("Tab");
        expect(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(true);
      }
      for (let n = 0; n < 4; n++) {
        await page.keyboard.press("Shift+Tab");
        expect(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    },
  );
  await check(
    "Wishlist toggles in foreground and survives reload",
    async () => {
      const trigger = shop(page, "軌道書房")
        .locator(".shelf-book-button")
        .first();
      await trigger.click();
      const save = page
        .locator(".bh-dialog")
        .getByRole("button", { name: /^読みたいに(?:加える|登録済み)$/ });
      await expect(save).toHaveAttribute("aria-pressed", "false");
      await save.click();
      await expect(save).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await trigger.click();
      await expect(save).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Escape");
      await go(page, "/reading-list/");
      await expect(page.locator(".catalog-book")).toHaveCount(1);
      await expect(page.locator(".catalog-book")).toContainText("ソラリス");
      await go(page);
    },
  );
  await check(
    "Follow, search, empty state and changing the lane keep discovery usable",
    async () => {
      await page
        .getByRole("button", { name: "軌道書房をフォロー", exact: true })
        .click();
      await page
        .getByRole("button", { name: "フォロー中", exact: true })
        .click();
      await expect(page.locator(".street-shop")).toHaveCount(1);
      await expect(shop(page, "軌道書房")).toBeVisible();
      await page
        .getByRole("button", { name: "フォロー中", exact: true })
        .click();
      const query = page.getByRole("textbox", {
        name: "本や書店を検索",
        exact: true,
      });
      await query.fill("雨と翻訳");
      await expect(page.locator(".street-shop")).toHaveCount(1);
      await expect(shop(page, "雨と翻訳")).toBeVisible();
      await query.fill("存在しない本屋_qa_20261010");
      await expect(page.locator(".street-shop")).toHaveCount(0);
      await expect(page.locator("main")).toContainText(
        /見つか|見当た|ありません/,
      );
      await query.fill("");
      const original = await page
        .locator(".street-shop-title")
        .first()
        .textContent();
      await page
        .getByRole("button", { name: "路地を変えてみる", exact: true })
        .click();
      expect(
        await page.locator(".street-shop-title").first().textContent(),
      ).not.toBe(original);
      await expect(page.locator(".street-shop")).toHaveCount(6);
      const names = await page.locator(".street-shop-title").allTextContents();
      expect(new Set(names).size).toBe(6);
      await page.locator(".street-shop").last().scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect(page.locator(".street-shop")).toHaveCount(6);
      await expect(page.locator(".street-end")).toContainText(
        "今日の路地は、ここまで。",
      );
      await expect(page.locator(".street-end")).toContainText("架空のデモ");
    },
  );
  await check(
    "Book browsing and the original directory remain accessible",
    async () => {
      await go(page);
      await page
        .getByRole("button", { name: "一冊からたどる", exact: true })
        .click();
      await expect(page.locator(".street-book-grid article")).toHaveCount(24);
      await page
        .getByRole("textbox", { name: "本や書店を検索", exact: true })
        .fill("レム");
      await expect(page.locator(".street-book-grid article")).toHaveCount(1);
      await page.locator(".street-book-grid article a").click();
      await expect(page).toHaveURL(/books\/solaris/);
      await go(page);
      await page.getByRole("button", { name: "書店一覧", exact: true }).click();
      await expect(page.locator(".shop-card")).toHaveCount(6);
      await page
        .getByRole("button", { name: "街の散歩に戻る", exact: true })
        .click();
      await expect(page.locator(".street-shop")).toHaveCount(6);
    },
  );
  await check(
    "Private shelf names, books and POPs stay out of the street and search",
    async () => {
      await page.evaluate(() => {
        const envelope = JSON.parse(localStorage.getItem("book-town-v1"));
        envelope.data.ownShop = {
          id: "mine",
          ownerId: "me",
          name: "公開展示QA書店",
          description: "公開する棚だけが見える書店。",
          theme: "sage",
          tagline: "公開する一冊",
          followers: 0,
          demo: false,
          shelves: [
            {
              id: "qa-public",
              name: "公開QA棚",
              capacity: 20,
              isPublic: true,
              items: [
                {
                  id: "qa-public-item",
                  bookId: "momo",
                  display: "face",
                  pop: "公開QAの紹介文",
                },
              ],
            },
            {
              id: "qa-private",
              name: "秘密QA棚_非公開",
              capacity: 20,
              isPublic: false,
              items: [
                {
                  id: "qa-private-item",
                  bookId: "solaris",
                  display: "face",
                  pop: "秘密QAの紹介文_非公開",
                },
              ],
            },
          ],
        };
        localStorage.setItem("book-town-v1", JSON.stringify(envelope));
      });
      await page.reload();
      const own = shop(page, "公開展示QA書店");
      await expect(own.locator(".shelf-scroll")).toHaveCount(1);
      await expect(own).toContainText("公開QA棚");
      await expect(own).not.toContainText("ソラリス");
      await expect(page.locator("main")).not.toContainText("秘密QA");
      await page
        .getByRole("textbox", { name: "本や書店を検索", exact: true })
        .fill("秘密QA棚_非公開");
      await expect(page.locator(".street-shop")).toHaveCount(0);
    },
  );
  await desktop.close();

  for (const width of [390, 320]) {
    const mobile = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "ja-JP",
    });
    const phone = await mobile.newPage();
    currentPage = phone;
    watch(phone);
    await check(
      `${width}px shelves scroll within viewport and foreground keeps its return position`,
      async () => {
        await go(phone);
        await expect(phone.locator(".street-shop")).toHaveCount(6);
        await noOverflow(phone, `${width}px street`);
        expect(
          await phone
            .locator(".street-shelf .shelf-scroll")
            .first()
            .evaluate((element) => element.getBoundingClientRect().top),
        ).toBeLessThan(700);
        const shelf = shop(phone, "雨と翻訳").locator(".shelf-scroll").first();
        await shelf.scrollIntoViewIfNeeded();
        expect(
          await shelf.evaluate(
            (element) => element.scrollWidth > element.clientWidth,
          ),
        ).toBe(true);
        const shelfRegion = shop(phone, "雨と翻訳")
          .locator(".street-shelf")
          .first();
        await shelfRegion.getByRole("button", { name: /の右側を見る$/ }).tap();
        await expect
          .poll(() => shelf.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
        const trigger = shelf.locator(".shelf-book-button").last();
        await trigger.scrollIntoViewIfNeeded();
        await trigger.focus();
        const before = {
          vertical: await phone.evaluate(() => scrollY),
          horizontal: await shelf.evaluate((element) => element.scrollLeft),
        };
        expect(before.vertical).toBeGreaterThan(0);
        expect(before.horizontal).toBeGreaterThan(0);
        await trigger.tap();
        await expectBook(phone, "ソラリス");
        await noOverflow(phone, `${width}px foreground`);
        await phone.screenshot({
          path: path.join(output, `book-in-hand-${width}.png`),
          animations: "disabled",
        });
        await phone
          .locator(".bh-dialog")
          .getByRole("button", { name: "本を閉じて棚に戻る", exact: true })
          .tap();
        await expect(phone.locator(".bh-dialog")).not.toBeVisible();
        await expect(trigger).toBeFocused();
        await expect
          .poll(async () =>
            Math.abs((await phone.evaluate(() => scrollY)) - before.vertical),
          )
          .toBeLessThanOrEqual(2);
        expect(
          Math.abs(
            (await shelf.evaluate((element) => element.scrollLeft)) -
              before.horizontal,
          ),
        ).toBeLessThanOrEqual(2);
        await phone.evaluate(() => scrollTo(0, 0));
        await phone.screenshot({
          path: path.join(output, `street-${width}.png`),
          fullPage: false,
          animations: "disabled",
        });
      },
    );
    await check(
      `${width}px horizontal intent moves to the adjacent book while vertical intent does not`,
      async () => {
        const shelf = shop(phone, "軌道書房").locator(".shelf-scroll").first();
        const titles = await shelfTitles(shelf);
        await shelf.locator(".shelf-book-button").first().tap();
        await expectBook(phone, titles[0]);
        await touchGesture(phone, -12, -100);
        await expectBook(phone, titles[0]);
        await touchGesture(phone, -110, 4);
        await expectBook(phone, titles[1]);
        await touchGesture(phone, 110, -3);
        await expectBook(phone, titles[0]);
        await touchGesture(phone, 110, 0);
        await expectBook(phone, titles[0]);
        await phone.keyboard.press("Escape");
      },
    );
    await mobile.close();
  }
  await check(
    "No hydration errors, uncaught exceptions or console errors",
    async () => {
      expect(errors).toEqual([]);
    },
  );
  await writeFile(
    path.join(output, "street-results.json"),
    JSON.stringify(
      { baseURL, passed, errors, realDeviceGestures: "not tested" },
      null,
      2,
    ),
  );
} catch (error) {
  await currentPage
    ?.screenshot({
      path: path.join(output, "street-failure.png"),
      fullPage: true,
    })
    .catch(() => {});
  await writeFile(
    path.join(output, "street-results.json"),
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
