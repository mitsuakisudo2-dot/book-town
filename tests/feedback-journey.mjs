import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/feedback-qa",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.BOOK_TOWN_CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const passed = [],
  errors = [];
let page;
// Set once a shop's shelf was wider than its card somewhere in the run.
let scrolledShopShelf = false;
async function check(name, run) {
  await run();
  passed.push(name);
  console.log(`PASS ${name}`);
}
async function go(route = "/") {
  await page.goto(`${baseURL}${route}`);
  await page.waitForFunction(() => localStorage.getItem("book-town-v1"));
}
function solarisTrigger() {
  return page
    .locator(".street-shop")
    .filter({
      has: page.getByRole("link", { name: "軌道書房に入る", exact: true }),
    })
    .locator(".shelf-book-button")
    .first();
}
const dialog = () => page.locator(".bh-dialog");
const reaction = (name) =>
  dialog()
    .getByRole("group", { name: "このPOPへのリアクション" })
    .getByRole("button", { name, exact: true });
async function expectTitle(title) {
  await expect(dialog().locator(".bh-book-heading h2")).toHaveText(title);
}
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 1440 ? 1000 : 844 },
      isMobile: width !== 1440,
      hasTouch: width !== 1440,
      locale: "ja-JP",
    });
    page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await go();
    await check(
      `${width}px synopsis leads, primary navigation uses profile, actions stay independent`,
      async () => {
        await expect(
          page
            .locator(".town-sidebar nav a, .town-bottom-nav a")
            .filter({ hasText: "読みたい" }),
        ).toHaveCount(0);
        await solarisTrigger().click();
        await expectTitle("ソラリス");
        await expect(dialog().locator(".bh-summary")).toBeInViewport();
        const order = await dialog().evaluate((el) => ({
          summary: el.querySelector(".bh-summary").getBoundingClientRect().top,
          pop: el.querySelector(".bh-pop").getBoundingClientRect().top,
        }));
        expect(order.summary).toBeLessThan(order.pop);
        await expect(dialog().locator(".bh-details")).toHaveCount(0);
        await reaction("いいね").click();
        await reaction("読む！").click();
        await reaction("私も好き！").click();
        await expect(reaction("いいね")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await dialog()
          .getByRole("button", { name: "お気に入り", exact: true })
          .click();
        await expect(
          dialog().getByRole("button", {
            name: "読みたいに加える",
            exact: true,
          }),
        ).toHaveAttribute("aria-pressed", "false");
        await dialog()
          .getByRole("button", { name: "読みたいに加える", exact: true })
          .click();
        const saved = await page.evaluate(
          () => JSON.parse(localStorage.getItem("book-town-v1")).data,
        );
        expect(saved.wishlist).toEqual(["solaris"]);
        expect(saved.favorites).toEqual(["solaris"]);
        expect(Object.values(saved.popReactions)).toEqual([
          ["like", "read", "love"],
        ]);
        // The shop links sit in the open; no extra tap is needed.
        // The shop links sit beside the title and price; no extra tap is needed.
        for (const provider of [/^Amazonで探す/, /^楽天ブックスで探す/]) {
          const link = dialog()
            .locator(".bh-book-intro")
            .getByRole("link", { name: provider });
          await expect(link).toBeVisible();
          await expect(link).toHaveAttribute("target", "_blank");
          await expect(link).toHaveAttribute("rel", "noopener noreferrer");
          const url = new URL(await link.getAttribute("href"));
          expect(["www.amazon.co.jp", "books.rakuten.co.jp"]).toContain(
            url.hostname,
          );
          expect(
            url.searchParams.get("k") ?? url.searchParams.get("sitem"),
          ).toContain("ソラリス スタニスワフ・レム");
        }
        await page.keyboard.press("Escape");
      },
    );
    await check(
      `${width}px persistence and private profile collections`,
      async () => {
        await page.reload();
        await solarisTrigger().click();
        await expect(reaction("いいね")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(
          dialog().getByRole("button", {
            name: "お気に入りに登録済み",
            exact: true,
          }),
        ).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.press("Escape");
        await go("/profiles/me/");
        await expect(
          page.locator(".profile-collections .profile-saved-book"),
        ).toHaveCount(1);
        await expect(page.locator(".profile-collections")).toContainText(
          "ソラリス",
        );
        await page
          .getByRole("button", { name: "お気に入り 1", exact: true })
          .click();
        await expect(page.locator(".profile-saved-book")).toHaveCount(1);
        await page
          .getByRole("button", {
            name: "ソラリスをお気に入りから外す",
            exact: true,
          })
          .click();
        await expect(page.locator(".profile-collection-empty")).toContainText(
          "お気に入りの本は、まだありません",
        );
        await page
          .getByRole("button", { name: "読みたい 1", exact: true })
          .click();
        await expect(page.locator(".profile-saved-book")).toHaveCount(1);
        await go("/profiles/r-nagi/");
        await expect(
          page.getByRole("heading", { name: "凪", exact: true }),
        ).toBeVisible();
        await expect(page.locator(".profile-collections")).toHaveCount(0);
        await go();
      },
    );
    await check(
      `${width}px other selections and actual shelves browse inline with exact POP context`,
      async () => {
        await solarisTrigger().click();
        await expect(
          dialog().locator(".bh-discovery-books .bh-choice-book"),
        ).not.toHaveCount(0);
        const beforeURL = page.url();
        const rain = dialog()
          .locator(".bh-shop-card")
          .filter({
            has: page.getByRole("heading", { name: "雨と翻訳", exact: true }),
          })
          .first();
        // Each other shop is a card holding its own shelf. A shelf wider than
        // its card scrolls inside the card and never changes the book in hand.
        const shelf = rain.locator("[data-book-rail] .shelf-scroll");
        if (await shelf.evaluate((el) => el.scrollWidth > el.clientWidth)) {
          await shelf.hover();
          await page.mouse.wheel(120, 0);
          await expect
            .poll(() => shelf.evaluate((el) => el.scrollLeft))
            .toBeGreaterThan(0);
          scrolledShopShelf = true;
        }
        await expectTitle("ソラリス");
        await rain.locator(".shelf-book-button").first().focus();
        await page.keyboard.press("ArrowRight");
        await expectTitle("ソラリス");
        // The card's link goes to the shop; its shelf still opens the POP in place.
        await expect(
          rain.getByRole("link", { name: "この書店へ", exact: true }),
        ).toHaveAttribute("href", /\/shops\/shop-rain\/#shelf-/);
        await rain
          .locator(".shelf-book-button")
          .filter({ hasText: "ソラリス" })
          .click();
        await expectTitle("ソラリス");
        await expect(page).toHaveURL(beforeURL);
        await expect(dialog()).toHaveCount(1);
        await expect(dialog().locator(".bh-pop-text")).toContainText(
          "翻訳で読む、理解の届かなさ",
        );
        await expect(reaction("いいね")).toHaveAttribute(
          "aria-pressed",
          "false",
        );
        await reaction("いいね").click();
        const first = dialog().locator(".bh-choice-book").first();
        const nextTitle = await first.locator("strong").textContent();
        await first.click();
        await expectTitle(nextTitle);
        await expect(page).toHaveURL(beforeURL);
        await page.keyboard.press("Escape");
        await solarisTrigger().click();
        await dialog()
          .locator(".bh-shop-card")
          .filter({
            has: page.getByRole("heading", { name: "雨と翻訳", exact: true }),
          })
          .first()
          .getByRole("link", { name: "この書店へ", exact: true })
          .click();
        await expect(page).toHaveURL(/\/shops\/shop-rain\//);
        await expect(dialog()).toHaveCount(0);
        await go();
        // Tapping the cover opens the book's own page.
        await solarisTrigger().click();
        await dialog()
          .getByRole("link", { name: "ソラリスの作品ページへ", exact: true })
          .click();
        await expect(page).toHaveURL(/\/books\/solaris\/$/);
        await expect(dialog()).toHaveCount(0);
        await go();
      },
    );
    await check(
      `${width}px horizontal wheel moves books, nested rails and vertical scroll do not`,
      async () => {
        await solarisTrigger().click();
        const title = dialog().locator(".bh-book-heading h2");
        await dialog()
          .locator(".bh-content")
          .dispatchEvent("wheel", { deltaX: 0, deltaY: 100 });
        await expectTitle("ソラリス");
        await dialog()
          .locator(".bh-discovery-books [data-book-rail]")
          .dispatchEvent("wheel", { deltaX: 120, deltaY: 0 });
        await expectTitle("ソラリス");
        await dialog()
          .locator(".bh-content")
          .dispatchEvent("wheel", { deltaX: 110, deltaY: 0 });
        await expect(title).not.toHaveText("ソラリス");
        await page.keyboard.press("Escape");
        await solarisTrigger().click();
        const rail = dialog().locator(".bh-discovery-books [data-book-rail]");
        await rail.evaluate((el) => {
          const start = new Touch({
            identifier: 2,
            target: el,
            clientX: 190,
            clientY: 300,
          });
          const end = new Touch({
            identifier: 2,
            target: el,
            clientX: 75,
            clientY: 300,
          });
          el.dispatchEvent(
            new TouchEvent("touchstart", {
              bubbles: true,
              touches: [start],
              changedTouches: [start],
            }),
          );
          el.dispatchEvent(
            new TouchEvent("touchmove", {
              bubbles: true,
              touches: [end],
              changedTouches: [end],
            }),
          );
          el.dispatchEvent(
            new TouchEvent("touchend", {
              bubbles: true,
              touches: [],
              changedTouches: [end],
            }),
          );
        });
        await expectTitle("ソラリス");
        const sizes = await dialog().evaluate((el) => ({
          dialog: el.clientWidth,
          body: el.querySelector(".bh-content").scrollWidth,
          window: innerWidth,
          root: document.documentElement.scrollWidth,
        }));
        expect(sizes.body).toBeLessThanOrEqual(sizes.dialog + 1);
        expect(sizes.root).toBeLessThanOrEqual(sizes.window + 1);
        await dialog()
          .locator(".bh-content")
          .evaluate((el) => (el.scrollTop = 0));
        await page.screenshot({
          path: path.join(output, `book-${width}.png`),
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
      },
    );
    await check(
      `${width}px private shelves never enter inline discoveries`,
      async () => {
        await page.evaluate(() => {
          const envelope = JSON.parse(localStorage.getItem("book-town-v1"));
          envelope.data.ownShop = {
            id: "mine",
            ownerId: "me",
            name: "QA書店",
            description: "",
            theme: "sage",
            tagline: "",
            followers: 0,
            demo: false,
            shelves: [
              {
                id: "public",
                name: "公開の棚",
                capacity: 20,
                isPublic: true,
                items: [
                  {
                    id: "public-item",
                    bookId: "momo",
                    display: "face",
                    pop: "公開POP",
                  },
                ],
              },
              {
                id: "private",
                name: "秘密の棚QA",
                capacity: 20,
                isPublic: false,
                items: [
                  {
                    id: "private-item",
                    bookId: "solaris",
                    display: "face",
                    pop: "秘密POPQA",
                  },
                ],
              },
            ],
          };
          localStorage.setItem("book-town-v1", JSON.stringify(envelope));
        });
        await page.reload();
        await solarisTrigger().click();
        await expect(dialog()).not.toContainText("秘密");
        await expect(dialog().locator(".bh-shop-card")).not.toContainText([
          "QA書店",
        ]);
        await page.keyboard.press("Escape");
      },
    );
    await context.close();
  }
  // The narrowest screen must have exercised scrolling a shop's shelf.
  expect(scrolledShopShelf).toBe(true);
  expect(errors).toEqual([]);
  console.log(`${passed.length} feedback browser checks passed.`);
  await writeFile(
    path.join(output, "feedback-results.json"),
    JSON.stringify(
      { baseURL, passed, errors, realDeviceGestures: "not tested" },
      null,
      2,
    ),
  );
} catch (error) {
  await page
    ?.screenshot({ path: path.join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  await writeFile(
    path.join(output, "feedback-results.json"),
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
