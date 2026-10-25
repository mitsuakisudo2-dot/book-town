import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { layersSettled, settleBeforeNavigating } from "./journey-layers.mjs";
import { expectReadable } from "./journey-contrast.mjs";
import {
  coarse,
  expectKeyboardUp,
  fakeKeyboard,
  forgetFocus,
  watchFocus,
} from "./journey-keyboard.mjs";

// The 便り: the v37 card on every screen that shows posts, and the page that
// slides in from the right (PR 1a). Each check runs on a phone held by a
// finger, at 390 and at 320px, with the page's clock in the test's hands.

const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/home-qa",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BOOK_TOWN_CHROME || undefined,
  headless: true,
});
const errors = [];
const passed = [];
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
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("main") ?? {}).some((key) =>
      key.startsWith("__reactFiber"),
    ),
  );
}
// Only what is shown: Home keeps the tab not shown on the page, hidden.
const card = (author, text) =>
  page
    .locator("main article.letter:visible")
    .filter({ has: page.getByRole("link", { name: author, exact: true }) })
    .filter({ hasText: text });
/** A 便り's page, open over the screen. */
const letterPage = (author) =>
  page.getByRole("dialog", { name: new RegExp("^" + author + "さんの便り") });
// Home itself (PR 1b): its two tabs, ホーム and 便りだけ.
const tabs = () => page.getByRole("tablist", { name: "ホームの表示" });
const tab = (name) => tabs().getByRole("tab", { name, exact: true });
const pane = (which) => page.locator(`[role="tabpanel"][data-pane="${which}"]`);
/** Words that count nothing, which the town never shows (CLAUDE.md). */
const ZERO = /(^|\D)0(人|件|軒|分|回|冊| 便り| フォロ)/;
/** Opens Home on ホーム (a fresh `/` opens the tab shown last), drawn. */
async function goHome() {
  await go("/");
  if ((await tab("ホーム").getAttribute("aria-selected")) !== "true")
    await tab("ホーム").tap();
  await expect(page).toHaveURL(`${baseURL}/`);
  await expect(page.locator(".home-skeletons")).toHaveCount(0);
}
/**
 * Waits for the web fonts to be in: they come after the page has loaded
 * (SHOW_FONTS in src/app/layout.tsx), and a 便り's lines wrap again when they
 * do. A check that measures where things sit waits for them first.
 */
async function fontsSettled() {
  await expect(page.locator("#web-fonts")).toHaveAttribute("media", "all", {
    timeout: 20_000,
  });
  await page.evaluate(async () => {
    await new Promise((done) =>
      requestAnimationFrame(() => requestAnimationFrame(done)),
    );
    await document.fonts.ready;
  });
}
/** Opens a page of its own on the browser for a check, then closes it. */
async function withPage(options, run) {
  const reader = page;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    ...options,
  });
  await context.clock.install();
  page = settleBeforeNavigating(await context.newPage());
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await run();
  } finally {
    await context.close();
    page = reader;
  }
}
/**
 * A one-finger sideways swipe as synthetic touches (as the app journey's),
 * starting on `locator`: at its middle, or `x` from the left of the screen.
 */
async function swipe(locator, dx, x) {
  await locator.evaluate(
    (element, { dx, x }) => {
      const box = element.getBoundingClientRect();
      const start = {
        identifier: 1,
        target: element,
        clientX: x ?? box.left + box.width / 2,
        clientY: box.top + Math.min(box.height / 2, 40),
      };
      const first = new Touch(start);
      const last = new Touch({ ...start, clientX: start.clientX + dx });
      for (const [type, touches, changed] of [
        ["touchstart", [first], [first]],
        ["touchmove", [last], [last]],
        ["touchend", [], [last]],
      ])
        element.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            touches,
            changedTouches: changed,
          }),
        );
    },
    { dx, x },
  );
}
/**
 * A step of a finger drawn down Home from near its top, as synthetic
 * touches: "start", a "move" to `dy` below (and `dx` aside), or "end".
 */
async function pull(stage, dy = 0, dx = 0) {
  await page.locator(".home-view").evaluate(
    (element, { stage, dy, dx }) => {
      const box = element.getBoundingClientRect();
      const top = box.top + 120;
      const point = new Touch({
        identifier: 1,
        target: element,
        clientX: box.left + box.width / 2 + dx,
        clientY: top + dy,
      });
      const type = "touch" + stage;
      element.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          touches: stage === "end" ? [] : [point],
          changedTouches: [point],
        }),
      );
    },
    { stage, dy, dx },
  );
}
/** The demo town's six shops. */
const DEMO_SHOPS = [
  "shop-orbit",
  "shop-rain",
  "shop-question",
  "shop-window",
  "shop-frame",
  "shop-lamplight",
];
/**
 * Follows every shop of the demo town. Every demo 便り is by one of their
 * owners, so 便りだけ (`/timeline/`) then has them all.
 */
async function followEveryShop() {
  await go("/");
  await editTown(`data.following = ${JSON.stringify(DEMO_SHOPS)};`);
}
/** Changes the saved town, as another device or the database would. */
async function editTown(change) {
  await page.evaluate((source) => {
    const saved = JSON.parse(localStorage.getItem("book-town-v1"));
    new Function("data", source)(saved.data);
    localStorage.setItem("book-town-v1", JSON.stringify(saved));
  }, change);
}
/** Posts from the round button, as a finger does. */
async function compose(text) {
  await page.locator(".compose-fab").tap();
  const sheet = page.getByRole("dialog", { name: "投稿する" });
  await sheet.locator("textarea").fill(text);
  await sheet.getByRole("button", { name: "投稿する" }).tap();
  await expect(sheet).toHaveCount(0);
}
/** Stops the page's clock a moment ahead of where it has got to. */
async function stopClock(ahead = 100) {
  // A slow runner can take longer than `ahead` between reading the clock and
  // stopping it, and the clock will not go back. It stands still by then, so
  // read again: the second try lands ahead of it.
  for (let tries = 1; ; tries += 1) {
    const now = await page.evaluate(() => Date.now());
    try {
      return await page.clock.pauseAt(now + ahead);
    } catch (error) {
      if (tries > 1 || !String(error).includes("fast-forward to the past"))
        throw error;
    }
  }
}
/**
 * A finger dragged across the screen (CDP touch: pointer events), one step
 * every `every` ms. The page's clock stands still between steps (its events
 * take their time from it), so a flick is as fast as the test says however
 * slowly the browser is driven.
 */
async function drag(from, to, { steps = 10, every = 16 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const at = (x, y) => [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }];
  await stopClock();
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: at(from.x, from.y),
    });
    for (let step = 1; step <= steps; step += 1) {
      await page.clock.runFor(every);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: at(
          from.x + ((to.x - from.x) * step) / steps,
          from.y + ((to.y - from.y) * step) / steps,
        ),
      });
    }
    await page.clock.runFor(every);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await cdp.detach();
    await page.clock.resume();
  }
}
/**
 * Taps `target` and gives how far the page was scrolled when the tap became
 * a click. Playwright may scroll before it taps (a target still moving is
 * tried again, centred), so the page opens over that place, not the one read
 * before the tap.
 */
async function tapScrolled(target) {
  await page.evaluate(() => {
    const note = () => {
      window.scrolledAtTap = scrollY;
    };
    window.scrolledAtTap = undefined;
    window.stopNotingTap = () => removeEventListener("click", note, true);
    addEventListener("click", note, true);
  });
  await target.tap();
  return page.evaluate(() => {
    window.stopNotingTap();
    return window.scrolledAtTap;
  });
}
/** Waits until a 便り's page has slid all the way in, under the finger. */
const slidIn = (layer) =>
  layer.evaluate((element) =>
    Promise.all(element.getAnimations().map((motion) => motion.finished)),
  );
/** Notes from now on whether the page follows a finger. */
const watchFollowing = (layer) =>
  layer.evaluate((element) => {
    element.dataset.followed = "";
    new MutationObserver((changes, watcher) => {
      if (!element.classList.contains("is-dragging")) return;
      element.dataset.followed = "yes";
      watcher.disconnect();
    }).observe(element, { attributes: true, attributeFilter: ["class"] });
  });
const following = (layer) =>
  layer.evaluate((element) => element.dataset.followed === "yes");
/** The page has no sideways scroll. */
async function noOverflow(label) {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    page: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(size.page, `${label}: root overflow`).toBeLessThanOrEqual(
    size.width + 1,
  );
  expect(size.body, `${label}: body overflow`).toBeLessThanOrEqual(
    size.width + 1,
  );
}
/**
 * Every control in `scope` is at least 44×44, but for words inside a
 * sentence (a #tag, covered words), and no words are under 12px but a
 * jacket's own art.
 */
async function expectTargetsAndType(scope, label) {
  const found = await scope.evaluateAll((roots) => {
    const small = [];
    const tiny = [];
    for (const root of roots) {
      for (const element of root.querySelectorAll('button, a, [role="tab"]')) {
        if (element.closest(".post-text")) continue;
        const box = element.getBoundingClientRect();
        if (!box.width && !box.height) continue;
        if (box.width < 43.5 || box.height < 43.5)
          small.push(
            `${element.tagName} ${element.className} 「${element.textContent.trim().slice(0, 12)}」 ${Math.round(box.width)}×${Math.round(box.height)}`,
          );
      }
      for (const element of [root, ...root.querySelectorAll("*")]) {
        if (element.closest(".book-jacket")) continue;
        if (!element.getClientRects().length) continue;
        const size = parseFloat(getComputedStyle(element).fontSize);
        const words = [...element.childNodes].some(
          (node) => node.nodeType === 3 && node.textContent.trim(),
        );
        if (words && size < 12)
          tiny.push(`${element.tagName} ${element.className} ${size}px`);
      }
    }
    return { small, tiny };
  });
  expect(found.small, `${label}: targets under 44px`).toEqual([]);
  expect(found.tiny, `${label}: words under 12px`).toEqual([]);
}
/**
 * Every control in `selector`'s matches takes a finger 44px across: each
 * scrolled to the middle of the screen, a point anywhere within 21px of its
 * middle (corners too) lands on it, by its own box or by what reaches past
 * its edges. A shelf's books are the books themselves, and left out.
 */
async function expectFingerTargets(selector, label) {
  const missed = await page.evaluate((selector) => {
    const missed = [];
    const controls = [...document.querySelectorAll(selector)].flatMap((root) =>
      [...root.querySelectorAll("a, button")].filter(
        (control) =>
          !control.closest(".shelf-scroll") && control.getClientRects().length,
      ),
    );
    for (const control of controls) {
      control.scrollIntoView({ block: "center" });
      const box = control.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const miss = [-21, 0, 21]
        .flatMap((dx) => [-21, 0, 21].map((dy) => [dx, dy]))
        .find(([dx, dy]) => {
          const hit = document.elementFromPoint(x + dx, y + dy);
          return !hit || !control.contains(hit);
        });
      if (miss)
        missed.push(
          `${control.tagName} ${control.className} 「${control.textContent.trim().slice(0, 12)}」 ${Math.round(box.width)}×${Math.round(box.height)}, missed at ${miss}`,
        );
    }
    return { missed, count: controls.length };
  }, selector);
  expect(missed.count, `${label}: controls found`).toBeGreaterThan(0);
  expect(missed.missed, `${label}: points a finger misses`).toEqual([]);
}
/**
 * No words in `scope` are under 12px, but for art that draws a thing at its
 * size: a jacket, the spines on a shelf, a poster's sheet (its words scale
 * with it, down to a miniature), the initial in an avatar.
 */
async function expectNoTinyWords(scope, label) {
  const tiny = await scope.evaluateAll((roots) =>
    roots.flatMap((root) =>
      [root, ...root.querySelectorAll("*")].flatMap((element) => {
        if (
          element.closest(
            ".book-jacket, .shelf-scroll, .poster-sheet, .reader-avatar",
          ) ||
          !element.getClientRects().length
        )
          return [];
        const size = parseFloat(getComputedStyle(element).fontSize);
        const words = [...element.childNodes].some(
          (node) => node.nodeType === 3 && node.textContent.trim(),
        );
        return words && size < 12
          ? [
              `${element.tagName} ${element.className} 「${element.textContent.trim().slice(0, 12)}」 ${size}px`,
            ]
          : [];
      }),
    ),
  );
  expect(tiny, `${label}: words under 12px`).toEqual([]);
}
/**
 * For each line of a card's words but the last, how far it ends from the
 * column's right edge (the words' own boxes, not the boxes around them).
 */
