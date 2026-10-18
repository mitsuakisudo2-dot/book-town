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
  // Saved data can exist before this page hydrates; wait until React owns the page.
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("main") ?? {}).some((key) =>
      key.startsWith("__reactFiber"),
    ),
  );
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
/** A shop's front in the alley: its first, once the alley has grown. */
function shop(page, name) {
  return page
    .locator(".street-shop")
    .filter({
      has: page.getByRole("link", { name: `${name}に入る`, exact: true }),
    })
    .first();
}
/** Walks the alley to its end, once: its next round comes. */
async function walkOn(page, rounds) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page).toHaveURL(new RegExp(`/\\?rounds=${rounds}$`));
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

/**
 * The three reactions under a POP stand in one row at equal widths, each a
 * full touch target with its icon and every word of its name in sight.
 */
async function expectReactionsInOneRow(pop, label) {
  const row = pop.locator(".bh-pop-reactions");
  await expect(row.getByRole("button")).toHaveCount(3);
  await restingBox(row);
  const buttons = await row.evaluate((element) =>
    Array.from(element.querySelectorAll("button"), (button) => {
      const box = button.getBoundingClientRect();
      const words = button.querySelector("span") ?? button;
      const range = document.createRange();
      range.selectNodeContents(words);
      const lines = Array.from(range.getClientRects());
      const icon = button.querySelector("svg").getBoundingClientRect();
      return {
        name: button.textContent,
        top: box.top,
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height,
        clipped:
          button.scrollWidth > button.clientWidth ||
          button.scrollHeight > button.clientHeight,
        wordsInside: lines.every(
          (line) =>
            line.left >= box.left &&
            line.right <= box.right &&
            line.top >= box.top &&
            line.bottom <= box.bottom,
        ),
        iconInside:
          icon.width > 0 && icon.left >= box.left && icon.right <= box.right,
      };
    }),
  );
  const card = await pop.boundingBox();
  expect(
    buttons.map((button) => button.name),
    label,
  ).toEqual(["いいね", "読みたくなった", "私も好き！"]);
  for (const button of buttons) {
    expect(Math.abs(button.top - buttons[0].top), label).toBeLessThan(1);
    expect(Math.abs(button.width - buttons[0].width), label).toBeLessThan(1);
    expect(button.width, label).toBeGreaterThanOrEqual(44);
    expect(button.height, label).toBeGreaterThanOrEqual(44);
    expect(button.clipped, `${label}: ${button.name} clipped`).toBe(false);
    expect(button.wordsInside, `${label}: ${button.name} words`).toBe(true);
    expect(button.iconInside, `${label}: ${button.name} icon`).toBe(true);
    expect(button.left, label).toBeGreaterThanOrEqual(card.x);
    expect(button.right, label).toBeLessThanOrEqual(card.x + card.width);
  }
}

/** Draws a finger most of a page across the POP: -1 to the next, 1 back. */
async function swipePop(page, pop, direction, held, lifted) {
  const track = pop.locator(".bh-pop-track");
  const width = await track.evaluate((element) => element.clientWidth);
  await fingerDrag(page, track, direction * width * 0.7, 0, held, lifted);
}

