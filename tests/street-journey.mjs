import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  escapeWhileComposing,
  restingBox,
  settleBeforeNavigating,
} from "./journey-layers.mjs";

const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/street-qa",
);
await mkdir(output, { recursive: true });
// Uses Playwright's own Chromium unless BOOK_TOWN_CHROME names another browser.
const browser = await chromium.launch({
  executablePath: process.env.BOOK_TOWN_CHROME || undefined,
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

// The POP the pager is on. Its neighbours lie beside it on the track, hidden
// from screen readers, so a check about the POP shown reads this page only.
const CURRENT_POP = ".bh-pop-page.is-current";

/** Draws a finger most of a page across the POP: -1 to the next, 1 back. */
async function swipePop(page, pop, direction, held) {
  const track = pop.locator(".bh-pop-track");
  const width = await track.evaluate((element) => element.clientWidth);
  await fingerDrag(page, track, direction * width * 0.7, 0, held);
}

/** The page the pager is on is the one the track rests on. */
async function expectPopInView(pop) {
  await expect
    .poll(() =>
      pop.evaluate((card) => {
        const track = card.querySelector(".bh-pop-track");
        const page = track.querySelector(".bh-pop-page.is-current");
        return Math.abs(
          page.getBoundingClientRect().left -
            track.getBoundingClientRect().left,
        );
      }),
    )
    .toBeLessThan(2);
}

// A finger drawn through the DevTools protocol: the browser scrolls what is
// under it as it would for a real touch. `held` runs before the finger lifts.
async function fingerDrag(page, locator, dx, dy, held) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const steps = 12;
  const at = (step) => [
    { x: x + (dx * step) / steps, y: y + (dy * step) / steps, id: 1 },
  ];
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: at(0),
    });
    for (let step = 1; step <= steps; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: at(step),
      });
      await page.waitForTimeout(16);
    }
    await held?.();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await cdp.detach();
  }
}