const lineGaps = (text) =>
  text.evaluate((element) => {
    const column = element.getBoundingClientRect();
    const ends = new Map();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (!rect.width) continue;
        const line = Math.round(rect.top);
        ends.set(line, Math.max(ends.get(line) ?? 0, rect.right));
      }
    }
    const lines = [...ends.entries()].sort((a, b) => a[0] - b[0]);
    return {
      lines: lines.length,
      gaps: lines.slice(0, -1).map(([, right]) => column.right - right),
    };
  });
/** How many characters fill a line of a card's words at this width. */
const charactersPerLine = () =>
  page
    .locator("main .letter-text")
    .first()
    .evaluate((sample) => {
      const probe = document.createElement("div");
      probe.className = "letter-text";
      Object.assign(probe.style, {
        position: "absolute",
        visibility: "hidden",
        width: `${sample.getBoundingClientRect().width}px`,
      });
      probe.textContent = "本".repeat(100);
      sample.parentElement.append(probe);
      const range = document.createRange();
      let first = null;
      let count = 0;
      for (; count < 100; count += 1) {
        range.setStart(probe.firstChild, count);
        range.setEnd(probe.firstChild, count + 1);
        const top = Math.round(range.getBoundingClientRect().top);
        first ??= top;
        if (top !== first) break;
      }
      probe.remove();
      return count;
    });

// Japanese with no punctuation or small kana, which the line breaking rules
// would carry to the next line.
const PLAIN_WORDS =
  "雨の日の午後は窓際の席で本を読むのがいちばん好きだ湯気の立つお茶と古い文庫本があれば何時間でも過ごせる気がする";
const LONG_LINES = Array.from(
  { length: 12 },
  (_, at) => `${at + 1}行目の言葉。`,
).join("\n");