/** A screen reader finds these words once in the pager, never twice. */
async function expectReadOnce(pop, words) {
  const tree = await pop.locator(".bh-pop-pager").ariaSnapshot();
  expect(tree.split(words).length - 1, tree).toBe(1);
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

/**
 * Notes in the page each time the POP count turns: whether a finger had
 * lifted from the track, whether the browser had said the scroll ended since,
 * and how long the track had then been still. These listen on the document
 * on the way down, so they hear the lift and each scroll before the page's
 * own handlers do.
 */
async function watchCountTurns(pop) {
  await pop.evaluate((card) => {
    const track = card.querySelector(".bh-pop-track");
    const count = card.querySelector(".bh-pop-page-count");
    const stop = new AbortController();
    const turns = [];
    let lifted;
    let scrolled;
    let ended = false;
    let shown = count.textContent;
    const on = (type, heard) =>
      document.addEventListener(
        type,
        (event) => {
          if (track.contains(event.target)) heard(performance.now());
        },
        { capture: true, signal: stop.signal },
      );
    for (const type of ["touchend", "touchcancel"])
      on(type, (now) => {
        lifted = now;
      });
    on("scroll", (now) => {
      scrolled = now;
    });
    on("scrollend", () => {
      if (lifted !== undefined) ended = true;
    });
    const observer = new MutationObserver(() => {
      if (count.textContent === shown) return;
      shown = count.textContent;
      turns.push({
        to: shown,
        lifted: lifted !== undefined,
        ended,
        still:
          lifted === undefined
            ? 0
            : performance.now() - Math.max(lifted, scrolled ?? lifted),
      });
    });
    observer.observe(count, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    window.countTurns = () => {
      stop.abort();
      observer.disconnect();
      return turns;
    };
  });
}

/**
 * The count turned once, to `shown`, after the finger lifted, and only when
 * the track had come to rest as the page judges it: the browser had said the
 * scroll ended, or the track had been still for the short quiet the page
 * waits for instead (120 ms; 100 here). A count that follows the glide turns
 * a moment after one of its scrolls, or as the finger lifts.
 */
async function expectCountTurnedAtRest(pop, shown) {
  const turns = await pop.evaluate(() => window.countTurns());
  expect(turns.map((turn) => turn.to)).toEqual([shown]);
  const [turn] = turns;
  expect(turn.lifted, JSON.stringify(turn)).toBe(true);
  expect(turn.ended || turn.still >= 100, JSON.stringify(turn)).toBe(true);
}

// A finger drawn through the DevTools protocol: the browser scrolls what is
// under it as it would for a real touch. `held` runs before the finger lifts,
// `lifted` as it lifts, given the protocol session: what it sends follows the
// lift at once, not a round trip later.
async function fingerDrag(page, locator, dx, dy, held, lifted) {
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
    await Promise.all([
      cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      }),
      lifted?.(cdp),
    ]);
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
    "The alley under ホーム shows six unique demo bookstores with public shelves",
    async () => {
      await go(page);
      await expect(page.locator(".street-shop")).toHaveCount(6);
      const head = page.getByRole("heading", {
        name: "ここから、まだ知らない路地",
      });
      await expect(head).toBeVisible();
      // Every front is below its heading, in the ホーム pane.
      await expect(
        page.locator('[role="tabpanel"][data-pane="home"] .street-shop'),
      ).toHaveCount(6);
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
      await head.evaluate((element) => element.scrollIntoView());
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
      const shownPop = dialog.locator(`${CURRENT_POP} .bh-pop-text`);
      await expect(dialog).toContainText("わからないものと暮らす");
      await expect(shownPop).toHaveText(
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
      await expect(shownPop).toHaveText(
        "翻訳で読む、理解の届かなさ。異なる世界に触れる入口として。",
      );
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
      await expectReactionsInOneRow(pop, "1440px reactions");
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
      await expectReadOnce(pop, firstPop);
      await expectPopInView(pop);

      await pop.getByRole("button", { name: "次のPOP" }).click();
      await expect(shown).not.toHaveText(firstPop);
      await expectPopInView(pop);
      const turnedTo = await shown.innerText();
      const told = pop.locator(".bh-pop-pager .bh-sr-only");
      await expect(told).toHaveAttribute("aria-live", "polite");
      await expect(told).toHaveText(turnedTo);
      // The words reach a screen reader once: from the copy that tells the
      // turn, and from the page itself once that copy has gone.
      await expectReadOnce(pop, turnedTo);
      await expect(told).toBeEmpty({ timeout: 10_000 });
      await expect(
        pop.locator('.bh-pop-page:not([aria-hidden="true"])'),
      ).toHaveCount(1);
      await expect(pop.locator(CURRENT_POP)).not.toHaveAttribute("aria-hidden");
      await expectReadOnce(pop, turnedTo);
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
    "Follow in the alley; the top search asks the search page; the alley goes on round after round",
    async () => {
      await go(page);
      const orbit = shop(page, "軌道書房");
      await orbit
        .getByRole("button", { name: "軌道書房をフォロー", exact: true })
        .click();
      await expect(page.locator(".toast")).toHaveText(
        "軌道書房をフォローしました",
      );
      const followed = orbit.getByRole("button", {
        name: "軌道書房のフォローを解除",
        exact: true,
      });
      await expect(followed).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await expect(followed).toHaveAttribute("aria-pressed", "true");
      // What is typed at the top no longer narrows the alley: Enter opens
      // the search page, for books, readers and shops alike.
      const query = page.getByRole("textbox", {
        name: "本や書店を検索",
        exact: true,
      });
      await query.fill("雨と翻訳");
      await expect(page.locator(".street-shop")).toHaveCount(6);
      await query.press("Enter");
      await expect(page).toHaveURL(/\/search\/\?q=/);
      await expect(
        page.locator('section[aria-labelledby="search-shops-title"]'),
      ).toContainText("雨と翻訳");
      await go(page);
      const names = await page.locator(".street-shop-title").allTextContents();
      expect(new Set(names).size).toBe(6);
      // The alley has no end: walking on brings another round of shops,
      // and the address keeps how far, for 戻る.
      await walkOn(page, 2);
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
    "Home tabs come back to how far the alley was walked; ホーム from elsewhere opens the last tab at its start",
    async () => {
      await go(page);
      const tabs = page.getByRole("tablist", { name: "ホームの表示" });
      const nav = page.getByRole("navigation", {
        name: "メインナビゲーション",
      });
      const letters = tabs.getByRole("tab", { name: "便りだけ" });
      const home = tabs.getByRole("tab", { name: "ホーム" });
      await expect(home).toHaveAttribute("aria-selected", "true");
      await walkOn(page, 2);
      await walkOn(page, 3);
      // Back up the alley a little: where the reader is, not its end.
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight / 2));
      const y = await page.evaluate(() => scrollY);
      await letters.click();
      await expect(page).toHaveURL(/\/timeline\/$/);
      // The other tab opens as it was left, in place.
      await home.click();
      await expect(page).toHaveURL(/\/\?rounds=3$/);
      await expect(page.locator(".street-round")).toHaveCount(2);
      expect(
        Math.abs((await page.evaluate(() => scrollY)) - y),
      ).toBeLessThanOrEqual(2);
      await letters.click();
      await expect(page).toHaveURL(/\/timeline\/$/);
      // ホーム from another page opens the tab shown last, from its start,
      // after a reload too.
      await nav.getByRole("link", { name: "検索" }).click();
      await expect(page).toHaveURL(/\/search\/$/);
      await page.reload();
      await expect(nav.getByRole("link", { name: "ホーム" })).toHaveAttribute(
        "href",
        "/timeline/",
      );
      await nav.getByRole("link", { name: "ホーム" }).click();
      await expect(page).toHaveURL(/\/timeline\/$/);
      await expect(letters).toHaveAttribute("aria-selected", "true");
      await home.click();
      await expect(page).toHaveURL(`${baseURL}/`);
      await expect(page.locator(".street-round")).toHaveCount(0);
    },
  );
  await check(
    "A Home tab is kept as it now is, after ホーム, a switch of tabs or 戻る",
    async () => {
      await go(page);
      const tabs = page.getByRole("tablist", { name: "ホームの表示" });
      const nav = page.getByRole("navigation", {
        name: "メインナビゲーション",
      });
      const home = nav.getByRole("link", { name: "ホーム" });
      const homeTab = tabs.getByRole("tab", { name: "ホーム" });
      await expect(homeTab).toHaveAttribute("aria-selected", "true");
      await walkOn(page, 2);
      const steps = await page.evaluate(() => history.length);
      // ホーム on Home takes the tab back to its top, in place: how far the
      // alley was walked stays, and no step of 戻る is added.
      await page.evaluate(() => scrollTo(0, 400));
      await home.click();
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      await expect(page).toHaveURL(/\/\?rounds=2$/);
      await expect(page.locator(".street-round")).toHaveCount(1);
      expect(await page.evaluate(() => history.length)).toBe(steps);
      // The open ホーム tab does the same.
      await page.evaluate(() => scrollTo(0, 400));
      await homeTab.click();
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      await expect(page).toHaveURL(/\/\?rounds=2$/);
      // The other tab and back, in place: the alley is kept as it was.
      await tabs.getByRole("tab", { name: "便りだけ" }).click();
      await expect(page).toHaveURL(/\/timeline\/$/);
      await homeTab.click();
      await expect(page).toHaveURL(/\/\?rounds=2$/);
      await expect(page.locator(".street-round")).toHaveCount(1);
      expect(await page.evaluate(() => history.length)).toBe(steps);
      // 戻る from another page brings back how far it was walked.
      await nav.getByRole("link", { name: "検索" }).click();
      await expect(page).toHaveURL(/\/search\/$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/\?rounds=2$/);
      await expect(page.locator(".street-round")).toHaveCount(1);
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
    "Private shelf names, books and POPs stay out of Home (the alley, 本棚をのぞく, 書店のPOP, 今夜の一軒) and search",
    async () => {
      await page.evaluate(() => {
        const envelope = JSON.parse(localStorage.getItem("book-town-v1"));
        // A book of the reader's own, kept only on the private shelf.
        envelope.data.addedBooks = [
          ...(envelope.data.addedBooks ?? []),
          { id: "my-book-9001", title: "秘密QAの本_非公開", author: "QA" },
        ];
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
                {
                  id: "qa-private-own-book",
                  bookId: "my-book-9001",
                  display: "face",
                  pop: "秘密QAのPOP_非公開",
                },
              ],
            },
          ],
        };
        localStorage.setItem("book-town-v1", JSON.stringify(envelope));
      });
      await go(page);
      const own = shop(page, "公開展示QA書店");
      await expect(own.locator(".shelf-scroll")).toHaveCount(1);
      await expect(own).toContainText("公開QA棚");
      await expect(own).not.toContainText("秘密QAの紹介文_非公開");
      // Nowhere on Home: the shelf's name, its books and their POPs.
      await expect(page.locator("main")).not.toContainText("秘密QA");
      // A shop is found by the books it shows, never by a private one.
      await go(page, "/search/?q=" + encodeURIComponent("秘密QAの本"));
      const shops = page.locator(
        'section[aria-labelledby="search-shops-title"]',
      );
      await expect(shops).toContainText("合う書店は見つかりませんでした。");
      await expect(shops).not.toContainText("公開展示QA書店");
      await go(page, "/search/?q=" + encodeURIComponent("モモ"));
      await expect(shops).toContainText("公開展示QA書店");
      await go(page);
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
        // 書店をのぞく, among the doors at the top, brings the alley's first
        // shelves into sight.
        await phone
          .getByRole("navigation", { name: "できること" })
          .getByRole("button", { name: "書店をのぞく" })
          .tap();
        await expect
          .poll(() =>
            phone
              .locator(".street-shelf .shelf-scroll")
              .first()
              .evaluate((element) => element.getBoundingClientRect().top),
          )
          .toBeLessThan(700);
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
        // The POP moves under the finger; what it names waits until it
        // rests, not only while the finger holds it but through the glide
        // after it lifts.
        await watchCountTurns(pop);
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
        await expectCountTurnedAtRest(pop, "2 / 4");
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
        // Pressed while the POP still glides in after the finger has left
        // it, a reaction goes to that POP, not the one sliding away. The
        // finger rests before it lifts, so the POP glides in on its snap,
        // not on a fling: a tap that stops a browser's fling is no click.
        // The tap is sent with the lift, not a round trip after it: the snap
        // lasts about a fifth of a second, which a slow runner's round trips
        // can outlast. So the press comes as the glide begins; that the
        // count waits through the rest of a glide is checked on the first
        // swipe above. A starved machine can still hold the click until the
        // POP has come to rest. Such a press shows nothing of the glide: it
        // is checked as a press on the POP at rest and undone, and the swipe
        // made again, a few times at most.
        const rest = () => phone.waitForTimeout(150);
        const next = pop.getByRole("button", { name: "次のPOP" });
        await next.tap();
        await expect(count).toHaveText("3 / 4");
        const arriving = await like.getAttribute("aria-pressed");
        await pop.getByRole("button", { name: "前のPOP" }).tap();
        await expect(count).toHaveText("2 / 4");
        await expectPopInView(pop);
        let pressed;
        for (let attempt = 1; attempt <= 5; attempt++) {
          // Measured each time: the presses that undo a late one can leave
          // the book's page scrolled.
          await like.scrollIntoViewIfNeeded();
          await track.scrollIntoViewIfNeeded();
          const likeBox = await like.boundingBox();
          const point = {
            x: likeBox.x + likeBox.width / 2,
            y: likeBox.y + likeBox.height / 2,
            id: 2,
          };
          await like.evaluate((button) => {
            const card = button.closest(".owner-pop");
            const track = card.querySelector(".bh-pop-track");
            window.pressedDuringGlide = undefined;
            button.addEventListener(
              "click",
              () => {
                window.pressedDuringGlide = {
                  at: track.scrollLeft / track.clientWidth,
                  count: card.querySelector(".bh-pop-page-count").textContent,
                };
              },
              { capture: true, once: true },
            );
          });
          await swipePop(phone, pop, -1, rest, async (cdp) => {
            await Promise.all([
              cdp.send("Input.dispatchTouchEvent", {
                type: "touchStart",
                touchPoints: [point],
              }),
              cdp.send("Input.dispatchTouchEvent", {
                type: "touchEnd",
                touchPoints: [],
              }),
            ]);
          });
          // The browser answers for the tap before the click it makes of it
          // has reached the page.
          await expect
            .poll(() => phone.evaluate(() => window.pressedDuringGlide), {
              message: "the tap during the glide is a click",
            })
            .toBeDefined();
          pressed = await phone.evaluate(() => window.pressedDuringGlide);
          if (pressed.at < 1.98 || attempt === 5) break;
          // Pressed once the POP had come to rest, it went to that POP.
          await expect(count).toHaveText("3 / 4");
          await expectPopInView(pop);
          await expect(like).toHaveAttribute(
            "aria-pressed",
            arriving === "true" ? "false" : "true",
          );
          await like.tap();
          await expect(like).toHaveAttribute("aria-pressed", arriving);
          await pop.getByRole("button", { name: "前のPOP" }).tap();
          await expect(count).toHaveText("2 / 4");
          await expectPopInView(pop);
          await expect(like).toHaveAttribute("aria-pressed", liked);
        }
        expect(pressed.at).toBeGreaterThan(1.02);
        expect(pressed.at, "pressed before the POP came to rest").toBeLessThan(
          1.98,
        );
        expect(pressed.count).toBe("2 / 4");
        await expect(count).toHaveText("3 / 4");
        await expectPopInView(pop);
        await expect(like).toHaveAttribute(
          "aria-pressed",
          arriving === "true" ? "false" : "true",
        );
        await pop.getByRole("button", { name: "前のPOP" }).tap();
        await expect(count).toHaveText("2 / 4");
        await expect(like).toHaveAttribute("aria-pressed", liked);
        await next.tap();
        await expect(count).toHaveText("3 / 4");
        await like.tap();
        await expect(like).toHaveAttribute("aria-pressed", arriving);
        await pop.getByRole("button", { name: "前のPOP" }).tap();
        await expect(count).toHaveText("2 / 4");
        await expectPopInView(pop);
        // At either end the POP stays, and the book neither turns nor
        // closes: a finger drawn outward there is no swipe back through the
        // history. It rests before it lifts, so no fling eats the next tap.
        await pop.getByRole("button", { name: "前のPOP" }).tap();
        await expect(count).toHaveText("1 / 4");
        await expectPopInView(pop);
        await swipePop(phone, pop, 1, rest);
        await expect(count).toHaveText("1 / 4");
        await expectPopInView(pop);
        await expectBook(phone, "ソラリス");
        for (const shown of ["2 / 4", "3 / 4", "4 / 4"]) {
          await pop.getByRole("button", { name: "次のPOP" }).tap();
          await expect(count).toHaveText(shown);
        }
        await expectPopInView(pop);
        await swipePop(phone, pop, -1, rest);
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
  {
    const mobile = await browser.newContext({
      viewport: { width: 430, height: 793 },
      isMobile: true,
      hasTouch: true,
      locale: "ja-JP",
    });
    const phone = settleBeforeNavigating(await mobile.newPage());
    currentPage = phone;
    watch(phone);
    await check(
      "From 320px to 430px the three POP reactions share one row at equal widths",
      async () => {
        await go(phone);
        await shop(phone, "軌道書房")
          .getByRole("button", {
            name: "ソラリス · 面陳 · POPあり",
            exact: true,
          })
          .tap();
        await expectBook(phone, "ソラリス");
        const pop = phone.locator(".bh-dialog .owner-pop");
        for (const width of [
          430, 428, 414, 412, 393, 390, 375, 360, 344, 320,
        ]) {
          await phone.setViewportSize({ width, height: 793 });
          await expectReactionsInOneRow(pop, `${width}px reactions`);
        }
        // Pressed, a reaction still shows it.
        const like = pop.getByRole("button", { name: "いいね", exact: true });
        await expect(like).toHaveAttribute("aria-pressed", "false");
        const plain = await like.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        );
        await like.tap();
        await expect(like).toHaveAttribute("aria-pressed", "true");
        // The background eases in, so it is read once the change has begun.
        await expect
          .poll(() =>
            like.evaluate(
              (element) => getComputedStyle(element).backgroundColor,
            ),
          )
          .not.toBe(plain);
        await expectReactionsInOneRow(pop, "320px pressed reactions");
        await like.tap();
        await expect(like).toHaveAttribute("aria-pressed", "false");
        await phone.keyboard.press("Escape");
      },
    );
    await check(
      "393px POP card keeps still for ordinary POPs and fits a long one only when it is shown",
      async () => {
        await phone.setViewportSize({ width: 393, height: 793 });
        const solaris = () =>
          shop(phone, "軌道書房")
            .getByRole("button", {
              name: "ソラリス · 面陳 · POPあり",
              exact: true,
            })
            .tap();
        const pop = phone.locator(".bh-dialog .owner-pop");
        const count = pop.locator(".bh-pop-page-count");
        const next = pop.getByRole("button", { name: "次のPOP" });
        const reactions = pop.locator(".bh-pop-reactions");
        const card = () =>
          pop.evaluate((element, current) => {
            const box = (selector) =>
              element.querySelector(selector).getBoundingClientRect();
            return {
              track: box(".bh-pop-track").height,
              shown: box(`${current} .bh-pop-text`),
              count: box(".bh-pop-page-count").top,
              reactions: box(".bh-pop-reactions"),
              viewport: innerHeight,
            };
          }, CURRENT_POP);
        // Turning between POPs of ordinary length moves nothing under them.
        await solaris();
        await expect(count).toHaveText("1 / 4");
        const still = (await restingBox(reactions)).y;
        for (const shown of ["2 / 4", "3 / 4", "4 / 4"]) {
          await next.tap();
          await expect(count).toHaveText(shown);
          await expectPopInView(pop);
          expect(
            Math.abs((await restingBox(reactions)).y - still),
          ).toBeLessThan(1);
        }
        await phone.keyboard.press("Escape");
        // Another reader's long POP for the same book, near the most a POP
        // may hold.
        const long = "読み終えてから、何度も表紙を眺めた。".repeat(50);
        await phone.evaluate((pop) => {
          const envelope = JSON.parse(localStorage.getItem("book-town-v1"));
          envelope.data.ownShop = {
            id: "mine",
            ownerId: "me",
            name: "長いPOPの書店",
            description: "長いPOPを書く書店。",
            theme: "sage",
            tagline: "一冊を長く語る",
            followers: 0,
            demo: false,
            shelves: [
              {
                id: "long-pop",
                name: "長く語る棚",
                capacity: 20,
                isPublic: true,
                items: [
                  {
                    id: "long-solaris",
                    bookId: "solaris",
                    display: "face",
                    pop,
                  },
                ],
              },
            ],
          };
          localStorage.setItem("book-town-v1", JSON.stringify(envelope));
        }, long);
        await phone.reload();
        await solaris();
        await expect(count).toHaveText("1 / 5");
        await expectPopInView(pop);
        // On a short POP the card stays near its words, and the count and the
        // reactions are in sight with the card's top.
        await pop.evaluate((element) => element.scrollIntoView());
        await restingBox(reactions);
        const short = await card();
        expect(short.track).toBeLessThan(220);
        expect(short.count - short.shown.bottom).toBeLessThan(120);
        expect(short.reactions.bottom).toBeLessThanOrEqual(short.viewport);
        // On the long POP the card grows to show every word of it.
        for (const shown of ["2 / 5", "3 / 5", "4 / 5", "5 / 5"]) {
          await next.tap();
          await expect(count).toHaveText(shown);
        }
        await expectPopInView(pop);
        await expect(pop.locator(`${CURRENT_POP} .bh-pop-text`)).toHaveText(
          long,
        );
        const full = await card();
        expect(full.shown.height).toBeGreaterThan(1000);
        expect(full.track).toBeGreaterThanOrEqual(full.shown.height);
        expect(full.count).toBeGreaterThanOrEqual(full.shown.bottom);
        await noOverflow(phone, "393px long POP");
        // Back on a short one, the card is short again.
        await pop.getByRole("button", { name: "前のPOP" }).tap();
        await expect(count).toHaveText("4 / 5");
        await expectPopInView(pop);
        expect((await card()).track).toBeLessThan(220);
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