// Synthetic touch checks exercise intent detection; real-device gesture arbitration
// remains a separate manual check and is not claimed by this browser suite.
async function touchGesture(page, dx, dy, selector = ".bh-content") {
  await page
    .locator(selector)
    .first()
    .evaluate(
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
  const page = settleBeforeNavigating(await desktop.newPage());
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
      // Each shop shows two shelves on the street; the rest is on the shop's own page.
      await expect(page.locator(".street-shop .shelf-scroll")).toHaveCount(12);
      await expect(
        page.getByRole("button", { name: "一冊からたどる", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "書店一覧", exact: true }),
      ).toHaveCount(0);
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
      await expect(
        dialog.locator(`${CURRENT_POP} .bh-pop-text`),
      ).not.toContainText("自分の記憶に出会ってしまう");
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "POP pager shows other readers' words without switching books",
    async () => {
      const shelf = shop(page, "軌道書房").locator(".shelf-scroll").first();
      await shelf
        .getByRole("button", { name: "ソラリス · 面陳 · POPあり", exact: true })
        .click();
      const dialog = page.locator(".bh-dialog");
      const pop = dialog.locator(".owner-pop");
      const shown = pop.locator(`${CURRENT_POP} .bh-pop-text`);
      const firstPop = await shown.innerText();
      const firstReaction = await pop
        .getByRole("button", { name: "いいね", exact: true })
        .getAttribute("aria-pressed");
      await expectBook(page, "ソラリス");
      await expect(pop.locator(".bh-pop-page-count")).toHaveText("1 / 4");
      await expect(pop.getByRole("button", { name: "前のPOP" })).toBeDisabled();
      await expect(pop.getByRole("button", { name: "次のPOP" })).toBeEnabled();
      await expect(pop.locator(".bh-shop-link")).toHaveText("軌道書房");
      await expect(pop.locator(".bh-owner-link")).toHaveAttribute(
        "href",
        "/profiles/r-nagi/",
      );

      // Only the POP on show is read out; turning to another tells it.
      await expect(pop.locator(".bh-pop-page")).toHaveCount(4);
      await expect(
        pop.locator('.bh-pop-page:not([aria-hidden="true"])'),
      ).toHaveCount(1);
      await expect(pop.locator(CURRENT_POP)).not.toHaveAttribute("aria-hidden");
      await expectPopInView(pop);

      await pop.getByRole("button", { name: "次のPOP" }).click();
      await expect(shown).not.toHaveText(firstPop);
      await expectPopInView(pop);
      await expect(
        pop.locator('.bh-pop-page:not([aria-hidden="true"])'),
      ).toHaveCount(1);
      await expect(pop.locator(".bh-pop-pager .bh-sr-only")).toHaveAttribute(
        "aria-live",
        "polite",
      );
      await expect(pop.locator(".bh-pop-pager .bh-sr-only")).toHaveText(
        await shown.innerText(),
      );
      await expect(pop.locator(".bh-shop-link")).not.toHaveText("軌道書房");
      await expect(pop.locator(".bh-shop-link")).toHaveText("雨と翻訳");
      await expect(pop.locator(".bh-shop-link")).toHaveAttribute(
        "href",
        /^\/shops\/shop-rain\/#shelf-/,
      );
      await expect(pop.locator(".bh-owner-link")).toHaveAttribute(
        "href",
        "/profiles/r-sumire/",
      );
      await expect(pop.locator(".bh-owner-link")).toContainText("すみれ");
      await expectBook(page, "ソラリス");
      await expect(pop.locator(".bh-pop-page-count")).toContainText("2 /");
      await expect(pop.getByRole("button", { name: "前のPOP" })).toBeEnabled();

      // The reaction belongs to the currently displayed POP, not the first.
      const reaction = pop.getByRole("button", { name: "いいね", exact: true });
      const before = await reaction.getAttribute("aria-pressed");
      await reaction.click();
      await expect(reaction).toHaveAttribute(
        "aria-pressed",
        before === "true" ? "false" : "true",
      );
      await pop.getByRole("button", { name: "前のPOP" }).click();
      await expect(shown).toHaveText(firstPop);
      await expectPopInView(pop);
      await expect(pop.locator(".bh-shop-link")).toHaveText("軌道書房");
      await expect(reaction).toHaveAttribute("aria-pressed", firstReaction);
      await pop.getByRole("button", { name: "次のPOP" }).click();
      await expect(reaction).toHaveAttribute(
        "aria-pressed",
        before === "true" ? "false" : "true",
      );
      const savedReactions = await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("book-town-v1")).data;
        return ["shop-orbit", "shop-rain"].map((shopId) => {
          return Object.entries(state.popReactions)
            .filter(([key]) => JSON.parse(key)[0] === shopId)
            .map(([key, reactions]) => ({ key, reactions }));
        });
      });
      expect(savedReactions[0]).toEqual([]);
      expect(savedReactions[1]).toEqual([
        {
          key: JSON.stringify(["shop-rain", "rain-cities", "r5"]),
          reactions: ["like"],
        },
      ]);
      for (const name of ["問いの余白", "小さな灯り"]) {
        await pop.getByRole("button", { name: "次のPOP" }).click();
        await expect(pop.locator(".bh-shop-link")).toHaveText(name);
        await expectBook(page, "ソラリス");
      }
      await expect(pop.locator(".bh-pop-page-count")).toHaveText("4 / 4");
      await expect(pop.getByRole("button", { name: "次のPOP" })).toBeDisabled();
      await expectPopInView(pop);
      await page.reload();
      await shelf
        .getByRole("button", { name: "ソラリス · 面陳 · POPあり", exact: true })
        .click();
      await expect(pop.locator(".bh-pop-page-count")).toHaveText("1 / 4");
      await pop.getByRole("button", { name: "次のPOP" }).click();
      await expect(reaction).toHaveAttribute(
        "aria-pressed",
        before === "true" ? "false" : "true",
      );
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "POP buttons glide to the next POP, and jump there under reduced motion",
    async () => {
      await shop(page, "軌道書房")
        .getByRole("button", { name: "ソラリス · 面陳 · POPあり", exact: true })
        .click();
      const pop = page.locator(".bh-dialog .owner-pop");
      // Where the track is, in pages, just as the button is pressed.
      const pressed = (name) =>
        pop.evaluate((card, label) => {
          const track = card.querySelector(".bh-pop-track");
          card.querySelector(`[aria-label="${label}"]`).click();
          return track.scrollLeft / track.clientWidth;
        }, name);
      try {
        await page.emulateMedia({ reducedMotion: "reduce" });
        expect(await pressed("次のPOP")).toBeCloseTo(1, 2);
        await expect(pop.locator(".bh-pop-page-count")).toHaveText("2 / 4");
        await page.emulateMedia({ reducedMotion: "no-preference" });
        expect(await pressed("前のPOP")).toBeCloseTo(1, 2);
        await expectPopInView(pop);
        await expect(pop.locator(".bh-pop-page-count")).toHaveText("1 / 4");
        await expect(pop.locator(".bh-shop-link")).toHaveText("軌道書房");
      } finally {
        await page.emulateMedia({ reducedMotion: null });
      }
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "Book buttons, arrow keys, wheel and discovery always reset POP to the source",
    async () => {
      await shop(page, "軌道書房")
        .getByRole("button", { name: "ソラリス · 面陳 · POPあり", exact: true })
        .click();
      const dialog = page.locator(".bh-dialog");
      const pop = dialog.locator(".owner-pop");
      const expectSource = async () => {
        await expectBook(page, "ソラリス");
        await expect(pop.locator(".bh-pop-page-count")).toHaveText("1 / 4");
        await expect(pop.locator(".bh-shop-link")).toHaveText("軌道書房");
        await expectPopInView(pop);
      };
      await pop.getByRole("button", { name: "次のPOP" }).click();
      await dialog.getByRole("button", { name: "次の本", exact: true }).click();
      await expectBook(page, "闇の左手");
      // 闇の左手 is also on 雨と翻訳's shelf; its POP still starts at this shop.
      await expect(pop.locator(".bh-pop-page-count")).toHaveText(/^1 \//);
      await expect(pop.locator(".bh-shop-link")).toHaveText("軌道書房");
      await dialog.getByRole("button", { name: "前の本", exact: true }).click();
      await expectSource();

      await pop.getByRole("button", { name: "次のPOP" }).click();
      await pop.getByRole("button", { name: "次のPOP" }).press("ArrowRight");
      await expectBook(page, "闇の左手");
      await page.keyboard.press("ArrowLeft");
      await expectSource();

      await pop.getByRole("button", { name: "次のPOP" }).click();
      await dialog.locator(".bh-summary").hover();
      await page.mouse.wheel(100, 0);
      await expectBook(page, "闇の左手");
      await dialog.getByRole("button", { name: "前の本", exact: true }).click();
      await expectSource();

      await pop.getByRole("button", { name: "次のPOP" }).click();
      await dialog
        .getByRole("button", {
          name: "闇の左手をこの場で手に取る",
          exact: true,
        })
        .click();
      await expectBook(page, "闇の左手");
      await dialog
        .getByRole("button", {
          name: "ソラリスをこの場で手に取る",
          exact: true,
        })
        .click();
      await expectSource();
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
    "Book titles and bookstore names open their detail pages",
    async () => {
      await shop(page, "軌道書房")
        .getByRole("button", { name: "ソラリス · 面陳 · POPあり", exact: true })
        .click();
      const dialog = page.locator(".bh-dialog");
      const title = dialog.locator(".bh-book-heading h2 a");
      await expect(title).toHaveAttribute("href", "/books/solaris/");
      await title.click();
      await expect(page).toHaveURL(/books\/solaris\/$/);
      await expect(
        page.getByRole("heading", { name: "ソラリス", exact: true }),
      ).toBeVisible();
      await go(page);
      await shop(page, "軌道書房")
        .getByRole("button", { name: "ソラリス · 面陳 · POPあり", exact: true })
        .click();
      const card = dialog.locator(".bh-shop-card").first();
      const shopLink = card.locator("h4 a");
      const visit = card.getByRole("link", { name: "この書店へ" });
      await expect(shopLink).toHaveAttribute(
        "href",
        await visit.getAttribute("href"),
      );
      const heading = await card.locator(".bh-shop-card-heading").boundingBox();
      const button = await visit.boundingBox();
      expect(
        Math.abs(heading.x + heading.width - button.x - button.width),
      ).toBeLessThan(2);
      await shopLink.click();
      await expect(page).toHaveURL(/shops\/shop-rain\/#shelf-/);
      await expect(
        page.getByRole("heading", { name: "雨と翻訳", exact: true }),
      ).toBeVisible();
      await go(page);
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
      // The book sits above the page, so its toast is shown inside it.
      await expect(page.locator(".bh-dialog .toast")).toHaveText(
        "読みたい本に入れました",
      );
      // The bottom band's "読みたい" is the same list, always in reach.
      await expect(
        page
          .locator(".bh-navigation")
          .getByRole("button", { name: "読みたい", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
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
      await page.getByRole("button", { name: "すべて", exact: true }).click();
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
      // The change is said, not only shown.
      await expect(page.locator(".street-route-label")).toContainText(
        "別の路地に入りました",
      );
      await expect(page.locator(".street-shop")).toHaveCount(6);
      const names = await page.locator(".street-shop-title").allTextContents();
      expect(new Set(names).size).toBe(6);
      // The street has no end: scrolling on brings another round of shops.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect(page.locator(".street-round")).toHaveCount(1);
      await expect(page.locator(".street-shop")).toHaveCount(12);
      const next = await page
        .locator(".street-shop-title")
        .nth(6)
        .textContent();
      expect(next).not.toBe(names[5]);
      expect(await page.locator("[id^=street-shop-]").count()).toBe(6);
      await expect(page.locator(".street-end")).toContainText("架空のデモ");
    },
  );
  await check(
    "Home tabs and ホーム come back to the filter and lane left there",
    async () => {
      await go(page);
      const tabs = page.getByRole("navigation", { name: "ホームの表示" });
      const nav = page.getByRole("navigation", {
        name: "メインナビゲーション",
      });
      const following = page.getByRole("button", {
        name: "フォロー中",
        exact: true,
      });
      await page
        .getByRole("button", { name: "路地を変えてみる", exact: true })
        .click();
      await following.click();
      await expect(page).toHaveURL(/\?lane=1&show=following$/);
      await tabs.getByRole("link", { name: "タイムライン" }).click();
      await expect(page).toHaveURL(/\/timeline\//);
      await following.click();
      await expect(page).toHaveURL(/\/timeline\/\?show=following$/);
      // The other tab opens as it was left; how far down the street the
      // reader went is not kept.
      await tabs.getByRole("link", { name: "書店" }).click();
      await expect(page).toHaveURL(`${baseURL}/?show=following&lane=1`);
      await expect(following).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".street-shop")).toHaveCount(1);
      await tabs.getByRole("link", { name: "タイムライン" }).click();
      await expect(page).toHaveURL(/\/timeline\/\?show=following$/);
      await expect(following).toHaveAttribute("aria-pressed", "true");
      // ホーム returns to the Home tab open last, after a reload too.
      await nav.getByRole("link", { name: "検索" }).click();
      await expect(page).toHaveURL(/\/search\/$/);
      await page.reload();
      await expect(nav.getByRole("link", { name: "ホーム" })).toHaveAttribute(
        "href",
        "/timeline/?show=following",
      );
      await nav.getByRole("link", { name: "ホーム" }).click();
      await expect(page).toHaveURL(/\/timeline\/\?show=following$/);
      await expect(following).toHaveAttribute("aria-pressed", "true");
      // On Home, ホーム and the tab already open stay the way to the start.
      await expect(nav.getByRole("link", { name: "ホーム" })).toHaveAttribute(
        "href",
        "/",
      );
      await expect(
        tabs.getByRole("link", { name: "タイムライン" }),
      ).toHaveAttribute("href", "/timeline/");
      await tabs.getByRole("link", { name: "書店" }).click();
      await expect(page).toHaveURL(`${baseURL}/?show=following&lane=1`);
      await page.getByRole("button", { name: "すべて", exact: true }).click();
      await tabs.getByRole("link", { name: "タイムライン" }).click();
      await page.getByRole("button", { name: "すべて", exact: true }).click();
      await expect(page).toHaveURL(/\/timeline\/$/);
    },
  );
  await check(
    "A Home tab is kept as it now is, after a link to its start or 戻る",
    async () => {
      await go(page);
      const tabs = page.getByRole("navigation", { name: "ホームの表示" });
      const nav = page.getByRole("navigation", {
        name: "メインナビゲーション",
      });
      const home = nav.getByRole("link", { name: "ホーム" });
      const shelves = tabs.getByRole("link", { name: "書店" });
      const following = page.getByRole("button", {
        name: "フォロー中",
        exact: true,
      });
      const everything = page.getByRole("button", {
        name: "すべて",
        exact: true,
      });
      await page
        .getByRole("button", { name: "路地を変えてみる", exact: true })
        .click();
      await following.click();
      await expect(page).toHaveURL(/\?lane=1&show=following$/);
      // ホーム on Home goes to the street's start, and the street is kept so.
      await home.click();
      await expect(page).toHaveURL(`${baseURL}/`);
      await expect(everything).toHaveAttribute("aria-pressed", "true");
      // 戻る brings the filter and the lane back, and they are kept again.
      await page.goBack();
      await expect(page).toHaveURL(/\?lane=1&show=following$/);
      await expect(following).toHaveAttribute("aria-pressed", "true");
      await tabs.getByRole("link", { name: "タイムライン" }).click();
      await expect(page).toHaveURL(/\/timeline\/$/);
      await expect(shelves).toHaveAttribute("href", "/?show=following&lane=1");
      await shelves.click();
      await expect(page).toHaveURL(`${baseURL}/?show=following&lane=1`);
      await home.click();
      await expect(page).toHaveURL(`${baseURL}/`);
      await tabs.getByRole("link", { name: "タイムライン" }).click();
      await expect(page).toHaveURL(/\/timeline\/$/);
      await expect(shelves).toHaveAttribute("href", "/");
      await shelves.click();
      await expect(page).toHaveURL(`${baseURL}/`);
      await expect(everything).toHaveAttribute("aria-pressed", "true");
      // The open 書店 tab is a way to the start too.
      await following.click();
      await expect(page).toHaveURL(/\/\?show=following$/);
      await shelves.click();
      await expect(page).toHaveURL(`${baseURL}/`);
      await nav.getByRole("link", { name: "検索" }).click();
      await expect(page).toHaveURL(/\/search\/$/);
      await expect(home).toHaveAttribute("href", "/");
    },
  );
  await check(
    "A search typed just before a tap or a reload is still there",
    async () => {
      await go(page, "/search/");
      const box = page.getByRole("searchbox").first();
      const asked = () =>
        page.evaluate(() => new URLSearchParams(location.search).get("q"));
      // The address has it at once, not a moment later.
      await box.fill("モモ");
      expect(await asked()).toBe("モモ");
      await box.fill("ソラリス");
      expect(await asked()).toBe("ソラリス");
      await page.locator("main a[href='/books/solaris/']").first().click();
      await expect(page).toHaveURL(/\/books\/solaris\/$/);
      await page.goBack();
      await expect(box).toHaveValue("ソラリス");
      expect(await asked()).toBe("ソラリス");
      await box.fill("闇の左手");
      await page.reload();
      await expect(box).toHaveValue("闇の左手");
      // An empty box leaves nothing in the address.
      await box.fill("");
      expect(await asked()).toBe(null);
      // A shared link is read as it came, not cleared on opening.
      await go(page, "/search/?q=" + encodeURIComponent("雨"));
      await expect(box).toHaveValue("雨");
      expect(await asked()).toBe("雨");
    },
  );
  await check(
    "An Escape that cancels a kana conversion keeps the dialog and its words",
    async () => {
      await go(page);
      await page
        .getByRole("button", { name: "投稿する", exact: true })
        .first()
        .click();
      const compose = page.getByRole("dialog", { name: "投稿する" });
      const words = compose.locator("textarea");
      await words.fill("雨の日に読みたい");
      await escapeWhileComposing(page);
      await expect(compose).toBeVisible();
      await expect(words).toHaveValue("雨の日に読みたい");
      await escapeWhileComposing(page, { keyCode229: true });
      await expect(compose).toBeVisible();
      await expect(words).toHaveValue("雨の日に読みたい");
      // A plain Escape still closes it.
      await words.fill("");
      await page.keyboard.press("Escape");
      await expect(compose).toHaveCount(0);
    },
  );
  await check(
    "Each shop card speaks first, walks in, and links to its own page",
    async () => {
      await go(page);
      const card = shop(page, "軌道書房");
      await expect(card.locator(".shelf-scroll")).toHaveCount(2);
      // The owner's words come first, and open the book they were written for.
      await expect(card.locator(".street-shop-voice")).toContainText(
        "店主 凪のPOP",
      );
      await card.locator(".street-shop-voice").click();
      await expect(page.getByRole("dialog")).toContainText("ソラリス");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        card.getByRole("link", { name: "店内に入る" }),
      ).toHaveAttribute("href", "/walk/#shop-orbit");
      await card.getByRole("link", { name: /^紹介と/ }).click();
      await expect(page).toHaveURL(/shops\/shop-orbit/);
      // Demo shops have three public shelves, one per tier of the walk.
      await expect(page.locator(".store-shelf-section")).toHaveCount(3);
      await go(page);
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
                {
                  id: "qa-empty-item",
                  bookId: "solaris",
                  display: "spine",
                  pop: "   ",
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
      await expect(own).not.toContainText("秘密QAの紹介文_非公開");
      await expect(page.locator("main")).not.toContainText("秘密QA");
      await page
        .getByRole("textbox", { name: "本や書店を検索", exact: true })
        .fill("秘密QA棚_非公開");
      await expect(page.locator(".street-shop")).toHaveCount(0);
      await page
        .getByRole("textbox", { name: "本や書店を検索", exact: true })
        .fill("");
      await shop(page, "軌道書房")
        .getByRole("button", { name: "ソラリス · 面陳 · POPあり", exact: true })
        .click();
      const pop = page.locator(".owner-pop");
      await expect(pop.locator(".bh-pop-page-count")).toHaveText("1 / 4");
      for (let n = 0; n < 4; n++) {
        await expect(pop).not.toContainText("秘密QA");
        if (n < 3) await pop.getByRole("button", { name: "次のPOP" }).click();
      }
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        const envelope = JSON.parse(localStorage.getItem("book-town-v1"));
        envelope.data.ownShop.shelves[0].items[1].pop = "公開QAのソラリスPOP";
        localStorage.setItem("book-town-v1", JSON.stringify(envelope));
      });
      await page.reload();
      await shop(page, "軌道書房")
        .getByRole("button", { name: "ソラリス · 面陳 · POPあり", exact: true })
        .click();
      await expect(pop.locator(".bh-pop-page-count")).toHaveText("1 / 5");
      for (let n = 0; n < 4; n++)
        await pop.getByRole("button", { name: "次のPOP" }).click();
      await expect(pop.locator(`${CURRENT_POP} .bh-pop-text`)).toHaveText(
        "公開QAのソラリスPOP",
      );
      await expect(pop.locator(".bh-owner-link")).toHaveAttribute(
        "href",
        "/profiles/me/",
      );
      await expect(pop.locator(".bh-shop-link")).toHaveText("公開展示QA書店");
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "Store browsing includes my public shop and skips it when every shelf is private",
    async () => {
      await go(page, "/shops/shop-lamplight/");
      await expect(
        page.getByRole("link", {
          name: "次の書店：公開展示QA書店",
          exact: true,
        }),
      ).toHaveAttribute("href", "/shops/mine/");
      await page.evaluate(() => {
        const envelope = JSON.parse(localStorage.getItem("book-town-v1"));
        envelope.data.ownShop.shelves.forEach((shelf) => {
          shelf.isPublic = false;
        });
        localStorage.setItem("book-town-v1", JSON.stringify(envelope));
      });
      await page.reload();
      await expect(
        page.getByRole("link", { name: "次の書店：軌道書房", exact: true }),
      ).toHaveAttribute("href", "/shops/shop-orbit/");
      await expect(page.locator(".shop-journey-home small")).toContainText(
        "6 / 6",
      );
    },
  );
  await desktop.close();

  for (const width of [549, 390, 320]) {
    const mobile = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "ja-JP",
    });
    const phone = settleBeforeNavigating(await mobile.newPage());
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
        // Street cards are compact: a short shelf may fit the screen, a long one scrolls.
        expect(
          await shelf.evaluate((element) => element.clientWidth),
        ).toBeLessThanOrEqual(width);
        if (
          await shelf.evaluate(
            (element) => element.scrollWidth > element.clientWidth,
          )
        ) {
          await shop(phone, "雨と翻訳")
            .locator(".street-shelf")
            .first()
            .getByRole("button", { name: /の右側を見る$/ })
            .tap();
          await expect
            .poll(() => shelf.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
        }
        const trigger = shelf.locator(".shelf-book-button").last();
        // Center it so the fixed bottom bar and compose button never cover the tap.
        await trigger.evaluate((element) =>
          element.scrollIntoView({ block: "center", inline: "nearest" }),
        );
        await trigger.focus({ preventScroll: true });
        const before = {
          vertical: await phone.evaluate(() => scrollY),
          horizontal: await shelf.evaluate((element) => element.scrollLeft),
        };
        expect(before.vertical).toBeGreaterThan(0);
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
        // The shop's own page keeps full-size shelves that scroll sideways.
        await go(phone, "/shops/shop-rain/");
        const full = phone.locator(".shelf-scroll").first();
        await full.scrollIntoViewIfNeeded();
        expect(
          await full.evaluate(
            (element) => element.scrollWidth > element.clientWidth,
          ),
        ).toBe(true);
        await noOverflow(phone, `${width}px shop`);
        await go(phone);
      },
    );
    await check(
      `${width}px POP arrows are touch sized and switch only POP`,
      async () => {
        await go(phone);
        await shop(phone, "軌道書房")
          .getByRole("button", {
            name: "ソラリス · 面陳 · POPあり",
            exact: true,
          })
          .tap();
        const pop = phone.locator(".owner-pop");
        const buttons = pop.getByRole("button", { name: /のPOP$/ });
        // all() does not wait: without this the loop could check no arrow.
        await expect(buttons).toHaveCount(2);
        for (const button of await buttons.all()) {
          // Measured once the book has finished rising into place.
          const rect = await restingBox(button);
          expect(rect.width).toBeGreaterThanOrEqual(44);
          expect(rect.height).toBeGreaterThanOrEqual(44);
          const centerDelta = await button.evaluate((element) => {
            const arrow = element.getBoundingClientRect();
            const note = element.closest(".owner-pop").getBoundingClientRect();
            return Math.abs(
              arrow.y + arrow.height / 2 - note.y - note.height / 2,
            );
          });
          expect(centerDelta).toBeLessThan(1);
          expect(rect.x).toBeGreaterThanOrEqual(10);
          expect(rect.x + rect.width).toBeLessThanOrEqual(width - 10);
        }
        await pop.getByRole("button", { name: "次のPOP" }).tap();
        await expectBook(phone, "ソラリス");
        await expect(pop.locator(".bh-pop-page-count")).toHaveText("2 / 4");
        await expect(pop.locator(".bh-shop-link")).toHaveText("雨と翻訳");
        await expectPopInView(pop);
        await noOverflow(phone, `${width}px POP pager`);
        await pop.screenshot({
          path: path.join(output, `pop-pager-${width}.png`),
          animations: "disabled",
        });
        // Outside the POP, a swipe still turns to the next book, and the
        // book comes back on its own first POP.
        await touchGesture(phone, -110, 0);
        await expectBook(phone, "闇の左手");
        await touchGesture(phone, 110, 0);
        await expectBook(phone, "ソラリス");
        await expect(pop.locator(".bh-pop-page-count")).toHaveText("1 / 4");
        await expectPopInView(pop);
        await phone.keyboard.press("Escape");
      },
    );
    await check(
      `${width}px a finger on the POP moves it and settles on the next, never the book`,
      async () => {
        await shop(phone, "軌道書房")
          .getByRole("button", {
            name: "ソラリス · 面陳 · POPあり",
            exact: true,
          })
          .tap();
        const pop = phone.locator(".owner-pop");
        const track = pop.locator(".bh-pop-track");
        const count = pop.locator(".bh-pop-page-count");
        const shopLink = pop.locator(".bh-shop-link");
        await restingBox(track);
        const page = await track.evaluate((element) => element.clientWidth);
        // The POP moves under the finger; what it names waits until it rests.
        await swipePop(phone, pop, -1, async () => {
          await expect
            .poll(() => track.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(page * 0.4);
          // Longer than a scroll is given to come to rest.
          await phone.waitForTimeout(400);
          expect(
            await track.evaluate((element) => element.scrollLeft),
          ).toBeLessThan(page * 0.95);
          await expect(count).toHaveText("1 / 4");
          await expect(shopLink).toHaveText("軌道書房");
        });
        await expect(count).toHaveText("2 / 4");
        await expect(shopLink).toHaveText("雨と翻訳");
        await expect(pop.locator(".bh-owner-link")).toHaveAttribute(
          "href",
          "/profiles/r-sumire/",
        );
        await expectPopInView(pop);
        await expectBook(phone, "ソラリス");
        await swipePop(phone, pop, -1);
        await expect(count).toHaveText("3 / 4");
        await expect(shopLink).toHaveText("問いの余白");
        await expectPopInView(pop);
        await swipePop(phone, pop, 1);
        await expect(count).toHaveText("2 / 4");
        await expectPopInView(pop);
        // The reaction goes to the POP the track rests on.
        const like = pop.getByRole("button", { name: "いいね", exact: true });
        const liked = await like.getAttribute("aria-pressed");
        await like.tap();
        await expect(like).toHaveAttribute(
          "aria-pressed",
          liked === "true" ? "false" : "true",
        );
        await like.tap();
        await expect(like).toHaveAttribute("aria-pressed", liked);
        // At either end the POP stays, and the book does not turn.
        await pop.getByRole("button", { name: "前のPOP" }).tap();
        await expect(count).toHaveText("1 / 4");
        await swipePop(phone, pop, 1);
        await expect(count).toHaveText("1 / 4");
        await expectPopInView(pop);
        await expectBook(phone, "ソラリス");
        for (const shown of ["2 / 4", "3 / 4", "4 / 4"]) {
          await pop.getByRole("button", { name: "次のPOP" }).tap();
          await expect(count).toHaveText(shown);
        }
        await swipePop(phone, pop, -1);
        await expect(count).toHaveText("4 / 4");
        await expectPopInView(pop);
        await expectBook(phone, "ソラリス");
        // Across the reactions nothing turns.
        await fingerDrag(
          phone,
          pop.locator(".bh-pop-reactions button").first(),
          -page * 0.7,
          0,
        );
        await expect(count).toHaveText("4 / 4");
        await expect(like).toHaveAttribute("aria-pressed", liked);
        await expectBook(phone, "ソラリス");
        // Drawn upward from the POP, the finger scrolls the book's page.
        const content = phone.locator(".bh-dialog .bh-content");
        const top = await content.evaluate((element) => element.scrollTop);
        const left = await track.evaluate((element) => element.scrollLeft);
        await fingerDrag(phone, track, -6, -160);
        await expect
          .poll(() => content.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(top + 60);
        expect(
          Math.abs(
            (await track.evaluate((element) => element.scrollLeft)) - left,
          ),
        ).toBeLessThanOrEqual(1);
        await expect(count).toHaveText("4 / 4");
        await expectBook(phone, "ソラリス");
        await phone.keyboard.press("Escape");
      },
    );
    await check(
      `${width}px store opens on its shelves and swipes between public stores`,
      async () => {
        await go(phone, "/shops/shop-orbit/");
        const shelf = phone
          .locator(".store-shelf-section .shelf-scroll")
          .first();
        const rect = await shelf.boundingBox();
        expect(rect.y + rect.height).toBeLessThan(760);
        await noOverflow(phone, `${width}px store entrance`);
        await phone.screenshot({
          path: path.join(output, `store-entrance-${width}.png`),
          animations: "disabled",
        });
        await touchGesture(phone, -12, -110, ".shop-hero h1");
        await expect(phone).toHaveURL(/shops\/shop-orbit\/$/);
        await touchGesture(
          phone,
          -110,
          0,
          ".store-shelf-section .shelf-scroll",
        );
        await expect(phone).toHaveURL(/shops\/shop-orbit\/$/);
        await touchGesture(phone, -110, 0, ".shop-hero button");
        await expect(phone).toHaveURL(/shops\/shop-orbit\/$/);
        await touchGesture(phone, -110, 0, ".shop-shelf-index");
        await expect(phone).toHaveURL(/shops\/shop-orbit\/$/);
        await touchGesture(phone, -110, 0, ".shop-hero h1");
        await expect(phone).toHaveURL(/shops\/shop-rain\/$/);
        await expect(
          phone.getByRole("heading", { name: "雨と翻訳", exact: true }),
        ).toBeVisible();
        expect(await phone.evaluate(() => scrollY)).toBe(0);
        await touchGesture(phone, 110, 0, ".store-shelf-label h3");
        await expect(phone).toHaveURL(/shops\/shop-orbit\/$/);
        await touchGesture(phone, 110, 0, ".shop-hero h1");
        await expect(phone).toHaveURL(/shops\/shop-lamplight\/$/);
        await phone
          .getByRole("link", { name: "次の書店：軌道書房", exact: true })
          .tap();
        await expect(phone).toHaveURL(/shops\/shop-orbit\/$/);
        await shelf
          .getByRole("button", {
            name: "ソラリス · 面陳 · POPあり",
            exact: true,
          })
          .tap();
        await swipePop(phone, phone.locator(".bh-dialog .owner-pop"), -1);
        await expectBook(phone, "ソラリス");
        await expect(phone.locator(".bh-pop-page-count")).toHaveText("2 / 4");
        await expect(phone).toHaveURL(/shops\/shop-orbit\/$/);
        await phone.keyboard.press("Escape");
        await go(phone);
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
