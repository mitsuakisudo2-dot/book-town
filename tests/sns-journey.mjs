import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// SNS journey: timeline → review → work page → conversation → profile/shop,
// "読みたくなった" → wishlist with its source, spoilers, reports, and mobile layout.
const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/qa",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.BOOK_TOWN_CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const errors = [];
let passed = 0;
function watch(page) {
  page.on("pageerror", (error) =>
    errors.push(`${page.url()} pageerror ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push(`${page.url()} console ${message.text()}`);
  });
}
async function check(name, operation) {
  await operation();
  passed += 1;
  console.log(`PASS ${name}`);
}
async function go(page, route) {
  await page.goto(`${baseURL}${route}`);
  await expect(page.locator("main")).toBeVisible();
  await page.waitForFunction(
    () =>
      localStorage.getItem("book-town-v1") !== null &&
      localStorage.getItem("book-town-sns-v1") !== null,
  );
}
const town = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("book-town-v1")).data);
const sns = (page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem("book-town-sns-v1")).data,
  );
async function noOverflow(page, name) {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(size.document, `${name}: document overflow`).toBeLessThanOrEqual(
    size.width + 1,
  );
  expect(size.body, `${name}: body overflow`).toBeLessThanOrEqual(
    size.width + 1,
  );
}
const composer = (page, name = "投稿する") =>
  page.getByRole("dialog", { name });
async function pickBook(dialog, buttonName, query, title) {
  await dialog.getByRole("button", { name: buttonName }).click();
  await dialog.getByRole("searchbox", { name: "添える本を検索" }).fill(query);
  await dialog
    .locator(".sns-picker li button")
    .filter({ hasText: title })
    .first()
    .click();
  await expect(dialog.locator(".sns-attached")).toContainText(title);
}

const desktop = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "ja-JP",
});
const page = await desktop.newPage();
watch(page);
try {
  await check(
    "Timeline lists demo posts newest first without spoiler bodies",
    async () => {
      await go(page, "/feed/");
      await expect(
        page.getByRole("heading", { name: "タイムライン" }),
      ).toBeVisible();
      const ids = await page
        .locator(".sns-list > .sns-post")
        .evaluateAll((nodes) => nodes.map((node) => node.id));
      expect(ids[0]).toBe("post-haru-lamp");
      expect(ids).not.toContain("post-nagi-re-tou-solaris");
      const spoiler = page.locator("#post-nagi-solaris-ending");
      await expect(spoiler.getByText("ネタバレを含む感想")).toBeVisible();
      // The body is not merely hidden with CSS: it is absent from the timeline.
      await expect(page.getByText("待つことを選んだ")).toHaveCount(0);
      await expect(
        spoiler.getByRole("link", { name: /作品ページで読む/ }),
      ).toHaveAttribute("href", "/books/solaris/#post-nagi-solaris-ending");
      await page.screenshot({
        path: path.join(output, "sns-feed-desktop.png"),
        animations: "disabled",
      });
    },
  );

  await check(
    "Review → work page → reviewer profile → reviewer's bookshop",
    async () => {
      const review = page.locator("#post-tou-solaris");
      await review
        .getByRole("link", { name: /この本の感想『ソラリス』/ })
        .click();
      await expect(page).toHaveURL(/\/books\/solaris\/#post-tou-solaris$/);
      const reviews = page.locator("#reviews");
      await expect(
        reviews.getByRole("heading", { name: "みんなの感想" }),
      ).toBeVisible();
      await expect(reviews.locator("#post-tou-solaris")).toBeVisible();
      // Spoiler review is protected on the work page until the viewer chooses.
      const protectedReview = reviews.locator("#post-nagi-solaris-ending");
      await expect(protectedReview.getByText("待つことを選んだ")).toHaveCount(
        0,
      );
      await protectedReview
        .getByRole("button", { name: "ネタバレを表示する" })
        .click();
      await expect(protectedReview.getByText(/待つことを選んだ/)).toBeVisible();
      await protectedReview.getByRole("button", { name: "隠す" }).click();
      await expect(protectedReview.getByText("待つことを選んだ")).toHaveCount(
        0,
      );
      // Existing work-page content is still there.
      await expect(page.locator(".stockist").first()).toBeVisible();
      await reviews
        .locator("#post-tou-solaris")
        .getByRole("link", { name: "灯", exact: true })
        .click();
      await expect(page).toHaveURL(/\/profiles\/r-tou\/$/);
      await expect(
        page.getByRole("heading", { name: "人生の9冊" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "灯さんの投稿" }),
      ).toBeVisible();
      await page.getByRole("link", { name: /この人の書店へ/ }).click();
      await expect(page).toHaveURL(/\/shops\/shop-question\/?$/);
    },
  );

  await check(
    "読みたくなった → wishlist records which review it came from",
    async () => {
      await go(page, "/feed/");
      const review = page.locator("#post-tou-solaris");
      const want = review.getByRole("button", { name: /^読みたくなった/ });
      await expect(want).toHaveAttribute("aria-label", "読みたくなった（2件）");
      await want.click();
      await expect(want).toHaveAttribute("aria-pressed", "true");
      await expect(want).toHaveAttribute("aria-label", "読みたくなった（3件）");
      // The reaction alone does not save anything.
      expect((await town(page)).wishlist).toEqual([]);
      await review
        .getByRole("button", { name: "読みたいリストに追加" })
        .click();
      await expect(review.getByText(/この投稿をきっかけに/)).toBeVisible();
      const saved = await town(page);
      expect(saved.wishlist).toEqual(["solaris"]);
      expect(saved.wishSources.solaris).toMatchObject({
        kind: "post",
        postId: "tou-solaris",
      });
      expect((await sns(page)).reactions).toEqual([
        { postId: "tou-solaris", kind: "wantToRead" },
      ]);
      await go(page, "/profiles/me/");
      const source = page.getByRole("link", { name: "灯さんの感想から" });
      await expect(source).toBeVisible();
      await source.click();
      await expect(page).toHaveURL(/\/posts\/\?id=tou-solaris$/);
      await expect(
        page.getByRole("heading", { name: "灯さんの感想" }),
      ).toBeVisible();
    },
  );

  await check(
    "Free post with an image is resized, persisted and never a review",
    async () => {
      await go(page, "/feed/");
      const png = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 1600;
        canvas.height = 1200;
        const context = canvas.getContext("2d");
        context.fillStyle = "#5d7967";
        context.fillRect(0, 0, 1600, 1200);
        return canvas.toDataURL("image/png").split(",")[1];
      });
      await page.locator(".side-compose").click();
      const dialog = composer(page);
      await dialog
        .getByRole("textbox", { name: "投稿の本文" })
        .fill("雨の日は喫茶店で読書。");
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "shelf.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      });
      await expect(dialog.locator(".sns-image-drafts img")).toHaveCount(1);
      await dialog
        .getByRole("textbox", { name: "画像1の説明（読み上げ用）" })
        .fill("緑一色の画像");
      await dialog
        .getByRole("button", { name: "投稿する", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      const first = page.locator(".sns-list > .sns-post").first();
      await expect(first).toContainText("雨の日は喫茶店で読書。");
      await expect(
        first.getByRole("button", { name: /画像1を拡大: 緑一色の画像/ }),
      ).toBeVisible();
      const [post] = (await sns(page)).posts;
      expect(post).toMatchObject({
        id: "mine-post-1",
        book: null,
        reply: null,
        spoiler: false,
      });
      expect(post.images[0]).toMatchObject({
        width: 1080,
        height: 810,
        alt: "緑一色の画像",
      });
      expect(post.images[0].src.startsWith("data:image/jpeg;base64,")).toBe(
        true,
      );
    },
  );

  await check(
    "Attaching a book is not a review; publishing as a review reaches the work page",
    async () => {
      await page.locator(".side-compose").click();
      let dialog = composer(page);
      await dialog
        .getByRole("textbox", { name: "投稿の本文" })
        .fill("『モモ』を買い直した。");
      await pickBook(dialog, "本を添える", "モモ", "モモ");
      await expect(
        dialog.getByRole("radio", { name: /本を添えるだけ/ }),
      ).toBeChecked();
      await dialog
        .getByRole("button", { name: "投稿する", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await go(page, "/books/momo/");
      await expect(page.locator("#reviews")).toContainText(
        "この本について、最初の言葉を残してみませんか。",
      );
      await page.getByRole("button", { name: "感想を書く" }).click();
      dialog = composer(page);
      await expect(
        dialog.getByRole("radio", { name: /感想として公開する/ }),
      ).toBeChecked();
      const submit = dialog.getByRole("button", {
        name: "投稿する",
        exact: true,
      });
      await expect(submit).toBeDisabled();
      await dialog
        .getByRole("textbox", { name: "投稿の本文" })
        .fill("灰色の男たちの正体に、最後は震えた。");
      await dialog.getByRole("checkbox", { name: /ネタバレを含む/ }).check();
      await submit.click();
      await expect(dialog).toHaveCount(0);
      const mine = page.locator("#reviews #post-mine-post-3");
      await expect(mine.getByText("ネタバレを含む感想")).toBeVisible();
      await expect(mine.getByText("灰色の男たち")).toHaveCount(0);
      await mine.getByRole("button", { name: "ネタバレを表示する" }).click();
      await expect(mine.getByText(/灰色の男たちの正体/)).toBeVisible();
      await go(page, "/feed/");
      await expect(page.locator("#post-mine-post-2")).toContainText(
        "『モモ』を買い直した。",
      );
      await expect(
        page.locator("#post-mine-post-3").getByText("ネタバレを含む感想"),
      ).toBeVisible();
      await expect(page.getByText("灰色の男たち")).toHaveCount(0);
    },
  );

  await check(
    "Replies continue the conversation and can recommend another book",
    async () => {
      await go(page, "/posts/?id=tou-solaris");
      await expect(
        page.getByRole("heading", { name: "返信 3件" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "灯さんに返信する" }).click();
      const dialog = composer(page, "返信する");
      await expect(dialog.getByText("灯さんへの返信")).toBeVisible();
      await dialog
        .getByRole("textbox", { name: "返信の本文" })
        .fill("この本も好きなんじゃないかな。");
      await pickBook(dialog, "本を添えて薦める", "森", "森の生活");
      await expect(dialog.getByRole("radio")).toHaveCount(0);
      await dialog
        .getByRole("button", { name: "返信する", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "返信 4件" }),
      ).toBeVisible();
      const reply = page.locator("#post-mine-post-4");
      await expect(
        reply.getByRole("link", { name: /おすすめの本『森の生活』/ }),
      ).toBeVisible();
      await go(page, "/books/walden/");
      const recommended = page.locator(
        ".sns-recommendations #post-mine-post-4",
      );
      await expect(recommended).toContainText("灯さんへの返信");
      await expect(
        page.locator("#reviews > .sns-list > .sns-post"),
      ).toHaveCount(0);
    },
  );

  await check(
    "Spoilers propagate down a thread and open together",
    async () => {
      await go(page, "/posts/?id=tou-re-nagi-ending");
      const gates = page.getByRole("button", { name: "ネタバレを表示する" });
      await expect(gates).toHaveCount(2);
      await gates.first().click();
      await expect(
        page.getByRole("button", { name: "ネタバレを表示する" }),
      ).toHaveCount(0);
      await expect(page.getByText(/腑に落ちました/)).toBeVisible();
    },
  );

  await check("Likes, reader follows and the following timeline", async () => {
    await go(page, "/feed/");
    const like = page
      .locator("#post-sou-not-reading")
      .getByRole("button", { name: /^いいね/ });
    await like.click();
    await expect(like).toHaveAttribute("aria-label", "いいね（3件）");
    await page.getByRole("tab", { name: "フォロー中" }).click();
    await expect(
      page.getByRole("heading", { name: "読書家をフォローする" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "蒼さんをフォロー" }).click();
    const authors = await page
      .locator(".sns-list > .sns-post .sns-author")
      .allTextContents();
    expect(new Set(authors)).toEqual(new Set(["蒼", "あなた"]));
    await go(page, "/profiles/r-sou/");
    await expect(
      page.getByRole("button", { name: "蒼さんのフォローを解除" }),
    ).toBeVisible();
    await expect(page.locator(".sns-reader-stats")).toContainText(
      "3 フォロワー",
    );
    expect((await sns(page)).following).toEqual(["r-sou"]);
  });

  await check(
    "Reporting a missing spoiler flag hides the post for the reporter",
    async () => {
      await go(page, "/feed/");
      const target = page.locator("#post-haru-galaxy");
      await target.getByRole("button", { name: "投稿のメニュー" }).click();
      await page
        .getByRole("menuitem", { name: "ネタバレ指定漏れを報告" })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "ネタバレ指定漏れを報告",
      });
      await expect(dialog).toContainText("投稿者や運営には送信されません");
      await dialog.getByRole("button", { name: "報告する" }).click();
      await expect(
        target.getByText("ネタバレ指定漏れとして報告した投稿"),
      ).toBeVisible();
      await expect(target.getByText(/声に出して読みたくなる/)).toHaveCount(0);
      expect((await sns(page)).spoilerReports).toEqual(["haru-galaxy"]);
      await target.getByRole("button", { name: "投稿のメニュー" }).click();
      await page
        .getByRole("menuitem", { name: "ネタバレ報告を取り消す" })
        .click();
      await expect(target.getByText(/声に出して読みたくなる/)).toBeVisible();
    },
  );

  await check(
    "Authors can add a spoiler flag later and delete their post",
    async () => {
      const mine = page.locator("#post-mine-post-2");
      await mine.getByRole("button", { name: "投稿のメニュー" }).click();
      await page
        .getByRole("menuitem", { name: "ネタバレ指定をつける" })
        .click();
      await expect(mine.getByText("ネタバレを含む投稿")).toBeVisible();
      await mine.getByRole("button", { name: "投稿のメニュー" }).click();
      await page.getByRole("menuitem", { name: "投稿を削除" }).click();
      await page
        .getByRole("dialog", { name: "投稿を削除" })
        .getByRole("button", { name: "削除する" })
        .click();
      await expect(page.locator("#post-mine-post-2")).toHaveCount(0);
      expect((await sns(page)).posts.map((post) => post.id)).toEqual([
        "mine-post-1",
        "mine-post-3",
        "mine-post-4",
      ]);
    },
  );

  await check(
    "Everything persists across reload and the town save is untouched",
    async () => {
      await page.reload();
      await expect(page.locator("#post-mine-post-1")).toBeVisible();
      await expect(page.locator("#post-mine-post-2")).toHaveCount(0);
      const saved = await town(page);
      expect(Object.keys(saved).sort()).toEqual(
        [
          "favorites",
          "following",
          "me",
          "ownShop",
          "popReactions",
          "wishSources",
          "wishlist",
        ].sort(),
      );
      expect(saved.following).toEqual([]);
      expect(saved.ownShop).toBeNull();
      const raw = await page.evaluate(() =>
        localStorage.getItem("book-town-v1"),
      );
      expect(raw).not.toContain("data:image");
    },
  );
} finally {
  await desktop.close();
}

for (const width of [390, 320]) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    locale: "ja-JP",
    isMobile: true,
    hasTouch: true,
  });
  const phone = await context.newPage();
  watch(phone);
  try {
    await check(
      `${width}px SNS screens fit and keep the bottom navigation`,
      async () => {
        for (const route of [
          "/feed/",
          "/posts/?id=tou-solaris",
          "/books/solaris/",
          "/profiles/r-tou/",
          "/profiles/me/",
        ]) {
          await go(phone, route);
          await noOverflow(phone, `${width}px ${route}`);
          const nav = phone.getByRole("navigation", {
            name: "スマートフォンナビゲーション",
          });
          await expect(
            nav.getByRole("link", { name: "タイムライン" }),
          ).toBeVisible();
        }
        await go(phone, "/feed/");
        await phone.screenshot({
          path: path.join(output, `sns-feed-${width}.png`),
          animations: "disabled",
        });
      },
    );
    await check(
      `${width}px floating button opens a full-screen composer`,
      async () => {
        await phone.getByRole("button", { name: "新しく投稿する" }).tap();
        const dialog = composer(phone);
        await expect(dialog).toBeVisible();
        const box = await dialog.boundingBox();
        expect(box.width).toBeLessThanOrEqual(width + 1);
        expect(Math.round(box.x)).toBe(0);
        await expect(
          dialog.getByRole("button", { name: "投稿する", exact: true }),
        ).toBeInViewport();
        await noOverflow(phone, `${width}px composer`);
        await phone.screenshot({
          path: path.join(output, `sns-composer-${width}.png`),
          animations: "disabled",
        });
        await dialog.getByRole("button", { name: "閉じる" }).tap();
        await expect(dialog).toHaveCount(0);
      },
    );
  } finally {
    await context.close();
  }
}

await check(
  "No hydration failures, browser exceptions or console errors",
  async () => {
    expect(errors).toEqual([]);
  },
);
await browser.close();
console.log(`${passed} SNS browser checks passed.`);
