import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { settleBeforeNavigating } from "./journey-layers.mjs";

// A reader makes a poster about a book, puts it up, finds it on the
// timeline, their profile and the book's page, changes it and takes it down;
// and reads others' posters page by page, a spoiler only when they choose to.

const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/poster-qa",
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
  expect(size.document, `${label}: root overflow`).toBeLessThanOrEqual(
    size.width + 1,
  );
}
const toast = (text) =>
  expect(page.getByText(text, { exact: true }).first()).toBeVisible();
const editor = () => page.locator("main form");

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
    const at = viewport.width < 600 ? "phone" : "desktop";

    await check(
      `${at}: a book's page offers to make a poster with it`,
      async () => {
        await go("/books/solaris/");
        const row = page.getByRole("heading", {
          name: "この本が出てくるポスター",
        });
        await expect(row).toBeVisible();
        await expect(
          page.getByRole("link", { name: /^ポスター 眠れない夜に読んだSF/ }),
        ).toBeVisible();
        await page
          .getByRole("link", { name: "この本でポスターを作る" })
          .click();
        await expect(page).toHaveURL(/\/posters\/new\/\?book=solaris/);
        await expect(
          page.getByRole("heading", { name: "ポスターを作る", level: 1 }),
        ).toBeVisible();
        await expect(
          page.getByRole("radio", { name: /^1冊を語る/ }),
        ).toBeChecked();
        await expect(
          editor().getByRole("button", { name: /^ソラリスの表紙/ }),
        ).toHaveAttribute("aria-pressed", "true");
        await noOverflow(`${at} editor`);
      },
    );

    await check(
      `${at}: an unfinished poster says what it still needs`,
      async () => {
        await editor()
          .getByRole("button", { name: "貼り出す", exact: true })
          .click();
        await expect(editor().getByRole("alert")).toContainText(
          "ひとことを書いてください。",
        );
        await expect(page).toHaveURL(/\/posters\/new\//);
      },
    );

    await check(
      `${at}: Enter in a text box does not put the poster up`,
      async () => {
        const heading = page.getByRole("textbox", { name: "見出し" });
        await heading.fill("まだ書いている途中");
        await heading.press("Enter");
        const search = editor().getByRole("searchbox", {
          name: "ポスターに載せる本を探す",
        });
        await search.fill("モモ");
        await search.press("Enter");
        // A poster put up would have moved to its own page by now.
        await page.waitForTimeout(400);
        await expect(page).toHaveURL(/\/posters\/new\/\?book=solaris/);
        await expect(heading).toHaveValue("まだ書いている途中");
        await search.fill("");
      },
    );

    await check(
      `${at}: words typed are kept in the browser through a reload`,
      async () => {
        await page
          .getByRole("textbox", { name: "見出し" })
          .fill("海を前にした夜に");
        await page
          .getByRole("textbox", { name: "この本のこと" })
          .fill("わからないまま、見つめ続ける話。");
        await expect(
          page.getByText("書きかけは、このブラウザに残しています。"),
        ).toBeVisible();
        await page.reload();
        await expect(page.getByRole("textbox", { name: "見出し" })).toHaveValue(
          "海を前にした夜に",
        );
        await expect(
          page.getByRole("textbox", { name: "この本のこと" }),
        ).toHaveValue("わからないまま、見つめ続ける話。");
      },
    );

    let posterUrl = "";
    await check(
      `${at}: a finished poster is put up and opens on its own page`,
      async () => {
        await editor()
          .getByRole("button", { name: "貼り出す", exact: true })
          .click();
        await expect(page).toHaveURL(/\/posters\/\?id=me-poster-/);
        posterUrl = page.url().replace(baseURL, "");
        await toast("ポスターを貼り出しました。");
        await expect(
          page.getByRole("heading", { name: "海を前にした夜に", level: 1 }),
        ).toBeVisible();
        await expect(page.getByRole("link", { name: "直す" })).toBeVisible();
        // Its cover leads to the book.
        await expect(
          page.locator(".poster-pages a[href*='/books/solaris']").first(),
        ).toBeVisible();
        await noOverflow(`${at} poster page`);
      },
    );

    await check(
      `${at}: the poster is on the timeline, the profile and the book`,
      async () => {
        await go("/timeline/");
        const card = page
          .getByRole("article", { name: "あなたのポスター" })
          .filter({ hasText: "海を前にした夜に" });
        await expect(card).toBeVisible();
        await go("/profile/");
        await expect(
          page.getByRole("link", { name: /^ポスター 海を前にした夜に/ }),
        ).toBeVisible();
        await go("/books/solaris/");
        await expect(
          page.getByRole("link", { name: /^ポスター 海を前にした夜に/ }),
        ).toBeVisible();
      },
    );

    await check(`${at}: the maker changes a put-up poster`, async () => {
      await go(posterUrl);
      await page.getByRole("link", { name: "直す" }).click();
      await expect(
        page.getByRole("heading", { name: "ポスターを直す", level: 1 }),
      ).toBeVisible();
      // A put-up poster cannot be turned back into a draft by accident.
      await expect(
        editor().getByRole("button", { name: "下書きに残す" }),
      ).toHaveCount(0);
      await page
        .getByRole("textbox", { name: "見出し" })
        .fill("海を前にした長い夜に");
      await editor().getByRole("button", { name: "直して貼り出す" }).click();
      await toast("ポスターを直しました。");
      await expect(page).toHaveURL(/\/posters\/\?id=me-poster-/);
      await expect(
        page.getByRole("heading", { name: "海を前にした長い夜に", level: 1 }),
      ).toBeVisible();
      // The editor is done with: going back does not open it again.
      await page.goBack();
      await expect(page).not.toHaveURL(/\/posters\/new\//);
    });

    await check(
      `${at}: a lineup kept as a draft is the maker's alone`,
      async () => {
        await go("/timeline/");
        await page.locator(".timeline-make-poster").click();
        await expect(page).toHaveURL(/\/posters\/new\/$/);
        await page.getByRole("radio", { name: /^並べる/ }).check();
        await editor()
          .getByRole("button", { name: /^ソラリスの表紙/ })
          .click();
        await editor()
          .getByRole("button", { name: "貼り出す", exact: true })
          .click();
        await expect(editor().getByRole("alert")).toContainText(
          "本を2冊以上選んでください。",
        );
        await editor().getByRole("button", { name: "下書きに残す" }).click();
        await toast("下書きに残しました。");
        await expect(
          page.getByText("下書きです。まだ、あなたにだけ見えています。"),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "仕上げて貼り出す" }),
        ).toBeVisible();
        await go("/profile/");
        await expect(
          page.getByRole("link", { name: /（下書き）$/ }),
        ).toBeVisible();
        // A draft is not on the timeline.
        await go("/timeline/");
        await expect(
          page.getByRole("article", { name: "あなたのポスター" }),
        ).toHaveCount(1);
      },
    );

    await check(
      `${at}: another reader's poster turns page by page`,
      async () => {
        await go("/posters/?id=poster-sumire-weekend");
        const pages = page.getByRole("region", { name: "すみれのポスター" });
        await expect(
          pages.getByRole("button", { name: "1ページ目" }),
        ).toHaveAttribute("aria-current", "true");
        await pages.getByRole("button", { name: "次のページ" }).click();
        await expect(
          pages.getByRole("button", { name: "2ページ目" }),
        ).toHaveAttribute("aria-current", "true");
        await expect(
          pages.getByRole("button", { name: "次のページ" }),
        ).toBeDisabled();
        await expect(page.getByRole("link", { name: "直す" })).toHaveCount(0);
        await expect(
          page.getByRole("link", { name: "わたしもポスターを作る" }),
        ).toBeVisible();
      },
    );

    await check(
      `${at}: a spoiler poster is shown only when asked, and hides again`,
      async () => {
        await go("/posters/?id=poster-haru-last-page");
        await expect(
          page.getByRole("heading", {
            name: "ネタバレを含むポスター",
            level: 1,
          }),
        ).toBeVisible();
        const door = page.getByRole("region", { name: /ネタバレを含みます/ });
        await expect(door.locator(".poster-sheet")).toHaveCount(0);
        await door.getByRole("button", { name: "表示する" }).click();
        const open = page.getByRole("region", { name: "はるのポスター" });
        await expect(open.locator(".poster-sheet").first()).toBeVisible();
        await open.getByRole("button", { name: "もう一度隠す" }).click();
        await expect(
          page.getByRole("button", { name: "表示する" }),
        ).toBeFocused();
        await expect(page.locator(".poster-pages .poster-sheet")).toHaveCount(
          0,
        );
      },
    );

    await check(`${at}: a missing poster says so kindly`, async () => {
      await go("/posters/?id=no-such-poster");
      await expect(
        page.getByText("このポスターは、いまは貼られていません。"),
      ).toBeVisible();
    });

    await check(`${at}: the maker takes a poster down`, async () => {
      await go(posterUrl);
      await page.getByRole("link", { name: "直す" }).click();
      await page.getByRole("button", { name: "このポスターを消す" }).click();
      await page
        .getByRole("group", { name: "ポスターを消す" })
        .getByRole("button", { name: "消す" })
        .click();
      await toast("ポスターを消しました。");
      await expect(
        page.getByRole("link", { name: /^ポスター 海を前にした長い夜に/ }),
      ).toHaveCount(0);
      await page.screenshot({
        path: path.join(output, `${at}-profile.png`),
        fullPage: true,
      });
      await page.goBack();
      await expect(page).not.toHaveURL(/\/posters\/new\//);
    });

    await context.close();
  }
  if (errors.length) throw new Error("Browser errors:\n" + errors.join("\n"));
  console.log(`${passed.length} passed`);
} finally {
  await browser.close();
}
