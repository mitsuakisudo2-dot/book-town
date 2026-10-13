import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { settleBeforeNavigating } from "./journey-layers.mjs";
import { expectReadable } from "./journey-contrast.mjs";

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
