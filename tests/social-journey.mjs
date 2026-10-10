import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/social-qa",
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
    page = await context.newPage();
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
          path: path.join(output, `timeline-${viewport.width}.png`),
          fullPage: true,
        });
      },
    );

    await check(
      `${label} a post with a book reaches the timeline and the book page`,
      async () => {
        await compose("灰色の男たちが怖かった。時間の使い方を考え直した。", {
          book: "モモ",
        });
        const mine = card("あなた", "灰色の男たち");
        await expect(mine).toBeVisible();
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
      `${label} 読みたくなった saves the book and remembers who inspired it`,
      async () => {
        await go("/timeline/");
        const post = card("すみれ", "どこから開いてもいい本");
        const want = post.getByRole("button", { name: /読みたくなった/ });
        await expect(want).toHaveAttribute("aria-pressed", "false");
        await want.click();
        await expect(want).toHaveAttribute("aria-pressed", "true");
        await expect(want).toContainText("6");
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
        path: path.join(output, `book-reviews-${viewport.width}.png`),
        fullPage: true,
      });
    });
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
