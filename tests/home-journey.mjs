import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { settleBeforeNavigating } from "./journey-layers.mjs";
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
const card = (author, text) =>
  page
    .locator("main article.letter")
    .filter({ has: page.getByRole("link", { name: author, exact: true }) })
    .filter({ hasText: text });
/** A 便り's page, open over the screen. */
const letterPage = (author) =>
  page.getByRole("dialog", { name: new RegExp("^" + author + "さんの便り") });
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
async function stopClock() {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 100);
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
        await expect(page.locator(".toast")).toHaveText(
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
        const post = card("すみれ", "どこから開いてもいい本");
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

        // The screen beneath stays where it was.
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
        await expect(page.locator(".toast")).toHaveText("投稿を削除しました");
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
        await expect(page.locator(".toast")).toHaveText("投稿を削除しました");
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
          "読んだ人から「ネタバレでは？」という声があったので、みんなの画面ではたたんで表示しています。投稿は消えていません。",
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
    "No hydration errors, uncaught exceptions or console errors",
    async () => {
      expect(errors).toEqual([]);
    },
  );
  console.log(`home journey ok (${passed.length} checks)`);
} finally {
  await browser.close();
}
