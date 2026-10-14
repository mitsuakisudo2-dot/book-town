import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { settleBeforeNavigating } from "./journey-layers.mjs";
import { expectReadable } from "./journey-contrast.mjs";
import {
  coarse,
  expectKeyboardUp,
  expectNoKeyboard,
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
const card = (author, text) =>
  page
    .locator("main article.post-card:not(.is-reply)")
    .filter({ has: page.getByRole("link", { name: author, exact: true }) })
    .filter({ hasText: text });
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

    await check(
      `${label} timeline is in the navigation and hides spoilers`,
      async () => {
        await go("/timeline/");
        const nav = page.locator(
          viewport.width > 760 ? ".town-sidebar nav" : ".town-bottom-nav",
        );
        await expect(nav.getByRole("link", { name: "ホーム" })).toHaveClass(
          /active/,
        );
        await expect(
          page
            .getByRole("navigation", { name: "ホームの表示" })
            .getByRole("link", { name: "タイムライン" }),
        ).toHaveAttribute("aria-current", "page");
        await expect(card("すみれ", "二駅乗り過ごした")).toBeVisible();
        await expect(card("凪", "十年ぶりに再読")).toBeVisible();
        await expect(page.getByText("最後の数章を読んだ夜は")).toHaveCount(0);
        await expect(page.getByText("あの終わり方でなければ")).toHaveCount(0);
        await noOverflow(`${label} timeline`);
        await page.screenshot({
          caret: "initial",
          path: path.join(output, `timeline-${viewport.width}.png`),
          fullPage: true,
        });
      },
    );

    await check(
      `${label} a post with a book reaches the timeline and the book page`,
      async () => {
        // Posted from home, it lands on the timeline with its toast.
        await go("/");
        await compose("灰色の男たちが怖かった。時間の使い方を考え直した。", {
          book: "モモ",
        });
        await expect(page).toHaveURL(/\/timeline\/$/);
        await expect(page.locator(".toast")).toHaveText(
          "タイムラインと作品ページに投稿しました",
        );
        const mine = card("あなた", "灰色の男たち");
        await expect(mine).toBeVisible();
        // The post just written glows once where it lands.
        await expect(mine).toHaveClass(/is-arriving/);
        await expect(mine.getByRole("link", { name: /モモ/ })).toBeVisible();
        await expect(
          page.locator("main article.post-card").first(),
        ).toContainText("灰色の男たち");
        await mine.getByRole("link", { name: /モモ/ }).click();
        await expect(
          page.getByRole("heading", { name: "この本のレビュー" }),
        ).toBeVisible();
        await expect(card("あなた", "灰色の男たち")).toBeVisible();
      },
    );

    await check(
      `${label} spoiler posts are covered on the timeline and wait behind the book page door`,
      async () => {
        await go("/timeline/");
        await compose("ラストの一行で、すべての章がつながった。", {
          book: "沈黙",
          spoiler: true,
        });
        // On the timeline the post is there, covered until the reader chooses to see it.
        await expect(page.getByText("ラストの一行で")).toHaveCount(0);
        const covered = card("あなた", "沈黙");
        await expect(covered).toContainText("ネタバレを含むため、隠しています");
        await covered.getByRole("button", { name: "表示する" }).click();
        await expect(covered).toContainText("ラストの一行で");
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
        await text.fill("読み終えて驚いた。犯人は庭師だった。");
        await text.evaluate((field) => {
          const start = field.value.indexOf("庭師");
          field.setSelectionRange(start, start + 2);
        });
        await dialog.getByRole("button", { name: "一部を隠す" }).click();
        await expect(text).toHaveValue(
          "読み終えて驚いた。犯人は||庭師||だった。",
        );
        await expect(text).toBeFocused();
        await expect(dialog.getByText("「||」で囲んだ言葉は")).toBeVisible();
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
      `${label} 読みたくなった saves the book and remembers who inspired it`,
      async () => {
        await go("/timeline/");
        const post = card("すみれ", "どこから開いてもいい本");
        const want = post.getByRole("button", { name: /読みたくなった/ });
        await expect(want).toHaveAttribute("aria-pressed", "false");
        await want.click();
        await expect(want).toHaveAttribute("aria-pressed", "true");
        // How many readers wanted it is the writer's to know, not ours.
        await expect(want).toHaveText("読みたくなった");
        await expect(post.getByRole("button", { name: /いいね/ })).toHaveText(
          "いいね",
        );
        await go("/books/invisible-cities/");
        await expect(
          page.getByText("すみれさんの感想で、読みたくなった本です。"),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "読みたいに登録済み" }),
        ).toBeVisible();
      },
    );

    await check(
      `${label} a like is pressed again, up to ten, and taken back from the menu`,
      async () => {
        await go("/timeline/");
        const post = card("すみれ", "二駅乗り過ごした");
        const like = post.getByRole("button", { name: /いいね/ });
        for (let press = 0; press < 3; press += 1) await like.click();
        await expect(like).toHaveAttribute("aria-pressed", "true");
        await expect(like).toHaveText("いいね3回");
        for (let press = 0; press < 8; press += 1) await like.click();
        await expect(like).toHaveText("いいね10回");
        await expect(page.locator(".toast")).toHaveText(
          "いいねは10回まで重ねられます",
        );
        await post.getByRole("button", { name: "その他の操作" }).click();
        await post.getByRole("button", { name: "いいねを取り消す" }).click();
        await expect(like).toHaveAttribute("aria-pressed", "false");
        await expect(like).toHaveText("いいね");
      },
    );

    await check(
      `${label} reviews hold conversations and replies can recommend a book`,
      async () => {
        await go("/books/solaris/");
        const review = card("凪", "十年ぶりに再読");
        await review.getByRole("button", { name: "返信 2件" }).click();
        await expect(review.locator(".post-card.is-reply")).toHaveCount(2);
        await expect(
          review
            .locator(".post-card.is-reply")
            .nth(1)
            .getByRole("link", { name: /闇の左手/ }),
        ).toBeVisible();
        const reply = review.locator("form.post-composer.is-reply");
        await reply.locator("textarea").fill("海の描写、わたしも好きです。");
        await reply
          .getByRole("button", { name: "おすすめの本を添える" })
          .click();
        await pickBook(reply, "見えない都市");
        await reply.getByRole("button", { name: "返信する" }).click();
        await expect(review.locator(".post-card.is-reply")).toHaveCount(3);
        await expect(
          review.getByRole("button", { name: "返信 3件" }),
        ).toBeVisible();
        await page.reload();
        await page.waitForFunction(() => localStorage.getItem("book-town-v1"));
        const again = card("凪", "十年ぶりに再読");
        await again.getByRole("button", { name: "返信 3件" }).click();
        await expect(
          again.getByText("海の描写、わたしも好きです。"),
        ).toBeVisible();
      },
    );

    await check(
      `${label} reporting a possible spoiler covers it on the timeline`,
      async () => {
        await go("/timeline/");
        const post = card("栞", "美術館の帰りに");
        // Reporting waits behind "…", out of sight of whoever is writing.
        await expect(
          post.getByRole("button", { name: "ネタバレでは？" }),
        ).toHaveCount(0);
        await post.getByRole("button", { name: "その他の操作" }).click();
        await post.getByRole("button", { name: "ネタバレでは？" }).click();
        await expect(card("栞", "美術館の帰りに")).toHaveCount(0);
        const reported = card("栞", "ネタバレの可能性を報告済み");
        await expect(
          reported.getByRole("button", { name: "表示する" }),
        ).toBeVisible();
        await go("/books/ways-of-seeing/");
        await page
          .getByRole("button", { name: /ネタバレありのレビュー（1件）/ })
          .click();
        const hidden = card("栞", "");
        await expect(
          hidden.getByText("ネタバレの可能性を報告済み"),
        ).toBeVisible();
        await hidden.getByRole("button", { name: "報告を取り消す" }).click();
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
        await expect(page.getByRole("heading", { name: "投稿" })).toBeVisible();
        await expect(card("凪", "十年ぶりに再読")).toBeVisible();
        await expect(page.getByText("最後の数章を読んだ夜は")).toHaveCount(0);
        await go("/profiles/me/");
        await expect(card("あなた", "灰色の男たち")).toBeVisible();
        const own = card("あなた", "灰色の男たち");
        await own.getByRole("button", { name: "削除", exact: true }).click();
        await own.getByRole("button", { name: "やめる" }).click();
        await expect(own).toBeVisible();
        await own.getByRole("button", { name: "削除", exact: true }).click();
        await own.getByRole("button", { name: "削除する" }).click();
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
        // By default a marked post or poster is folded, in its place.
        await expect(page.locator(".social-note")).toContainText(
          "ネタバレの印が付いた投稿とポスター、3人以上が「ネタバレでは？」と言った投稿は、たたんでいます",
        );
        await expect(page.locator("main .spoiler-cover").first()).toBeVisible();
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
          name: "読み終えた本の記録（これから残す記録）",
        });
        await expect(records.getByRole("radio").first()).toBeChecked();
        await expect(records.getByLabel("自分だけ")).toBeChecked();
        await display
          .getByLabel("ネタバレの印があるもの・可能性があるものは出さない")
          .check();
        await expect(page.locator(".toast")).toContainText(
          "ネタバレの印があるもの・可能性があるものは、出さないようにします",
        );
        await noOverflow(`${label} settings`);
        await page.screenshot({
          caret: "initial",
          path: path.join(output, `settings-spoilers-${viewport.width}.png`),
        });
        await page.keyboard.press("Escape");
        expect((await stored()).settings.spoilerDisplay).toBe("leave_out");
        await go("/timeline/");
        await expect(page.locator(".social-note")).toHaveText(
          "ネタバレの印が付いた投稿とポスター、その可能性がある投稿は、設定により出していません。",
        );
        // Others' marked posts are left out; the reader's own never are.
        for (const title of ["闇の左手", "銀河鉄道の夜"])
          await expect(
            page.locator("main .spoiler-cover", { hasText: title }),
          ).toHaveCount(0);
        await expect(
          card("あなた", "").locator(".spoiler-cover").first(),
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
        expect((await own()).isPublic).toBe(true);
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
        expect((await own()).isPublic).toBe(false);
        // Publishing one record later is one quiet tap on the book page.
        const mine = page.locator(".book-feelings-own");
        await mine.getByRole("button", { name: "公開する" }).click();
        await expect(toast).toContainText("公開しました");
        expect((await own()).isPublic).toBe(true);
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
        expect((await own()).isPublic).toBe(false);
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
          .getByRole("button", { name: "はじめる", exact: true })
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
            .getByRole("button", { name: "はじめる", exact: true })
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
            .map(({ note, isPublic }) => ({ note, isPublic })),
        ).toEqual([{ note: "湖の音と、豆畑。", isPublic: true }]);
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
      `${label} following nobody yet, the timeline suggests owners with POPs`,
      async () => {
        await go("/timeline/");
        await page
          .getByRole("group", { name: "投稿の表示範囲" })
          .getByRole("button", { name: "フォロー中" })
          .click();
        const suggestions = page.getByRole("region", {
          name: "フォローすると、その店主の投稿がここに届きます",
        });
        await expect(suggestions.getByRole("listitem")).toHaveCount(3);
        await expect(suggestions).toContainText("POP：");
        await expect(suggestions).not.toContainText(/\d+人/);
        await suggestions
          .getByRole("button", { name: "フォロー" })
          .first()
          .click();
        await expect(suggestions).toHaveCount(0);
        await expect(page.locator(".post-card").first()).toBeVisible();
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
        expect(
          await dialog
            .locator(".composer-tools")
            .evaluate((tools) => getComputedStyle(tools).position),
        ).toBe("static");
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
    const fab = page.locator(".compose-fab");
    const dialog = page.getByRole("dialog", { name: "投稿する" });
    const text = dialog.locator("textarea");
    const chip = dialog
      .getByRole("button", { name: /^タグ「.+」を付ける$/ })
      .first();
    await check(
      "393px phone: the post sheet opens with its text box ready and the keyboard up; the feelings sheet waits for a tap",
      async () => {
        expect(await coarse(page)).toBe(true);
        await go("/timeline/");
        // The text box has the focus, given within the tap that opened the
        // sheet, so a phone's keyboard rises with it: typing goes in.
        await fab.tap();
        await expectKeyboardUp(page, text, "投稿する");
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
        // 書きかけを消す asks, with the focus on its answer (the keyboard may
        // go down meanwhile); 消す gives the text box the focus again.
        await dialog.getByRole("button", { name: "書きかけを消す" }).tap();
        await expect(
          dialog.getByRole("button", { name: "残す" }),
        ).toBeFocused();
        await forgetFocus(page);
        await dialog.getByRole("button", { name: "消す", exact: true }).tap();
        await expect(text).toHaveValue("");
        await expectKeyboardUp(page, text, "draft thrown away");
        await page.keyboard.type("犯人は庭師だった。");
        // How often the text box lost the focus: each time, a phone's
        // keyboard would go down, even for a moment.
        await text.evaluate((field) => {
          window.__blurs = 0;
          field.addEventListener("blur", () => window.__blurs++);
        });
        const blurs = () => page.evaluate(() => window.__blurs);
        // A tag, and the title: the text box keeps the focus.
        await chip.tap();
        await expect(text).toBeFocused();
        await expect(text).toHaveValue(/^犯人は庭師だった。 #\S+ $/);
        await dialog.getByRole("heading", { name: "投稿する" }).tap();
        await expect(text).toBeFocused();
        // ［一部を隠す］ covers the words chosen, there in the text box.
        await text.evaluate((field) => field.setSelectionRange(3, 5));
        await dialog.getByRole("button", { name: "一部を隠す" }).tap();
        await expect(text).toHaveValue(/^犯人は\|\|庭師\|\|だった。/);
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
      "393px phone: a tag tapped during a kana conversion ends it, and the words stay",
      async () => {
        await go("/timeline/");
        await fab.tap();
        await expectKeyboardUp(page, text, "open");
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
          await chip.tap();
        } finally {
          await cdp.detach();
        }
        expect(await page.evaluate(() => window.__ended)).toBe(1);
        await expect(text).toBeFocused();
        await expect(text).toHaveValue(/^にほん #\S+ $/);
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
        // ［一部を隠す］ in a field not tapped yet: the place to write in is
        // made, and the keyboard stays down.
        await momo.getByRole("button", { name: "一部を隠す" }).tap();
        await expect(momoText).toHaveValue("||隠したい言葉||");
        await expectNoKeyboard(page, "一部を隠す", momoForm);
        // Typing in it, the words chosen are covered there, still theirs.
        await expectTapWrites(momoText);
        await momoText.fill("犯人は庭師だった。");
        await momoText.evaluate((field) => field.setSelectionRange(3, 5));
        await momo.getByRole("button", { name: "一部を隠す" }).tap();
        await expect(momoText).toHaveValue("犯人は||庭師||だった。");
        await expect(momoText).toBeFocused();
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
            .getByRole("button", { name: "はじめる", exact: true })
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
