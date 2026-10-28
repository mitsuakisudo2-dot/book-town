import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { settleBeforeNavigating } from "./journey-layers.mjs";
import { expectReadable } from "./journey-contrast.mjs";

// A reader makes a poster about a book, puts it up, finds it on the
// home, their profile and the book's page, changes it and takes it down;
// and reads others' posters page by page, a spoiler only when they choose to.

const baseURL = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/booktown/poster-qa",
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
/** Opens Home on ホーム (a fresh `/` opens the tab shown last). */
async function goHome() {
  await go("/");
  const home = page
    .getByRole("tablist", { name: "ホームの表示" })
    .getByRole("tab", { name: "ホーム" });
  if ((await home.getAttribute("aria-selected")) !== "true") await home.click();
  await expect(page).toHaveURL(`${baseURL}/`);
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
        const offered = (title) =>
          editor().getByRole("button", { name: new RegExp(`^${title}の表紙`) });
        // A near title waits under a quiet heading that is still readable.
        await search.fill("秘密の森の花園");
        await expect(editor().locator(".search-near")).toBeVisible();
        await expectReadable(editor().locator(".search-near"), "近い題名の本");
        // Several titles hold 孤独: Enter waits for a tap.
        await search.fill("孤独");
        await search.press("Enter");
        // A poster put up would have moved to its own page by now.
        await page.waitForTimeout(400);
        await expect(page).toHaveURL(/\/posters\/new\/\?book=solaris/);
        await expect(heading).toHaveValue("まだ書いている途中");
        await expect(search).toHaveValue("孤独");
        // A book surely meant, here read from kana, is taken as in every
        // picker, and the poster still waits for 貼り出す.
        await search.fill("もも");
        await search.press("Enter");
        await page.waitForTimeout(400);
        await expect(page).toHaveURL(/\/posters\/new\/\?book=solaris/);
        await expect(heading).toHaveValue("まだ書いている途中");
        await expect(search).toHaveValue("");
        await expect(offered("モモ")).toHaveAttribute("aria-pressed", "true");
        await expect(offered("ソラリス")).toHaveAttribute(
          "aria-pressed",
          "false",
        );
        // Back to the book this poster is about, by its romaji.
        await search.fill("solaris");
        await search.press("Enter");
        await expect(search).toHaveValue("");
        await expect(offered("ソラリス")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
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
          page.getByText("書きかけは、このブラウザに残しています"),
        ).toBeVisible();
        await page.reload();
        await expect(page.getByRole("textbox", { name: "見出し" })).toHaveValue(
          "海を前にした夜に",
        );
        await expect(
          page.getByRole("textbox", { name: "この本のこと" }),
        ).toHaveValue("わからないまま、見つめ続ける話。");
        // Thrown away only when asked, in the words every screen uses, with
        // answers the size of a finger.
        const line = page.locator(".poster-editor-kept");
        await line.getByRole("button", { name: "書きかけを消す" }).click();
        await expect(line).toContainText("書きかけを消しますか？");
        for (const name of ["消す", "残す"]) {
          const box = await line
            .getByRole("button", { name, exact: true })
            .boundingBox();
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        await line.getByRole("button", { name: "残す", exact: true }).click();
        await expect(
          line.getByRole("button", { name: "書きかけを消す" }),
        ).toBeFocused();
        await expect(page.getByRole("textbox", { name: "見出し" })).toHaveValue(
          "海を前にした夜に",
        );
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
      `${at}: the poster is on Home, the profile and the book`,
      async () => {
        await goHome();
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
      `${at}: work begun before the poster changed elsewhere waits for the maker`,
      async () => {
        const id = new URL(baseURL + posterUrl).searchParams.get("id");
        await go(posterUrl);
        await page.getByRole("link", { name: "直す" }).click();
        const heading = page.getByRole("textbox", { name: "見出し" });
        await heading.fill("書きかけの見出し");
        await go(posterUrl);
        // Another device changes the poster meanwhile.
        await page.evaluate((posterId) => {
          const town = JSON.parse(localStorage.getItem("book-town-v1"));
          town.data.posters.find(
            (poster) => poster.id === posterId,
          ).pages[0].heading = "別の端末の見出し";
          localStorage.setItem("book-town-v1", JSON.stringify(town));
        }, id);
        await page.reload();
        await expect(
          page.getByText(
            "このポスターの書きかけを、このブラウザに残しています。",
          ),
        ).toBeVisible();
        await page.screenshot({
          path: path.join(output, `${at}-poster-work-kept.png`),
          fullPage: true,
        });
        await page.getByRole("link", { name: "直す" }).click();
        const note = editor().locator(".poster-editor-kept").first();
        await expect(note).toContainText(
          "書きかけより新しいポスターが保存されています",
        );
        // The poster saved now is shown, and nothing is written over the
        // older work before the maker chooses: the hand is on the choice.
        await expect(heading).toHaveValue("別の端末の見出し");
        await expect(heading).toBeDisabled();
        await expect(
          editor().getByRole("button", { name: "直して貼り出す" }),
        ).toBeDisabled();
        const open = note.getByRole("button", { name: "書きかけを開く" });
        await expect(open).toBeFocused();
        await page.screenshot({
          path: path.join(output, `${at}-poster-work-waits.png`),
        });
        // Asked for, the older work opens, and putting it up is said to
        // replace the poster saved now.
        await open.click();
        await expect(heading).toHaveValue("書きかけの見出し");
        await expect(heading).toBeEnabled();
        await expect(editor().locator(".poster-editor-kept")).toContainText(
          "保存すると、いま保存されているポスターと入れ替わります",
        );
        await editor().locator(".poster-editor-kept").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(output, `${at}-poster-work-opened.png`),
        });
        await heading.fill("海を前にした長い夜に");
        await editor().getByRole("button", { name: "直して貼り出す" }).click();
        await toast("ポスターを直しました。");
        await expect(
          page.getByRole("heading", { name: "海を前にした長い夜に", level: 1 }),
        ).toBeVisible();
        await expect(
          page.getByText(
            "このポスターの書きかけを、このブラウザに残しています。",
          ),
        ).toHaveCount(0);
        expect(
          await page.evaluate(() =>
            localStorage.getItem("book-town-poster-drafts-v1"),
          ),
        ).toBeNull();
      },
    );

    await check(
      `${at}: a lineup kept as a draft is the maker's alone`,
      async () => {
        // From the writing sheet, as the timeline's own button is gone.
        await goHome();
        await page.locator(".compose-fab").click();
        await page
          .getByRole("dialog", { name: "投稿する" })
          .getByRole("button", { name: "ポスターを作る" })
          .click();
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
        // A draft is not on Home.
        await goHome();
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

    await check(
      `${at}: a reader who leaves spoilers out is not shown others' spoiler posters`,
      async () => {
        const setting = async (label) => {
          await go("/profiles/me/");
          await page.getByRole("button", { name: "設定" }).click();
          await page
            .getByRole("dialog", { name: "設定" })
            .getByRole("group", { name: "ネタバレの表示" })
            .getByLabel(label)
            .check();
          await page.keyboard.press("Escape");
        };
        const spoilerThumb = () =>
          page.getByRole("link", { name: /^ネタバレを含むポスター/ });
        // By default a spoiler poster is listed among 「街の便り」, behind
        // its door.
        await goHome();
        await expect(
          page.getByRole("article", { name: "はるのポスター" }),
        ).toBeVisible();
        await setting("読んだところより先のネタバレは、一覧にも出さない");
        await goHome();
        await expect(
          page.getByRole("article", { name: "はるのポスター" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("article", { name: "栞のポスター" }),
        ).toBeVisible();
        await go("/profiles/r-haru/");
        await expect(spoilerThumb()).toHaveCount(0);
        // The book's page says once, without a count, that some were left out.
        await go("/books/hundred-years/");
        await expect(spoilerThumb()).toHaveCount(0);
        const leftOut = page.getByText(
          "ネタバレを含むポスターは、設定により出していません",
        );
        await expect(leftOut).toBeVisible();
        await expect(leftOut).not.toContainText(/\d/);
        await expect(
          page.getByRole("link", { name: "この本でポスターを作る" }),
        ).toBeVisible();
        await noOverflow(`${at} book page, spoiler posters left out`);
        await page.screenshot({
          path: path.join(output, `${at}-posters-left-out.png`),
          fullPage: true,
        });
        // Opened from its own address, it is there, still behind its door.
        await go("/posters/?id=poster-haru-last-page");
        await expect(
          page.getByRole("heading", {
            name: "ネタバレを含むポスター",
            level: 1,
          }),
        ).toBeVisible();
        await page.getByRole("button", { name: "表示する" }).click();
        await expect(
          page
            .getByRole("region", { name: "はるのポスター" })
            .locator(".poster-sheet")
            .first(),
        ).toBeVisible();
        // Showing all: no door anywhere, as for a 便り (けにーさん 10-27).
        await setting("すべて表示する");
        await go("/books/hundred-years/");
        await expect(spoilerThumb()).toHaveCount(0);
        await expect(leftOut).toHaveCount(0);
        await go("/posters/?id=poster-haru-last-page");
        await expect(
          page.getByRole("button", { name: "表示する" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "もう一度隠す" }),
        ).toHaveCount(0);
        await expect(
          page
            .getByRole("region", { name: "はるのポスター" })
            .locator(".poster-sheet")
            .first(),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "ネタバレを含むポスター" }),
        ).toHaveCount(0);
        await goHome();
        const card = page.getByRole("article", { name: "はるのポスター" });
        await expect(card.locator(".poster-sheet").first()).toBeVisible();
        await expect(card.getByText("ネタバレあり")).toBeVisible();
        await expect(
          card.getByRole("button", { name: "表示する" }),
        ).toHaveCount(0);
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(output, `${at}-spoiler-poster-shown-all.png`),
        });
        // Back to folding: listed again, behind its door.
        await setting("読んだところより先のネタバレは、たたんで表示する");
        await go("/books/hundred-years/");
        await expect(spoilerThumb()).toBeVisible();
        await expect(leftOut).toHaveCount(0);
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
