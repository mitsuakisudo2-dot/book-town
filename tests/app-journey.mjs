import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/app-qa",
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
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // The ISBN lookup is answered locally so the test never depends on the network.
  await page.route("https://api.openbd.jp/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { summary: { title: "QAの本", author: "試験 太郎／著" } },
      ]),
    }),
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
        .locator(".reading-memos article.post-card")
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
    await expect(
      page.getByRole("link", { name: /お知らせ（未読\d+件）/ }),
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
      await expect(page.locator(".picker-chosen")).toContainText("ソラリス");
      await expect(
        page.getByText("いま読んでいる本を選んでいます。"),
      ).toBeVisible();
      const data = await stored();
      expect(data.readingSessions).toHaveLength(1);
      expect(data.readingSessions[0].endedAt).not.toBeNull();
      await expect(page.locator(".reading-log li")).toHaveCount(1);
    },
  );

  await check(
    "reading alone keeps memos private and off the timeline",
    async () => {
      await page.getByRole("button", { name: /一人で読む/ }).click();
      await confirmIn("読書をはじめますか？", "はじめる");
      await expect(
        page.getByRole("heading", { name: /同じ本を、いま2人が読んでいます/ }),
      ).toBeVisible();
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
        page.getByRole("button", { name: /^登録した本/ }),
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

  await check("following list opens from the profile", async () => {
    await go("/profiles/r-nagi/");
    await page.getByRole("button", { name: "書店をフォロー" }).click();
    await go("/profiles/me/");
    await page.getByRole("button", { name: /1 フォロー/ }).click();
    const dialog = page.getByRole("dialog", { name: "フォロー" });
    await expect(dialog.getByRole("link", { name: /凪/ })).toBeVisible();
    await page.keyboard.press("Escape");
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
    await expect(page.locator(".reading-memos")).toContainText(
      "本を決めずに、ぱらぱらと。",
    );
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
    },
  );

  await check(
    "a new shop's few books stand together under one chalkboard",
    async () => {
      await go("/walk/#mine");
      await expect(page.locator(".walk-sign")).toContainText("雨音書店");
      await expect(page.locator('[data-row="row-0"] .walk-book')).toHaveCount(
        5,
      );
      await expect(page.locator(".walk-row-board")).toHaveCount(1);
      // The empty tiers hold a few things instead of bare boards.
      await expect(page.locator(".walk-row-still")).toHaveCount(2);
      await expect(page.locator(".walk-ownerPop")).toContainText(
        "一頁ぶん、遠回り。",
      );
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