try {
  for (const width of [390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await watchFocus(context);
    await fakeKeyboard(context);
    // Time flows as usual until a check stops it.
    await context.clock.install();
    page = settleBeforeNavigating(await context.newPage());
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const label = `${width}px`;
    await followEveryShop();

    await check(
      `${label} card geometry: one left edge, いいね in the middle`,
      async () => {
        expect(await coarse(page)).toBe(true);
        await go("/timeline/");
        const post = card("凪", "十年ぶりに再読");
        await expect(post).toBeVisible();
        const at = await post.evaluate((article) => {
          const box = (selector) =>
            article.querySelector(selector).getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(article.querySelector(".post-author"));
          const dots = article.querySelectorAll(".letter-menu-button circle");
          return {
            name: range.getBoundingClientRect().left,
            text: box(".letter-text").left,
            column: box(".letter-body"),
            frame: box(".letter-book").left,
            reply: box(".letter-reply path").left,
            like: box(".letter-like"),
            dotsEnd: dots[dots.length - 1].getBoundingClientRect().right,
            textEnd: box(".letter-text").right,
            menu: box(".letter-menu-button").right,
            articleRight: article.getBoundingClientRect().right,
          };
        });
        for (const [what, left] of [
          ["the name", at.name],
          ["the book's frame", at.frame],
          ["the reply icon's line", at.reply],
        ])
          expect(
            Math.abs(left - at.text),
            `${what} at the text's left`,
          ).toBeLessThanOrEqual(1);
        const middle = at.column.left + at.column.width / 2;
        expect(
          Math.abs(at.like.left + at.like.width / 2 - middle),
          "いいね at the middle of the words' column",
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(at.textEnd - at.dotsEnd),
          "「…」 ends at the text's right edge",
        ).toBeLessThanOrEqual(2);
        expect(at.menu, "「…」 inside the card").toBeLessThanOrEqual(
          at.articleRight,
        );
        await noOverflow(`${label} timeline`);
        await page.screenshot({
          path: path.join(output, `timeline-${width}.png`),
        });
      },
    );

    await check(
      `${label} a long 便り folds to six lines; one tap opens it, the next its page`,
      async () => {
        await go("/timeline/");
        await compose(LONG_LINES);
        const mine = card("あなた", "1行目の言葉。");
        const text = mine.locator(".letter-text");
        await expect(text).toHaveClass(/is-folded/);
        const more = mine.getByRole("button", { name: "続きを読む" });
        await expect(more).toHaveAttribute("aria-expanded", "false");
        const folded = await text.evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          line: parseFloat(getComputedStyle(element).lineHeight),
        }));
        expect(Math.round(folded.height / folded.line)).toBe(6);
        await expectReadable(more, "続きを読む");
        await text.tap();
        await expect(text).not.toHaveClass(/is-folded/);
        await expect(
          mine.getByRole("button", { name: "たたむ" }),
        ).toHaveAttribute("aria-expanded", "true");
        expect(
          await text.evaluate(
            (element) => element.getBoundingClientRect().height,
          ),
        ).toBeGreaterThanOrEqual(folded.line * 12 - 1);
        await expect(letterPage("あなた")).toHaveCount(0);
        await text.tap();
        await expect(letterPage("あなた")).toBeVisible();
        // The page shows it whole.
        await expect(
          letterPage("あなた").locator(".letter-text"),
        ).not.toHaveClass(/is-folded/);
        await letterPage("あなた").getByRole("button", { name: "戻る" }).tap();
        await expect(letterPage("あなた")).toHaveCount(0);
      },
    );

    await check(
      `${label} a spoiler is one button, its words not on the page; open from the start once the book is read`,
      async () => {
        await go("/timeline/");
        const spoiler = card("凪", "闇の左手");
        const cover = spoiler.locator(".letter-spoiler");
        await expect(cover).toHaveCount(1);
        await expect(cover).toHaveAttribute("aria-expanded", "false");
        await expect(
          spoiler.getByRole("button", {
            name: /結末に触れています・押すと表示/,
          }),
        ).toHaveAccessibleName(/『闇の左手』/);
        await expect(page.getByText("最後の数章を読んだ夜は")).toHaveCount(0);
        expect(
          await page.evaluate(() =>
            document.documentElement.innerHTML.includes(
              "最後の数章を読んだ夜は",
            ),
          ),
        ).toBe(false);
        await expectReadable(
          spoiler.locator(".letter-spoiler-words"),
          "spoiler box",
        );
        // A spoiler reply on its page is covered too, for a reader who has
        // not finished the book.
        await spoiler.locator(".letter-time").tap();
        const letter = letterPage("凪");
        await expect(letter).toBeVisible();
        const reply = letter.locator("article.is-reply").filter({
          has: page.getByRole("link", { name: "すみれ", exact: true }),
        });
        await expect(reply.locator(".letter-spoiler")).toHaveCount(1);
        await expect(page.getByText("語り手の距離感")).toHaveCount(0);
        await letter.getByRole("button", { name: "戻る" }).tap();
        await expect(letter).toHaveCount(0);
        // Finished: a record of the book is kept.
        await go("/books/left-hand/");
        await page
          .getByRole("button", { name: "読み終えた気持ちを残す" })
          .tap();
        const sheet = page.getByRole("dialog", { name: "読み終えた気持ち" });
        await sheet.getByRole("button", { name: "記録する" }).tap();
        await expect(sheet).toHaveCount(0);
        await go("/timeline/");
        const open = card("凪", "最後の数章を読んだ夜は");
        await expect(open).toBeVisible();
        await expect(open.locator(".letter-spoiler")).toHaveCount(0);
        await open.locator(".letter-time").tap();
        await expect(
          letterPage("凪").getByText("語り手の距離感"),
        ).toBeVisible();
        await letterPage("凪").getByRole("button", { name: "戻る" }).tap();
      },
    );

    await check(
      `${label} いいね adds one a tap, shows 「n回」 a moment, and asks after ten`,
      async () => {
        await go("/timeline/");
        const post = card("すみれ", "二駅乗り過ごした");
        const like = post.getByRole("button", { name: "いいね", exact: true });
        const pill = post.locator(".letter-like-pill");
        // The clock stops: a moment is what the test says it is.
        await stopClock();
        await like.tap();
        await expect(like).toHaveAttribute("aria-pressed", "true");
        await expect(pill).toHaveText("1回");
        await expect(pill).toHaveAttribute("aria-hidden", "true");
        await expect(page.locator(".town-said")).toHaveText("いいね 1回");
        await expectReadable(pill, "「1回」");
        await page.clock.runFor(900);
        await expect(pill).toHaveText("1回");
        await page.clock.runFor(300);
        await expect(pill).toHaveCount(0);
        await expect(post).not.toContainText("回");
        for (let taps = 2; taps <= 10; taps += 1) {
          await like.tap();
          await expect(pill).toHaveText(`${taps}回`);
        }
        await page.clock.runFor(1200);
        await expect(post).not.toContainText("回");
        // The eleventh asks whether to take it back.
        await like.tap();
        const ask = page.getByRole("dialog", {
          name: "いいねを取り消しますか",
        });
        await expect(ask).toBeVisible();
        await expect(pill).toHaveCount(0);
        for (const name of ["取り消す", "そのまま"]) {
          const box = await ask.getByRole("button", { name }).boundingBox();
          expect(box.height, name).toBeGreaterThanOrEqual(44);
        }
        await ask.getByRole("button", { name: "取り消す" }).tap();
        await expect(ask).toHaveCount(0);
        await expect(like).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator(".toast")).toHaveText(
          "いいねを取り消しました",
        );
        await page.clock.resume();
        // The writer is shown no count either.
        await editTown(
          `const post = data.posts.find((entry) => entry.authorId === "me");
         post.likers = [{ readerId: "r-sumire", taps: 3, at: post.createdAt }];
         post.likes = 3;`,
        );
        await go("/profiles/me/");
        expect(
          await page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("book-town-v1")).data.posts[0]
                .likers?.length,
          ),
          "the likes reached the town",
        ).toBe(1);
        const own = page.locator("main article.letter").first();
        await expect(own).toBeVisible();
        await expect(own).not.toContainText(/\d+\s*(回|人)/);
      },
    );

    await check(
      `${label} 読みたい sits in the book's frame and names whose 便り it was`,
      async () => {
        await go("/timeline/");
        const post = card("すみれ", "どこから開いてもいい本");
        const frame = post.locator(".letter-book");
        const want = frame.getByRole("button", { name: "読みたい" });
        await expect(want).toHaveAttribute("aria-pressed", "false");
        const box = await want.boundingBox();
        const pill = await want.locator(".letter-want-pill").boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(pill.height).toBeGreaterThanOrEqual(36);
        const edge = await frame.boundingBox();
        expect(edge.x + edge.width - (pill.x + pill.width)).toBeLessThan(12);
        expect(edge.y + edge.height - (pill.y + pill.height)).toBeLessThan(12);
        await want.tap();
        await expect(want).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator(".toast")).toContainText(
          "『見えない都市』を読みたいに入れました。すみれさんの便りで出会った本として残します。",
        );
        await expectReadable(want.locator(".letter-want-pill"), "読みたい, on");
        await want.tap();
        await expect(want).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator(".toast")).toHaveText(
          "この便りで出会った記録を外しました。読みたい本には残っています",
        );
        await want.tap();
        await go("/books/invisible-cities/");
        await expect(
          page.getByText("すみれさんの感想で、読みたくなった本です。"),
        ).toBeVisible();
      },
    );

    await check(
      `${label} the book page still offers 読みたい on others' 便り`,
      async () => {
        await go("/books/invisible-cities/");
        // The 便り is where the reader met the book (この本との出会い), and
        // among the book's 便り, last.
        const met = page.locator(".book-encounters article.letter");
        await expect(met).toHaveCount(1);
        await expect(met).toContainText("どこから開いてもいい本");
        const post = card("すみれ", "どこから開いてもいい本").last();
        await expect(post.locator(".letter-book")).toHaveCount(0);
        const want = post.getByRole("button", { name: "読みたい" });
        await expect(want).toHaveAttribute("aria-pressed", "true");
        await want.tap();
        await expect(
          page.getByText("すみれさんの感想で、読みたくなった本です。"),
        ).toHaveCount(0);
        await want.tap();
        await expect(
          page.getByText("すみれさんの感想で、読みたくなった本です。"),
        ).toBeVisible();
        await noOverflow(`${label} book page`);
      },
    );

    await check(
      `${label} a 便り's page: by keyboard, its replies, the reply sheet, swipes and its address`,
      async () => {
        await go("/timeline/");
        // A reply of the reader's own, older than the town's two, comes last
        // in the saved town: the page puts it first.
        await editTown(
          `data.posts.push({
             id: "me-post-early-reply",
             authorId: "me",
             body: "わたしも再読したくなりました。",
             bookId: null,
             spoiler: false,
             parentId: "p-1",
             createdAt: "2026-10-10T09:20:00+09:00",
             likes: 0,
             wants: 0,
             readingMode: null,
           });`,
        );
        await go("/timeline/");
        // Keyboard: Tab to the time link, Enter, 戻る has the focus; Escape
        // closes, and the time link has it again.
        const post = card("凪", "十年ぶりに再読");
        const time = post.locator(".letter-time");
        await post.getByRole("link", { name: "凪", exact: true }).focus();
        await page.keyboard.press("Tab");
        await expect(time).toBeFocused();
        await page.keyboard.press("Enter");
        const letter = letterPage("凪");
        await expect(letter).toBeVisible();
        await expect(
          letter.getByRole("button", { name: "戻る" }),
        ).toBeFocused();
        await expect(letter).toHaveAttribute("aria-modal", "true");
        await expect(
          letter.getByRole("heading", { name: "便り" }),
        ).toBeVisible();
        // The screen beneath waits.
        expect(
          await page
            .locator(".town-workspace")
            .evaluate((element) => element.inert),
        ).toBe(true);
        // Replies, oldest first; the writer's own is marked.
        const replies = letter.locator("article.is-reply");
        await expect(replies).toHaveCount(3);
        await expect(replies.nth(0)).toContainText(
          "わたしも再読したくなりました",
        );
        await expect(replies.nth(1)).toContainText("灯");
        await expect(replies.nth(2)).toContainText("凪");
        await expect(
          replies.nth(2).locator(".letter-tag", { hasText: "投稿した人" }),
        ).toBeVisible();
        await expect(replies.nth(1)).not.toContainText("投稿した人");
        // Another's reply that recommends a book offers 読みたい in its row.
        await expect(
          replies
            .nth(2)
            .locator(".letter-book")
            .getByRole("button", { name: "読みたい" }),
        ).toBeVisible();
        await expect(replies.locator(".letter-reply")).toHaveCount(0);
        await expect(letter.locator(".post-page-replies-head")).toHaveText(
          "返信",
        );
        // Type and size of the page.
        const words = letter.locator(".is-main .letter-text");
        expect(
          await words.evaluate((element) => {
            const style = getComputedStyle(element);
            return [style.fontSize, style.lineHeight];
          }),
        ).toEqual(["16px", "26.4px"]);
        await expectTargetsAndType(letter, `${label} post page`);
        await expectReadable(letter.locator(".post-page-head h2"), "便り");
        await expectReadable(letter.locator(".post-page-replies-head"), "返信");
        await expectReadable(
          letter.locator(".post-page-reply > span:last-child"),
          "reply bar",
        );
        await expectReadable(replies.locator(".post-text"), "replies");
        await page.screenshot({
          path: path.join(output, `post-page-${width}.png`),
        });
        await page.keyboard.press("Escape");
        await expect(letter).toHaveCount(0);
        await expect(time).toBeFocused();

        // The reply bar opens the writing sheet with its text box ready.
        await post.locator(".letter-text").tap();
        await expect(letter).toBeVisible();
        await forgetFocus(page);
        await letter.getByRole("button", { name: "凪さんに返信" }).tap();
        const sheet = page.getByRole("dialog", { name: "返信", exact: true });
        await expectKeyboardUp(page, sheet.locator("textarea"), "返信");
        await page.keyboard.press("Escape");
        await expect(sheet).toHaveCount(0);
        await expect(letter).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(letter).toHaveCount(0);
        // Closing the page while the sheet's step is still coming off the
        // history: the page stays closed, its step off too.
        await layersSettled(page);
        await post.locator(".letter-text").tap();
        await expect(letter).toBeVisible();
        await letter.getByRole("button", { name: "凪さんに返信" }).tap();
        await expect(sheet).toBeVisible();
        await page.evaluate(async () => {
          const escape = () =>
            document.activeElement.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Escape",
                bubbles: true,
                cancelable: true,
              }),
            );
          escape();
          await new Promise((done) => setTimeout(done, 5));
          escape();
        });
        await expect(sheet).toHaveCount(0);
        await expect(letter).toHaveCount(0);
        await layersSettled(page);
        await expect(letter).toHaveCount(0);
        expect(
          await page.evaluate(() => history.state?.booktownLayers ?? null),
        ).toBeNull();

        // The screen beneath stays where it was. The closed page's step
        // comes off the history a moment later, and the browser then puts
        // the page where it was when the 便り opened; the reader's next
        // scroll comes after that, and so does this one.
        await layersSettled(page);
        await page.evaluate(() => scrollTo(0, 700));
        await page.waitForTimeout(100);
        expect(await page.evaluate(() => scrollY)).toBeGreaterThan(600);
        const below = page.locator("main article.letter .letter-time");
        const target = await below.evaluateAll((links) =>
          links.findIndex((link) => {
            const box = link.getBoundingClientRect();
            return box.top > 120 && box.bottom < innerHeight - 120;
          }),
        );
        expect(target).toBeGreaterThanOrEqual(0);
        const before = await tapScrolled(below.nth(target));
        expect(before).toBeGreaterThan(600);
        const opened = page.locator(".post-page.is-layer");
        await expect(opened).toBeVisible();
        await opened.getByRole("button", { name: "戻る" }).tap();
        await expect(opened).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(before);

        // Swipes: a slow 60px drag springs back; 150px, or a quick 40px
        // flick, closes it; a drag from the left edge is Safari's, not ours.
        await time.scrollIntoViewIfNeeded();
        const under = await tapScrolled(time);
        await slidIn(letter);
        const y = 420;
        await watchFollowing(letter);
        await drag({ x: 120, y }, { x: 180, y }, { steps: 10, every: 60 });
        expect(await following(letter), "followed the finger").toBe(true);
        await expect(letter).toBeVisible();
        await expect
          .poll(() => letter.evaluate((element) => element.style.transform))
          .toBe("");
        // Back in place before the next finger comes down on its edge.
        await slidIn(letter);
        expect(
          await letter.evaluate((element) => element.getBoundingClientRect().x),
        ).toBe(0);
        await watchFollowing(letter);
        await drag({ x: 10, y }, { x: 160, y }, { steps: 10, every: 20 });
        expect(await following(letter), "left the edge to Safari").toBe(false);
        await expect(letter).toBeVisible();
        await drag({ x: 100, y }, { x: 250, y }, { steps: 10, every: 60 });
        await expect(letter).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(under);
        await time.tap();
        await slidIn(letter);
        await drag({ x: 100, y }, { x: 140, y }, { steps: 4, every: 10 });
        await expect(letter).toHaveCount(0);
        // Nothing beneath took the drag as a tap.
        await expect(page).toHaveURL(/\/timeline\/$/);

        // Its own address, for links and notices.
        await go("/post/?id=p-1");
        await expect(
          page.getByRole("heading", { level: 1, name: "便り" }),
        ).toBeVisible();
        await expect(page.locator("main")).toContainText("十年ぶりに再読");
        await expect(page.locator("main article.is-reply")).toHaveCount(3);
        // ホーム still returns to the Home tab left last.
        await expect(
          page
            .getByRole("navigation", { name: "スマートフォンナビゲーション" })
            .getByRole("link", { name: "ホーム" }),
        ).toHaveAttribute("href", "/timeline/");
        await go("/post/?id=no-such-post");
        await expect(
          page.getByText("この便りは、いまは開けません"),
        ).toBeVisible();
      },
    );

    await check(
      `${label} a link on a 便り's page to the page beneath only closes it`,
      async () => {
        await go("/timeline/");
        await go("/books/solaris/");
        const review = card("凪", "十年ぶりに再読");
        await review.evaluate((element) =>
          element.scrollIntoView({ block: "center" }),
        );
        await page.waitForTimeout(100);
        const under = await tapScrolled(review.locator(".letter-time"));
        expect(under).toBeGreaterThan(0);
        const letter = letterPage("凪");
        await expect(letter).toBeVisible();
        // The book of a review opened on that book's page: the page closes,
        // as 戻る would, with the book's page where it was.
        await letter.locator(".is-main .post-book").tap();
        await expect(letter).toHaveCount(0);
        await expect(page).toHaveURL(/\/books\/solaris\/$/);
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(under);
        // No step was left behind: 戻る leaves the book's page.
        await page.goBack();
        await expect(page).toHaveURL(/\/timeline\/$/);
      },
    );

    await check(
      `${label} a 便り opened from behind the spoiler door shows on its page as the door did`,
      async () => {
        await go("/books/galaxy-railroad/");
        await editTown(
          `data.posts.push({
             id: "me-post-door-reply",
             authorId: "me",
             body: "最後の駅で降りなかった理由が、いまならわかる気がします。",
             bookId: null,
             spoiler: true,
             parentId: "p-9",
             createdAt: "2026-10-08T20:10:00+09:00",
             likes: 0,
             wants: 0,
             readingMode: null,
           });`,
        );
        await go("/books/galaxy-railroad/");
        await page
          .getByRole("button", { name: /ネタバレありのレビュー/ })
          .tap();
        const behind = card("はる", "あの終わり方");
        await expect(behind).toBeVisible();
        await behind.locator(".letter-time").tap();
        const letter = letterPage("はる");
        await expect(letter).toBeVisible();
        await expect(letter.locator(".letter-spoiler")).toHaveCount(0);
        await expect(letter.getByText("あの終わり方")).toBeVisible();
        await expect(letter.getByText("最後の駅で降りなかった")).toBeVisible();
        await letter.getByRole("button", { name: "戻る" }).tap();
        await expect(letter).toHaveCount(0);
        // Opened from the timeline, the same 便り is covered as it is there.
        await page
          .getByRole("navigation", { name: "スマートフォンナビゲーション" })
          .getByRole("link", { name: "ホーム" })
          .tap();
        await expect(page).toHaveURL(/\/timeline\/$/);
        const covered = page
          .locator("main article.letter")
          .filter({
            has: page.getByRole("link", { name: "はる", exact: true }),
          })
          .filter({ has: page.locator(".letter-spoiler") })
          .filter({ hasText: "銀河鉄道の夜" });
        await expect(covered).toHaveCount(1);
        await covered.locator(".letter-time").tap();
        await expect(letter).toBeVisible();
        await expect(letter.locator(".is-main .letter-spoiler")).toHaveCount(1);
        await expect(page.getByText("あの終わり方")).toHaveCount(0);
        await expect(page.getByText("最後の駅で降りなかった")).toHaveCount(0);
        await letter.getByRole("button", { name: "戻る" }).tap();
        await expect(letter).toHaveCount(0);
      },
    );

    await check(
      `${label} in a tag's list, a reply whose 便り is left out opens no page`,
      async () => {
        await go("/timeline/");
        await editTown(
          `data.settings.spoilerDisplay = "leave_out";
           data.posts.push({
             id: "me-post-tag-reply",
             authorId: "me",
             body: "わたしも大人になって読み返しました。 #夜ふかし",
             bookId: null,
             spoiler: false,
             parentId: "p-9",
             createdAt: "2026-10-09T08:00:00+09:00",
             likes: 0,
             wants: 0,
             readingMode: null,
           });`,
        );
        await go("/search/?q=" + encodeURIComponent("#夜ふかし"));
        const mine = card("あなた", "大人になって読み返しました");
        await expect(mine).toBeVisible();
        await expect(mine.locator("a.letter-time")).toHaveCount(0);
        await expect(mine.locator("time.letter-when")).toBeVisible();
        await expect(mine.locator(".letter-reply")).toHaveCount(0);
        await mine.locator(".letter-text").tap();
        await page.waitForTimeout(300);
        await expect(page.locator(".post-page.is-layer")).toHaveCount(0);
        await editTown(`data.settings.spoilerDisplay = "fold_possible";`);
      },
    );

    await check(
      `${label} a 便り deleted at its own address: back where the reader came from, or home`,
      async () => {
        await go("/timeline/");
        await compose("消すための便り。");
        const id = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("book-town-v1")).data.posts.find(
              (post) => post.body === "消すための便り。",
            ).id,
        );
        await editTown(
          `const post = data.posts.find((entry) => entry.id === ${JSON.stringify(id)});
           post.likers = [{ readerId: "r-sumire", taps: 1, at: post.createdAt }];
           post.likes = 1;`,
        );
        const remove = async () => {
          const main = page.locator("main article.letter.is-main");
          await main.getByRole("button", { name: "その他の操作" }).tap();
          const menu = page.getByRole("dialog", { name: "その他の操作" });
          await menu.getByRole("button", { name: "削除する" }).tap();
          await menu.getByRole("button", { name: "削除する" }).tap();
          await expect(menu).toHaveCount(0);
        };
        // From a notice: 戻る's way, back to the notices.
        await go("/notifications/");
        await page
          .getByRole("link", { name: /消すための便り/ })
          .first()
          .tap();
        await expect(page).toHaveURL(/\/post\/\?id=/);
        await expect(
          page.getByRole("heading", { level: 1, name: "便り" }),
        ).toBeVisible();
        await remove();
        await expect(page).toHaveURL(/\/notifications\/$/);
        await expect(page.locator(".toast")).toHaveText("便りを削除しました");
        // Opened at its address: to the town.
        await go("/timeline/");
        await compose("もうひとつ消す便り。");
        const other = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("book-town-v1")).data.posts.find(
              (post) => post.body === "もうひとつ消す便り。",
            ).id,
        );
        await go("/post/?id=" + other);
        await remove();
        await expect(page).not.toHaveURL(/\/post\//);
        await expect(page.locator(".toast")).toHaveText("便りを削除しました");
        await expect(
          page.getByText("この便りは、いまは開けません"),
        ).toHaveCount(0);
      },
    );

    await check(
      `${label} the card's words: 15px on 24px lines, filled to the right edge`,
      async () => {
        await go("/timeline/");
        // Four full lines and one character: a lone last character is what
        // a balancing wrap (text-wrap: pretty) pulls words down to fill,
        // leaving the lines above it short.
        const body = PLAIN_WORDS.repeat(4).slice(
          0,
          (await charactersPerLine()) * 4 + 1,
        );
        await compose(body);
        const mine = card("あなた", "雨の日の午後は");
        const text = mine.locator(".letter-text");
        expect(
          await text.evaluate((element) => {
            const style = getComputedStyle(element);
            return [style.fontSize, style.lineHeight, style.letterSpacing];
          }),
        ).toEqual(["15px", "24px", "0.15px"]);
        const { lines, gaps } = await lineGaps(text);
        expect(lines).toBe(5);
        for (const gap of gaps)
          expect(gap, "a line ends a character early").toBeLessThanOrEqual(15);
      },
    );

    await check(
      `${label} targets are 44px, words 12px or more, and readable`,
      async () => {
        await go("/timeline/");
        const cards = page.locator("main article.letter");
        await expect(cards.first()).toBeVisible();
        await expectTargetsAndType(cards, `${label} cards`);
        const posters = page.locator("main article.poster-card");
        await expect(posters.first()).toBeVisible();
        await expectTargetsAndType(
          posters.locator(".post-head"),
          `${label} poster cards`,
        );
        const sample = card("すみれ", "どこから開いてもいい本");
        await expectReadable(sample.locator(".post-text"), "card text");
        await expectReadable(sample.locator(".letter-meta"), "card meta");
        await expectReadable(
          sample.locator(".letter-tag", { hasText: "見本" }),
          "見本",
        );
        await expectReadable(sample.locator(".post-author"), "name");
        await expectReadable(
          sample.locator(
            ".letter-book-title, .letter-book-author, .letter-feelings span",
          ),
          "book row",
        );
        await expectReadable(sample.locator(".letter-want-pill"), "読みたい");
        await go("/books/invisible-cities/");
        await expectTargetsAndType(
          page.locator("main article.letter"),
          `${label} book page cards`,
        );
        await go("/profiles/r-sumire/");
        await expectTargetsAndType(
          page.locator("main article.letter"),
          `${label} profile cards`,
        );
      },
    );

    await check(
      `${label} a reader-folded post of one's own keeps its note and 「ネタバレの印を付ける」`,
      async () => {
        await go("/timeline/");
        await editTown(
          `const post = data.posts.find((entry) => entry.body.startsWith("雨の日の午後は"));
         post.folded = true;
         post.bookId = "momo";`,
        );
        await go("/profiles/me/");
        // Covered on the writer's screen too, as on everyone's; its book
        // names it.
        const mine = card("あなた", "モモ");
        await expect(
          mine.getByRole("button", {
            name: /ネタバレかもしれません・押すと表示/,
          }),
        ).toBeVisible();
        const note = mine.getByRole("note");
        await expect(note).toContainText(
          "読んだ人から「ネタバレでは？」という声があったので、みんなの画面ではたたんで表示しています。便りは消えていません。",
        );
        await expectReadable(note.locator("p"), "the writer's note");
        const mark = note.getByRole("button", { name: "ネタバレの印を付ける" });
        expect((await mark.boundingBox()).height).toBeGreaterThanOrEqual(44);
        await mark.tap();
        await expect(page.locator(".toast")).toHaveText(
          "ネタバレの印を付けました",
        );
        await expect(mine.getByRole("note")).toHaveCount(0);
      },
    );

    await context.close();
  }

  // Home itself (PR 1b): one browser per check, a reader new to the town
  // unless the check says otherwise.
  await check(
    "390px Home's tabs: roles and keys, a switch in place that keeps each pane, and the tab a reload or a fresh ホーム opens",
    () =>
      withPage({}, async () => {
        await go("/");
        await expect(page).toHaveURL(`${baseURL}/`);
        await expect(tabs().getByRole("tab")).toHaveText([
          "ホーム",
          "便りだけ",
        ]);
        await expect(tab("ホーム")).toHaveAttribute("aria-selected", "true");
        await expect(tab("ホーム")).toHaveAttribute(
          "aria-controls",
          "home-pane-home",
        );
        await expect(tab("便りだけ")).toHaveAttribute("aria-selected", "false");
        await expect(tab("便りだけ")).toHaveAttribute("tabindex", "-1");
        await expect(page.getByRole("tabpanel")).toHaveAttribute(
          "aria-labelledby",
          "home-tab-home",
        );
        // 便りだけ is made on its first visit, then kept.
        await expect(pane("letters")).toHaveCount(0);
        await expect(page).toHaveTitle("BookTown | 本を読みたくなるSNS");
        await pane("home").evaluate((element) => {
          element.dataset.kept = "yes";
        });
        const steps = await page.evaluate(() => history.length);
        await tab("ホーム").focus();
        await page.keyboard.press("ArrowRight");
        await expect(tab("便りだけ")).toBeFocused();
        await expect(tab("便りだけ")).toHaveAttribute("aria-selected", "true");
        await expect(page).toHaveURL(`${baseURL}/timeline/`);
        await expect(page).toHaveTitle("便りだけ | BookTown");
        await expect(page.getByRole("tabpanel")).toHaveAttribute(
          "aria-labelledby",
          "home-tab-letters",
        );
        // The ホーム pane is the same, only hidden.
        await expect(pane("home")).toBeHidden();
        await expect(pane("home")).toHaveAttribute("data-kept", "yes");
        await page.keyboard.press("ArrowLeft");
        await expect(tab("ホーム")).toBeFocused();
        await expect(page).toHaveURL(`${baseURL}/`);
        await expect(pane("home")).toBeVisible();
        await expect(pane("home")).toHaveAttribute("data-kept", "yes");
        await expect(pane("letters")).toBeHidden();
        await tab("便りだけ").tap();
        await expect(page).toHaveURL(`${baseURL}/timeline/`);
        // No switch is a step of 戻る.
        expect(await page.evaluate(() => history.length)).toBe(steps);
        // A reload opens the address's tab; a fresh `/`, the one shown last.
        await page.reload();
        await expect(tab("便りだけ")).toHaveAttribute("aria-selected", "true");
        await go("/");
        await expect(page).toHaveURL(`${baseURL}/timeline/`);
        await expect(tab("便りだけ")).toHaveAttribute("aria-selected", "true");
        await tab("ホーム").tap();
        await expect(page).toHaveURL(`${baseURL}/`);
      }),
  );
  await check(
    "390px a swipe switches the tabs in place, but not one from the carousel, a 特集's rail or the screen's edges",
    () =>
      withPage({}, async () => {
        await goHome();
        const doors = page.getByRole("navigation", { name: "できること" });
        // A start the browser keeps for 戻る (24px from either edge).
        await swipe(doors, -160, 380);
        await swipe(doors, -160, 10);
        // A start on what scrolls sideways belongs to it.
        await swipe(page.locator(".home-carousel-track"), -160);
        await swipe(page.locator(".home-rail").first(), -160);
        await page.waitForTimeout(300);
        await expect(page).toHaveURL(`${baseURL}/`);
        await expect(tab("ホーム")).toHaveAttribute("aria-selected", "true");
        // Anywhere else, left to 便りだけ and right back.
        await swipe(doors, -160);
        await expect(page).toHaveURL(`${baseURL}/timeline/`);
        await expect(tab("便りだけ")).toHaveAttribute("aria-selected", "true");
        await swipe(pane("letters"), 160);
        await expect(page).toHaveURL(`${baseURL}/`);
        await expect(tab("ホーム")).toHaveAttribute("aria-selected", "true");
      }),
  );
  await check(
    "390px swiping either way, the pane coming in slides from its side, even when the screen is held still a moment after the swipe",
    () =>
      withPage({}, async () => {
        await goHome();
        const doors = page.getByRole("navigation", { name: "できること" });
        /** Notes, frame by frame, where the pane `which` is across. */
        const note = (which) =>
          page.evaluate((which) => {
            window.__paneAt = [];
            const start = performance.now();
            const frame = () => {
              const pane = document.querySelector(
                `.home-pane[data-pane="${which}"]`,
              );
              const moved = pane && getComputedStyle(pane).transform;
              if (moved)
                window.__paneAt.push(
                  moved === "none" ? 0 : Math.round(new DOMMatrix(moved).m41),
                );
              if (performance.now() - start < 1500)
                requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
            // The next task holds the screen still for 400ms, as drawing
            // ホーム again can on a phone.
            addEventListener(
              "touchend",
              () =>
                setTimeout(() => {
                  const until = performance.now() + 400;
                  while (performance.now() < until);
                }),
              { once: true, capture: true },
            );
          }, which);
        const places = () => page.evaluate(() => window.__paneAt);
        for (const [which, from, dx, side] of [
          ["letters", doors, -160, 1],
          ["home", pane("letters"), 160, -1],
        ]) {
          await note(which);
          await swipe(from, dx);
          await expect(pane(which)).toBeVisible();
          await page.waitForTimeout(1600);
          const seen = await places();
          // From 40px on its side, through the way, to its place: it slid.
          expect(new Set(seen).size, which).toBeGreaterThanOrEqual(3);
          expect(Math.max(...seen.map((x) => x * side)), which).toBe(40);
          expect(seen.at(-1), which).toBe(0);
        }
      }),
  );
  await check(
    "390px in the demo a pull at the top says nothing new came, nothing waits a minute later, and only a pull from the top reads",
    () =>
      withPage({}, async () => {
        await goHome();
        const letters = () =>
          pane("home")
            .locator(".home-letters > .post-feed > article.letter")
            .evaluateAll((all) => all.map((card) => card.dataset.postId));
        const drawn = await letters();
        expect(drawn.length).toBeGreaterThan(0);
        const words = page.locator(".home-pull");
        // The clock stops a little ahead: Home is still settling.
        await stopClock(2000);
        await pull("start");
        await pull("move", 60);
        await expect(words).toHaveText("引っぱって新しい便りを読む");
        await pull("move", 170);
        await expect(words).toHaveText("離すと読み込みます");
        await expect(words).toHaveAttribute("aria-hidden", "true");
        await expectNoTinyWords(words, "the pull's words");
        await expectReadable(words.locator("span"), "the pull's words");
        await pull("end", 170);
        await expect(words).toHaveText("新しい便りはまだありません");
        await expect(page.locator(".town-said")).toHaveText(
          "新しい便りはまだありません",
        );
        await page.clock.runFor(1000);
        await expect(words).toHaveCount(0);
        // The demo reads nothing after the town: no pill, no dot, nothing
        // moved, and no zero.
        await page.clock.runFor(5 * 60_000);
        await expect(
          page.getByRole("button", { name: "新しい便りを見る" }),
        ).toHaveCount(0);
        await expect(page.locator(".home-tab-dot")).toHaveCount(0);
        await expect(tab("ホーム")).toBeVisible();
        expect(await letters()).toEqual(drawn);
        await expect(page.locator("main")).not.toContainText(ZERO);
        // The tab tapped at the top only goes to the top: nothing to read.
        await tab("ホーム").tap();
        await expect(words).toHaveCount(0);
        // More sideways than down: no pull, and no switch.
        await pull("start");
        await pull("move", 60, 80);
        await expect(words).toHaveCount(0);
        await pull("end", 60, 80);
        // Too short: it shuts again, and reads nothing.
        await pull("start");
        await pull("move", 100);
        await expect(words).toHaveText("引っぱって新しい便りを読む");
        await pull("end", 100);
        await expect(words).toHaveCount(0);
        // A second finger while pulling (a pinch): no pull, and the space
        // shuts at once, not left open when the fingers lift.
        await pull("start");
        await pull("move", 170);
        await expect(words).toHaveText("離すと読み込みます");
        await page.locator(".home-view").evaluate((element) => {
          const box = element.getBoundingClientRect();
          const finger = (identifier, x, y) =>
            new Touch({ identifier, target: element, clientX: x, clientY: y });
          const first = finger(1, box.left + box.width / 2, box.top + 290);
          const second = finger(2, box.left + 60, box.top + 400);
          element.dispatchEvent(
            new TouchEvent("touchstart", {
              bubbles: true,
              touches: [first, second],
              changedTouches: [second],
            }),
          );
        });
        await expect(words).toHaveCount(0);
        await pull("end", 170);
        await expect(words).toHaveCount(0);
        await expect(page).toHaveURL(`${baseURL}/`);
        // Read down the page, a finger drawn down only scrolls.
        await page.evaluate(() => window.scrollTo(0, 300));
        await pull("start");
        await pull("move", 170);
        await expect(words).toHaveCount(0);
        await pull("end", 170);
        await page.evaluate(() => window.scrollTo(0, 0));
        // Under a sheet, the finger is the sheet's.
        await page.locator(".compose-fab").tap();
        const sheet = page.getByRole("dialog", { name: "投稿する" });
        await expect(sheet).toBeVisible();
        await pull("start");
        await pull("move", 170);
        await expect(words).toHaveCount(0);
        await pull("end", 170);
        // While Home shows, the browser's own pull and rubber band are off;
        // on the town's other pages, they are the browser's again.
        const overscroll = () =>
          page.evaluate(
            () =>
              getComputedStyle(document.documentElement).overscrollBehaviorY,
          );
        expect(await overscroll()).toBe("none");
        await page.keyboard.press("Escape");
        await expect(sheet).toHaveCount(0);
        await page
          .getByRole("navigation", { name: "スマートフォンナビゲーション" })
          .getByRole("link", { name: "検索" })
          .tap();
        await expect(page).toHaveURL(`${baseURL}/search/`);
        expect(await overscroll()).toBe("auto");
      }),
  );
  await check(
    "390px 「今日の街」 turns every ten seconds until a finger or 止める stops it, and never under less motion",
    () =>
      withPage({}, async () => {
        await goHome();
        const carousel = page.getByRole("region", { name: "今日の街" });
        await expect(carousel).toHaveAttribute(
          "aria-roledescription",
          "カルーセル",
        );
        // A reader new to the town: the welcome, 今夜の一軒 and 企画展.
        const slides = carousel.getByRole("group");
        await expect(slides).toHaveCount(3);
        await expect(slides.first()).toHaveAttribute("aria-label", "1 / 3");
        await expect(slides.first()).toHaveAttribute(
          "aria-roledescription",
          "スライド",
        );
        await expect(slides.nth(1)).toContainText("今夜の一軒");
        await expect(slides.nth(2)).toContainText("企画展");
        const art = carousel.locator("img.home-slide-art").first();
        await expect(art).toHaveAttribute("fetchpriority", "high");
        await expect(art).toHaveAttribute("srcset", /390w.*780w.*1170w/);
        const stop = carousel.getByRole("button", {
          name: "自動の切り替えを止める",
        });
        const restart = carousel.getByRole("button", {
          name: "自動の切り替えを再開する",
        });
        const button = await stop.boundingBox();
        expect(button.width).toBeGreaterThanOrEqual(44);
        expect(button.height).toBeGreaterThanOrEqual(44);
        const track = carousel.locator(".home-carousel-track");
        await expect(track).toHaveAttribute("aria-live", "off");
        const shown = () =>
          carousel
            .locator(".home-carousel-dots .is-on")
            .evaluate((dot) => [...dot.parentElement.children].indexOf(dot));
        expect(await shown()).toBe(0);
        await page.clock.runFor(10_000 + 1_200);
        await expect.poll(shown).toBe(1);
        // 止める holds the slide, and lets a screen reader hear it.
        await stop.tap();
        await expect(restart).toBeVisible();
        await expect(track).toHaveAttribute("aria-live", "polite");
        await page.clock.runFor(30_000);
        expect(await shown()).toBe(1);
        await restart.tap();
        // Focus inside holds it too, until it leaves.
        await page.evaluate(() => document.activeElement?.blur());
        await page.clock.runFor(10_000 + 1_200);
        await expect.poll(shown).toBe(2);
        // A finger drawn 200px across: the next slide, and it stops for good.
        await goHome();
        await track.scrollIntoViewIfNeeded();
        const box = await track.boundingBox();
        const y = box.y + box.height / 2;
        await drag(
          { x: box.x + box.width - 60, y },
          { x: box.x + box.width - 260, y },
        );
        await expect.poll(shown).toBe(1);
        await expect(restart).toBeVisible();
        await page.clock.runFor(30_000);
        expect(await shown()).toBe(1);
        // Less motion: it never turns by itself, and there is no button.
        await page.emulateMedia({ reducedMotion: "reduce" });
        await goHome();
        await expect(slides).toHaveCount(3);
        await expect(carousel.locator(".home-carousel-pause")).toHaveCount(0);
        await page.clock.runFor(30_000);
        expect(await shown()).toBe(0);
      }),
  );
  await check(
    "390px 読書をはじめる asks for a book, then how; the book being read then sits under the doors, 記録する a full target, no link in a link",
    () =>
      withPage({}, async () => {
        await goHome();
        await expect(page.locator(".home-reading")).toHaveCount(0);
        const doors = page.getByRole("navigation", { name: "できること" });
        // Where in the history Home is (the Navigation API's index, which
        // entries ahead of it leave alone).
        const at = () => page.evaluate(() => navigation.currentEntry.index);
        const home = await at();
        await doors.getByRole("button", { name: "読書をはじめる" }).tap();
        const sheet = page.getByRole("dialog", { name: "読書をはじめる" });
        await sheet.getByRole("button", { name: "本を探す" }).tap();
        await sheet
          .getByRole("searchbox", { name: "読む本を探す" })
          .fill("モモ");
        await sheet.getByRole("button", { name: /^モモ/ }).first().tap();
        await sheet
          .getByRole("button", { name: "ひとりで読む（記録は自分だけ）" })
          .tap();
        await expect(page).toHaveURL(/\/reading\/$/);
        await expect(page.locator(".toast")).toContainText(
          "一人で読み始めました",
        );
        // 戻る comes home, the sheet gone: it left no step of its own.
        await page.goBack();
        await expect(page).toHaveURL(`${baseURL}/`);
        await expect(sheet).toHaveCount(0);
        expect(await at()).toBe(home);
        const line = page.locator(".home-reading");
        await expect(line).toContainText("読書中");
        await expect(line).toContainText("モモ");
        const record = line.getByRole("link", {
          name: "『モモ』の読書を記録する",
        });
        await expect(record).toHaveAttribute("href", "/reading/");
        const target = await record.boundingBox();
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
        const jacket = line.getByRole("link", {
          name: "『モモ』の作品ページへ",
        });
        await expect(jacket).toHaveAttribute("href", "/books/momo/");
        // The jacket's link is a full target too, the jacket as it was.
        const book = await jacket.boundingBox();
        expect(book.width).toBeGreaterThanOrEqual(44);
        expect(book.height).toBeGreaterThanOrEqual(44);
        expect(
          (await jacket.locator(".book-jacket").boundingBox()).width,
        ).toBeCloseTo(34, 0);
        await expect(page.locator(".home-reading a a")).toHaveCount(0);
        const below = (await doors.boundingBox()).y;
        expect((await line.boundingBox()).y).toBeGreaterThan(below);
        // 読みたい本をぜんぶ見る leaves the sheet first, too: 戻る from the
        // list comes home in one step.
        await editTown(`data.wishlist = ["solaris"];`);
        await goHome();
        const before = await at();
        await doors.getByRole("button", { name: "読書をはじめる" }).tap();
        await sheet.getByRole("link", { name: "読みたい本をぜんぶ見る" }).tap();
        await expect(page).toHaveURL(/\/reading-list\/$/);
        await page.goBack();
        await expect(page).toHaveURL(`${baseURL}/`);
        await expect(sheet).toHaveCount(0);
        expect(await at()).toBe(before);
      }),
  );
  await check(
    "390px following nobody, 便りだけ says so, and ホームに戻る switches back in place",
    () =>
      withPage({}, async () => {
        await goHome();
        await tab("便りだけ").tap();
        await expect(pane("letters")).toContainText("まだ便りがありません");
        const home = pane("letters").getByRole("button", {
          name: "ホームに戻る",
        });
        expect((await home.boundingBox()).height).toBeGreaterThanOrEqual(44);
        const steps = await page.evaluate(() => history.length);
        await home.tap();
        await expect(page).toHaveURL(`${baseURL}/`);
        await expect(tab("ホーム")).toHaveAttribute("aria-selected", "true");
        expect(await page.evaluate(() => history.length)).toBe(steps);
      }),
  );
  await check(
    "Before the town is read, Home shows the bones of its 便り, never an empty line or a zero",
    () =>
      withPage({ javaScriptEnabled: false }, async () => {
        for (const route of ["/", "/timeline/"]) {
          await page.goto(baseURL + route);
          const bones = page.locator("main .home-skeletons");
          await expect(bones).toHaveAttribute("aria-busy", "true");
          await expect(bones.locator(".home-skel")).toHaveCount(3);
          await expect(page.locator("main")).not.toContainText(
            "まだ便りがありません",
          );
          await expect(page.locator("main")).not.toContainText(ZERO);
        }
        // The first art is asked for first, whatever the slide will be.
        await page.goto(baseURL + "/");
        // The doors that depend on who the reader is wait as shapes: no
        // 書店を開く that turns into 本を登録, no 掲示板 with no board yet.
        const doors = page.getByRole("navigation", { name: "できること" });
        for (const name of ["書店を開く", "本を登録", "掲示板"])
          await expect(
            doors.getByText(name).filter({ visible: true }),
          ).toHaveCount(0);
        await expect(doors.locator(".home-entrance:visible")).toHaveCount(4);
        await expect(
          doors.locator(".home-entrance.is-waiting:visible"),
        ).toHaveCount(2);
        await expect(
          doors.getByRole("button", { name: "読書をはじめる" }),
        ).toBeVisible();
        await expect(
          page.locator(".home-carousel.is-loading img.home-slide-art"),
        ).toHaveAttribute("fetchpriority", "high");
      }),
  );
  for (const width of [390, 320])
    await check(
      `${width}px the alley grows as it is walked, a 特集 after every two shops, never wider than the screen`,
      () =>
        withPage({ viewport: { width, height: 844 } }, async () => {
          await goHome();
          for (const rounds of [2, 3, 4]) {
            await page.evaluate(() =>
              window.scrollTo(0, document.body.scrollHeight),
            );
            await expect(page).toHaveURL(new RegExp(`/\\?rounds=${rounds}$`));
            await noOverflow(`${width}px alley, ${rounds} rounds`);
            // A phone widens the page to what is too wide for it.
            expect(await page.evaluate(() => innerWidth)).toBe(width);
          }
          const alley = page.locator(".home-alley");
          const parts = await alley.evaluate((element) =>
            [...element.children].flatMap((child) =>
              child.matches(".street-shop")
                ? ["shop"]
                : child.matches(".home-feature")
                  ? [child.querySelector("h2").textContent]
                  : [],
            ),
          );
          expect(parts.filter((part) => part === "shop")).toHaveLength(24);
          let run = 0;
          const bands = [];
          for (const part of parts)
            if (part === "shop") run += 1;
            else {
              expect(run, "shops before a 特集").toBe(2);
              run = 0;
              bands.push(part);
            }
          expect(bands).toHaveLength(12);
          // 企画展 and 棚をのぞく by turns; once the posters not yet on
          // the page run out, 棚をのぞく.
          const out = bands.findIndex(
            (band, index) => index % 2 === 0 && band !== "企画展",
          );
          bands.forEach((band, index) =>
            expect(band, `特集 ${index + 1}`).toBe(
              index % 2 === 0 && (out === -1 || index < out)
                ? "企画展"
                : "棚をのぞく",
            ),
          );
        }),
    );
  await check(
    "390px Home shows no zeros: for a reader new to the town, a usual one, and on a quiet day",
    () =>
      withPage({}, async () => {
        const look = async (state) => {
          await goHome();
          await expect(page.locator("main"), state).not.toContainText(ZERO);
          await go("/timeline/");
          await expect(page.locator(".home-skeletons")).toHaveCount(0);
          await expect(page.locator("main"), state).not.toContainText(ZERO);
        };
        await look("new to the town");
        await editTown(`data.following = ${JSON.stringify(DEMO_SHOPS)};`);
        await goHome();
        await compose("今日の一行。");
        await look("usual");
        // Seven weeks on, nothing new from those followed: a quiet day.
        await page.clock.setSystemTime(Date.parse("2026-12-01T12:00:00+09:00"));
        await look("quiet");
      }),
  );
  await check(
    "390px the tabs, the 特集's kicker and the board's heading are readable",
    () =>
      withPage({}, async () => {
        await goHome();
        await expectReadable(tabs().getByRole("tab"), "the tabs");
        await expectReadable(tabs().locator("span"), "the tabs' words");
        await expectReadable(page.locator(".feature-kicker"), "特集");
        await expectReadable(page.locator(".home-board-head"), "掲示板");
        await expectReadable(
          page.locator(".home-board-head span"),
          "掲示板's line",
        );
      }),
  );
  await check(
    "390px following a shop in the alley moves nothing on the page; its 便り come when the tab is tapped",
    () =>
      withPage({}, async () => {
        await goHome();
        // The browser's own scroll anchoring would hide a card moving.
        await page.addStyleTag({
          content: "* { overflow-anchor: none !important; }",
        });
        const orbit = page
          .locator(".street-shop")
          .filter({
            has: page.getByRole("link", {
              name: "軌道書房に入る",
              exact: true,
            }),
          })
          .first();
        await orbit.evaluate((element) =>
          element.scrollIntoView({ block: "center" }),
        );
        await fontsSettled();
        const tops = () =>
          pane("home").evaluate((element) =>
            [
              ...element.querySelectorAll(
                "article.letter, .home-feature, .home-board, .street-shop",
              ),
            ].map((part) => part.getBoundingClientRect().top),
          );
        const before = await tops();
        expect(before.length).toBeGreaterThan(10);
        // No 便り of 凪's (軌道書房) yet above 「街の便り」: the first card is
        // the town's (凪's may lead it, now Live holds the memos).
        const first = pane("home").locator("article.letter").first();
        const townFirst = () =>
          pane("home").evaluate((element) => {
            const head = element.querySelector(".home-town-head");
            const card = element.querySelector("article.letter");
            return Boolean(
              head &&
              card &&
              head.compareDocumentPosition(card) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            );
          });
        expect(await townFirst()).toBe(true);
        await orbit
          .getByRole("button", { name: "軌道書房をフォロー", exact: true })
          .tap();
        await expect(
          orbit.getByRole("button", { name: "軌道書房のフォローを解除" }),
        ).toBeVisible();
        expect(await tops()).toEqual(before);
        await expect(page.locator(".home-older")).toHaveCount(0);
        // A tap on the tab: the top, and what came since.
        await tab("ホーム").tap();
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
        await expect(
          first.getByRole("link", { name: "凪", exact: true }),
        ).toBeVisible();
        expect(await townFirst()).toBe(false);
        await expect(page.locator(".home-older")).toBeVisible();
        await expect(pane("home")).toContainText(
          "フォロー中の便りは、ここまでです。",
        );
      }),
  );

  for (const width of [390, 320])
    await check(
      `${width}px 読みながらのひとこと: three lines of 104px with their covers, opened to all and closed, each memo once and none on 便りだけ, a tap or Enter on the time opens its 便り (a new-tab click is the browser's), and a spoiler or a book being read waits behind a tap that fits its line and keeps the focus`,
      () =>
        withPage({ viewport: { width, height: 844 } }, async () => {
          // Two days after the demo's four memos.
          await page.clock.setSystemTime(
            Date.parse("2026-10-12T12:00:00+09:00"),
          );
          await goHome();
          const live = pane("home").locator(".home-live");
          await expect(
            live.getByRole("heading", { name: "読みながらのひとこと" }),
          ).toBeVisible();
          const box = live.locator(".home-live-box");
          await expect(box).toHaveAttribute("aria-live", "off");
          const rows = box.locator(".home-live-line");
          const MEMOS = ["p-m4", "p-m2", "p-m1", "p-m3"];
          await expect(rows).toHaveCount(4);
          expect(
            await rows.evaluateAll((all) =>
              all.map((row) => row.dataset.postId),
            ),
          ).toEqual(MEMOS);
          const boxHeight = () =>
            box.evaluate((element) => element.getBoundingClientRect().height);
          expect(await boxHeight()).toBe(312);
          for (const index of [0, 1, 2]) {
            const row = rows.nth(index);
            expect((await row.boundingBox()).height).toBe(104);
            // The cover whole at 44px; who, 『the book』 and when on one
            // line; the words in two lines at most.
            expect(
              (await row.locator(".home-live-jacket").boundingBox()).width,
            ).toBe(44);
            await expect(row.locator(".book-jacket")).toBeVisible();
            expect(
              (await row.locator(".home-live-meta").boundingBox()).height,
            ).toBe(22);
            expect(
              await row
                .locator(".home-live-text")
                .evaluate((text) =>
                  Math.round(
                    text.getBoundingClientRect().height /
                      parseFloat(getComputedStyle(text).lineHeight),
                  ),
                ),
            ).toBeLessThanOrEqual(2);
          }
          // The fourth waits under the box, out of reach.
          await expect(rows.nth(3)).toHaveAttribute("inert", "");
          // Nothing comes to the demo: no 止める.
          await expect(
            live.getByRole("button", { name: /ひとことを(止める|動かす)/ }),
          ).toHaveCount(0);
          const more = live.getByRole("button", { name: "前のひとことも見る" });
          expect((await more.boundingBox()).height).toBeGreaterThanOrEqual(44);
          await more.tap();
          const fold = live.getByRole("button", { name: "たたむ" });
          await expect(fold).toHaveAttribute("aria-expanded", "true");
          await expect.poll(boxHeight).toBe(416);
          await expect(rows.nth(3)).not.toHaveAttribute("inert", "");
          await fold.tap();
          await expect.poll(boxHeight).toBe(312);
          await noOverflow(`${width}px ひとこと`);
          // Each memo once: none among ホーム's 便り.
          for (const id of MEMOS)
            await expect(
              pane("home").locator(`article.letter[data-post-id="${id}"]`),
            ).toHaveCount(0);
          // The time is the keyboard's way in; a tap on a line opens its 便り.
          await expect(
            rows.first().locator("a.home-live-time"),
          ).toHaveAttribute("href", "/post/?id=p-m4");
          await rows.first().locator(".home-live-text").tap();
          await expect(letterPage("すみれ")).toBeVisible();
          await page.goBack();
          await expect(letterPage("すみれ")).toHaveCount(0);
          // By the keyboard: Enter on the time, and 戻る gives the focus back.
          const time = rows.first().locator("a.home-live-time");
          await time.focus();
          await page.keyboard.press("Enter");
          await expect(letterPage("すみれ")).toBeVisible();
          await page.goBack();
          await expect(letterPage("すみれ")).toHaveCount(0);
          await expect(time).toBeFocused();
          // A click meant for a new tab or window is left to the browser.
          expect(
            await time.evaluate((link) => {
              let prevented = null;
              addEventListener(
                "click",
                (event) => {
                  prevented = event.defaultPrevented;
                  event.preventDefault();
                },
                { once: true },
              );
              link.dispatchEvent(
                new MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                  button: 0,
                  ctrlKey: true,
                }),
              );
              return prevented;
            }),
          ).toBe(false);
          await expect(letterPage("すみれ")).toHaveCount(0);
          // 便りだけ has no ひとこと band.
          await tab("便りだけ").tap();
          await expect(pane("letters").locator(".home-live")).toHaveCount(0);

          // Reading ソラリス (on the reader's shelves, not finished), and
          // すみれ's memo asked about as a spoiler: those lines wait behind
          // a tap, the words not on the page until then.
          await editTown(`
            data.readingSessions = [{ id: "me-reading-1", bookId: "solaris",
              mode: "together", startedAt: "2026-10-12T10:00:00+09:00",
              endedAt: null }];
            data.spoilerReports = ["p-m4"];
          `);
          await goHome();
          const guards = live.getByRole("button", {
            name: /あなたのライブラリの、読み終えていない本のひとことです。/,
          });
          await expect(guards).toHaveCount(2);
          await expect(live).not.toContainText("海の描写のところで");
          // Each stand-in fits its line, with room under it.
          for (const index of [1, 2])
            expect(
              await rows.nth(index).evaluate((row) => {
                const guard = row.querySelector(".home-live-guard");
                return (
                  row.getBoundingClientRect().bottom -
                  guard.getBoundingClientRect().bottom
                );
              }),
            ).toBeGreaterThanOrEqual(4);
          expect(
            (await guards.first().boundingBox()).height,
          ).toBeGreaterThanOrEqual(44);
          await guards.first().tap();
          const opened = rows.nth(1).locator(".home-live-text");
          await expect(opened).toContainText("凪さんと同じ本を");
          await expect(opened).toBeFocused();
          await expect(guards).toHaveCount(1);
          const spoiler = rows.first().getByRole("button", {
            name: /ネタバレの可能性を報告済み・押すと表示/,
          });
          await expect(live).not.toContainText("もう三つ目");
          await spoiler.tap();
          await expect(rows.first().locator(".home-live-text")).toContainText(
            "もう三つ目",
          );
          await expect(rows.first().locator(".home-live-text")).toBeFocused();
          await expectNoTinyWords(live, `${width}px ひとこと`);
          await expectTargetsAndType(live, `${width}px ひとこと`);
          // A line both on the shelves and a spoiler: 表示する gives the
          // focus to its spoiler box.
          await editTown(`data.spoilerReports = ["p-m4", "p-m2"];`);
          await goHome();
          await guards.first().tap();
          await expect(
            rows.nth(1).getByRole("button", {
              name: /ネタバレの可能性を報告済み・押すと表示/,
            }),
          ).toBeFocused();
        }),
    );
  await check(
    "390px no ひとこと band below three memos in seven days, and no frame for it",
    () =>
      withPage({}, async () => {
        // Eight days after the demo's memos: none is a line.
        await page.clock.setSystemTime(Date.parse("2026-10-18T22:00:00+09:00"));
        await goHome();
        await expect(pane("home").locator(".home-live")).toHaveCount(0);
        // Their 便り stay among the town's, as before.
        await expect(
          pane("home").locator('article.letter[data-post-id="p-m4"]'),
        ).toHaveCount(1);
      }),
  );

  await check(
    "390px 感想が面白い本: 見本 on each tile, a tap opens its 便り, no spoiler in the page, and a tile asked about as a spoiler leaves the band",
    () =>
      withPage({}, async () => {
        // A day when the reader's own six 便り of the morning fill the
        // 便り, so no other's is among them: the band has every writer's
        // newest review of the fortnight, one each.
        await page.clock.setSystemTime(Date.parse("2026-10-13T12:00:00+09:00"));
        await go("/");
        await editTown(
          `data.following = ["shop-lamplight"];
           data.spoilerReports = ["p-3"];
           data.posts = Array.from({ length: 6 }, (_, at) => ({
             id: "me-post-" + (at + 1),
             authorId: "me",
             body: "今朝の一行、その" + (at + 1) + "。",
             bookId: null,
             spoiler: false,
             parentId: null,
             createdAt: new Date(
               Date.parse("2026-10-13T11:00:00+09:00") - at * 600_000,
             ).toISOString(),
             likes: 0,
             wants: 0,
             readingMode: null,
           }));`,
        );
        await goHome();
        const band = pane("home").getByRole("region", {
          name: "感想が面白い本",
        });
        const tiles = band.locator("a.home-review");
        const links = () =>
          tiles.evaluateAll((all) =>
            all.map((tile) => tile.getAttribute("href")),
          );
        await expect(tiles).toHaveCount(4);
        // 凪, 灯, 栞 and すみれ; not はる's, asked about as a spoiler.
        expect(await links()).toEqual([
          "/post/?id=p-1",
          "/post/?id=p-4",
          "/post/?id=p-6",
          "/post/?id=p-8",
        ]);
        for (const tile of await tiles.all())
          await expect(tile.locator(".home-tag")).toHaveText("見本");
        // Not in the page at all: a spoiler (marked, or asked about).
        const html = await page.content();
        for (const words of [
          "最後の数章を読んだ夜は眠れなかった",
          "あの終わり方でなければいけなかった",
          "遠くへ行かなくても旅はできる",
        ])
          expect(html, words).not.toContain(words);
        // A tap opens the 便り's page. Asked about as a spoiler there, it
        // has left the band when 戻る comes home.
        await tiles.first().tap();
        const letter = letterPage("凪");
        await expect(letter).toBeVisible();
        await slidIn(letter);
        await expect(letter.locator(".letter.is-main")).toContainText(
          "十年ぶりに再読",
        );
        await letter
          .locator(".letter.is-main")
          .getByRole("button", { name: "その他の操作" })
          .tap();
        const menu = page.getByRole("dialog", { name: "その他の操作" });
        await menu.getByRole("button", { name: "ネタバレでは？" }).tap();
        await expect(menu).toHaveCount(0);
        await letter.getByRole("button", { name: "戻る" }).tap();
        await expect(letter).toHaveCount(0);
        await expect(page).toHaveURL(`${baseURL}/`);
        await expect(tiles).toHaveCount(3);
        expect(await links()).toEqual([
          "/post/?id=p-4",
          "/post/?id=p-6",
          "/post/?id=p-8",
        ]);
        expect(await page.content()).not.toContain("十年ぶりに再読");
      }),
  );
  await check(
    "390px the bars stay as they were when a 便り's page or a book in hand closes over a page read down, and go again on the way down",
    () =>
      withPage({}, async () => {
        await goHome();
        await fontsSettled();
        const shell = page.locator(".town-shell");
        const scrolled = () => page.evaluate(() => Math.round(scrollY));
        // Time for a scroll to be read (the page's own frames).
        const settle = () => page.waitForTimeout(400);
        /** Scrolls `target` to the middle of the screen, then a little up. */
        const readDownTo = async (target) => {
          await target.evaluate((element) =>
            element.scrollIntoView({ block: "center" }),
          );
          await settle();
          await expect(shell).toHaveAttribute("data-bar", "hidden");
          const at = (await scrolled()) - 60;
          await page.evaluate((y) => window.scrollTo(0, y), at);
          await settle();
          await expect(shell).not.toHaveAttribute("data-bar");
          return at;
        };
        /** Closed, the page is back where it was, its bars as they were. */
        const backAt = async (at) => {
          await expect.poll(scrolled).toBe(at);
          await settle();
          await expect(shell).not.toHaveAttribute("data-bar");
        };
        // A 便り's page, and 戻る.
        const card = pane("home").locator("article.letter").nth(3);
        let at = await readDownTo(card);
        await card.locator(".letter-time").tap();
        const layer = page.getByRole("dialog", { name: /さんの便り/ });
        await expect(layer).toBeVisible();
        await slidIn(layer);
        await layer.getByRole("button", { name: "戻る" }).tap();
        await expect(layer).toHaveCount(0);
        await backAt(at);
        // A book in hand from the alley, put back.
        const book = pane("home")
          .locator(".home-alley .street-shop .shelf-book-button")
          .first();
        at = await readDownTo(book);
        await book.tap();
        const dialog = page.locator(".bh-dialog");
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "本を閉じて棚に戻る" }).tap();
        await expect(dialog).toHaveCount(0);
        await backAt(at);
        // Read down from there, the bars go as ever.
        await page.evaluate((y) => window.scrollTo(0, y), at + 200);
        await expect(shell).toHaveAttribute("data-bar", "hidden");
      }),
  );
  await check(
    "On a desktop, 「今日の街」 holds while the focus is inside though the mouse leaves, and while the mouse is over it though the focus leaves",
    () =>
      withPage(
        {
          viewport: { width: 1280, height: 900 },
          isMobile: false,
          hasTouch: false,
        },
        async () => {
          await goHome();
          // The page's clock runs while the browser is driven; on a slow
          // runner the ten seconds can pass before the first look. Stop it
          // so the slide turns only when the test says.
          await stopClock();
          const carousel = page.getByRole("region", { name: "今日の街" });
          const stop = carousel.getByRole("button", {
            name: "自動の切り替えを止める",
          });
          const shown = () =>
            carousel
              .locator(".home-carousel-dots .is-on")
              .evaluate((dot) => [...dot.parentElement.children].indexOf(dot));
          const box = await carousel.boundingBox();
          const over = () =>
            page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          const away = () => page.mouse.move(box.x - 20, box.y + 20);
          expect(box.x).toBeGreaterThan(40);
          expect(await shown()).toBe(0);
          // The focus inside, the mouse over it and away: it holds.
          await stop.focus();
          await over();
          await away();
          await page.clock.runFor(15_000);
          expect(await shown()).toBe(0);
          // The focus gone too: it turns.
          await page.evaluate(() => document.activeElement?.blur());
          await page.clock.runFor(10_000 + 1_200);
          await expect.poll(shown).toBe(1);
          // The mouse over it, the focus in and gone: it holds.
          await over();
          await stop.focus();
          await page.evaluate(() => document.activeElement?.blur());
          await page.clock.runFor(15_000);
          expect(await shown()).toBe(1);
          // The mouse away too: it turns.
          await away();
          await page.clock.runFor(10_000 + 1_200);
          await expect.poll(shown).toBe(2);
        },
      ),
  );
  for (const width of [390, 320])
    await check(
      `${width}px every control on the alley's fronts and at its end takes a finger, and no words on Home are under 12px`,
      () =>
        withPage({ viewport: { width, height: 844 } }, async () => {
          await goHome();
          await expectNoTinyWords(pane("home"), `${width}px ホーム`);
          await expectFingerTargets(
            ".home-alley > .street-shop:not(.street-round ~ *)",
            `${width}px the alley's first fronts`,
          );
          await expectFingerTargets(
            ".home-alley > .street-end",
            `${width}px the alley's end`,
          );
          // Following nobody, 便りだけ's shops to follow. Read down to the
          // alley's end, the bars have slid away (or are sliding back as the
          // alley grows); a reader goes back up to the tabs first.
          await page.evaluate(() => scrollTo(0, 0));
          await expect(tab("便りだけ")).toBeInViewport({ ratio: 1 });
          await tab("便りだけ").tap();
          await expect(
            pane("letters").locator(".follow-suggestions"),
          ).toBeVisible();
          await expectNoTinyWords(pane("letters"), `${width}px 便りだけ`);
        }),
    );

  await check(
    "On a desktop, the 便り's page keeps its column of the page at its address",
    async () => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      page = settleBeforeNavigating(await context.newPage());
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await followEveryShop();
      const column = () =>
        page.locator(".post-page .letter.is-main").evaluate((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, width: box.width };
        });
      await go("/post/?id=p-1");
      const route = await column();
      await go("/timeline/");
      await card("凪", "十年ぶりに再読").locator(".letter-time").click();
      await expect(letterPage("凪")).toBeVisible();
      await slidIn(letterPage("凪"));
      const layer = await column();
      expect(
        Math.abs(layer.width - route.width),
        "the same width",
      ).toBeLessThanOrEqual(1);
      expect(layer.width).toBeLessThanOrEqual(640);
      expect(
        Math.abs(layer.left + layer.width / 2 - 640),
        "in the middle of the screen",
      ).toBeLessThanOrEqual(1);
      for (const part of [".post-page-back", ".post-page-reply"]) {
        const box = await letterPage("凪")
          .locator(part)
          .evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
          });
        expect(box.left, `${part} within the column`).toBeGreaterThanOrEqual(
          layer.left - 1,
        );
        expect(box.right, `${part} within the column`).toBeLessThanOrEqual(
          layer.left + layer.width + 1,
        );
      }
      await context.close();
    },
  );

  await check(
    "設定's 画面の色: six palettes by name, kept, and on <html> before the first paint",
    () =>
      withPage({}, async () => {
        // When <body> first appears, nothing is drawn yet: the palette must
        // already be on <html> then (appearance.ts's head script).
        await page.addInitScript(() => {
          new MutationObserver((_, observer) => {
            if (!document.body) return;
            window.__paletteAtBody =
              document.documentElement.dataset.palette ?? "none";
            observer.disconnect();
          }).observe(document, { childList: true, subtree: true });
        });
        await go("/profiles/me/");
        expect(await page.evaluate(() => window.__paletteAtBody)).toBe("none");
        await page
          .locator(".profile-minor-actions")
          .getByRole("button", { name: "設定" })
          .tap();
        const colours = page
          .getByRole("dialog", { name: "設定" })
          .getByRole("group", { name: "画面の色" });
        await expect(colours.getByRole("radio")).toHaveCount(6);
        for (const name of ["深緑", "煉瓦", "藍", "藤", "山吹", "墨"])
          await expect(
            colours.getByRole("radio", { name, exact: true }),
          ).toBeVisible();
        await expect(
          colours.getByRole("radio", { name: "深緑", exact: true }),
        ).toBeChecked();
        // Each choice is a whole row for the finger, 44px or more.
        for (const height of await colours
          .locator("label")
          .evaluateAll((labels) =>
            labels.map((label) => label.getBoundingClientRect().height),
          ))
          expect(height).toBeGreaterThanOrEqual(44);
        await colours.getByText("藍", { exact: true }).tap();
        await expect(
          colours.getByRole("radio", { name: "藍", exact: true }),
        ).toBeChecked();
        await expect(page.locator("html")).toHaveAttribute(
          "data-palette",
          "ai",
        );
        await expectReadable(colours.locator("label"), "palette choices, 藍");
        await page.keyboard.press("Escape");

        await page.reload();
        await expect(page.locator("main")).toBeVisible();
        expect(await page.evaluate(() => window.__paletteAtBody)).toBe("ai");
        expect(
          await page.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue("--green")
              .trim(),
          ),
        ).toBe("#2c4a78");
        await goHome();
        await expect(page.locator("html")).toHaveAttribute(
          "data-palette",
          "ai",
        );
        await expectReadable(tabs().getByRole("tab"), "the tabs, 藍");
        await expectReadable(
          page.locator(".town-bottom-nav a.active"),
          "the bottom bar's tab, 藍",
        );
        await page.screenshot({
          path: path.join(output, "palette-ai-home.png"),
        });

        // Back to 深緑: the mark goes, and stays gone after a reload.
        await go("/profiles/me/");
        await page
          .locator(".profile-minor-actions")
          .getByRole("button", { name: "設定" })
          .tap();
        await colours.getByText("深緑", { exact: true }).tap();
        await expect(page.locator("html")).not.toHaveAttribute(
          "data-palette",
          /./,
        );
        await page.keyboard.press("Escape");
        await page.reload();
        await expect(page.locator("main")).toBeVisible();
        expect(await page.evaluate(() => window.__paletteAtBody)).toBe("none");
      }),
  );

  await check(
    "Moving along the bottom bar slides the round mark from the tab shown to the tab tapped",
    () =>
      withPage({}, async () => {
        const bar = page.locator(".town-bottom-nav");
        /** Where the moving mark starts and ends, beside the icons' centres. */
        const marks = () =>
          page.evaluate(() => {
            const bar = document.querySelector(".town-bottom-nav");
            const box = bar.getBoundingClientRect();
            const centre = (svg) => {
              const r = svg.getBoundingClientRect();
              return Math.round(r.left + r.width / 2 - box.left);
            };
            const icons = [...bar.querySelectorAll(":scope > a svg")].map(
              centre,
            );
            const mark = bar.querySelector(".nav-mark");
            if (!mark) return { icons, moving: false };
            const animation = mark.getAnimations()[0];
            const [from] = animation.effect.getKeyframes();
            const dx = Number(
              /translate\((-?[\d.]+)px/.exec(
                from.transform.replace("translate(-50%, -50%) ", ""),
              )[1],
            );
            const end = parseFloat(mark.style.left);
            return {
              icons,
              moving: bar.classList.contains("is-moving"),
              from: Math.round(end + dx),
              to: Math.round(end),
            };
          });
        await go("/profiles/me/");
        await bar.getByRole("link", { name: "記録" }).tap();
        await expect(page).toHaveURL(/\/reading\//);
        const move = await marks();
        // From わたし (6th) to 記録 (5th): the mark slides left.
        expect(move).toMatchObject({
          moving: true,
          from: move.icons[5],
          to: move.icons[4],
        });
        // The chosen tab's mark is round.
        expect(
          await bar
            .locator('a[aria-current="page"] svg')
            .evaluate((svg) => getComputedStyle(svg).borderRadius),
        ).toBe("50%");
        // It arrives and the moving mark goes.
        await expect(page.locator(".nav-mark")).toHaveCount(0);
        await expect(bar).not.toHaveClass(/is-moving/);
        // ホーム to ライブラリ: one slide.
        await bar.getByRole("link", { name: "ホーム" }).tap();
        await expect(page.locator(".nav-mark")).toHaveCount(0);
        await bar.getByRole("link", { name: "ライブラリ" }).tap();
        await expect(page).toHaveURL(/\/library\//);
        const shelf = await marks();
        expect(shelf).toMatchObject({
          from: shelf.icons[0],
          to: shelf.icons[3],
        });
        expect(await page.locator(".nav-mark").count()).toBe(1);
        // The same tab again does not move it.
        await expect(page.locator(".nav-mark")).toHaveCount(0);
        await bar.getByRole("link", { name: "ライブラリ" }).tap();
        expect(await page.locator(".nav-mark").count()).toBe(0);
        // The page itself does not move as it opens: no slide, no rise.
        await bar.getByRole("link", { name: "検索" }).tap();
        await expect(page).toHaveURL(/\/search\//);
        expect(
          await page.evaluate(
            () => document.querySelector("main").getAnimations().length,
          ),
        ).toBe(0);
      }),
  );
  await check(
    "On a short phone, 投稿 steps aside while Home's doors lie under it, and is back once they move up; on a tall one it stays",
    async () => {
      for (const [width, height] of [
        [320, 568],
        [390, 568],
        [390, 844],
      ])
        await withPage({ viewport: { width, height } }, async () => {
          await go("/");
          const fab = page.locator(".compose-fab");
          const doors = page.locator(".home-entrances");
          await expect(doors.locator("button, a")).toHaveCount(4);
          const under = async () => {
            const [a, b] = await Promise.all([
              doors.boundingBox(),
              fab.boundingBox(),
            ]);
            return a.y + a.height > b.y - 8 && a.y < b.y + b.height;
          };
          if (!(await under())) {
            await expect(fab, `${width}x${height}`).toBeVisible();
            return;
          }
          await expect(fab, `${width}x${height}`).toBeHidden();
          // The door it stood on takes the finger.
          await doors.getByText("書店を開く").tap({ trial: true });
          // The page's clock is held: the frames after each scroll are let
          // run while waiting.
          const settled = async () => {
            await page.clock.runFor(50);
            return page.evaluate(() =>
              document.documentElement.hasAttribute("data-fab-aside"),
            );
          };
          await page.evaluate(() => scrollTo(0, 200));
          await expect.poll(settled).toBe(false);
          expect(await under()).toBe(false);
          await expect(fab).toBeVisible();
          await page.evaluate(() => scrollTo(0, 0));
          await expect.poll(settled).toBe(true);
          await expect(fab).toBeHidden();
        });
    },
  );

  await check(
    "A first-timer's Home has はじめの3つ, each one tap away: 本を登録 opens the scanner, 本棚をつくる the library's form, 書店を開く the door",
    () =>
      withPage({ viewport: { width: 320, height: 640 } }, async () => {
        await goHome();
        const steps = page.getByRole("region", { name: "はじめの3つ" });
        await expect(steps.getByRole("listitem")).toHaveCount(3);
        await expect(steps).not.toContainText(/0/);
        // Nothing in it is wider than the phone.
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await steps.getByRole("button", { name: /本を登録/ }).tap();
        const scanner = page.getByRole("dialog", { name: /スキャン|登録/ });
        await expect(scanner).toBeVisible();
        await scanner.getByRole("button", { name: "閉じる" }).tap();
        await expect(scanner).toHaveCount(0);
        await steps.getByRole("link", { name: /本棚をつくる/ }).tap();
        await expect(page).toHaveURL(`${baseURL}/library/`);
        await expect(
          page.getByRole("dialog", { name: "本棚をつくる" }),
        ).toBeVisible();
        await page.goBack();
        await goHome();
        await expect(
          page
            .getByRole("region", { name: "はじめの3つ" })
            .getByRole("link", { name: /書店を開く/ }),
        ).toHaveAttribute("href", "/my-shop/");
      }),
  );

  await check(
    "Into and out of 書店めぐり, whose page holds the screen still while drawn, the round mark still slides rather than jumps",
    () =>
      withPage({}, async () => {
        const bar = page.locator(".town-bottom-nav");
        /** Starts noting, frame by frame, where the moving mark is. */
        const note = () =>
          page.evaluate(() => {
            window.__markAt = [];
            const start = performance.now();
            const frame = () => {
              const mark = document.querySelector(".nav-mark");
              if (mark)
                window.__markAt.push(
                  Math.round(mark.getBoundingClientRect().left),
                );
              if (performance.now() - start < 2500)
                requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          });
        const places = () => page.evaluate(() => new Set(window.__markAt).size);
        await go("/profiles/me/");
        for (const [name, address] of [
          ["書店めぐり", /\/walk\//],
          ["わたし", /\/profiles\/me\//],
        ]) {
          await note();
          await bar.getByRole("link", { name }).tap();
          await expect(page).toHaveURL(address);
          await expect(page.locator(".nav-mark")).toHaveCount(0);
          // Seen at its start, on its way and near its end: it slid.
          expect(await places()).toBeGreaterThanOrEqual(3);
        }
      }),
  );
  await check(
    "With less motion asked for, the bottom bar's mark does not slide",
    () =>
      withPage({ reducedMotion: "reduce" }, async () => {
        await go("/search/");
        await page
          .locator(".town-bottom-nav")
          .getByRole("link", { name: "記録" })
          .tap();
        await expect(page).toHaveURL(/\/reading\//);
        expect(
          await page.evaluate(
            () =>
              document
                .getAnimations()
                .filter((a) => !(a instanceof CSSAnimation)).length,
          ),
        ).toBe(0);
      }),
  );

  await check(
    "The night: 端末に合わせる follows a dark device before the first paint, and every word on the main screens is readable",
    () =>
      withPage({ colorScheme: "dark" }, async () => {
        await page.addInitScript(() => {
          new MutationObserver((_, observer) => {
            if (!document.body) return;
            window.__themeAtBody =
              document.documentElement.dataset.theme ?? "none";
            observer.disconnect();
          }).observe(document, { childList: true, subtree: true });
        });
        /** Words under 4.5:1 on what is behind them, outside the pictures
            (wood, spines, covers, posters, the walk's scenery, avatars),
            which keep their day colours at night. */
        const unreadable = () =>
          page.evaluate(() => {
            const rgb = (value) => {
              const parts = (value.match(/[\d.]+/g) ?? []).map(Number);
              return value.startsWith("color(")
                ? [
                    parts[0] * 255,
                    parts[1] * 255,
                    parts[2] * 255,
                    parts[3] ?? 1,
                  ]
                : [parts[0], parts[1], parts[2], parts[3] ?? 1];
            };
            const lum = ([r, g, b]) => {
              const c = [r, g, b].map((v) => {
                const x = v / 255;
                return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
              });
              return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
            };
            const pictures =
              ".reader-avatar, .book-spine, .book-jacket, .shelf-scroll, .street-shelf, .poster-sheet, .poster-swatch, .walk-view, .store-canvas, .scan-camera, .profile-shop-sign, img, svg";
            const found = [];
            for (const element of document.querySelectorAll("main *, nav *")) {
              const own = [...element.childNodes].some(
                (node) => node.nodeType === 3 && node.textContent.trim(),
              );
              if (!own || element.closest(pictures)) continue;
              const style = getComputedStyle(element);
              const box = element.getBoundingClientRect();
              if (!box.width || style.visibility === "hidden") continue;
              if (Number(style.opacity) <= 0.5) continue;
              let back = element;
              let bg = "rgba(0, 0, 0, 0)";
              let image = false;
              while (back && rgb(bg)[3] === 0) {
                const backStyle = getComputedStyle(back);
                bg = backStyle.backgroundColor;
                if (backStyle.backgroundImage.includes("url(")) image = true;
                back = back.parentElement;
              }
              // Words on a photo are checked by their own veil, not here.
              if (image) continue;
              const a = lum(rgb(style.color));
              const b = lum(rgb(bg));
              const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
              if (ratio < 4.5)
                found.push(
                  `${ratio.toFixed(2)} ${element.className} "${element.textContent.trim().slice(0, 20)}"`,
                );
            }
            return [...new Set(found)];
          });
        const routes = [
          "/",
          "/timeline/",
          "/search/",
          "/books/walden/",
          "/shops/shop-rain/",
          "/profiles/me/",
          "/profiles/r-haru/",
          "/posters/",
          "/notifications/",
          "/reading/",
        ];
        for (const route of routes) {
          await go(route);
          expect(await page.evaluate(() => window.__themeAtBody)).toBe("dark");
          await page.waitForTimeout(400);
          expect(await unreadable(), `${route} at night`).toEqual([]);
        }
        await page.screenshot({ path: path.join(output, "night-home.png") });
        // Each palette's night, on the screens with the most of its colour.
        for (const palette of ["brick", "ai", "fuji", "yamabuki", "sumi"]) {
          await page.evaluate(
            (palette) =>
              localStorage.setItem(
                "book-town-appearance-v1",
                JSON.stringify({ palette }),
              ),
            palette,
          );
          for (const route of ["/", "/books/walden/", "/profiles/me/"]) {
            await go(route);
            await page.waitForTimeout(400);
            expect(await unreadable(), `${route} at night, ${palette}`).toEqual(
              [],
            );
          }
        }

        // The device turns light while the town is open: it follows.
        await page.emulateMedia({ colorScheme: "light" });
        await expect(page.locator("html")).not.toHaveAttribute(
          "data-theme",
          /./,
        );
        await page.emulateMedia({ colorScheme: "dark" });
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          "dark",
        );
        // 昼 stays the day on a dark device; 夜 stays the night on a light one.
        await page.evaluate(() =>
          localStorage.setItem(
            "book-town-appearance-v1",
            JSON.stringify({ palette: "green", brightness: "day" }),
          ),
        );
        await page.reload();
        await expect(page.locator("main")).toBeVisible();
        expect(await page.evaluate(() => window.__themeAtBody)).toBe("none");
        await page.evaluate(() =>
          localStorage.setItem(
            "book-town-appearance-v1",
            JSON.stringify({ palette: "green", brightness: "night" }),
          ),
        );
        await page.emulateMedia({ colorScheme: "light" });
        await page.reload();
        await expect(page.locator("main")).toBeVisible();
        expect(await page.evaluate(() => window.__themeAtBody)).toBe("dark");

        // 設定's 明るさ: three choices, each a whole row, kept with the
        // palette; the page changes at once.
        await go("/profiles/me/");
        await page
          .locator(".profile-minor-actions")
          .getByRole("button", { name: "設定" })
          .tap();
        const brightness = page
          .getByRole("dialog", { name: "設定" })
          .getByRole("group", { name: "明るさ" });
        await expect(brightness.getByRole("radio")).toHaveCount(3);
        await expect(
          brightness.getByRole("radio", { name: "夜", exact: true }),
        ).toBeChecked();
        await expectReadable(brightness.locator("label"), "明るさ at night");
        for (const height of await brightness
          .locator("label")
          .evaluateAll((labels) =>
            labels.map((label) => label.getBoundingClientRect().height),
          ))
          expect(height).toBeGreaterThanOrEqual(44);
        await brightness.getByText("昼", { exact: true }).tap();
        await expect(page.locator("html")).not.toHaveAttribute(
          "data-theme",
          /./,
        );
        await expectReadable(brightness.locator("label"), "明るさ by day");
        await brightness.getByText("端末に合わせる", { exact: true }).tap();
        await expect(page.locator("html")).not.toHaveAttribute(
          "data-theme",
          /./,
        );
        await page.emulateMedia({ colorScheme: "dark" });
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          "dark",
        );
        expect(
          await page.evaluate(() =>
            JSON.parse(localStorage.getItem("book-town-appearance-v1")),
          ),
        ).toEqual({
          palette: "green",
          brightness: "system",
          text: "normal",
        });
        await page.keyboard.press("Escape");
      }),
  );

  await check(
    "No hydration errors, uncaught exceptions or console errors",
    async () => {
      expect(errors).toEqual([]);
    },
  );
  console.log(`home journey ok (${passed.length} checks)`);
} finally {
  await browser.close();
}
