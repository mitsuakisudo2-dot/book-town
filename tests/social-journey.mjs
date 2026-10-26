import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { settleBeforeNavigating } from "./journey-layers.mjs";
import { expectReadable } from "./journey-contrast.mjs";
import {
  coarse,
  expectKeyboardUp,
  expectNoKeyboard,
  expectNoZoomOnFocus,
  expectTapWrites,
  fakeKeyboard,
  forgetFocus,
  toolbarPlace,
  watchFocus,
} from "./journey-keyboard.mjs";

const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/social-qa",
);
await mkdir(output, { recursive: true });
// Uses Playwright's own Chromium unless BOOK_TOWN_CHROME names another browser.
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
  // Saved data can exist before this page hydrates; wait until React owns the page.
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("main") ?? {}).some((key) =>
      key.startsWith("__reactFiber"),
    ),
  );
}
/** Reloads, and waits until React owns the page again. */
async function reload() {
  await page.reload();
  await expect(page.locator("main")).toBeVisible();
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("main") ?? {}).some((key) =>
      key.startsWith("__reactFiber"),
    ),
  );
}
/** 戻る, once the open dialog has its step in the history. */
async function back() {
  await expect
    .poll(() => page.evaluate(() => history.state?.booktownLayers?.length ?? 0))
    .toBeGreaterThan(0);
  await page.goBack();
}
/** A tap on the dimmed page around the open dialog. */
const tapOutside = () =>
  page.locator(".modal-backdrop").click({ position: { x: 5, y: 5 } });
