import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { settleBeforeNavigating } from "./journey-layers.mjs";
import { expectReadable } from "./journey-contrast.mjs";

const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/app-qa",
);
await mkdir(output, { recursive: true });
// Uses Playwright's own Chromium unless BOOK_TOWN_CHROME names another browser.
const browser = await chromium.launch({
  executablePath: process.env.BOOK_TOWN_CHROME || undefined,
  headless: true,
});
const errors = [];
const passed = [];
const GOOGLE_ISBN = "9784101092058";
const OPENBD_ISBN = "9784003101018";
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
    document: document.documentElement.scrollWidth,
  }));
  expect(size.document, `${label}: overflow`).toBeLessThanOrEqual(
    size.width + 1,
  );
}
/** Dispatches a one-finger horizontal swipe that starts on the given element. */
async function swipe(locator, dx) {
  await locator.evaluate((element, delta) => {
    const box = element.getBoundingClientRect();
    const start = {
      identifier: 1,
      target: element,
      clientX: box.left + box.width / 2,
      clientY: box.top + Math.min(box.height / 2, 40),
    };
    const first = new Touch(start);
    const last = new Touch({ ...start, clientX: start.clientX + delta });
    element.dispatchEvent(
      new TouchEvent("touchstart", {
        bubbles: true,
        touches: [first],
        changedTouches: [first],
      }),
    );
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
  }, dx);
}
/** Answers the reading confirmation and checks it greeted the reader with a phrase. */
async function confirmIn(title, answer) {
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog.locator(".reading-confirm-phrase")).not.toBeEmpty();
  await dialog.getByRole("button", { name: answer, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
const stored = () =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem("book-town-v1") ?? "{}").data,
  );

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  page = settleBeforeNavigating(await context.newPage());
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // The ISBN lookups and covers are answered locally so the test never
  // depends on the network. openBD has the cover of 表紙のある本; Google
  // Books has the one of QAの本.
  await page.route("https://api.openbd.jp/**", (route) => {
    const isbns = new URL(route.request().url()).searchParams
      .get("isbn")
      .split(",");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        isbns.map((isbn) =>
          isbn === OPENBD_ISBN
            ? {
                summary: {
                  isbn,
                  title: "表紙のある本",
                  author: "試験 花子／著",
                  cover: `https://cover.openbd.jp/${isbn}.jpg`,
                },
              }
            : { summary: { isbn, title: "QAの本", author: "試験 太郎／著" } },
        ),
      ),
    });
  });
  await page.route("https://www.googleapis.com/books/**", (route) => {
    const isbn = new URL(route.request().url()).searchParams
      .get("q")
      .replace("isbn:", "");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        isbn === GOOGLE_ISBN
          ? {
              items: [
                {
                  volumeInfo: {
                    industryIdentifiers: [
                      { type: "ISBN_13", identifier: isbn },
                    ],
                    imageLinks: {
                      thumbnail:
                        "http://books.google.com/books/content?id=qa&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api",
                    },
                    canonicalVolumeLink:
                      "https://books.google.com/books/about/QA.html?id=qa",
                  },
                },
              ],
            }
          : {},
      ),
    });
  });
  const coverImage = await readFile(
    new URL("../public/favicon.ico", import.meta.url),
  );
  await page.route(
    /^https:\/\/(cover\.openbd\.jp|books\.google\.com\/books\/content)/,
    (route) => route.fulfill({ contentType: "image/png", body: coverImage }),
  );

  await check(
    "bottom bar reads home, search, walk, reading, profile",
    async () => {
      await go("/");
      const nav = page.getByRole("navigation", {
        name: "スマートフォンナビゲーション",
      });
      await expect(nav.getByRole("link")).toHaveText([
        "ホーム",
        "検索",
        "書店めぐり",
        "読書を開始",
        "プロフィール",
      ]);
      await expect(nav.getByRole("link", { name: "ホーム" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(
        page
          .getByRole("navigation", { name: "ホームの表示" })
          .getByRole("link"),
      ).toHaveText(["書店", "タイムライン"]);
      await expect(page.getByRole("link", { name: "お知らせ" })).toBeVisible();
      await noOverflow("home");
    },
  );

  await check(
    "swipes on a shelf stay on the shelf; other swipes switch home",
    async () => {
      await go("/");
      const shelf = page.locator(".street-shelf").first();
      await shelf.scrollIntoViewIfNeeded();
      await swipe(shelf, -160);
      await page.waitForTimeout(400);
      await expect(page).toHaveURL(`${baseURL}/`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await swipe(page.locator(".street-intro"), -160);
      await expect(page).toHaveURL(/\/timeline\/$/);
      await expect(
        page.getByRole("heading", { name: "タイムライン" }),
      ).toBeVisible();
      await swipe(page.locator(".page-subtitle"), 160);
      await expect(page).toHaveURL(`${baseURL}/`);
    },
  );

  await check(
    "search finds books and shops, by feeling, talk, shelves and quiet corners",
    async () => {
      await go("/search/");
      await expect(
        page.getByRole("heading", { name: "話題の本" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "多くの棚に並ぶ本" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "棚の隅の本" }),
      ).toBeVisible();
      // Feelings readers kept lead to the books they felt them with.
      const feelings = page.getByRole("group", { name: "気持ち" });
      await feelings.getByRole("button", { name: "誰かと話したい" }).click();
      const felt = page.locator(
        "[aria-labelledby=search-feelings-title] .search-book",
      );
      await expect(felt.filter({ hasText: "ソラリス" })).toHaveCount(1);
      await expect(felt.filter({ hasText: "モモ" })).toContainText(
        "ほか4軒の棚に",
      );
      await expect(page.getByText(/0件|0人|0軒/)).toHaveCount(0);
      await feelings.getByRole("button", { name: "誰かと話したい" }).click();
      await expect(felt).toHaveCount(0);
      const box = page.getByRole("searchbox", { name: "本と書店を検索" });
      await box.fill("ル＝グウィン");
      await expect(page.locator(".search-results .search-book")).toHaveCount(2);
      await box.fill("雨と翻訳");
      await expect(page.locator(".search-results .search-shop")).toHaveCount(1);
      await page.getByRole("link", { name: /雨と翻訳/ }).click();
      await expect(page).toHaveURL(/shops\/shop-rain/);
    },
  );

  await check(
    "a kanji title is found by its reading and romaji, best match first, with no counts",
    async () => {
      await go("/search/");
      const box = page.getByRole("searchbox", { name: "本と書店を検索" });
      const found = page.locator(
        "[aria-labelledby=search-books-title] > ul:not([aria-labelledby]) .search-book",
      );
      for (const typed of ["ぎんがてつどう", "gingatetsudou", "銀河 鉄道"]) {
        await box.fill(typed);
        await expect(found).toHaveCount(1);
        await expect(found.first()).toContainText("銀河鉄道の夜");
      }
      // Found through its reading, the row says how it is read.
      await box.fill("ぎんがてつどう");
      await expect(found.first()).toContainText(
        "よみ：ぎんが てつどう の よる",
      );
      // The title itself first, then titles that hold the word.
      await box.fill("夜");
      await expect(found.nth(0)).toContainText("夜と霧");
      await expect(found).toHaveCount(3);
      // Result headings and rows carry no counts.
      await expect(page.locator(".search-results h2").first()).toHaveText("本");
      await expect(page.locator(".search-results")).not.toContainText(
        /軒の棚に|\d+冊/,
      );
      // Close spellings wait under their own quiet heading, and the page
      // does not say first that nothing was found.
      await box.fill("秘密の森の花園");
      await expect(found).toHaveCount(0);
      await expect(
        page.getByRole("list", { name: "近い題名の本" }),
      ).toContainText("秘密の花園");
      // The quiet heading is small, but still readable.
      await expectReadable(page.locator(".search-near"), "近い題名の本");
      await expect(
        page.getByText("ぴったり合う本はありませんでした。"),
      ).toBeVisible();
      await expect(
        page.getByText("合う本は見つかりませんでした。", { exact: true }),
      ).toHaveCount(0);
      // A name spelled a little differently is a close author, not a title.
      await box.fill("ミハエル・エンデ");
      await expect(
        page.getByRole("list", { name: "著者名が近い本" }),
      ).toContainText("モモ");
      // Found by the author's reading, the row shows no title reading.
      await box.fill("みやざわけんじ");
      await expect(found.first()).toContainText("銀河鉄道の夜");
      await expect(found.first()).not.toContainText("よみ：");
      // A word of a reading that begins with a vowel: ロウジン ト ウミ.
      await box.fill("うみ");
      await expect(found.first()).toContainText("老人と海");
      // A genre chip lists its books and nothing close.
      await box.fill("");
      await page
        .getByRole("group", { name: "ジャンルで探す" })
        .getByRole("button", { name: "ファンタジー" })
        .click();
      await expect(found).toHaveCount(2);
      await expect(page.locator(".search-near")).toHaveCount(0);
      // A search with nothing to find says so in words, never 0.
      await box.fill("量子力学");
      await expect(
        page.getByText("合う本は見つかりませんでした。"),
      ).toBeVisible();
      await expect(page.locator(".search-results")).not.toContainText(/0/);
      // In a picker, Enter never sends the post being written, and takes
      // only a sure match: several equal ones or a near one wait for a tap.
      await go("/timeline/");
      await page.locator(".compose-fab").click();
      const compose = page.getByRole("dialog", { name: "投稿する" });
      await compose.locator("textarea").fill("下書きのつもりの文章");
      await compose.getByRole("button", { name: "本を添える" }).click();
      const picker = compose.getByRole("searchbox");
      for (const [typed, shown] of [
        ["孤独", /^百年の孤独/],
        ["グウィン", /^闇の左手/],
        ["秘密の森の花園", /^秘密の花園/],
      ]) {
        await picker.fill(typed);
        await expect(
          compose.getByRole("button", { name: shown }),
        ).toBeVisible();
        if (typed === "秘密の森の花園")
          await expectReadable(compose.locator(".search-near"), "近い題名の本");
        await picker.press("Enter");
        await expect(compose).toBeVisible();
        await expect(compose.locator(".picker-chosen")).toHaveCount(0);
      }
      await expect(page.getByText(/に投稿しました/)).toHaveCount(0);
      await expect(compose.locator("textarea")).toHaveValue(
        "下書きのつもりの文章",
      );
      await picker.fill("よるときり");
      await expect(
        compose.getByRole("button", { name: /^夜と霧/ }),
      ).toBeVisible();
      await picker.press("Enter");
      await expect(compose.locator(".picker-chosen")).toContainText("夜と霧");
      await compose.getByRole("button", { name: "夜と霧を外す" }).click();
      await compose.locator("textarea").fill("");
      await page.keyboard.press("Escape");
      await expect(compose).toHaveCount(0);
      await expect(page.getByText(/に投稿しました/)).toHaveCount(0);
    },
  );

  await check(
    "reading together: default book, timer, public memo and readers now",
    async () => {
      await go("/reading/");
      await expect(
        page.getByRole("heading", { name: /いま4人が、みんなで読んでいます/ }),
      ).toBeVisible();
      // Everyone's reading posts show before starting, whatever book they are on.
      const feed = page.locator(".reading-memos");
      await expect(
        page.getByRole("heading", { name: "みんなの読書中のつぶやき" }),
      ).toBeVisible();
      await expect(feed).toContainText("もう三つ目");
      await expect(feed).toContainText("時計の音がよく聞こえる");
      await page
        .getByRole("searchbox", { name: "読む本を探す" })
        .fill("ソラリス");
      await page.getByRole("button", { name: /^ソラリス/ }).click();
      await page.getByRole("button", { name: /みんなで読む/ }).click();
      await confirmIn("読書をはじめますか？", "はじめる");
      await expect(
        page.getByRole("heading", { name: "ソラリス" }),
      ).toBeVisible();
      await expect(page.getByRole("timer")).toHaveText(/00:0[1-9]/, {
        timeout: 5000,
      });
      await expect(
        page.getByRole("heading", { name: /同じ本を、いま3人が読んでいます/ }),
      ).toBeVisible();
      const nav = page.getByRole("navigation", {
        name: "スマートフォンナビゲーション",
      });
      await expect(nav.getByRole("link", { name: "読書中" })).toBeVisible();
      await page
        .getByRole("textbox", { name: "読書中のつぶやき" })
        .fill("ちょうど第二章。");
      await page.getByRole("button", { name: "つぶやく" }).click();
      const memo = page
        .getByRole("region", { name: "今回書いたこと" })
        .locator("article.post-card")
        .filter({ hasText: "ちょうど第二章。" });
      await expect(memo).toBeVisible();
      await memo.getByRole("button", { name: /いいね/ }).click();
      await expect(
        memo.getByRole("button", { name: /いいね/ }),
      ).toHaveAttribute("aria-pressed", "true");
      await go("/timeline/");
      await expect(page.getByText("ちょうど第二章。")).toBeVisible();
    },
  );

  await check("notifications show readers reading the same book", async () => {
    await go("/timeline/");
    // While a book is open, home does not offer to continue it.
    await expect(page.locator(".home-continue")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "お知らせ（新しいお知らせがあります）" }),
    ).toBeVisible();
    await page.getByRole("link", { name: /お知らせ/ }).click();
    await expect(
      page.getByText("凪さんも今『ソラリス』を読んでいます"),
    ).toBeVisible();
    await page.reload();
    await page.waitForFunction(() => localStorage.getItem("book-town-v1"));
    await expect(page.getByRole("link", { name: "お知らせ" })).toBeVisible();
  });

  await check(
    "ending a session records time and the book stays the default",
    async () => {
      await go("/reading/");
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: "読書を終える" }).click();
      await confirmIn("読書を終えますか？", "本を閉じる");
      await expect(
        page.getByRole("heading", { name: "読書を開始" }),
      ).toBeVisible();
      // Closing the book leaves this sitting's time, the book and a line written.
      const closed = page.getByRole("status", { name: "今日の読書" });
      await expect(closed).toContainText("今日の読書");
      await expect(closed).toContainText("『ソラリス』");
      await expect(closed).toContainText("ちょうど第二章。");
      await expect(
        closed.getByRole("link", { name: "『ソラリス』の作品ページへ" }),
      ).toHaveAttribute("href", "/books/solaris/");
      await closed.getByRole("button", { name: "閉じる" }).click();
      await expect(closed).toHaveCount(0);
      await expect(page.locator(".picker-chosen")).toContainText("ソラリス");
      await expect(
        page.getByText("いま読んでいる本を選んでいます。"),
      ).toBeVisible();
      const data = await stored();
      expect(data.readingSessions).toHaveLength(1);
      expect(data.readingSessions[0].endedAt).not.toBeNull();
      await expect(page.locator(".reading-log li")).toHaveCount(1);
      // Home keeps the unfinished book a tap away, with the last line written.
      await go("/");
      const next = page.getByRole("link", {
        name: "『ソラリス』の続きを読む",
      });
      await expect(next).toContainText("ちょうど第二章。");
      // The jacket is its own link, to the book's page (where its cover is
      // credited); the two links sit side by side, not nested.
      await expect(
        page.getByRole("link", { name: "『ソラリス』の作品ページへ" }),
      ).toHaveAttribute("href", "/books/solaris/");
      await expect(page.locator(".home-continue a a")).toHaveCount(0);
      await next.click();
      await expect(page).toHaveURL(/\/reading\/$/);
      await expect(page.locator(".picker-chosen")).toContainText("ソラリス");
    },
  );

  await check(
    "reading alone keeps memos private and off the timeline",
    async () => {
      await page.getByRole("button", { name: /一人で読む/ }).click();
      await confirmIn("読書をはじめますか？", "はじめる");
      // Reading alone, the town's readers and words wait behind a fold.
      const others = page.getByRole("heading", {
        name: /同じ本を、いま2人が読んでいます/,
      });
      await expect(others).toBeHidden();
      await expect(
        page.getByRole("heading", { name: "みんなの読書中のつぶやき" }),
      ).toBeHidden();
      await page.getByText("ひと休みに、街の読書をのぞく").click();
      await expect(others).toBeVisible();
      // Kept open, the fold stays open the next time the page is shown.
      await page.getByLabel("読書中はいつも開いておく").check();
      await page.reload();
      await expect(others).toBeVisible();
      await page.getByLabel("読書中はいつも開いておく").uncheck();
      await page.reload();
      await expect(others).toBeHidden();
      await page
        .getByLabel("読書メモ（自分だけ）")
        .fill("ここは自分だけのメモ。");
      await page.getByRole("button", { name: "メモする" }).click();
      await expect(
        page.getByText("自分だけのメモ", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "読み終えた！" }).click();
      await confirmIn("読み終えましたか？", "読み終えた");
      expect((await stored()).finishedBooks).toEqual(["solaris"]);
      await go("/timeline/");
      await expect(page.getByText("ここは自分だけのメモ。")).toHaveCount(0);
      await go("/books/solaris/");
      await expect(page.getByText("ここは自分だけのメモ。")).toHaveCount(0);
    },
  );

  await check("the compose button icon follows the setting", async () => {
    await go("/profiles/me/");
    await expect(page.locator(".profile-stats")).toContainText("読書時間");
    // Before a shop opens, the profile's main step is opening one.
    await expect(
      page
        .locator(".profile-reader-actions")
        .getByRole("link", { name: "書店をひらく" }),
    ).toHaveAttribute("href", "/my-shop/");
    await page.getByRole("button", { name: "設定" }).click();
    await page
      .getByRole("dialog", { name: "設定" })
      .locator("label", { hasText: "タイプライター" })
      .click();
    await expect(page.getByLabel("タイプライター")).toBeChecked();
    await page.keyboard.press("Escape");
    await go("/");
    await expect(page.locator(".compose-fab")).toHaveClass(/icon-typewriter/);
    expect((await stored()).settings.composeIcon).toBe("typewriter");
  });

  await check(
    "a book registered by ISBN can be read and attached to posts",
    async () => {
      await go("/profiles/me/");
      await page.getByRole("button", { name: "本を登録" }).click();
      const dialog = page.getByRole("dialog", { name: "本を登録" });
      await dialog.getByLabel("ISBN").fill("978-4-00-000000-2");
      await dialog.getByRole("button", { name: "ISBNで探す" }).click();
      await expect(
        dialog.getByText("ISBNとして読めませんでした"),
      ).toBeVisible();
      await dialog.getByLabel("ISBN").fill("978-4-10-109205-8");
      await dialog.getByRole("button", { name: "ISBNで探す" }).click();
      await expect(dialog.getByLabel("タイトル")).toHaveValue("QAの本");
      await expect(dialog.getByLabel("著者")).toHaveValue("試験 太郎");
      await dialog.getByRole("button", { name: "登録する" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /^登録\s*\d*$/ }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".profile-saved-book")).toContainText("QAの本");
      await page.reload();
      await page.waitForFunction(() => localStorage.getItem("book-town-v1"));
      await go("/reading/");
      await page
        .getByRole("searchbox", { name: "読む本を探す" })
        .fill("9784101092058");
      await expect(page.getByRole("button", { name: /^QAの本/ })).toBeVisible();
    },
  );

  await check(
    "a registered book shows its real cover, unaltered, with where it came from",
    async () => {
      await go("/profiles/me/?books=library");
      // QAの本 has no cover at openBD, so it is Google's, credited on the page.
      const saved = page.locator(".profile-saved-book", { hasText: "QAの本" });
      const google = saved.locator(".book-jacket.has-cover img");
      await expect(google).toHaveAttribute(
        "src",
        "https://books.google.com/books/content?id=qa&printsec=frontcover&img=1&zoom=1&source=gbs_api",
      );
      await expect(google).toHaveCSS("object-fit", "contain");
      await expect(saved.locator(".jacket-title")).toBeHidden();
      await expect(page.locator(".google-covers-credit")).toHaveText(
        "表紙の一部: powered by Google",
      );

      // On its own page, the cover names Google and links the book there.
      await saved.locator("a, button").first().click();
      const credit = page.locator(".cover-credit").first();
      await expect(credit).toContainText("powered by Google");
      await expect(
        credit.getByRole("link", { name: "Google Books でこの本を見る" }),
      ).toHaveAttribute(
        "href",
        "https://books.google.com/books/about/QA.html?id=qa",
      );

      // A book openBD has a cover for shows openBD's.
      await go("/profiles/me/?books=library");
      await page.getByRole("button", { name: "本を登録", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "本を登録" });
      await dialog.getByLabel("ISBN").fill(OPENBD_ISBN);
      await dialog.getByRole("button", { name: "ISBNで探す" }).click();
      await expect(dialog.getByLabel("タイトル")).toHaveValue("表紙のある本");
      await dialog.getByRole("button", { name: "登録する" }).click();
      await expect(dialog).toHaveCount(0);
      const openBd = page
        .locator(".profile-saved-book", { hasText: "表紙のある本" })
        .locator(".book-jacket.has-cover img");
      await expect(openBd).toHaveAttribute(
        "src",
        `https://cover.openbd.jp/${OPENBD_ISBN}.jpg`,
      );

      // A book without an ISBN keeps its 装丁カード, set top to bottom.
      await page.getByRole("button", { name: "本を登録", exact: true }).click();
      await dialog.getByLabel("タイトル").fill("手で書いた本");
      await dialog.getByLabel("著者").fill("試験 次郎");
      await dialog.getByRole("button", { name: "登録する" }).click();
      await expect(dialog).toHaveCount(0);
      const card = page
        .locator(".profile-saved-book", { hasText: "手で書いた本" })
        .locator(".book-jacket");
      await expect(card).not.toHaveClass(/has-cover/);
      await expect(card).toHaveClass(/is-tate/);
      await expect(card.locator(".jacket-title")).toHaveCSS(
        "writing-mode",
        "vertical-rl",
      );
      await page.screenshot({ path: path.join(output, "covers.png") });
    },
  );

  await check("following list opens from the profile", async () => {
    await go("/profiles/r-nagi/");
    await page.getByRole("button", { name: "書店をフォロー" }).click();
    await go("/profiles/me/");
    await page.getByRole("button", { name: /1 フォロー/ }).click();
    const dialog = page.getByRole("dialog", { name: "フォロー" });
    await expect(dialog.getByRole("link", { name: /凪/ })).toBeVisible();
    // A link in the list leaves from the profile: 戻る returns to the
    // profile, and the next 戻る leaves it.
    const href = await dialog
      .getByRole("link", { name: /凪/ })
      .getAttribute("href");
    const there = new URL(href, page.url()).href;
    await dialog.getByRole("link", { name: /凪/ }).click();
    await expect(page).toHaveURL(there);
    await page.goBack();
    await expect(page).toHaveURL(/\/profiles\/me\/$/);
    await expect(dialog).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/profiles\/r-nagi\/$/);
    await go("/notifications/");
    await expect(
      page.getByText(/フォロー中の凪さんが投稿しました/).first(),
    ).toBeVisible();
    await noOverflow("notifications");
  });

  await check("reading can start without choosing a book", async () => {
    await go("/reading/");
    const clear = page.locator(".picker-chosen .picker-clear");
    if (await clear.count()) await clear.click();
    await page.getByRole("button", { name: /一人で読む/ }).click();
    await confirmIn("読書をはじめますか？", "はじめる");
    await expect(
      page.getByRole("heading", { name: "読書中", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("本を選ばずに読んでいます")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "読み終えた！" }),
    ).toHaveCount(0);
    await expect(page.getByText("ネタバレあり")).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "読書メモ（自分だけ）" })
      .fill("本を決めずに、ぱらぱらと。");
    await page.getByRole("button", { name: "メモする" }).click();
    await expect(
      page.getByRole("region", { name: "今回書いたこと" }),
    ).toContainText("本を決めずに、ぱらぱらと。");
    await page.getByRole("button", { name: "読書を終える" }).click();
    await confirmIn("読書を終えますか？", "本を閉じる");
    await expect(page.locator(".reading-log")).toContainText("本を選ばずに");
  });

  await check(
    "profile links accept web pages and refuse other schemes",
    async () => {
      await go("/profiles/me/");
      await page.getByRole("button", { name: "プロフィールを編集" }).click();
      const dialog = page.getByRole("dialog", { name: "読書家のプロフィール" });
      await dialog
        .getByLabel("リンク1", { exact: true })
        .fill("javascript:alert(1)");
      await dialog.getByRole("button", { name: "保存する" }).click();
      await expect(dialog.getByRole("alert")).toContainText(
        "URLとして読めない",
      );
      await dialog
        .getByLabel("リンク1", { exact: true })
        .fill("note.com/qa_reader");
      await dialog.getByRole("button", { name: "リンクを追加" }).click();
      await dialog
        .getByLabel("リンク2", { exact: true })
        .fill("https://www.youtube.com/@qa");
      await dialog.getByRole("button", { name: "保存する" }).click();
      await expect(dialog).toHaveCount(0);
      const links = page.getByRole("list", { name: "リンク" });
      await expect(links.getByRole("link")).toHaveText(["note", "YouTube"]);
      await expect(links.getByRole("link", { name: "note" })).toHaveAttribute(
        "href",
        "https://note.com/qa_reader",
      );
      await expect(links.getByRole("link", { name: "note" })).toHaveAttribute(
        "target",
        "_blank",
      );
      await page.reload();
      await page.waitForFunction(() => localStorage.getItem("book-town-v1"));
      await expect(links.getByRole("link")).toHaveCount(2);
    },
  );

  await check("reading confirmations can be declined", async () => {
    await go("/reading/");
    await page.getByRole("button", { name: /一人で読む/ }).click();
    const dialog = page.getByRole("dialog", { name: "読書をはじめますか？" });
    await expect(dialog.locator(".reading-confirm-phrase")).not.toBeEmpty();
    await dialog.getByRole("button", { name: "もう少し準備する" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "読書を開始" }),
    ).toBeVisible();
    expect((await stored()).readingSessions.every((s) => s.endedAt)).toBe(true);
  });

  await check("tags link to every post that shares them", async () => {
    await go("/timeline/");
    await page.getByRole("link", { name: "#積読" }).first().click();
    await expect(page).toHaveURL(/\/search\//);
    await expect(
      page.getByRole("heading", { name: /#積読 の投稿/ }),
    ).toBeVisible();
    await expect(page.locator(".search-results")).toContainText(
      "今週は一冊も買わない",
    );
    await go("/timeline/");
    await page.locator(".compose-fab").click();
    const compose = page.getByRole("dialog", { name: "投稿する" });
    await compose.locator("textarea").fill("雨の日は");
    await compose
      .getByRole("button", { name: /タグ「.+」を付ける/ })
      .first()
      .click();
    await expect(compose.locator("textarea")).toHaveValue(/^雨の日は #\S+ $/);
    await expect(compose.locator(".tag-chip.is-set")).toHaveCount(1);
    await page.keyboard.press("Escape");
  });

  await check(
    "every reader has an @ID; the viewer can set a free one",
    async () => {
      await go("/timeline/");
      await expect(page.locator(".post-handle").first()).toHaveText(
        /^@[a-z0-9_]+$/,
      );
      await go("/profiles/me/");
      await expect(page.locator(".profile-handle")).toHaveText("@reader");
      await page.getByRole("button", { name: "プロフィールを編集" }).click();
      const dialog = page.getByRole("dialog", { name: "読書家のプロフィール" });
      await dialog.getByLabel("ユーザーID").fill("nagi");
      await dialog.getByRole("button", { name: "保存する" }).click();
      await expect(dialog.getByRole("alert")).toContainText("ほかの読書家");
      await dialog.getByLabel("ユーザーID").fill("Book_Reader");
      await dialog.getByRole("button", { name: "保存する" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator(".profile-handle")).toHaveText("@book_reader");
      await go("/search/");
      await page
        .getByRole("searchbox", { name: "本と書店を検索" })
        .fill("@book_r");
      await expect(page.getByRole("heading", { name: /読書家/ })).toBeVisible();
      await expect(page.locator(".search-results")).toContainText(
        "@book_reader",
      );
    },
  );

  await check(
    "book page shows the price, open shop links and three reviews first",
    async () => {
      await go("/books/solaris/");
      await expect(page.locator(".book-page-hero .book-price")).toContainText(
        "¥1,540",
      );
      await expect(
        page
          .locator(".book-page-hero")
          .getByRole("link", { name: /^Amazonで探す/ }),
      ).toBeVisible();
      await expect(
        page
          .locator(".book-page-hero")
          .getByRole("link", { name: /^この本についてGoogleで調べる/ }),
      ).toHaveAttribute(
        "href",
        "https://www.google.com/search?q=" +
          encodeURIComponent("ソラリス　スタニスワフ・レム"),
      );
      const reviews = page.locator(
        ".book-reviews > .post-feed > article.post-card",
      );
      await expect(reviews).toHaveCount(3);
      const more = page.getByRole("button", {
        name: /残りのレビューをすべて表示/,
      });
      await more.click();
      await expect(more).toHaveCount(0);
      expect(await reviews.count()).toBeGreaterThan(3);
    },
  );

  await check(
    "closing the book can lead straight to writing a review",
    async () => {
      await go("/reading/");
      await page.getByRole("searchbox", { name: "読む本を探す" }).fill("モモ");
      await page.getByRole("button", { name: /^モモ/ }).click();
      await page.getByRole("button", { name: /一人で読む/ }).click();
      await confirmIn("読書をはじめますか？", "はじめる");
      await page.getByRole("button", { name: "読書を終える" }).click();
      await page
        .getByRole("dialog", { name: "読書を終えますか？" })
        .getByRole("button", { name: "感想を書く" })
        .click();
      const review = page.getByRole("dialog", { name: "『モモ』の感想" });
      await review
        .locator("textarea")
        .fill("時間どろぼうの話を、時間をかけて読んだ。");
      await review.getByRole("button", { name: "投稿する" }).click();
      await expect(review).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "読書を開始" }),
      ).toBeVisible();
      await go("/books/momo/");
      await expect(page.locator(".book-reviews")).toContainText(
        "時間どろぼうの話を、時間をかけて読んだ。",
      );
    },
  );

  await check(
    "a shop opens in three minutes: the nine, a sign, the lights",
    async () => {
      await go("/my-shop/");
      await page.getByRole("button", { name: /人生の9冊の本屋/ }).click();
      // The life nine already on the profile stand on the shelf.
      await expect(page.locator(".open-shelf-book")).toHaveCount(4);
      await expect(page.getByText("あと5冊まで並べられます。")).toBeVisible();
      await page
        .getByRole("searchbox", { name: "棚に並べる本" })
        .fill("見えない都市");
      await page
        .getByRole("list", { name: "棚に並べる本の候補" })
        .getByRole("button", { name: /見えない都市/ })
        .click();
      await expect(page.locator(".open-shelf-book")).toHaveCount(5);
      await page.getByRole("button", { name: "看板を決める" }).click();
      // 戻る goes back one step at a time, keeping what was chosen.
      await page.goBack();
      await expect(page.locator(".open-shelf-book")).toHaveCount(5);
      await page.goBack();
      await expect(
        page.getByRole("button", { name: /人生の9冊の本屋/ }),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/my-shop\/$/);
      await page.goForward();
      await expect(page.locator(".open-shelf-book")).toHaveCount(5);
      await page.goForward();
      await page.getByRole("button", { name: "名前の例" }).click();
      await expect(page.getByLabel("書店の名前")).toHaveValue("雨音書店");
      await page.getByLabel("ひとこと").fill("一頁ぶん、遠回り。");
      await page.getByRole("button", { name: "藍色", exact: true }).click();
      await page
        .getByRole("button", { name: "書店をひらく", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "「雨音書店」が開店しました",
      );
      // The steps that led to the opening are behind it: 戻る leaves the page.
      await expect
        .poll(() => page.evaluate(() => history.state?.booktownLayers ?? null))
        .toBeNull();
      const shop = (await stored()).ownShop;
      expect(shop.name).toBe("雨音書店");
      expect(shop.tagline).toBe("一頁ぶん、遠回り。");
      expect(shop.theme).toBe("ink");
      expect(shop.shelves[0].name).toBe("人生の9冊");
      expect(shop.shelves[0].isPublic).toBe(true);
      expect(shop.shelves[0].items.map((item) => item.display)).toEqual([
        "face",
        "spine",
        "spine",
        "spine",
        "spine",
      ]);
      await page.getByRole("button", { name: "棚を整える" }).click();
      await expect(page.locator(".editor-shelf-panel")).toHaveCount(1);
      // For a day, the street opens with the new shop and says it joined.
      await go("/");
      const first = page.locator(".street-shop").first();
      await expect(first.locator(".street-new-own")).toContainText(
        "あなたの書店が、街に加わりました",
      );
      await expect(first.locator("h2")).toHaveText("雨音書店");
      await expect(first.locator(".street-shop-tagline")).toHaveText(
        "一頁ぶん、遠回り。",
      );
      await expect(page.locator(".street-new-own")).toHaveCount(1);
      await go("/profiles/me/");
      await expect(
        page
          .locator(".profile-reader-actions")
          .getByRole("link", { name: "書店を整える" }),
      ).toHaveAttribute("href", "/my-shop/");
    },
  );

  await check(
    "a new shop's few books stand together under one chalkboard",
    async () => {
      await go("/walk/#mine");
      await expect(page.locator(".walk-sign")).toContainText("雨音書店");
      // One's own shop is tended, not liked or kept for later.
      await expect(
        page.getByRole("link", { name: "自分の店を整える" }),
      ).toHaveAttribute("href", "/my-shop/");
      await expect(
        page.getByRole("button", { name: "この店が好き" }),
      ).toHaveCount(0);
      await expect(page.locator('[data-row="row-0"] .walk-book')).toHaveCount(
        5,
      );
      await expect(page.locator(".walk-row-board")).toHaveCount(1);
      // The empty tiers hold a few things instead of bare boards.
      await expect(page.locator(".walk-row-still")).toHaveCount(2);
      await expect(page.locator(".walk-ownerPop")).toContainText(
        "一頁ぶん、遠回り。",
      );
      // Short words are shown whole, with nothing more to read.
      await expect(page.locator(".walk-floor-pop-more")).toHaveCount(0);
      // Without words of the owner's, the floor POP invites only the owner.
      await go("/my-shop/");
      await page.getByText("書店の看板と紹介").click();
      await page.getByLabel("ひとこと").fill("");
      await page.getByRole("button", { name: "変更を保存" }).click();
      await go("/walk/#mine");
      await page.getByRole("link", { name: /ひとことを書く/ }).click();
      await expect(page).toHaveURL(/\/my-shop\/#shop-words$/);
      await expect(page.getByLabel("ひとこと")).toBeFocused();
    },
  );

  // Enter while a kana conversion is still open: the keyboard's, never a search's.
  const composingEnter = (box) =>
    box.evaluate((input) =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 229,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

  await check(
    "every search box reads kana and romaji, and Enter takes only a sure match",
    async () => {
      // The shelf picker: reading and romaji find the book, Enter places only
      // the one surely meant and never takes a book off.
      await go("/my-shop/");
      await page
        .locator(".editor-shelf-panel")
        .first()
        .getByRole("button", { name: "本棚を編集", exact: true })
        .click();
      const shelfPicker = page.getByRole("dialog", { name: "本棚を編集" });
      const shelfSearch = shelfPicker.getByLabel("追加する本を検索");
      const shelfTitles = shelfPicker.locator(
        ".editor-picker-grid:not([role]) .editor-book-choice-title",
      );
      const shelved = async () =>
        (await stored()).ownShop.shelves[0].items.map((item) => item.bookId);
      const before = await shelved();
      expect(before).toContain("galaxy-railroad");
      expect(before).not.toContain("night-fog");
      await shelfSearch.fill("chinmoku");
      await expect(shelfTitles.first()).toHaveText("沈黙");
      await shelfSearch.fill("孤独");
      await expect(shelfTitles.first()).toContainText("孤独");
      await shelfSearch.press("Enter");
      await shelfSearch.fill("gingatetsudou");
      await expect(shelfTitles.first()).toHaveText("銀河鉄道の夜");
      await shelfSearch.press("Enter");
      // Near titles wait under a quiet heading that is still readable.
      await shelfSearch.fill("秘密の森の花園");
      await expect(shelfPicker.locator(".search-near")).toBeVisible();
      await expectReadable(shelfPicker.locator(".search-near"), "近い題名の本");
      await shelfSearch.fill("よるときり");
      await expect(shelfTitles.first()).toHaveText("夜と霧");
      await composingEnter(shelfSearch);
      await expect(shelfSearch).toHaveValue("よるときり");
      expect(await shelved()).toEqual(before);
      await shelfSearch.press("Enter");
      await expect(shelfSearch).toHaveValue("");
      await expect(shelfPicker).toBeVisible();
      await expect.poll(shelved).toContain("night-fog");
      expect(await shelved()).toHaveLength(before.length + 1);
      await shelfPicker
        .getByRole("button", { name: "完了", exact: true })
        .click();
      await expect(shelfPicker).toHaveCount(0);

      // The 人生の9冊 picker, the same way.
      await go("/profiles/me/");
      await page.locator(".profile-edit-nine").click();
      const nine = page.getByRole("dialog", { name: "人生の9冊を選ぶ" });
      const nineSearch = nine.getByRole("searchbox", {
        name: "人生の9冊に追加する本を検索",
      });
      const chosen = nine.locator(".profile-nine-editor-item");
      await expect(chosen).toHaveCount(4);
      await nineSearch.fill("roujintoumi");
      await expect(
        nine.locator(".profile-picker-book strong").first(),
      ).toHaveText("老人と海");
      await nineSearch.fill("秘密の森の花園");
      await expect(nine.locator(".search-near")).toBeVisible();
      await expectReadable(nine.locator(".search-near"), "近い題名の本");
      await nineSearch.fill("ヒミツノハナゾノ");
      await expect(
        nine.locator(".profile-picker-book strong").first(),
      ).toHaveText("秘密の花園");
      await composingEnter(nineSearch);
      await expect(chosen).toHaveCount(4);
      await nineSearch.press("Enter");
      await expect(chosen).toHaveCount(5);
      await expect(chosen.last()).toContainText("秘密の花園");
      await expect(nineSearch).toHaveValue("");
      await nineSearch.fill("孤独");
      await nineSearch.press("Enter");
      await expect(chosen).toHaveCount(5);
      await expect(nine).toBeVisible();
      await nine
        .getByRole("button", { name: "キャンセル", exact: true })
        .click();
      await expect(nine).toHaveCount(0);
      expect((await stored()).me.lifeNine).not.toContain("secret-garden");

      // Readers by name or @ID in either kana, either width, or romaji; no counts.
      await go("/search/");
      const box = page.getByRole("searchbox", { name: "本と書店を検索" });
      const people = page.locator(
        "[aria-labelledby=search-people-title] .search-list",
      );
      for (const [typed, handle] of [
        ["スミレ", "@sumire"],
        ["ＨＡＲＵ", "@haru"],
        ["＠ｓｕｍｉ", "@sumire"],
      ]) {
        await box.fill(typed);
        await expect(
          page.getByRole("heading", { name: "読書家", exact: true }),
        ).toBeVisible();
        await expect(people.locator("li")).toHaveCount(1);
        await expect(people).toContainText(handle);
      }
      const shopsFound = page.locator(
        "[aria-labelledby=search-shops-title] .search-shop",
      );
      // Typed one letter at a time, a reader stays found at a last n.
      for (const typed of ["a", "an", "ana"]) {
        await box.fill(typed);
        await expect(people.locator("b").first()).toHaveText("あなた");
      }
      // A kanji name typed in kana finds the reader by their romaji @ID,
      // and the ID finds the shop they keep.
      await box.fill("なぎ");
      await expect(people).toContainText("@nagi");
      await expect(shopsFound).toHaveText([/^軌道書房/]);
      // After @, readers and shops are both found by @ID only.
      await box.fill("@sumire");
      await expect(people).toContainText("@sumire");
      await expect(shopsFound).toHaveText([/^雨と翻訳/]);
      await box.fill("@スミレ");
      await expect(page.locator(".search-results")).toContainText(
        "合う書店は見つかりませんでした。",
      );
      await expect(people).toHaveCount(0);
      await expect(shopsFound).toHaveCount(0);
      // A shop named for the word comes before one whose owner is.
      await box.fill("灯");
      await expect(shopsFound.first()).toContainText("小さな灯り");
      await expect(shopsFound.nth(1)).toContainText("問いの余白");
      // A book's reading also finds the shops that shelve it.
      await box.fill("ぎんがてつどう");
      await expect(shopsFound).not.toHaveCount(0);
      expect(
        (await page.locator(".search-results h2").allTextContents()).join(""),
      ).not.toMatch(/\d/);

      // The top search (on wider screens; phones have 検索 in the bottom bar)
      // opens the search page, and 戻る comes back to where it was.
      await page.setViewportSize({ width: 1280, height: 900 });
      await go("/timeline/");
      const top = page.getByRole("textbox", {
        name: "本や書店を検索",
        exact: true,
      });
      await top.fill("ぎんがてつどう");
      await composingEnter(top);
      await page.waitForTimeout(300);
      await expect(page).toHaveURL(/\/timeline\/$/);
      await top.press("Enter");
      await expect(page).toHaveURL(
        `${baseURL}/search/?q=${encodeURIComponent("ぎんがてつどう")}`,
      );
      await expect(box).toHaveValue("ぎんがてつどう");
      await expect(
        page
          .locator(
            "[aria-labelledby=search-books-title] > ul:not([aria-labelledby]) .search-book",
          )
          .first(),
      ).toContainText("銀河鉄道の夜");
      await page.goBack();
      await expect(page).toHaveURL(/\/timeline\/$/);
      // On the street the words narrow the shops as typed, and stay there.
      await go("/");
      await top.fill("雨と翻訳");
      await expect(page.locator(".street-shop")).toHaveCount(1);
      await expect(page.locator(".street-search-result")).not.toContainText(
        /\d/,
      );
      // When nothing matches, the status itself says so (the empty street
      // below is not read out), still without a number.
      await top.fill("量子力学");
      await expect(page.locator(".street-shop")).toHaveCount(0);
      await expect(
        page.getByRole("status").filter({ hasText: "量子力学" }),
      ).toContainText(
        "「量子力学」からつながる書店は、まだ見つかりませんでした",
      );
      await top.fill("雨と翻訳");
      await expect(page.locator(".street-search-result")).toContainText(
        "「雨と翻訳」からつながる書店クリア",
      );
      await top.press("Enter");
      await expect(page).toHaveURL(/\/search\/\?q=/);
      await expect(
        page
          .locator("[aria-labelledby=search-shops-title] .search-shop")
          .filter({ hasText: "雨と翻訳" }),
      ).toHaveCount(1);
      await page.goBack();
      await expect(page).toHaveURL(/#search=/);
      await expect(page.locator(".street-shop")).toHaveCount(1);
      await top.fill("");
      await page.setViewportSize({ width: 390, height: 844 });
    },
  );

  await check(
    "No hydration errors, uncaught exceptions or console errors",
    async () => {
      expect(errors).toEqual([]);
    },
  );
  await context.close();
  await writeFile(
    path.join(output, "app-results.json"),
    JSON.stringify({ baseURL, passed, errors }, null, 2),
  );
} catch (error) {
  await page
    ?.screenshot({ path: path.join(output, "app-failure.png"), fullPage: true })
    .catch(() => {});
  await writeFile(
    path.join(output, "app-results.json"),
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