async function noOverflow(label) {
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
// Only what is shown: Home keeps the tab not shown on the page, hidden.
const card = (author, text) =>
  page
    .locator("main article.post-card:not(.is-reply):visible")
    .filter({ has: page.getByRole("link", { name: author, exact: true }) })
    .filter({ hasText: text });
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
 * owners, so 便りだけ (`/timeline/`) then has them all, as the timeline of
 * everyone's posts did before.
 */
async function followEveryShop() {
  await go("/");
  await page.evaluate((shops) => {
    const saved = JSON.parse(localStorage.getItem("book-town-v1"));
    saved.data.following = shops;
    localStorage.setItem("book-town-v1", JSON.stringify(saved));
  }, DEMO_SHOPS);
  await reload();
}
/** The sheet 「…」 opens on a card. */
const menu = () => page.getByRole("dialog", { name: "その他の操作" });
/** A 便り's page, open over the screen. */
const letterPage = (author) =>
  page.getByRole("dialog", { name: new RegExp("^" + author + "さんの便り") });
async function pickBook(scope, title) {
  await scope.getByRole("searchbox").fill(title);
  await scope
    .getByRole("button", { name: new RegExp("^" + title) })
    .first()
    .click();
}
/** Posts from the round button on the home screen. */
async function compose(text, { book, spoiler = false } = {}) {
  await page.locator(".compose-fab").click();
  const dialog = page.getByRole("dialog", { name: "投稿する" });
  await dialog.locator("textarea").fill(text);
  if (book) {
    await dialog.getByRole("button", { name: "本を添える" }).click();
    // Typing goes to the book search, not into the post.
    await expect(dialog.getByRole("searchbox")).toBeFocused();
    await pickBook(dialog, book);
  }
  if (spoiler) await dialog.getByLabel("ネタバレあり").check();
  await dialog.getByRole("button", { name: "投稿する" }).click();
  await expect(dialog).toHaveCount(0);
}

try {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    page = settleBeforeNavigating(await context.newPage());
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const label = `${viewport.width}px`;
    await followEveryShop();

    await check(
      `${label} 便りだけ is a tab of Home and hides spoilers`,
      async () => {
        await go("/timeline/");
        const nav = page.locator(
          viewport.width > 760 ? ".town-sidebar nav" : ".town-bottom-nav",
        );
        await expect(nav.getByRole("link", { name: "ホーム" })).toHaveClass(
          /active/,
        );
        const tabs = page.getByRole("tablist", { name: "ホームの表示" });
        await expect(tabs.getByRole("tab")).toHaveText(["ホーム", "便りだけ"]);
        await expect(
          tabs.getByRole("tab", { name: "便りだけ" }),
        ).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("tabpanel")).toHaveAttribute(
          "aria-labelledby",
          "home-tab-letters",
        );
        await expect(card("すみれ", "二駅乗り過ごした")).toBeVisible();
        await expect(card("凪", "十年ぶりに再読")).toBeVisible();
        await expect(page.getByText("最後の数章を読んだ夜は")).toHaveCount(0);
        await expect(page.getByText("あの終わり方でなければ")).toHaveCount(0);
        await noOverflow(`${label} 便りだけ`);
        await page.screenshot({
          caret: "initial",
          path: path.join(output, `timeline-${viewport.width}.png`),
          fullPage: true,
        });
      },
    );

    await check(
      `${label} a post with a book reaches Home and the book page`,
      async () => {
        // Posted from ホーム, it stays there, at the top, with its toast.
        await go("/");
        await page
          .getByRole("tablist", { name: "ホームの表示" })
          .getByRole("tab", { name: "ホーム" })
          .click();
        await expect(page).toHaveURL(/\/$/);
        await compose("灰色の男たちが怖かった。時間の使い方を考え直した。", {
          book: "モモ",
        });
        await expect(page).toHaveURL(/\/$/);
        await expect(page.locator(".toast")).toHaveText(
          "ホームと作品ページに投稿しました",
        );
        const mine = card("あなた", "灰色の男たち");
        await expect(mine).toBeVisible();
        // The post just written glows once where it lands.
        await expect(mine).toHaveClass(/is-arriving/);
        await expect(mine.getByRole("link", { name: /モモ/ })).toBeVisible();
        await expect(
          page.locator("main article.post-card:visible").first(),
        ).toContainText("灰色の男たち");
        await mine.getByRole("link", { name: /モモ/ }).click();
        await expect(
          page.getByRole("heading", { name: "この本のレビュー" }),
        ).toBeVisible();
        await expect(card("あなた", "灰色の男たち")).toBeVisible();
      },
    );

    await check(
      `${label} spoiler posts are covered on 便りだけ and wait behind the book page door`,
      async () => {
        await go("/timeline/");
        await compose("ラストの一行で、すべての章がつながった。", {
          book: "沈黙",
          spoiler: true,
        });
        // On 便りだけ the post is there, covered until the reader
        // chooses to see it: the words are not on the page until then.
        await expect(page.getByText("ラストの一行で")).toHaveCount(0);
        const covered = card("あなた", "沈黙");
        await expect(covered).toContainText("結末に触れています・押すと表示");
        // The whole box is one button, named with its book.
        const cover = covered.getByRole("button", {
          name: /結末に触れています/,
        });
        await expect(cover).toHaveAttribute("aria-expanded", "false");
        await expect(cover).toHaveAccessibleName(/『沈黙』/);
        await cover.click();
        await expect(covered).toContainText("ラストの一行で");
        await expect(cover).toHaveCount(0);
        await go("/books/silence/");
        await expect(page.getByText("ラストの一行で")).toHaveCount(0);
        const door = page.getByRole("button", {
          name: /ネタバレありのレビュー（1件）/,
        });
        await door.click();
        await expect(door).toHaveAttribute("aria-expanded", "true");
        await expect(card("あなた", "ラストの一行で")).toBeVisible();
      },
    );

    await check(
      `${label} a writer covers just the spoiling words of a post`,
      async () => {
        await go("/timeline/");
        await page.locator(".compose-fab").click();
        const dialog = page.getByRole("dialog", { name: "投稿する" });
        const text = dialog.locator("textarea");
        const hide = dialog.getByRole("button", { name: "選んだ言葉を隠す" });
        await text.fill("読み終えて驚いた。犯人は庭師だった。");
        // ［隠す］ is there only while words are chosen in the text box:
        // chosen with the mouse (three clicks choose the line), it comes,
        // and a click that lets them go takes it away.
        await expect(hide).toHaveCount(0);
        await text.click({ clickCount: 3 });
        await expect(hide).toHaveText("隠す");
        await text.click();
        await expect(hide).toHaveCount(0);
        await text.evaluate((field) => {
          const start = field.value.indexOf("庭師");
          field.setSelectionRange(start, start + 2);
        });
        await hide.click();
        await expect(text).toHaveValue(
          "読み終えて驚いた。犯人は||庭師||だった。",
        );
        await expect(text).toBeFocused();
        // The caret goes on after them: nothing is left chosen, so it goes.
        expect(
          await text.evaluate((field) => [
            field.selectionStart - field.value.indexOf("だった"),
            field.selectionEnd - field.value.indexOf("だった"),
          ]),
        ).toEqual([0, 0]);
        await expect(hide).toHaveCount(0);
        // No line of help about the marks under it.
        await expect(dialog.getByText("「||」で囲んだ言葉は")).toHaveCount(0);
        await dialog.getByRole("button", { name: "投稿する" }).click();
        await expect(dialog).toHaveCount(0);
        // Only those words are covered; the rest of the post reads as usual.
        const post = card("あなた", "読み終えて驚いた");
        await expect(post).toContainText("犯人は");
        await expect(post).not.toContainText("庭師");
        await post
          .getByRole("button", { name: "隠された言葉（ネタバレ）を読む" })
          .click();
        await expect(post.locator("mark.hidden-words")).toHaveText("庭師");
        await noOverflow(`${label} covered words`);
      },
    );

    await check(
      `${label} 読みたい saves the book and remembers whose 便り it was`,
      async () => {
        await go("/timeline/");
        const post = card("すみれ", "どこから開いてもいい本");
        // In the book's frame, beside the link to the book.
        const frame = post.locator(".letter-book");
        await expect(frame.locator(".post-book")).toBeVisible();
        const want = frame.getByRole("button", { name: "読みたい" });
        await expect(want).toHaveAttribute("aria-pressed", "false");
        await want.click();
        await expect(want).toHaveAttribute("aria-pressed", "true");
        const toast = page.locator(".toast");
        await expect(toast).toContainText(
          "『見えない都市』を読みたいに入れました",
        );
        // How many readers wanted it is the writer's to know, not ours.
        await expect(want).toHaveText("読みたい");
        await expect(post).not.toContainText(/\d+人/);
        // The toast offers a memo of why (押したときのメモ).
        await toast.getByRole("button", { name: "メモ" }).click();
        const memo = page.getByRole("dialog", { name: "出会いのメモ" });
        await expect(memo).toContainText("すみれさんの便りで読みたくなった");
        await memo.getByRole("textbox").fill("旅の前に読みたい");
        await memo.getByRole("button", { name: "残す" }).click();
        await expect(memo).toHaveCount(0);
        await expect(toast).toHaveText("メモを残しました");
        await go("/books/invisible-cities/");
        await expect(
          page.getByText("すみれさんの感想で、読みたくなった本です。"),
        ).toBeVisible();
        const met = page.locator(".book-encounters li").first();
        await expect(met.locator("q")).toHaveText("旅の前に読みたい");
        // Changed from the book's page, the same sheet holds the memo.
        await met.getByRole("button", { name: "メモを直す" }).click();
        await expect(memo.getByRole("textbox")).toHaveValue("旅の前に読みたい");
        await memo.getByRole("textbox").fill("旅の前に、駅で読みたい");
        await memo.getByRole("button", { name: "残す" }).click();
        await expect(met.locator("q")).toHaveText("旅の前に、駅で読みたい");
        await expect(
          page.getByRole("button", { name: "読みたいに登録済み" }),
        ).toBeVisible();
      },
    );

    await check(
      `${label} a first いいね on a 便り about a book offers a memo, once the tapping stops`,
      async () => {
        await go("/timeline/");
        const post = card("凪", "十年ぶりに再読");
        const like = post.getByRole("button", { name: "いいね", exact: true });
        await like.click();
        await like.click();
        await like.click();
        const toast = page.locator(".toast");
        await expect(toast).toContainText("いいねした本に入れました");
        await expect(toast.getByRole("button", { name: "メモ" })).toHaveCount(
          1,
        );
        await toast.getByRole("button", { name: "メモ" }).click();
        const memo = page.getByRole("dialog", { name: "出会いのメモ" });
        await expect(memo).toContainText("凪さんの便りでいいね");
        await memo.getByRole("button", { name: "やめる" }).click();
        await expect(memo).toHaveCount(0);
        await noOverflow(`${label} memo`);
        // Forgotten on the book's page, the いいね stays and the page is as before.
        await go("/books/solaris/");
        await page
          .locator(".book-encounters")
          .getByRole("button", { name: "消す" })
          .click();
        await expect(page.locator(".book-encounters")).toHaveCount(0);
      },
    );

    await check(
      `${label} a like is pressed again, up to ten, and taken back from the menu`,
      async () => {
        await go("/timeline/");
        const post = card("すみれ", "二駅乗り過ごした");
        const like = post.getByRole("button", { name: "いいね", exact: true });
        const pill = post.locator(".letter-like-pill");
        await like.click();
        await expect(like).toHaveAttribute("aria-pressed", "true");
        // 「1回」 for a moment above the heart, then no count at all.
        await expect(pill).toHaveText("1回");
        await expect(pill).toHaveCount(0);
        await expect(post).not.toContainText("回");
        // A 便り without a book meets none: no memo is offered.
        await expect(page.locator(".toast")).toHaveCount(0);
        for (let press = 1; press < 10; press += 1) await like.click();
        await expect(pill).toHaveText("10回");
        // The press after the tenth asks to take it back.
        await like.click();
        const ask = page.getByRole("dialog", {
          name: "いいねを取り消しますか",
        });
        await ask.getByRole("button", { name: "そのまま" }).click();
        await expect(ask).toHaveCount(0);
        await expect(like).toHaveAttribute("aria-pressed", "true");
        await like.click();
        await ask.getByRole("button", { name: "取り消す" }).click();
        await expect(like).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator(".toast")).toHaveText(
          "いいねを取り消しました",
        );
        // Taken back from 「…」 too.
        await like.click();
        await expect(like).toHaveAttribute("aria-pressed", "true");
        await post.getByRole("button", { name: "その他の操作" }).click();
        await menu().getByRole("button", { name: "いいねを取り消す" }).click();
        await expect(menu()).toHaveCount(0);
        await expect(like).toHaveAttribute("aria-pressed", "false");
        await expect(post).not.toContainText("回");
      },
    );

    await check(
      `${label} reviews hold conversations and replies can recommend a book`,
      async () => {
        await go("/books/solaris/");
        const review = card("凪", "十年ぶりに再読");
        // No count of replies on the card: the reply icon opens its page.
        await expect(review).not.toContainText(/件|返信を見る|返信\s*\d/);
        await review.getByRole("button", { name: "返信", exact: true }).click();
        const letter = letterPage("凪");
        await expect(letter).toBeVisible();
        const replies = letter.locator("article.post-card.is-reply");
        await expect(replies).toHaveCount(2);
        await expect(
          replies.nth(1).getByRole("link", { name: /闇の左手/ }),
        ).toBeVisible();
        await letter.getByRole("button", { name: "凪さんに返信" }).click();
        const sheet = page.getByRole("dialog", { name: "返信", exact: true });
        await expect(sheet.locator("textarea")).toBeFocused();
        await sheet.locator("textarea").fill("海の描写、わたしも好きです。");
        await sheet
          .getByRole("button", { name: "おすすめの本を添える" })
          .click();
        await pickBook(sheet, "見えない都市");
        await sheet.getByRole("button", { name: "返信する" }).click();
        await expect(sheet).toHaveCount(0);
        await expect(page.locator(".toast")).toHaveText("返信しました");
        await expect(replies).toHaveCount(3);
        await expect(replies.nth(2)).toContainText("海の描写");
        await expect(replies.nth(2)).toBeInViewport();
        await letter.getByRole("button", { name: "戻る" }).click();
        await expect(letter).toHaveCount(0);
        await expect(card("凪", "十年ぶりに再読")).not.toContainText(
          /件|返信を見る|返信\s*\d/,
        );
        await page.reload();
        await page.waitForFunction(() => localStorage.getItem("book-town-v1"));
        await card("凪", "十年ぶりに再読").locator(".letter-text").click();
        await expect(
          letterPage("凪").getByText("海の描写、わたしも好きです。"),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(letterPage("凪")).toHaveCount(0);
      },
    );

    await check(
      `${label} reporting a possible spoiler covers it on 便りだけ`,
      async () => {
        await go("/timeline/");
        const post = card("栞", "美術館の帰りに");
        // Reporting waits behind "…", out of sight of whoever is writing.
        await expect(
          post.getByRole("button", { name: "ネタバレでは？" }),
        ).toHaveCount(0);
        await post.getByRole("button", { name: "その他の操作" }).click();
        await menu().getByRole("button", { name: "ネタバレでは？" }).click();
        await expect(card("栞", "美術館の帰りに")).toHaveCount(0);
        const reported = card("栞", "ネタバレの可能性を報告済み");
        await expect(
          reported.getByRole("button", {
            name: /ネタバレの可能性を報告済み・押すと表示/,
          }),
        ).toBeVisible();
        await go("/books/ways-of-seeing/");
        await page
          .getByRole("button", { name: /ネタバレありのレビュー（1件）/ })
          .click();
        const hidden = card("栞", "");
        await expect(
          hidden.getByText("ネタバレの可能性を報告済み"),
        ).toBeVisible();
        await hidden.getByRole("button", { name: "その他の操作" }).click();
        await menu().getByRole("button", { name: "報告を取り消す" }).click();
        await expect(
          page.getByRole("button", { name: /ネタバレありのレビュー/ }),
        ).toHaveCount(0);
      },
    );

    await check(
      `${label} profiles show a reader's posts without spoilers`,
      async () => {
        await go("/timeline/");
        await card("凪", "十年ぶりに再読")
          .getByRole("link", { name: "凪", exact: true })
          .click();
        await expect(page.getByRole("heading", { name: "便り" })).toBeVisible();
        await expect(card("凪", "十年ぶりに再読")).toBeVisible();
        await expect(page.getByText("最後の数章を読んだ夜は")).toHaveCount(0);
        await go("/profiles/me/");
        await expect(card("あなた", "灰色の男たち")).toBeVisible();
        const own = card("あなた", "灰色の男たち");
        // Deleting is under 「…」, asked once more there.
        await own.getByRole("button", { name: "その他の操作" }).click();
        await menu().getByRole("button", { name: "削除する" }).click();
        await expect(menu()).toContainText("この便りを削除しますか？");
        await menu().getByRole("button", { name: "やめる" }).click();
        await page.keyboard.press("Escape");
        await expect(menu()).toHaveCount(0);
        await expect(own).toBeVisible();
        await own.getByRole("button", { name: "その他の操作" }).click();
        await menu().getByRole("button", { name: "削除する" }).click();
        await menu().getByRole("button", { name: "削除する" }).click();
        await expect(menu()).toHaveCount(0);
        await expect(page.locator(".toast")).toHaveText("便りを削除しました");
        await expect(card("あなた", "灰色の男たち")).toHaveCount(0);
        await noOverflow(`${label} profile`);
      },
    );

    await check(`${label} book page stays within the viewport`, async () => {
      await go("/books/solaris/");
      await noOverflow(`${label} book`);
      await page.screenshot({
        caret: "initial",
        path: path.join(output, `book-reviews-${viewport.width}.png`),
        fullPage: true,
      });
    });
    await check(
      `${label} the spoiler setting folds, or leaves out, spoilers everywhere`,
      async () => {
        const stored = () =>
          page.evaluate(
            () => JSON.parse(localStorage.getItem("book-town-v1")).data,
          );
        await go("/timeline/");
        // By default a marked post or poster is folded, in its place. The
        // words on how are in the setting alone: no footnote under the 便り.
        await expect(page.locator(".social-note")).toHaveCount(0);
        await expect(
          page.locator("main .letter-spoiler").first(),
        ).toBeVisible();
        await go("/profiles/me/");
        await page.getByRole("button", { name: "設定" }).click();
        const settings = page.getByRole("dialog", { name: "設定" });
        const display = settings.getByRole("group", { name: "ネタバレの表示" });
        await expect(
          display.getByLabel(
            "ネタバレの可能性があるもの（3人以上が「ネタバレでは？」）はたたんで表示する",
          ),
        ).toBeChecked();
        await expect(display).toContainText(
          "書いた人がネタバレの印を付けたものは、はじめからたたんであります。",
        );
        await expectReadable(
          display.locator(".spoiler-display-note"),
          "spoiler display note",
        );
        // Records start private: 自分だけ is the first choice, and chosen.
        const records = settings.getByRole("group", {
          name: "読み終えた本の記録",
        });
        await expect(records.getByRole("radio").first()).toBeChecked();
        await expect(records.getByLabel("自分だけ")).toBeChecked();
        await display
          .getByLabel("ネタバレの印があるもの・可能性があるものは出さない")
          .check();
        await expect(page.locator(".toast")).toContainText(
          "ネタバレの印があるもの・可能性があるものは、出さないようにします（読み終えた本の便りは出します）",
        );
        await noOverflow(`${label} settings`);
        await page.screenshot({
          caret: "initial",
          path: path.join(output, `settings-spoilers-${viewport.width}.png`),
        });
        await page.keyboard.press("Escape");
        expect((await stored()).settings.spoilerDisplay).toBe("leave_out");
        await go("/timeline/");
        // Others' marked posts are left out; the reader's own never are.
        for (const title of ["闇の左手", "銀河鉄道の夜"])
          await expect(
            page.locator("main .letter-spoiler", { hasText: title }),
          ).toHaveCount(0);
        await expect(
          card("あなた", "").locator(".letter-spoiler").first(),
        ).toBeVisible();
        await expect(card("すみれ", "二駅乗り過ごした")).toBeVisible();
        // The book page has no door, and says once (no count) why.
        await go("/books/galaxy-railroad/");
        await expect(
          page.getByRole("button", { name: /ネタバレありのレビュー/ }),
        ).toHaveCount(0);
        const leftOut = page.getByText(
          "ネタバレを含むかもしれないレビューは、設定により出していません",
        );
        await expect(leftOut).toBeVisible();
        await expect(leftOut).not.toContainText(/\d/);
        await page.screenshot({
          caret: "initial",
          path: path.join(output, `book-left-out-${viewport.width}.png`),
          fullPage: true,
        });
        // Back to folding: the door is there again.
        await go("/profiles/me/");
        await page.getByRole("button", { name: "設定" }).click();
        await page
          .getByRole("dialog", { name: "設定" })
          .getByLabel(
            "ネタバレの可能性があるもの（3人以上が「ネタバレでは？」）はたたんで表示する",
          )
          .check();
        await page.keyboard.press("Escape");
        await go("/books/galaxy-railroad/");
        await expect(
          page.getByRole("button", { name: /ネタバレありのレビュー/ }),
        ).toBeVisible();
      },
    );

    await check(
      `${label} a record starts private; publishing is told, with a way back`,
      async () => {
        const records = () =>
          page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("book-town-v1")).data
                .readingRecords,
          );
        const own = async () =>
          (await records()).find(
            (record) => record.readerId === "me" && record.bookId === "laozi",
          );
        await go("/books/laozi/");
        await page
          .getByRole("button", { name: "読み終えた気持ちを残す" })
          .click();
        const sheet = page.getByRole("dialog", { name: "読み終えた気持ち" });
        await expect(sheet.getByText("自分だけに残します")).toBeVisible();
        await sheet.getByRole("button", { name: "公開にする" }).click();
        await expect(
          sheet.getByText("公開します（同じ本を読んだ人に届きます）"),
        ).toBeVisible();
        // No confirmation in between: saving publishes, and says so.
        await sheet.getByRole("button", { name: "記録する" }).click();
        await expect(sheet).toHaveCount(0);
        const toast = page.locator(".toast");
        await expect(toast).toContainText(
          "公開しました。同じ本を読んだ人に届きます",
        );
        expect((await own()).audience).toBe("everyone");
        await noOverflow(`${label} publish toast`);
        await page.screenshot({
          caret: "initial",
          path: path.join(output, `record-published-${viewport.width}.png`),
        });
        // The toast does not take the focus from where the reader is.
        expect(
          await page.evaluate(() =>
            document.activeElement?.classList.contains("toast-undo"),
          ),
        ).toBe(false);
        await toast.getByRole("button", { name: "自分だけに戻す" }).click();
        await expect(toast).toContainText("自分だけに戻しました");
        await expect(toast.getByRole("button")).toHaveCount(0);
        expect((await own()).audience).toBe("private");
        // Publishing one record later is one quiet tap on the book page.
        const mine = page.locator(".book-feelings-own");
        await mine.getByRole("button", { name: "公開する" }).click();
        await expect(toast).toContainText("公開しました");
        expect((await own()).audience).toBe("everyone");
        // A reader who goes to the undo by keyboard keeps it past its 8 s,
        // and it goes its way once they leave it.
        await toast.getByRole("button", { name: "自分だけに戻す" }).focus();
        await page.waitForTimeout(9000);
        await expect(
          toast.getByRole("button", { name: "自分だけに戻す" }),
        ).toBeFocused();
        await mine.getByRole("button", { name: "自分だけにする" }).focus();
        await expect(toast).toHaveCount(0, { timeout: 10000 });
        await mine.getByRole("button", { name: "自分だけにする" }).click();
        await expect(toast).toContainText("自分だけにしました");
        expect((await own()).audience).toBe("private");
        // 見せる範囲 in 設定: widening asks once about the records kept so
        // far; narrowing takes them too.
        const setting = async (choice) => {
          await go("/profiles/me/");
          await page.getByRole("button", { name: "設定" }).click();
          await page
            .getByRole("dialog", { name: "設定" })
            .getByRole("group", { name: "読み終えた本の記録" })
            .getByLabel(choice)
            // A wider choice waits on the question, so the radio is clicked.
            .click();
        };
        const stored = () =>
          page.evaluate(
            () => JSON.parse(localStorage.getItem("book-town-v1")).data,
          );
        const question = page
          .getByRole("dialog", { name: "設定" })
          .getByRole("group", { name: /^今までの記録も公開にするか/ });
        await setting("公開");
        await expect(question).toContainText("今までの記録も公開にしますか？");
        // The question is read out where it comes. Nothing changes until it
        // is answered; やめる leaves it all as it was, the focus on the choice.
        await expect(
          question.getByText("今までの記録も公開にしますか？"),
        ).toBeFocused();
        await question.getByRole("button", { name: "やめる" }).click();
        await expect(question).toHaveCount(0);
        await expect(
          page
            .getByRole("dialog", { name: "設定" })
            .getByRole("group", { name: "読み終えた本の記録" })
            .getByLabel("自分だけ"),
        ).toBeFocused();
        expect((await stored()).settings.visibility.records.audience).toBe(
          "private",
        );
        await page
          .getByRole("dialog", { name: "設定" })
          .getByRole("group", { name: "読み終えた本の記録" })
          .getByLabel("公開")
          .click();
        await noOverflow(`${label} visibility question`);
        await page.screenshot({
          caret: "initial",
          path: path.join(output, `visibility-question-${viewport.width}.png`),
        });
        await question
          .getByRole("button", { name: "これからの記録だけ" })
          .click();
        await expect(toast).toContainText(
          "これからの読み終えた本の記録は公開になります。今までの記録はそのままです",
        );
        expect((await own()).audience).toBe("private");
        expect((await stored()).settings.visibility.records.audience).toBe(
          "everyone",
        );
        await page.keyboard.press("Escape");
        await setting("自分だけ");
        await expect(toast).toContainText(
          "読み終えた本の記録を自分だけにしました。今までの記録も自分だけです",
        );
        await page.keyboard.press("Escape");
        await setting("公開");
        await question
          .getByRole("button", { name: "今までの記録も公開にする" })
          .click();
        await expect(toast).toContainText("今までの記録も公開にしました");
        expect((await own()).audience).toBe("everyone");
        await page.keyboard.press("Escape");
        await setting("自分だけ");
        expect((await own()).audience).toBe("private");
        await page.keyboard.press("Escape");
      },
    );

    await check(
      `${label} a post being written stays through closing and a reload; its count waits near the limit`,
      async () => {
        await go("/timeline/");
        const fab = page.locator(".compose-fab");
        await fab.click();
        const dialog = page.getByRole("dialog", { name: "投稿する" });
        const text = dialog.locator("textarea");
        const count = dialog.locator(".composer-count");
        // Nothing written shows no count (never 「0/1000」); it comes at 80%.
        await expect(count).toHaveCount(0);
        await expect(dialog).not.toContainText("/1000");
        await text.fill("あ".repeat(799));
        await expect(count).toHaveCount(0);
        await text.fill("あ".repeat(800));
        await expect(count).toHaveText("800/1000");
        // The button keeps to the right edge, with the count or without it.
        const gap = async () => {
          const tools = await dialog.locator(".composer-tools").boundingBox();
          const button = await dialog
            .getByRole("button", { name: "投稿する" })
            .boundingBox();
          return tools.x + tools.width - (button.x + button.width);
        };
        expect(await gap()).toBeLessThan(2);
        await text.fill("閉じても残る下書き。");
        await expect(count).toHaveCount(0);
        expect(await gap()).toBeLessThan(2);
        // Escape keeps it, and the round button says a draft waits.
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(fab).toContainText("下書き");
        await reload();
        await fab.click();
        await expect(text).toHaveValue("閉じても残る下書き。");
        await expect(dialog.getByText("書きかけを続けています")).toBeVisible();
        // A tap outside, and 戻る, keep it too.
        await tapOutside();
        await expect(dialog).toHaveCount(0);
        await fab.click();
        await expect(text).toHaveValue("閉じても残る下書き。");
        await back();
        await expect(dialog).toHaveCount(0);
        await fab.click();
        await expect(text).toHaveValue("閉じても残る下書き。");
        // Only 書きかけを消す throws it away, asked once.
        await dialog.getByRole("button", { name: "書きかけを消す" }).click();
        await expect(dialog.getByText("書きかけを消しますか？")).toBeVisible();
        await dialog.getByRole("button", { name: "残す" }).click();
        await expect(text).toHaveValue("閉じても残る下書き。");
        await dialog.getByRole("button", { name: "書きかけを消す" }).click();
        await dialog.getByRole("button", { name: "消す", exact: true }).click();
        await expect(text).toHaveValue("");
        await expect(text).toBeFocused();
        await expect(dialog.getByText("書きかけを続けています")).toHaveCount(0);
        // Words written anew after that are not the old work.
        await text.fill("書いて、送った。");
        await expect(dialog.getByText("書きかけを続けています")).toHaveCount(0);
        // Posted, the draft is gone.
        await dialog.getByRole("button", { name: "投稿する" }).click();
        await expect(dialog).toHaveCount(0);
        await expect(fab).not.toContainText("下書き");
        await fab.click();
        await expect(text).toHaveValue("");
        await page.keyboard.press("Escape");
      },
    );

    await check(
      `${label} a line written while reading survives leaving, a reload and closing the book`,
      async () => {
        await go("/reading/");
        await page
          .getByRole("searchbox", { name: "読む本を探す" })
          .fill("夢十夜");
        await page.getByRole("button", { name: /^夢十夜/ }).click();
        await page.getByRole("button", { name: /一人で読む/ }).click();
        await page
          .getByRole("dialog", { name: "読書をはじめますか？" })
          .getByRole("button", { name: "本を開く", exact: true })
          .click();
        const memo = page.getByLabel("読書メモ（自分だけ）");
        await memo.fill("百年待っていてください。");
        await expect(
          page.locator(".memo-composer .composer-count"),
        ).toHaveCount(0);
        // Leaving and coming back, 戻る, and a reload all keep it.
        await go("/timeline/");
        await go("/reading/");
        await expect(memo).toHaveValue("百年待っていてください。");
        await expect(page.getByText("書きかけを続けています")).toBeVisible();
        await go("/timeline/");
        await page.goBack();
        await expect(memo).toHaveValue("百年待っていてください。");
        await reload();
        await expect(memo).toHaveValue("百年待っていてください。");
        // Closing the book offers the line not sent.
        await page.getByRole("button", { name: "読書を終える" }).click();
        const ending = page.getByRole("dialog", { name: "読書を終えますか？" });
        await expect(ending).toContainText("まだメモしていない言葉があります");
        await expect(ending.locator("blockquote")).toHaveText(
          "百年待っていてください。",
        );
        await expect(
          ending.getByRole("button", { name: "メモして閉じる" }),
        ).toBeVisible();
        // Closed without sending, it waits above the start, even after a reload.
        await ending
          .getByRole("button", { name: "本を閉じる", exact: true })
          .click();
        const unsent = page.getByRole("region", {
          name: "読みながら書いて、送っていない言葉",
        });
        await expect(unsent.locator("blockquote")).toHaveText(
          "百年待っていてください。",
        );
        await expect(unsent).toContainText("『夢十夜』を読みながら");
        await expect(unsent).not.toContainText(/\d/);
        await noOverflow(`${label} unsent line`);
        await reload();
        await expect(unsent.locator("blockquote")).toHaveText(
          "百年待っていてください。",
        );
        // Used for the review, it starts the review and leaves this place.
        await unsent.getByRole("button", { name: "感想に使う" }).click();
        const review = page.getByRole("dialog", { name: "『夢十夜』の感想" });
        await expect(review.locator("textarea")).toHaveValue(
          "百年待っていてください。",
        );
        await expect(unsent).toHaveCount(0);
        // Closed by Escape, the review keeps it on the book's page.
        await page.keyboard.press("Escape");
        await expect(review).toHaveCount(0);
        await go("/books/ten-nights/");
        const reviews = page.locator(".book-reviews");
        await expect(reviews.locator("textarea")).toHaveValue(
          "百年待っていてください。",
        );
        await expect(reviews.getByText("書きかけを続けています")).toBeVisible();
        await reviews.getByRole("button", { name: "書きかけを消す" }).click();
        await reviews
          .getByRole("button", { name: "消す", exact: true })
          .click();
        await expect(reviews.locator("textarea")).toHaveValue("");
        // Words written anew there are not the old work.
        await reviews.locator("textarea").fill("前から書いていた感想。");
        await expect(reviews.getByText("書きかけを続けています")).toHaveCount(
          0,
        );
        // A review with words of its own is not overwritten by the line; the
        // review shows the line, and 書き足す adds it at the end.
        const startSolo = async () => {
          await go("/reading/");
          await page.getByRole("button", { name: /一人で読む/ }).click();
          await page
            .getByRole("dialog", { name: "読書をはじめますか？" })
            .getByRole("button", { name: /^(本を開く|はじめる)$/ })
            .click();
        };
        await startSolo();
        await memo.fill("三夜目の一行。");
        await page.getByRole("button", { name: "読書を終える" }).click();
        await ending.getByRole("button", { name: "感想を書く" }).click();
        await expect(review.locator("textarea")).toHaveValue(
          "前から書いていた感想。",
        );
        const toAdd = review.locator(".reading-line-to-add");
        await expect(toAdd).toContainText(
          "読みながら書いた言葉は、まだ感想に入れていません",
        );
        await expect(toAdd.locator("blockquote")).toHaveText("三夜目の一行。");
        await noOverflow(`${label} line to add`);
        await toAdd.getByRole("button", { name: "書き足す" }).click();
        await expect(review.locator("textarea")).toHaveValue(
          "前から書いていた感想。\n三夜目の一行。",
        );
        await expect(review.locator("textarea")).toBeFocused();
        await expect(toAdd).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(review).toHaveCount(0);
        await expect(unsent).toHaveCount(0);
        await go("/books/ten-nights/");
        await expect(reviews.locator("textarea")).toHaveValue(
          "前から書いていた感想。\n三夜目の一行。",
        );
        await reviews.getByRole("button", { name: "書きかけを消す" }).click();
        await reviews
          .getByRole("button", { name: "消す", exact: true })
          .click();
        await expect(reviews.locator("textarea")).toHaveValue("");
        // A line sent as the book closes is posted, and kept nowhere else.
        await startSolo();
        await memo.fill("二夜目の一行。");
        await page.getByRole("button", { name: "読書を終える" }).click();
        await ending.getByRole("button", { name: "メモして閉じる" }).click();
        await expect(ending).toHaveCount(0);
        const closed = page.getByRole("status", { name: "今日の読書" });
        await expect(closed).toContainText("二夜目の一行。");
        await expect(closed).toContainText("1分未満");
        await expect(unsent).toHaveCount(0);
        const posts = await page.evaluate(
          () => JSON.parse(localStorage.getItem("book-town-v1")).data.posts,
        );
        expect(
          posts.filter((post) => post.body === "二夜目の一行。"),
        ).toHaveLength(1);
        expect(
          await page.evaluate(() =>
            localStorage.getItem("book-town-post-drafts-v1"),
          ),
        ).toBeNull();
        // A line another reader on this browser left (another account's, or
        // a visitor's) is never shown here, even for a sitting in this town;
        // nor is the reader's own for a sitting not (or not yet) in it.
        const sitting = await page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem("book-town-v1"),
            ).data.readingSessions.find((session) => session.endedAt).id,
        );
        const keep = (drafts) =>
          page.evaluate(
            (drafts) =>
              localStorage.setItem(
                "book-town-post-drafts-v1",
                JSON.stringify({ version: 1, drafts }),
              ),
            drafts,
          );
        const line = (body) => ({ body, bookId: null, spoiler: false });
        await keep({
          ["visitor:reading:" + sitting]: line("ほかの人の言葉。"),
          ["6b0c1c3e-0000-4000-8000-000000000000:reading:" + sitting]:
            line("ほかの人の言葉。"),
          ["demo:reading:6b0c1c3e-0000-4000-8000-000000000000"]:
            line("ほかの座の言葉。"),
        });
        await reload();
        await expect(
          page.getByRole("button", { name: /一人で読む/ }),
        ).toBeVisible();
        await expect(unsent).toHaveCount(0);
        await expect(page.getByText("ほかの人の言葉。")).toHaveCount(0);
        await expect(page.getByText("ほかの座の言葉。")).toHaveCount(0);
        // A line kept before drafts had owners is the first reader's to come,
        // here the demo's, once: it leaves its old place.
        await keep({ ["reading:" + sitting]: line("前から残っていた言葉。") });
        await reload();
        await expect(unsent.locator("blockquote")).toHaveText(
          "前から残っていた言葉。",
        );
        expect(
          Object.keys(
            JSON.parse(
              await page.evaluate(() =>
                localStorage.getItem("book-town-post-drafts-v1"),
              ),
            ).drafts,
          ),
        ).toEqual(["demo:reading:" + sitting]);
        await unsent.getByRole("button", { name: "書きかけを消す" }).click();
        await unsent.getByRole("button", { name: "消す", exact: true }).click();
        await expect(unsent).toHaveCount(0);
        expect(
          await page.evaluate(() =>
            localStorage.getItem("book-town-post-drafts-v1"),
          ),
        ).toBeNull();
      },
    );

    await check(
      `${label} feelings chosen for a finished book wait for the next time`,
      async () => {
        await go("/books/walden/");
        const feelings = page.locator(".book-feelings");
        await feelings
          .getByRole("button", { name: "読み終えた気持ちを残す" })
          .click();
        const sheet = page.getByRole("dialog", { name: "読み終えた気持ち" });
        const note = sheet.getByLabel("ひとこと（なくても大丈夫です）");
        const quiet = sheet.getByRole("button", { name: "静かになった" });
        await quiet.click();
        await note.fill("湖の音が残った。");
        await expect(sheet.locator(".record-count")).toHaveCount(0);
        // A tap outside keeps it; the book page offers to go on.
        await tapOutside();
        await expect(sheet).toHaveCount(0);
        const again = feelings.getByRole("button", {
          name: "書きかけの気持ちを続ける",
        });
        await again.click();
        await expect(quiet).toHaveAttribute("aria-pressed", "true");
        await expect(note).toHaveValue("湖の音が残った。");
        await expect(sheet.getByText("書きかけを続けています")).toBeVisible();
        // So do Escape, あとで, 戻る and a reload.
        await page.keyboard.press("Escape");
        await expect(sheet).toHaveCount(0);
        await again.click();
        await sheet.getByRole("button", { name: "あとで" }).click();
        await expect(sheet).toHaveCount(0);
        await again.click();
        await back();
        await expect(sheet).toHaveCount(0);
        await reload();
        await again.click();
        await expect(quiet).toHaveAttribute("aria-pressed", "true");
        await expect(note).toHaveValue("湖の音が残った。");
        // The count comes only near the limit.
        await note.fill("湖".repeat(204));
        await expect(sheet.locator(".record-count")).toHaveText("204/255");
        await expectReadable(sheet.locator(".record-count"), "record count");
        await note.fill("湖の音が残った。");
        // Kept for real, the work is cleared.
        await sheet.getByRole("button", { name: "記録する" }).click();
        await expect(sheet).toHaveCount(0);
        const own = feelings.locator(".book-feelings-own");
        await expect(own).toContainText("静かになった");
        const edit = page.getByRole("dialog", { name: "記録を見直す" });
        const editNote = edit.getByLabel("ひとこと（なくても大丈夫です）");
        await own.getByRole("button", { name: "見直す" }).click();
        await expect(editNote).toHaveValue("湖の音が残った。");
        await expect(edit.getByText("書きかけを続けています")).toHaveCount(0);
        // A change waits through Escape. Made public beside 見直す in the
        // meantime, the record stays public when the change is saved: only
        // what was changed is kept, over the record as it is.
        await editNote.fill("湖の音と、豆畑。");
        await page.keyboard.press("Escape");
        await expect(edit).toHaveCount(0);
        await own.getByRole("button", { name: "公開する" }).click();
        await expect(
          own.getByRole("button", { name: "自分だけにする" }),
        ).toBeVisible();
        await own.getByRole("button", { name: "見直す" }).click();
        await expect(editNote).toHaveValue("湖の音と、豆畑。");
        await expect(edit.getByText("書きかけを続けています")).toBeVisible();
        await expect(edit.locator(".record-going")).toContainText("公開します");
        await edit.getByRole("button", { name: "書き直す" }).click();
        await expect(edit).toHaveCount(0);
        await expect(
          own.getByRole("button", { name: "自分だけにする" }),
        ).toBeVisible();
        const saved = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("book-town-v1")).data
              .readingRecords,
        );
        expect(
          saved
            .filter((entry) => entry.bookId === "walden")
            .map(({ note, audience }) => ({ note, audience })),
        ).toEqual([{ note: "湖の音と、豆畑。", audience: "everyone" }]);
        // やめる throws a change away, asked once.
        await own.getByRole("button", { name: "見直す" }).click();
        await expect(edit.getByText("書きかけを続けています")).toHaveCount(0);
        await editNote.fill("湖の音と、豆畑と、冬。");
        await page.keyboard.press("Escape");
        await own.getByRole("button", { name: "見直す" }).click();
        await expect(editNote).toHaveValue("湖の音と、豆畑と、冬。");
        await edit.getByRole("button", { name: "やめる" }).click();
        await expect(edit.getByText("書きかけを消しますか？")).toBeVisible();
        await edit.getByRole("button", { name: "消す", exact: true }).click();
        await expect(edit).toHaveCount(0);
        await own.getByRole("button", { name: "見直す" }).click();
        await expect(editNote).toHaveValue("湖の音と、豆畑。");
        await expect(edit.getByText("書きかけを続けています")).toHaveCount(0);
        await page.keyboard.press("Escape");
        expect(
          await page.evaluate(() =>
            localStorage.getItem("book-town-record-drafts-v1"),
          ),
        ).toBeNull();
      },
    );

    await check(
      `${label} following nobody yet, 便りだけ suggests owners with POPs`,
      async () => {
        // A reader new to the town: no follows, nothing written yet.
        const reader = page;
        const fresh = await browser.newContext({ viewport });
        page = settleBeforeNavigating(await fresh.newPage());
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        try {
          await go("/timeline/");
          const empty = page.getByRole("tabpanel");
          await expect(empty).toContainText("まだ便りがありません");
          const suggestions = page.getByRole("region", {
            name: "フォローすると、その店主の便りがここに届きます",
          });
          await expect(suggestions.getByRole("listitem")).toHaveCount(3);
          await expect(suggestions).toContainText("POP：");
          await expect(suggestions).not.toContainText(/\d+人/);
          await suggestions
            .getByRole("button", { name: "フォロー" })
            .first()
            .click();
          // The first follow brings that owner's 便り at once: nothing was
          // drawn to keep in place.
          await expect(suggestions).toHaveCount(0);
          await expect(empty).not.toContainText("まだ便りがありません");
          await expect(page.locator(".post-card").first()).toBeVisible();
        } finally {
          await fresh.close();
          page = reader;
        }
      },
    );
    await check(
      `${label} with a mouse, a sheet for writing opens with its field ready`,
      async () => {
        expect(
          await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
        ).toBe(false);
        await go("/timeline/");
        await page.locator(".compose-fab").click();
        const dialog = page.getByRole("dialog", { name: "投稿する" });
        await expect(dialog.locator("textarea")).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await go("/books/utopia/");
        await page
          .getByRole("button", { name: "読み終えた気持ちを残す" })
          .click();
        const sheet = page.getByRole("dialog", { name: "読み終えた気持ち" });
        await expect(
          sheet.getByLabel("ひとこと（なくても大丈夫です）"),
        ).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(sheet).toHaveCount(0);
      },
    );
    await check(
      `${label} with a mouse, clicks in the post sheet and its layout are as before`,
      async () => {
        expect(await coarse(page)).toBe(false);
        await go("/timeline/");
        await page.locator(".compose-fab").click();
        const dialog = page.getByRole("dialog", { name: "投稿する" });
        await expect(dialog.locator("textarea")).toBeFocused();
        // The buttons are in the card's flow, last, not docked.
        const tools = dialog.locator(".composer-tools");
        expect(
          await tools.evaluate((tools) => getComputedStyle(tools).position),
        ).toBe("static");
        // ポスターを作る is one of them, after 本を添える; ネタバレあり waits
        // for a book.
        await expect(
          tools.locator(".composer-book + .composer-poster"),
        ).toHaveAccessibleName("ポスターを作る");
        await expect(
          dialog.getByRole("checkbox", { name: "ネタバレあり" }),
        ).toHaveCount(0);
        // A click takes the focus where it lands, as anywhere: the book's
        // search, then the ネタバレあり box by its words.
        await dialog.getByRole("button", { name: "本を添える" }).click();
        await expect(dialog.getByRole("searchbox")).toBeFocused();
        await pickBook(dialog, "モモ");
        const words = dialog.locator(".composer-spoiler");
        const box = await words.boundingBox();
        await words.click({
          position: { x: box.width - 8, y: box.height / 2 },
        });
        const spoiler = dialog.getByRole("checkbox", { name: "ネタバレあり" });
        await expect(spoiler).toBeChecked();
        await expect(spoiler).toBeFocused();
        await dialog.getByRole("button", { name: "モモを外す" }).click();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      },
    );
    await context.close();
  }
  {
    // A phone, whose main pointer is a finger.
    const context = await browser.newContext({
      viewport: { width: 393, height: 793 },
      isMobile: true,
      hasTouch: true,
    });
    await watchFocus(context);
    await fakeKeyboard(context);
    page = settleBeforeNavigating(await context.newPage());
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await followEveryShop();
    const fab = page.locator(".compose-fab");
    const dialog = page.getByRole("dialog", { name: "投稿する" });
    const text = dialog.locator("textarea");
    const hide = dialog.getByRole("button", { name: "選んだ言葉を隠す" });
    /** Notes each time the text box lets the focus go (__blurs). */
    const countBlurs = () =>
      text.evaluate((field) => {
        window.__blurs = 0;
        field.addEventListener("blur", () => window.__blurs++);
      });
    const blurs = () => page.evaluate(() => window.__blurs);
    await check(
      "393px phone: the post sheet opens with its text box ready and the keyboard up; the feelings sheet waits for a tap",
      async () => {
        expect(await coarse(page)).toBe(true);
        await go("/timeline/");
        // The text box has the focus, given within the tap that opened the
        // sheet, so a phone's keyboard rises with it: typing goes in.
        await fab.tap();
        await expectKeyboardUp(page, text, "投稿する");
        // In the town's shell still, at a phone's sizes: the text box at
        // 16px, and the words around it readable.
        await expectNoZoomOnFocus(text, "投稿する");
        await expectReadable(dialog.locator(".composer-book"), "本を添える");
        await expectReadable(
          dialog.locator(".composer-poster"),
          "ポスターを作る",
        );
        await page.keyboard.type("指で書きはじめる");
        await expect(text).toHaveValue("指で書きはじめる");
        // The sheet still keeps the focus inside, both ways round.
        for (const key of ["Shift+Tab", "Tab", "Tab", "Tab"]) {
          await page.keyboard.press(key);
          expect(
            await dialog.evaluate((element) =>
              element.contains(document.activeElement),
            ),
          ).toBe(true);
        }
        // Escape and 戻る still close it. The words are kept, and the sheet
        // opens again with the caret after them.
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await forgetFocus(page);
        await fab.tap();
        await expectKeyboardUp(page, text, "投稿する again");
        await expect(text).toHaveValue("指で書きはじめる");
        expect(
          await text.evaluate((field) => [
            field.selectionStart,
            field.selectionEnd,
          ]),
        ).toEqual([8, 8]);
        await back();
        await expect(dialog).toHaveCount(0);
        // The feelings for a finished book are chosen first: no writing
        // screen. The sheet opens on 閉じる, with no keyboard, and the field
        // waits for a tap.
        await go("/books/utopia/");
        await page
          .getByRole("button", { name: "読み終えた気持ちを残す" })
          .tap();
        const sheet = page.getByRole("dialog", { name: "読み終えた気持ち" });
        await expectNoKeyboard(page, "読み終えた気持ち", sheet);
        await expect(
          sheet.getByRole("button", { name: "閉じる" }),
        ).toBeFocused();
        await expectTapWrites(
          sheet.getByLabel("ひとこと（なくても大丈夫です）"),
        );
        await page.keyboard.press("Escape");
        await expect(sheet).toHaveCount(0);
      },
    );
    await check(
      "393px phone: taps inside the post sheet keep the keyboard up",
      async () => {
        await go("/timeline/");
        await fab.tap();
        await expectKeyboardUp(page, text, "open");
        // How often the text box lost the focus: each time, a phone's
        // keyboard would go down, even for a moment.
        await countBlurs();
        // The line about the draft kept is blank space but for its buttons:
        // a tap on its words keeps the keyboard up.
        await dialog.getByText("書きかけを続けています").tap();
        await expect(text).toBeFocused();
        expect(await blurs(), "the text box let the focus go").toBe(0);
        // 書きかけを消す asks, with the focus on its answer (the keyboard may
        // go down meanwhile). 残す, and 消す, give the text box the focus
        // again within the tap.
        await dialog.getByRole("button", { name: "書きかけを消す" }).tap();
        await expect(
          dialog.getByRole("button", { name: "残す" }),
        ).toBeFocused();
        await forgetFocus(page);
        await dialog.getByRole("button", { name: "残す" }).tap();
        await expectKeyboardUp(page, text, "draft kept");
        await expect(text).not.toHaveValue("");
        await dialog.getByRole("button", { name: "書きかけを消す" }).tap();
        await forgetFocus(page);
        await dialog.getByRole("button", { name: "消す", exact: true }).tap();
        await expect(text).toHaveValue("");
        await expectKeyboardUp(page, text, "draft thrown away");
        await page.keyboard.type("犯人は庭師だった。");
        await page.evaluate(() => {
          window.__blurs = 0;
        });
        // The title: the text box keeps the focus.
        await dialog.getByRole("heading", { name: "投稿する" }).tap();
        await expect(text).toBeFocused();
        // ［隠す］ covers the words chosen, there in the text box.
        await text.evaluate((field) => field.setSelectionRange(3, 5));
        await hide.tap();
        await expect(text).toHaveValue("犯人は||庭師||だった。");
        await expect(text).toBeFocused();
        expect(await blurs(), "the text box let the focus go").toBe(0);
        // ［本を添える］: its search takes the focus within the tap, with no
        // picker standing in for it; a book picked hands the focus back to
        // the text box within that tap.
        await forgetFocus(page);
        await dialog.getByRole("button", { name: "本を添える" }).tap();
        const search = dialog.getByRole("searchbox", {
          name: "添える本を探す",
        });
        await expectKeyboardUp(page, search, "本を添える");
        await expectNoZoomOnFocus(search, "本を添える");
        await expect(
          dialog.getByRole("group", { name: "添える本を探す" }),
        ).toHaveCount(0);
        await page.keyboard.type("モモ");
        await forgetFocus(page);
        await dialog.getByRole("button", { name: /^モモ/ }).first().tap();
        await expectKeyboardUp(page, text, "a book picked");
        // ネタバレあり, by its words and by its box: it flips, and the text
        // box keeps the focus. (The caret as typing leaves it: with words
        // chosen in the box, a label would not move the focus anyway.)
        await text.evaluate((field) =>
          field.setSelectionRange(field.value.length, field.value.length),
        );
        const before = await blurs();
        const spoiler = dialog.getByRole("checkbox", { name: "ネタバレあり" });
        const words = await dialog.locator(".composer-spoiler").boundingBox();
        await page.touchscreen.tap(
          words.x + words.width - 8,
          words.y + words.height / 2,
        );
        await expect(spoiler).toBeChecked();
        await expect(text).toBeFocused();
        await spoiler.tap();
        await expect(spoiler).not.toBeChecked();
        await expect(text).toBeFocused();
        // The book taken off again.
        await dialog.getByRole("button", { name: "モモを外す" }).tap();
        await expect(
          dialog.getByRole("button", { name: "本を添える" }),
        ).toBeVisible();
        await expect(text).toBeFocused();
        expect(await blurs(), "the text box let the focus go").toBe(before);
        // With the keyboard put away, a tap on blank space (the title) brings
        // the text box and its keyboard back, within the tap.
        await text.evaluate((field) => field.blur());
        await forgetFocus(page);
        await dialog.getByRole("heading", { name: "投稿する" }).tap();
        await expectKeyboardUp(page, text, "blank space");
        // So does ［隠す］, for words chosen before the keyboard went away:
        // they are covered in the text box, focused within the tap.
        await text.evaluate((field) => field.setSelectionRange(0, 2));
        await expect(hide).toBeVisible();
        await text.evaluate((field) => field.blur());
        await expect(hide).toBeVisible();
        await forgetFocus(page);
        await hide.tap();
        await expect(text).toHaveValue("||犯人||は||庭師||だった。");
        await expectKeyboardUp(page, text, "隠す, the keyboard put away");
        await text.fill("");
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      },
    );
    await check(
      "393px phone: the post sheet's buttons sit just above the keyboard",
      async () => {
        await go("/timeline/");
        await fab.tap();
        await expectKeyboardUp(page, text, "open");
        const near = (now, want, label) =>
          expect(
            Math.abs(now - want),
            `${label}: ${now}, not ${want}`,
          ).toBeLessThan(2);
        const send = dialog.getByRole("button", { name: "投稿する" });
        /** 投稿する in what is seen, and what a tap there reaches. */
        const reachable = async (top, bottom) => {
          const at = await send.evaluate((button) => {
            const box = button.getBoundingClientRect();
            const there = document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            return {
              top: box.top,
              bottom: box.bottom,
              hit: Boolean(there && button.contains(there)),
            };
          });
          expect(at.top).toBeGreaterThanOrEqual(top);
          expect(at.bottom).toBeLessThanOrEqual(bottom);
          expect(at.hit, "a tap on 投稿する reaches it").toBe(true);
        };
        // A keyboard 336px tall, with the page pushed 120px up: the sheet
        // is what is left, the title at its top, the buttons on the keyboard.
        await page.evaluate(() => window.__keyboard(336, 120));
        let place = await toolbarPlace(dialog);
        near(place.bottom, 577, "the buttons' bottom");
        near(place.top, 120, "the sheet's top");
        expect(
          await page.evaluate(() => document.documentElement.dataset.keyboard),
        ).toBe("up");
        await reachable(120, 577);
        // Long words scroll between them; the buttons stay.
        await text.fill(
          Array.from({ length: 30 }, (_, at) => `${at + 1}行目`).join("\n"),
        );
        place = await toolbarPlace(dialog);
        near(place.bottom, 577, "long words: the buttons' bottom");
        near(place.top, 120, "long words: the sheet's top");
        await reachable(120, 577);
        // The keyboard put away: the whole screen again.
        await page.evaluate(() => window.__keyboard(0));
        near((await toolbarPlace(dialog)).bottom, 793, "no keyboard");
        // A phone may still report its keyboard after the field let go (iOS
        // 26.0): with no field focused, the sheet keeps the whole screen.
        await page.evaluate(() => window.__keyboard(336, 0));
        near((await toolbarPlace(dialog)).bottom, 457, "the keyboard again");
        await text.evaluate((field) => field.blur());
        await expect
          .poll(async () => Math.round((await toolbarPlace(dialog)).bottom))
          .toBe(793);
        await page.evaluate(() => window.__keyboard(0));
        await text.fill("");
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      },
    );
    await check(
      "393px phone: a 便り's reply sheet opens with its text box ready, its buttons just above the keyboard",
      async () => {
        await go("/timeline/");
        // A tap on the card opens its page; the reply bar, the sheet.
        await card("凪", "十年ぶりに再読").locator(".letter-text").tap();
        const letter = letterPage("凪");
        await expect(letter).toBeVisible();
        await forgetFocus(page);
        await letter.getByRole("button", { name: "凪さんに返信" }).tap();
        const sheet = page.getByRole("dialog", { name: "返信", exact: true });
        const reply = sheet.locator("textarea");
        // The fifth writing screen: focused within the tap, at 16px.
        await expectKeyboardUp(page, reply, "返信");
        await expectNoZoomOnFocus(reply, "返信");
        await page.keyboard.type("指で返信");
        await expect(reply).toHaveValue("指で返信");
        await page.evaluate(() => window.__keyboard(336, 120));
        const place = await toolbarPlace(sheet);
        expect(
          Math.abs(place.bottom - 577),
          "the buttons' bottom",
        ).toBeLessThan(2);
        expect(Math.abs(place.top - 120), "the sheet's top").toBeLessThan(2);
        await page.evaluate(() => window.__keyboard(0));
        await reply.fill("");
        // One Escape closes the sheet; the 便り's page stays under it.
        await page.keyboard.press("Escape");
        await expect(sheet).toHaveCount(0);
        await expect(letter).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(letter).toHaveCount(0);
      },
    );
    await check(
      "393px phone: the post sheet holds what is used: 隠す while words are chosen, ネタバレあり with a book, ポスターを作る beside 本を添える",
      async () => {
        await go("/timeline/");
        await fab.tap();
        await expectKeyboardUp(page, text, "open");
        const toolbar = dialog.locator(".writing-toolbar");
        const spoiler = dialog.getByRole("checkbox", { name: "ネタバレあり" });
        // No row of tags and no lines of help: a #word in the words is a
        // tag, as before.
        await expect(dialog.locator(".tag-chip")).toHaveCount(0);
        await expect(dialog.getByText("タグ", { exact: true })).toHaveCount(0);
        await expect(dialog).not.toContainText("#ことば");
        await expect(spoiler).toHaveCount(0);
        await expect(hide).toHaveCount(0);
        await page.keyboard.type("犯人は庭師だった。");
        await expect(hide).toHaveCount(0);
        await expect(dialog).not.toContainText("このブラウザに保存");
        // The keyboard up and words chosen: ［隠す］ comes in the toolbar,
        // on the keyboard, in its one row (the words keep their room), and
        // a tap there reaches it.
        await page.evaluate(() => window.__keyboard(336, 120));
        await countBlurs();
        const { height } = await toolbar.boundingBox();
        await text.evaluate((field) => field.setSelectionRange(3, 5));
        await expect(
          toolbar.getByRole("button", { name: "選んだ言葉を隠す" }),
        ).toBeVisible();
        await expect(hide).toHaveText("隠す");
        expect((await toolbar.boundingBox()).height).toBe(height);
        const place = await toolbarPlace(dialog);
        expect(Math.abs(place.bottom - 577)).toBeLessThan(2);
        const at = await hide.evaluate((button) => {
          const box = button.getBoundingClientRect();
          const there = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          return {
            top: box.top,
            bottom: box.bottom,
            hit: Boolean(there && button.contains(there)),
          };
        });
        expect(at.top).toBeGreaterThanOrEqual(120);
        expect(at.bottom).toBeLessThanOrEqual(577);
        expect(at.hit, "a tap on 隠す reaches it").toBe(true);
        // The words let go of, it goes; chosen again, it comes back.
        await text.evaluate((field) => field.setSelectionRange(9, 9));
        await expect(hide).toHaveCount(0);
        await text.evaluate((field) => field.setSelectionRange(3, 5));
        await expect(hide).toBeVisible();
        // Pressed: just those words are covered, the text box never lets
        // the focus go, and the caret goes on after them, so ［隠す］ goes.
        await hide.tap();
        await expect(text).toHaveValue("犯人は||庭師||だった。");
        await expect(text).toBeFocused();
        expect(await blurs(), "the text box let the focus go").toBe(0);
        expect(
          await text.evaluate((field) => [
            field.selectionStart,
            field.selectionEnd,
          ]),
        ).toEqual([9, 9]);
        await expect(hide).toHaveCount(0);
        await expect(dialog.getByText("「||」で囲んだ言葉は")).toHaveCount(0);
        // ポスターを作る: in the toolbar, right after 本を添える, in its row.
        const book = toolbar.getByRole("button", { name: "本を添える" });
        const poster = toolbar.getByRole("button", { name: "ポスターを作る" });
        await expect(
          toolbar.locator(".composer-book + .composer-poster"),
        ).toHaveAccessibleName("ポスターを作る");
        const [bookBox, posterBox] = [
          await book.boundingBox(),
          await poster.boundingBox(),
        ];
        expect(Math.abs(bookBox.y - posterBox.y)).toBeLessThan(2);
        expect(posterBox.x).toBeGreaterThan(bookBox.x + bookBox.width);
        // ネタバレあり comes with a book, in the toolbar, and goes with it.
        await book.tap();
        await page.keyboard.type("モモ");
        await dialog.getByRole("button", { name: /^モモ/ }).first().tap();
        await expect(
          toolbar.getByRole("checkbox", { name: "ネタバレあり" }),
        ).toBeVisible();
        await expect(spoiler).toBeEnabled();
        await dialog.getByRole("button", { name: "モモを外す" }).tap();
        await expect(spoiler).toHaveCount(0);
        // ポスターを作る leaves the sheet for the poster's own page; the
        // words wait in the draft.
        await page.evaluate(() => window.__keyboard(0));
        await poster.tap();
        await expect(dialog).toHaveCount(0);
        await expect(page).toHaveURL(/\/posters\/new\/$/);
        await expect(
          page.getByRole("heading", { name: "ポスターを作る", level: 1 }),
        ).toBeVisible();
        await go("/timeline/");
        await fab.tap();
        await expect(text).toHaveValue("犯人は||庭師||だった。");
        await text.fill("");
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      },
    );
    await check(
      "393px phone: ネタバレあり tapped during a kana conversion ends it, and the words stay",
      async () => {
        await go("/timeline/");
        await fab.tap();
        await expectKeyboardUp(page, text, "open");
        // A book first, for ネタバレあり to be there.
        await dialog.getByRole("button", { name: "本を添える" }).tap();
        await page.keyboard.type("モモ");
        await dialog.getByRole("button", { name: /^モモ/ }).first().tap();
        await expect(text).toBeFocused();
        const spoiler = dialog.getByRole("checkbox", { name: "ネタバレあり" });
        await page.evaluate(() => {
          window.__ended = 0;
          document.addEventListener(
            "compositionend",
            () => window.__ended++,
            true,
          );
        });
        const cdp = await context.newCDPSession(page);
        try {
          await cdp.send("Input.imeSetComposition", {
            text: "にほん",
            selectionStart: 3,
            selectionEnd: 3,
          });
          await spoiler.tap();
        } finally {
          await cdp.detach();
        }
        expect(await page.evaluate(() => window.__ended)).toBe(1);
        await expect(text).toBeFocused();
        await expect(text).toHaveValue("にほん");
        await expect(spoiler).toBeChecked();
        await dialog.getByRole("button", { name: "モモを外す" }).tap();
        await text.fill("");
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      },
    );
    await check(
      "393px phone: outside writing screens, covered words and drafts thrown away leave the keyboard down; a review opens ready to write, every way in",
      async () => {
        // A review thrown away on the book's page, outside any sheet: the
        // keyboard stays down, and the focus stays with the review (its
        // form), not back at the top of the page.
        await go("/books/momo/");
        const momo = page.locator(".book-reviews");
        const momoText = momo.locator("textarea");
        const momoForm = momo.locator("form.post-composer");
        await momoText.fill("消える感想。");
        await reload();
        await momo.getByRole("button", { name: "書きかけを消す" }).tap();
        await momo.getByRole("button", { name: "消す", exact: true }).tap();
        await expect(momoText).toHaveValue("");
        await expectNoKeyboard(page, "review thrown away", momoForm);
        // ［隠す］ waits for words chosen. Typing, the words chosen are
        // covered there, and the text box is still theirs.
        const momoHide = momo.getByRole("button", { name: "選んだ言葉を隠す" });
        await expect(momoHide).toHaveCount(0);
        await expectTapWrites(momoText);
        await momoText.fill("犯人は庭師だった。");
        await expect(momoHide).toHaveCount(0);
        await momoText.evaluate((field) => field.setSelectionRange(3, 5));
        await momoHide.tap();
        await expect(momoText).toHaveValue("犯人は||庭師||だった。");
        await expect(momoText).toBeFocused();
        // Words chosen, then the keyboard put away: they are covered, and
        // the keyboard stays down.
        await momoText.evaluate((field) => field.setSelectionRange(0, 2));
        await expect(momoHide).toBeVisible();
        await momoText.evaluate((field) => field.blur());
        await momoHide.tap();
        await expect(momoText).toHaveValue("||犯人||は||庭師||だった。");
        await expectNoKeyboard(page, "隠す, the keyboard put away");
        await momoText.fill("");

        // A review with words of its own, and a line written while reading.
        await go("/books/ten-nights/");
        const reviews = page.locator(".book-reviews");
        await reviews.locator("textarea").fill("前から書いていた感想。");
        await go("/reading/");
        // A picker shown on the page is named by its search alone: it is
        // not wrapped in a group of the same name.
        await expect(
          page.getByRole("group", { name: "読む本を探す" }),
        ).toHaveCount(0);
        // 夢十夜 alone; read again, the book read last is chosen already.
        const read = async () => {
          const search = page.getByRole("searchbox", { name: "読む本を探す" });
          if (await search.count()) {
            await search.fill("夢十夜");
            await page.getByRole("button", { name: /^夢十夜/ }).tap();
          }
          await expect(page.locator(".picker-chosen")).toContainText("夢十夜");
          await page.getByRole("button", { name: /一人で読む/ }).tap();
          await page
            .getByRole("dialog", { name: "読書をはじめますか？" })
            .getByRole("button", { name: "本を開く", exact: true })
            .tap();
        };
        await read();
        const memo = page.getByLabel("読書メモ（自分だけ）");
        // The memo thrown away after a reload: the keyboard stays down.
        await memo.fill("消える一行。");
        await reload();
        await page.getByRole("button", { name: "書きかけを消す" }).tap();
        await page.getByRole("button", { name: "消す", exact: true }).tap();
        await expect(memo).toHaveValue("");
        await expectNoKeyboard(
          page,
          "memo thrown away",
          page.locator("form.memo-composer"),
        );
        // 読書を終える, then 感想を書く: the review is a writing screen,
        // ready within the tap.
        await memo.fill("三夜目の一行。");
        await page.getByRole("button", { name: "読書を終える" }).tap();
        await forgetFocus(page);
        await page
          .getByRole("dialog", { name: "読書を終えますか？" })
          .getByRole("button", { name: "感想を書く" })
          .tap();
        const review = page.getByRole("dialog", { name: "『夢十夜』の感想" });
        const reviewText = review.locator("textarea");
        await expectKeyboardUp(page, reviewText, "感想を書く");
        // ［書き足す］ adds the line; the text box keeps the focus, in view.
        await review.getByRole("button", { name: "書き足す" }).tap();
        await expect(reviewText).toHaveValue(
          "前から書いていた感想。\n三夜目の一行。",
        );
        await expect(reviewText).toBeFocused();
        await expect(reviewText).toBeInViewport();
        await page.keyboard.press("Escape");
        await expect(review).toHaveCount(0);
        // The book closed with a line not sent: the closing card's 感想を書く
        // and the line's 感想に使う open the review ready too.
        await read();
        await memo.fill("四夜目の一行。");
        await page.getByRole("button", { name: "読書を終える" }).tap();
        await page
          .getByRole("dialog", { name: "読書を終えますか？" })
          .getByRole("button", { name: "本を閉じる" })
          .tap();
        await forgetFocus(page);
        await page.getByRole("button", { name: "感想を書く" }).tap();
        await expectKeyboardUp(page, reviewText, "the closing card");
        await page.keyboard.press("Escape");
        await expect(review).toHaveCount(0);
        await forgetFocus(page);
        await page.getByRole("button", { name: "感想に使う" }).tap();
        await expectKeyboardUp(page, reviewText, "a line not sent");
        await page.keyboard.press("Escape");
        await expect(review).toHaveCount(0);
      },
    );
    await check(
      "393px phone: the post sheet stays as it was opened when the main pointer changes",
      async () => {
        await go("/timeline/");
        await fab.tap();
        await expectKeyboardUp(page, text, "open");
        await page.keyboard.type("指で");
        await dialog.getByRole("button", { name: "本を添える" }).tap();
        const search = dialog.getByRole("searchbox", {
          name: "添える本を探す",
        });
        await expect(search).toBeFocused();
        await dialog.evaluate((sheet) => {
          window.__sheet = sheet;
        });
        const same = () => dialog.evaluate((sheet) => sheet === window.__sheet);
        // A tablet's keyboard put on and taken off again: the sheet is not
        // made anew, so the book's search is still there, still focused.
        // (The session that stands in for the change is kept to the end:
        // leaving it takes the finger away again.)
        const cdp = await context.newCDPSession(page);
        try {
          await cdp.send("Emulation.setTouchEmulationEnabled", {
            enabled: false,
          });
          await expect.poll(() => coarse(page)).toBe(false);
          expect(await same(), "the sheet was made anew").toBe(true);
          await expect(search).toBeFocused();
          await cdp.send("Emulation.setTouchEmulationEnabled", {
            enabled: true,
            maxTouchPoints: 1,
          });
          await expect.poll(() => coarse(page)).toBe(true);
          expect(await same(), "the sheet was made anew").toBe(true);
          await expect(search).toBeFocused();
          // And it still fits what the keyboard leaves.
          await text.tap();
          await page.evaluate(() => window.__keyboard(336, 120));
          const place = await toolbarPlace(dialog);
          expect(Math.abs(place.bottom - 577)).toBeLessThan(2);
          expect(Math.abs(place.top - 120)).toBeLessThan(2);
        } finally {
          await cdp.detach();
        }
        await page.evaluate(() => window.__keyboard(0));
        await text.fill("");
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      },
    );
    await context.close();
  }
  {
    // A phone on its side: the keyboard leaves it about 200px.
    const context = await browser.newContext({
      viewport: { width: 852, height: 393 },
      isMobile: true,
      hasTouch: true,
    });
    await watchFocus(context);
    await fakeKeyboard(context);
    page = settleBeforeNavigating(await context.newPage());
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await followEveryShop();
    await check(
      "852px phone on its side: with the keyboard up, the words being written and 投稿する are both in sight",
      async () => {
        expect(await coarse(page)).toBe(true);
        await go("/timeline/");
        await page.locator(".compose-fab").tap();
        const dialog = page.getByRole("dialog", { name: "投稿する" });
        const text = dialog.locator("textarea");
        await expectKeyboardUp(page, text, "投稿する");
        await page.keyboard.type("横向きで書く");
        /** Where it is against what is seen, and what a tap at `y` reaches. */
        const sight = (locator) =>
          locator.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const toolbar = element
              .closest('[role="dialog"]')
              .querySelector(".writing-toolbar")
              .getBoundingClientRect();
            const viewport = window.visualViewport;
            const reaches = (y) => {
              const there = document.elementFromPoint(box.x + box.width / 2, y);
              return Boolean(there && element.contains(there));
            };
            return {
              top: box.top,
              bottom: box.bottom,
              seenTop: viewport.offsetTop,
              seenBottom: viewport.offsetTop + viewport.height,
              toolbarTop: toolbar.top,
              middle: reaches(box.top + box.height / 2),
              firstLines: reaches(box.top + 20),
            };
          });
        for (const height of [160, 180, 200]) {
          await page.evaluate((height) => window.__keyboard(height), height);
          const label = `a keyboard ${height}px tall`;
          // The text box: its first lines over the buttons, a tap there on it.
          const words = await sight(text);
          expect(words.top, label).toBeGreaterThanOrEqual(words.seenTop);
          expect(words.top + 40, label).toBeLessThanOrEqual(words.toolbarTop);
          expect(words.firstLines, `${label}: the text box`).toBe(true);
          // 投稿する: whole in sight, a tap on it reaching it.
          const send = await sight(
            dialog.getByRole("button", { name: "投稿する" }),
          );
          expect(send.top, label).toBeGreaterThanOrEqual(send.seenTop);
          expect(send.bottom, label).toBeLessThanOrEqual(send.seenBottom);
          expect(send.middle, `${label}: 投稿する`).toBe(true);
          if (height === 180)
            await page.screenshot({
              path: path.join(output, "social-phone-on-its-side.png"),
            });
        }
        await page.evaluate(() => window.__keyboard(0));
        await text.fill("");
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      },
    );
    await context.close();
  }
  await check(
    "No hydration errors, uncaught exceptions or console errors",
    async () => {
      expect(errors).toEqual([]);
    },
  );
  await writeFile(
    path.join(output, "social-results.json"),
    JSON.stringify({ baseURL, passed, errors }, null, 2),
  );
} catch (error) {
  await page
    ?.screenshot({
      path: path.join(output, "social-failure.png"),
      fullPage: true,
    })
    .catch(() => {});
  await writeFile(
    path.join(output, "social-results.json"),
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
