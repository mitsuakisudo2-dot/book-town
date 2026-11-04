import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { settleBeforeNavigating } from "./journey-layers.mjs";
import { expectReadable } from "./journey-contrast.mjs";
import {
  coarse,
  expectNoKeyboard,
  expectTapWrites,
} from "./journey-keyboard.mjs";
const base = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../outputs/phase2-customization-qa",
);
await mkdir(output, { recursive: true });
// Uses Playwright's own Chromium unless BOOK_TOWN_CHROME names another browser.
const browser = await chromium.launch({
  executablePath: process.env.BOOK_TOWN_CHROME || undefined,
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "ja-JP",
});
const page = settleBeforeNavigating(await context.newPage());
const passed = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function check(name, run) {
  await run();
  passed.push(name);
  console.log("PASS " + name);
}
const tidy = () => page.locator(".tidy");
/** Opens 整える on the reader's own shop. */
async function open(on = page) {
  await on.goto(base + "/my-shop/");
  await on.getByRole("button", { name: "店を整える", exact: true }).click();
  await expect(on.locator(".tidy .walk-artboard")).toBeVisible();
}
async function close() {
  await tidy().getByRole("button", { name: "閉じる" }).first().click();
  await expect(tidy()).toHaveCount(0);
}
/** The sheet of the sign: its name, the greeting, the stamp and the mood. */
async function face() {
  await tidy().getByRole("button", { name: "看板", exact: true }).click();
  await expect(tidy().getByLabel("看板の店名")).toBeVisible();
}
/** The sheet of the room: the wood shop's three templates and the looks. */
async function room() {
  await tidy().getByRole("button", { name: "店内", exact: true }).click();
  await expect(tidy().locator(".scene-template-options")).toBeVisible();
}
/** A book's sheet (Enter opens even a thin spine's own). */
async function bookSheet(id) {
  await tidy().locator(`[data-placement="${id}"]`).press("Enter");
  await expect(tidy().locator(".tidy-sheet .tidy-title")).toBeVisible();
}
/** A book's POP, written on its sheet. */
async function writePop(id) {
  await bookSheet(id);
  await tidy()
    .getByRole("button", { name: /POPを(書く|直す)/ })
    .click();
  return tidy().getByLabel("この本のPOP");
}
/** A tier's sheet (the first one's unless named), opened from its board. */
async function rowSheet(rowId) {
  await tidy()
    .locator(rowId ? `.walk-row[data-row="${rowId}"]` : ".walk-row[data-row]")
    .first()
    .locator(".walk-row-board, .walk-zoom-trigger")
    .first()
    .click();
  await expect(tidy().getByLabel("棚の案内札")).toBeVisible();
}
async function walkData() {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("book-town-walk-v1")),
  );
}
async function legacy() {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("book-town-v1")).data,
  );
}
const DRAFTS = "book-town-scene-drafts-v1";
async function drafts() {
  return page.evaluate((key) => localStorage.getItem(key), DRAFTS);
}
const objectOf = async (id) =>
  (await walkData()).sceneOverrides[0].objects.find((o) => o.id === id);
try {
  await page.goto(base + "/my-shop/");
  await page.getByRole("button", { name: "空の棚から始める" }).click();
  await page.getByLabel("書店の名前").fill("私の静かな本屋");
  await page.getByRole("button", { name: "書店をひらく", exact: true }).click();
  await page.getByRole("button", { name: "店を整える" }).click();
  await expect(tidy().locator(".walk-artboard")).toBeVisible();
  await close();
  await expect(page.locator(".shop-editor")).toBeVisible();
  await check(
    "empty saved store explains how to open it instead of opening a different shop",
    async () => {
      // A size chosen for the empty shop saves its scene, with no books.
      await open();
      await tidy()
        .getByRole("button", { name: "店の大きさ", exact: true })
        .click();
      await tidy().getByRole("button", { name: "1段", exact: true }).click();
      await expect
        .poll(async () => (await walkData())?.sceneOverrides?.length)
        .toBe(1);
      await close();
      await expect(
        page.getByRole("link", { name: "店内を眺める", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText(
          "公開する棚に本を並べると、書店めぐりに灯りがともります。",
          { exact: true },
        ),
      ).toBeVisible();
      // In the walk, asking for one's own empty shop says why it is not there.
      await page.goto(base + "/walk/#mine");
      const missing = page.locator(".walk-own-missing");
      await expect(missing).toContainText("まだ棚に本がないので");
      await expect(
        missing.getByRole("link", { name: "自分の書店を整える" }),
      ).toHaveAttribute("href", "/my-shop/?tidy=1");
      await missing.getByRole("button", { name: "閉じる" }).click();
      await expect(missing).toHaveCount(0);
      await page.goto(base + "/my-shop/");
    },
  );
  await page.evaluate(() => {
    localStorage.removeItem("book-town-walk-v1");
    const envelope = JSON.parse(localStorage.getItem("book-town-v1"));
    envelope.data.ownShop.shelves = [
      {
        id: "public",
        name: "旅の入口",
        capacity: 20,
        isPublic: true,
        items: [
          { id: "a", bookId: "solaris", display: "face", pop: "公の言葉" },
          {
            id: "b",
            bookId: "left-hand",
            display: "spine",
            pop: "雪の星のこと",
          },
        ],
      },
      {
        id: "private",
        name: "秘密の棚",
        capacity: 20,
        isPublic: false,
        items: [
          {
            id: "secret",
            bookId: "solaris",
            display: "face",
            pop: "秘密の言葉",
          },
        ],
      },
    ];
    envelope.data.library = ["solaris", "left-hand", "momo"];
    envelope.data.popReactions[JSON.stringify(["mine", "public", "a"])] = [
      "like",
    ];
    localStorage.setItem("book-town-v1", JSON.stringify(envelope));
  });
  await page.reload();
  const original = (await legacy()).ownShop;
  await check(
    "own-store entry opens 整える; demo shops have none, and opening writes nothing",
    async () => {
      await page.goto(base + "/shops/shop-orbit/");
      await expect(
        page.getByRole("button", { name: "店を整える", exact: true }),
      ).toHaveCount(0);
      await open();
      // The public shelf's two books stand in the shop; the secret one not.
      await expect(tidy().locator("[data-placement]")).toHaveCount(2);
      await room();
      await expect(
        tidy().locator(".scene-template-options button"),
      ).toHaveCount(5);
      await close();
      expect((await legacy()).ownShop).toEqual(original);
      const value = await page.evaluate(() =>
        localStorage.getItem("book-town-walk-v1"),
      );
      expect(value ? JSON.parse(value).sceneOverrides : []).toHaveLength(0);
    },
  );
  await check(
    "the sign, a tier's label, a POP and its airplane stamp are saved where they are written",
    async () => {
      await open();
      await face();
      await tidy().getByLabel("看板の店名").fill("夜道の本屋");
      await rowSheet();
      await tidy().getByLabel("棚の案内札").fill("遠くへ行く本");
      const pop = await writePop("placement:mine:a");
      await pop.fill("遠い星の海で、言葉のない相手に出会う。");
      await tidy()
        .getByRole("group", { name: "POPのスタンプ" })
        .getByRole("button", { name: "飛行機" })
        .click();
      await page.screenshot({
        path: path.join(output, "tidy-desktop.png"),
        animations: "disabled",
      });
      await tidy().getByRole("button", { name: "できた", exact: true }).click();
      const data = await walkData();
      expect(data.schemaVersion).toBe(2);
      expect(data.legacyBackups).toHaveLength(1);
      expect(data.legacyBackups[0].shop).toEqual(original);
      expect((await objectOf("sign")).text).toBe("夜道の本屋");
      expect((await objectOf("pop:placement:mine:a")).stamp).toBe("plane");
      expect((await legacy()).ownShop).toEqual(original);
      await close();
    },
  );
  await check(
    "reload keeps what was written, and the private book stays out",
    async () => {
      await page.reload();
      await open();
      await face();
      await expect(tidy().getByLabel("看板の店名")).toHaveValue("夜道の本屋");
      await rowSheet();
      await expect(tidy().getByLabel("棚の案内札")).toHaveValue("遠くへ行く本");
      await expect(await writePop("placement:mine:a")).toHaveValue(
        "遠い星の海で、言葉のない相手に出会う。",
      );
      await expect(
        tidy()
          .getByRole("group", { name: "POPのスタンプ" })
          .getByRole("button", { name: "飛行機" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        tidy().locator('[data-placement="placement:mine:secret"]'),
      ).toHaveCount(0);
      await tidy().getByRole("button", { name: "できた", exact: true }).click();
      await tidy().locator(".tidy-sheet-close").click();
      await expect(
        tidy().getByRole("button", { name: "まだ並べていない本 · 1冊" }),
      ).toBeVisible();
      await close();
    },
  );
  await check(
    "managed store appears in walk and reactions use the exact native POP target",
    async () => {
      await page.goto(base + "/walk/#mine");
      await expect(page.locator(".walk-sign")).toHaveText("夜道の本屋");
      await expect(
        page.locator('[data-placement="placement:mine:secret"]'),
      ).toHaveCount(0);
      await expect(
        page.locator(".walk-book-pop").filter({ hasText: "秘密の言葉" }),
      ).toHaveCount(0);
      await page.screenshot({
        path: path.join(output, "own-store-desktop.png"),
        animations: "disabled",
      });
      await page.locator('[data-placement="placement:mine:a"]').click();
      const shownPop = page.locator(".bh-pop-page.is-current");
      await expect(shownPop.locator(".bh-pop-text")).toHaveText(
        "遠い星の海で、言葉のない相手に出会う。",
      );
      await expect(shownPop.locator(".bh-pop-stamp")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "いいね", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page
        .getByRole("button", { name: "読みたくなった", exact: true })
        .click();
      expect(
        (await walkData()).walkState.placementReactions[
          JSON.stringify(["scene", "mine", "placement:mine:a"])
        ],
      ).toEqual(["like", "read"]);
      expect(
        (await legacy()).popReactions[JSON.stringify(["mine", "public", "a"])],
      ).toEqual(["like"]);
      await page.getByRole("button", { name: "次のPOP", exact: true }).click();
      await expect(shownPop.locator(".bh-pop-text")).not.toHaveText(
        "遠い星の海で、言葉のない相手に出会う。",
      );
      await expect(
        page.getByRole("button", { name: "読みたくなった", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await page.getByRole("button", { name: "前のPOP", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "読みたくなった", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.locator(".bh-dialog").press("Escape");
    },
  );
  await check(
    "different templates preserve book IDs, POPs, reactions and private status",
    async () => {
      const before = (await walkData()).sceneOverrides[0];
      await open();
      await room();
      await tidy()
        .getByRole("button", { name: /窓辺の選書/ })
        .click();
      await expect
        .poll(async () => (await walkData()).sceneOverrides[0].templateId)
        .toBe("window");
      const next = (await walkData()).sceneOverrides[0];
      expect(
        next.objects.filter((o) => o.kind === "book").map((o) => o.id),
      ).toEqual(
        before.objects.filter((o) => o.kind === "book").map((o) => o.id),
      );
      expect(next.objects.find((o) => o.id === "pop:placement:mine:a")).toEqual(
        before.objects.find((o) => o.id === "pop:placement:mine:a"),
      );
      expect(
        next.objects.find((o) => o.id === "placement:mine:secret").isPublic,
      ).toBe(false);
      // Each book stays on its row, in its order there.
      const rows = (scene) =>
        scene.objects
          .filter((o) => o.kind === "book")
          .map((o) => [o.id, o.parentId, o.order]);
      expect(rows(next)).toEqual(rows(before));
      expect((await walkData()).legacyBackups).toHaveLength(1);
      await close();
    },
  );
  await check(
    "a look (店内) changes the room and the case; the books, POPs and words stay, and a visitor sees it",
    async () => {
      const before = (await walkData()).sceneOverrides[0];
      await open();
      await room();
      await tidy()
        .getByRole("button", { name: /海辺の朝/ })
        .click();
      await expect
        .poll(async () => (await walkData()).sceneOverrides[0].theme.id)
        .toBe("seaside");
      const sea = (await walkData()).sceneOverrides[0];
      expect(sea.background.url).toBe("/themes/seaside/room-v1.webp");
      expect(sea.objects).toEqual(before.objects);
      await expect(
        tidy().locator('.walk-store-objects[data-look="seaside"]'),
      ).toHaveCount(1);
      await expect(
        tidy().getByRole("button", { name: /海辺の朝/ }),
      ).toHaveAttribute("aria-pressed", "true");
      await close();
      await page.goto(base + "/walk/#mine");
      await expect(page.locator('.walk-view[data-look="seaside"]')).toHaveCount(
        1,
      );
      await expect(page.locator(".walk-room img").first()).toHaveAttribute(
        "src",
        /seaside\/room-v1/,
      );
      await page.goto(base + "/my-shop/");
      // The wood shop comes back with its own room.
      await open();
      await room();
      await tidy()
        .getByRole("button", { name: /窓辺の選書/ })
        .click();
      await expect
        .poll(async () => (await walkData()).sceneOverrides[0].theme.id)
        .toBe("woodshop");
      await expect(
        tidy().locator(".walk-store-objects[data-look]"),
      ).toHaveCount(0);
      await close();
    },
  );
  await check(
    "take off and set out again keeps the POP and stamp",
    async () => {
      await open();
      await bookSheet("placement:mine:a");
      await tidy()
        .getByRole("button", { name: "棚から下ろす", exact: true })
        .click();
      await expect
        .poll(async () => (await objectOf("placement:mine:a")).parentId)
        .toBe(null);
      await tidy()
        .getByRole("button", { name: /^まだ並べていない本 · / })
        .click();
      await tidy()
        .locator(".tidy-list button")
        .filter({ hasText: "ソラリス" })
        .filter({ hasText: "並べる" })
        .click();
      await expect
        .poll(async () => (await objectOf("placement:mine:a")).parentId)
        .not.toBe(null);
      expect((await objectOf("pop:placement:mine:a")).text).toBe(
        "遠い星の海で、言葉のない相手に出会う。",
      );
      expect((await objectOf("pop:placement:mine:a")).stamp).toBe("plane");
      await close();
    },
  );
  await check(
    "本を足す finds a book by romaji and kana, and the shop takes it",
    async () => {
      await open();
      await tidy()
        .getByRole("button", { name: "本を足す", exact: true })
        .click();
      const search = tidy().getByRole("searchbox", { name: "足す本を探す" });
      // Romaji and kana find a book here as in every search.
      for (const typed of ["momo", "もも"]) {
        await search.fill(typed);
        await expect(
          tidy().locator(".tidy-covers button").first(),
        ).toContainText("モモ");
      }
      await tidy().locator(".tidy-covers button").first().click();
      const momo = async () =>
        (await walkData()).sceneOverrides[0].objects.find(
          (o) => o.kind === "book" && o.bookId === "momo",
        );
      await expect
        .poll(async () => (await momo())?.parentId ?? null)
        .not.toBe(null);
      const id = (await momo()).id;
      const pop = await writePop(id);
      await pop.fill("急がなくてもいい。コーヒーを一杯。");
      await tidy()
        .getByRole("group", { name: "POPのスタンプ" })
        .getByRole("button", { name: "コーヒー" })
        .click();
      await expect
        .poll(async () => (await objectOf("pop:" + id))?.stamp)
        .toBe("coffee");
      await close();
    },
  );
  await check(
    "private shelf is excluded from rendered books and POP discovery",
    async () => {
      // The tier that holds ソラリス and モモ (the shop may have grown).
      const tier = (await objectOf("placement:mine:a")).parentId;
      await open();
      await rowSheet(tier);
      await tidy().getByLabel("この段を公開する").uncheck();
      await close();
      await page.goto(base + "/walk/#mine");
      await expect(
        page.locator('[data-placement="placement:mine:a"]'),
      ).toHaveCount(0);
      await expect(
        page.locator(".walk-book-pop").filter({ hasText: "コーヒー" }),
      ).toHaveCount(0);
      await open();
      await rowSheet(tier);
      await tidy().getByLabel("この段を公開する").check();
      await close();
    },
  );
  await check(
    "words written in 整える stay through Escape, 戻る and a reload",
    async () => {
      const ways = {
        Escape: () => page.keyboard.press("Escape"),
        戻る: () => page.goBack(),
        "a reload": () => page.reload(),
      };
      for (const [way, leave] of Object.entries(ways)) {
        const words = "雨の日の本屋へ、ようこそ。(" + way + ")";
        await open();
        await face();
        await tidy().getByLabel("店主からのひとこと").fill(words);
        await leave();
        await expect(tidy()).toHaveCount(0);
        await expect(page).toHaveURL(/\/my-shop\/$/);
        await open();
        await face();
        await expect(tidy().getByLabel("店主からのひとこと")).toHaveValue(
          words,
        );
        await close();
      }
      // Saved as written, nothing waits in this browser.
      expect(await drafts()).toBe(null);
    },
  );
  await check(
    "work begun before a scene saved elsewhere waits, and is put back or thrown away as asked",
    async () => {
      const greeting = async () => (await objectOf("greeting")).text;
      const before = await greeting();
      /** Work kept here, begun from a scene saved over since. */
      const keep = (words) =>
        page.evaluate(
          ([key, words]) => {
            const scene = JSON.parse(localStorage.getItem("book-town-walk-v1"))
              .sceneOverrides[0];
            scene.objects.find((o) => o.id === "greeting").text = words;
            localStorage.setItem(
              key,
              JSON.stringify({
                version: 1,
                drafts: { "demo/mine": { scene, from: "elsewhere" } },
              }),
            );
          },
          [DRAFTS, words],
        );
      await keep("古い書きかけ");
      await page.goto(base + "/my-shop/");
      const keptHere = page.getByText(
        "店内の書きかけを、このブラウザに残しています。",
      );
      await expect(keptHere).toBeVisible();
      await page
        .getByRole("button", { name: "店を整える", exact: true })
        .click();
      const note = tidy().locator(".tidy-kept");
      await expect(note).toContainText(
        "書きかけより新しい店が保存されています。戻すと、いまの店と入れ替わります",
      );
      await page.screenshot({
        path: path.join(output, "tidy-work-kept.png"),
        animations: "disabled",
      });
      // Nothing new is written over it until the reader chooses.
      await face();
      await tidy().getByLabel("店主からのひとこと").fill("上書きしない");
      await expect(
        page.getByText("書きかけを戻すか消すと、続けて整えられます。"),
      ).toBeVisible();
      expect(await greeting()).toBe(before);
      expect(await drafts()).toContain("古い書きかけ");
      await note
        .getByRole("button", { name: "書きかけを戻す", exact: true })
        .click();
      await expect.poll(greeting).toBe("古い書きかけ");
      await expect(note).toHaveCount(0);
      expect(await drafts()).toBe(null);
      // 元に戻す takes it back, as any other change.
      await tidy()
        .getByRole("button", { name: "元に戻す", exact: true })
        .click();
      await expect.poll(greeting).toBe(before);
      await close();
      await expect(keptHere).toHaveCount(0);
      // Work thrown away is gone, and the shop stays as it was.
      await keep("消す言葉");
      await open();
      await note
        .getByRole("button", { name: "書きかけを消す", exact: true })
        .click();
      await note.getByRole("button", { name: "消す", exact: true }).click();
      await expect(note).toHaveCount(0);
      expect(await drafts()).toBe(null);
      expect(await greeting()).toBe(before);
      await close();
    },
  );
  await check(
    "a book shelved after the scene was saved joins the shop, and leaves with the shelf",
    async () => {
      const shelve = (push) =>
        page.evaluate((push) => {
          const envelope = JSON.parse(localStorage.getItem("book-town-v1"));
          const items = envelope.data.ownShop.shelves[0].items;
          if (push) items.push(push);
          else
            items.splice(
              items.findIndex((i) => i.id === "later"),
              1,
            );
          localStorage.setItem("book-town-v1", JSON.stringify(envelope));
        }, push);
      const later = async () =>
        (await walkData()).sceneOverrides[0].objects.find(
          (o) => o.kind === "book" && o.bookId === "dispossessed",
        );
      await shelve({
        id: "later",
        bookId: "dispossessed",
        display: "spine",
        pop: "あとから棚に来た本",
      });
      await page.goto(base + "/my-shop/");
      await expect
        .poll(async () => (await later())?.parentId ?? null)
        .not.toBeNull();
      const placed = await later();
      expect(placed.source.itemId).toBe("later");
      await page.goto(base + "/walk/#mine");
      await expect(page.locator(`[data-placement="${placed.id}"]`)).toHaveCount(
        1,
      );
      // Taken off the shelf, it leaves the shop's rows and waits with its POP.
      await page.goto(base + "/my-shop/");
      await shelve(null);
      await page.goto(base + "/my-shop/");
      await expect.poll(async () => (await later())?.parentId).toBeNull();
      const left = await later();
      expect(left.source).toBeUndefined();
      const scene = (await walkData()).sceneOverrides[0];
      expect(scene.objects.find((o) => o.id === "pop:" + left.id).text).toBe(
        "あとから棚に来た本",
      );
    },
  );
  await check(
    "整える stays within 320 390 430 widths with usable controls",
    async () => {
      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 884 });
        await open();
        await face();
        const sizes = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          controls: [
            ...document.querySelectorAll(
              ".tidy-fields input, .tidy-fields textarea, .tidy-chips button, .scene-template-options button, .tidy-tools button",
            ),
          ].map((e) => e.getBoundingClientRect().height),
        }));
        expect(sizes.doc).toBeLessThanOrEqual(width + 1);
        expect(Math.min(...sizes.controls)).toBeGreaterThanOrEqual(44);
        await page.screenshot({
          path: path.join(output, "tidy-" + width + ".png"),
          animations: "disabled",
        });
        await close();
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(base + "/walk/#mine");
      await expect(page.locator(".walk-sign")).toHaveText("夜道の本屋");
      await page.screenshot({
        path: path.join(output, "own-store-mobile.png"),
        animations: "disabled",
      });
    },
  );
  await check(
    "a save this browser will not take says so, and the shop stays as it was",
    async () => {
      await open();
      await face();
      const before = await page.evaluate(() =>
        localStorage.getItem("book-town-walk-v1"),
      );
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === "book-town-walk-v1") throw new Error("quota");
          return original.call(this, k, v);
        };
      });
      await tidy().getByLabel("看板の店名").fill("保存できなかった店");
      await expect(
        page.getByText("店を保存できませんでした", { exact: false }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => localStorage.getItem("book-town-walk-v1")),
      ).toBe(before);
      await page.goto(base + "/walk/#mine");
      await expect(page.locator(".walk-sign")).toHaveText("夜道の本屋");
    },
  );
  await check(
    "unknown saved version remains intact and 整える cannot open over it",
    async () => {
      const rawTown = await page.evaluate(() =>
        localStorage.getItem("book-town-v1"),
      );
      const corrupt = '{"schemaVersion":99}';
      const locked = await browser.newContext({
        viewport: { width: 390, height: 884 },
        storageState: {
          cookies: [],
          origins: [
            {
              origin: new URL(base).origin,
              localStorage: [
                { name: "book-town-v1", value: rawTown },
                { name: "book-town-walk-v1", value: corrupt },
              ],
            },
          ],
        },
      });
      const other = settleBeforeNavigating(await locked.newPage());
      other.on("pageerror", (e) => errors.push(e.message));
      await other.goto(base + "/my-shop/");
      await expect(
        other.getByRole("button", { name: "店を整える", exact: true }),
      ).toBeDisabled();
      expect(
        await other.evaluate(() => localStorage.getItem("book-town-walk-v1")),
      ).toBe(corrupt);
      await locked.close();
    },
  );
  await check(
    "393px phone: 整える opens without the keyboard, and the sign takes a tap",
    async () => {
      const town = await page.evaluate(() =>
        localStorage.getItem("book-town-v1"),
      );
      const walk = await page.evaluate(() =>
        localStorage.getItem("book-town-walk-v1"),
      );
      const touch = await browser.newContext({
        viewport: { width: 393, height: 793 },
        isMobile: true,
        hasTouch: true,
        locale: "ja-JP",
        storageState: {
          cookies: [],
          origins: [
            {
              origin: new URL(base).origin,
              localStorage: [
                { name: "book-town-v1", value: town },
                ...(walk ? [{ name: "book-town-walk-v1", value: walk }] : []),
              ],
            },
          ],
        },
      });
      const finger = settleBeforeNavigating(await touch.newPage());
      finger.on("pageerror", (e) => errors.push(e.message));
      expect(await coarse(finger)).toBe(true);
      await finger.goto(base + "/my-shop/");
      const shop = finger.locator(".tidy");
      await finger
        .getByRole("button", { name: "店を整える", exact: true })
        .tap();
      await expect(shop.locator(".walk-artboard")).toBeVisible();
      await expectNoKeyboard(finger, "整える", shop);
      await expect(
        shop.getByRole("button", { name: "閉じる" }).first(),
      ).toBeFocused();
      await shop.getByRole("button", { name: "看板", exact: true }).tap();
      const sign = shop.getByLabel("看板の店名");
      await expect(sign).toBeVisible();
      await expectTapWrites(sign);
      await touch.close();
    },
  );
  await check(
    "on a phone, a long title among the covers of 本を足す keeps its + full size",
    async () => {
      const town = JSON.parse(
        await page.evaluate(() => localStorage.getItem("book-town-v1")),
      );
      town.data.addedBooks = [
        ...(town.data.addedBooks ?? []),
        {
          id: "my-book-901",
          title:
            "銀河の夜をわたるための覚え書き――ある鉄道員と星をめぐる三十七の短い物語、そしてその後に続く静かな朝の記録",
          author: "試験 太郎",
        },
      ];
      const walk = await page.evaluate(() =>
        localStorage.getItem("book-town-walk-v1"),
      );
      const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: "ja-JP",
        storageState: {
          cookies: [],
          origins: [
            {
              origin: new URL(base).origin,
              localStorage: [
                { name: "book-town-v1", value: JSON.stringify(town) },
                ...(walk ? [{ name: "book-town-walk-v1", value: walk }] : []),
              ],
            },
          ],
        },
      });
      const small = settleBeforeNavigating(await phone.newPage());
      small.on("pageerror", (e) => errors.push(e.message));
      await open(small);
      const shop = small.locator(".tidy");
      await shop.getByRole("button", { name: "本を足す", exact: true }).click();
      await shop
        .getByRole("searchbox", { name: "足す本を探す" })
        .fill("銀河の夜");
      const covers = shop.locator(".tidy-covers button");
      await expect(covers.filter({ hasText: "銀河の夜をわたる" })).toHaveCount(
        1,
      );
      // Beside a long title, the + keeps its size like every other.
      const icons = await covers.evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button.querySelector("i svg").getBoundingClientRect();
          return `${Math.round(box.width)}x${Math.round(box.height)}`;
        }),
      );
      expect(icons.length).toBeGreaterThanOrEqual(1);
      expect(new Set(icons)).toEqual(new Set(["14x14"]));
      await phone.close();
    },
  );
  await check(
    "整える: the shop fills the screen; its size, a book's look and 元に戻す work there",
    async () => {
      await page.goto(base + "/my-shop/");
      await page
        .getByRole("button", { name: "店を整える", exact: true })
        .click();
      const tidy = page.locator(".tidy");
      await expect(tidy.locator(".walk-artboard")).toBeVisible();
      const growth = async () => (await walkData()).sceneOverrides?.[0]?.growth;
      const before = await growth();
      await tidy
        .getByRole("button", { name: "店の大きさ", exact: true })
        .click();
      await tidy.getByRole("button", { name: "2段", exact: true }).click();
      await expect(
        tidy.getByRole("button", { name: "2段", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(await growth()).toBe(2);
      await tidy.getByRole("button", { name: "元に戻す", exact: true }).click();
      await expect.poll(growth).toBe(before);
      // A book opens its sheet; turning it is saved and its tier kept.
      await tidy.locator(".walk-book-target").first().click();
      const turn = tidy.getByRole("button", {
        name: "背表紙を見せる",
        exact: true,
      });
      const face = tidy.getByRole("button", {
        name: "表紙を見せる",
        exact: true,
      });
      const next =
        (await face.getAttribute("aria-pressed")) === "true" ? turn : face;
      await next.click();
      await expect(next).toHaveAttribute("aria-pressed", "true");
      await expect(tidy.locator(".scene-pinned")).toBeVisible();
      await tidy.getByRole("button", { name: "閉じる" }).first().click();
      await expect(tidy).toHaveCount(0);
    },
  );
  await check(
    "整える: a book is picked up and carried, or moved from its sheet, and 本を足す shows covers",
    async () => {
      await page
        .getByRole("button", { name: "店を整える", exact: true })
        .click();
      const tidy = page.locator(".tidy");
      await expect(tidy.locator(".walk-artboard")).toBeVisible();
      /** The saved tiers' books, top to bottom, left to right. */
      const tiers = () =>
        page.evaluate(() => {
          const scene = JSON.parse(localStorage.getItem("book-town-walk-v1"))
            .sceneOverrides[0];
          return scene.objects
            .filter((o) => o.kind === "row" && o.parentId === "main-shelf")
            .sort((a, b) => a.rect.y - b.rect.y)
            .map((row) =>
              scene.objects
                .filter((o) => o.kind === "book" && o.parentId === row.id)
                .sort((a, b) => a.order - b.order)
                .map((o) => o.id),
            );
        });
      const before = await tiers();
      const tier = before.findIndex((books) => books.length > 1);
      expect(tier).toBeGreaterThan(-1);
      const [first] = before[tier];
      const row = tidy.locator(".walk-row[data-row]").nth(tier);
      const lifted = tidy.locator(`[data-placement="${first}"]`);
      const from = await lifted.boundingBox();
      const to = await row.boundingBox();
      // Rested on, the book is picked up; let go at the tier's end, it
      // stands there, and 元に戻す takes it back.
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await expect(tidy.locator(".tidy-carried")).toBeVisible();
      await page.mouse.move(to.x + to.width - 4, to.y + to.height / 2, {
        steps: 6,
      });
      await expect(row).toHaveClass(/is-lit/);
      await page.mouse.up();
      await expect(tidy.locator(".tidy-carried")).toHaveCount(0);
      await expect.poll(async () => (await tiers())[tier].at(-1)).toBe(first);
      await expect(tidy.locator(".walk-row-pin").first()).toBeVisible();
      await expect(tidy.locator(".tidy-sheet")).toHaveCount(0);
      await tidy.getByRole("button", { name: "元に戻す", exact: true }).click();
      await expect.poll(tiers).toEqual(before);
      // From its sheet: 動かす, then the place is pressed. (Enter opens a
      // thin spine's own sheet, where a tap opens its tier.)
      await lifted.press("Enter");
      await tidy.getByRole("button", { name: "動かす", exact: true }).click();
      await expect(tidy.locator(".tidy-placing")).toBeVisible();
      await expect(row).toHaveClass(/is-lit/);
      await page.mouse.click(to.x + to.width - 4, to.y + to.height / 2);
      await expect(tidy.locator(".tidy-placing")).toHaveCount(0);
      await expect.poll(async () => (await tiers())[tier].at(-1)).toBe(first);
      await tidy.getByRole("button", { name: "元に戻す", exact: true }).click();
      await expect.poll(tiers).toEqual(before);
      // 本を足す: the books are shown by their covers, and found by name.
      await tidy.getByRole("button", { name: "本を足す", exact: true }).click();
      const search = tidy.getByRole("searchbox", { name: "足す本を探す" });
      await expect(search).toBeVisible();
      await search.fill("銀河");
      await expect(
        tidy.locator(".tidy-covers button .book-jacket").first(),
      ).toBeVisible();
      await tidy.getByRole("button", { name: "閉じる" }).first().click();
      await expect(tidy).toHaveCount(0);
    },
  );
  await check(
    "整える: the sign, its stamp and a POP are written in the shop, saved as typed, and taken back in one step",
    async () => {
      await page
        .getByRole("button", { name: "店を整える", exact: true })
        .click();
      const tidy = page.locator(".tidy");
      await expect(tidy.locator(".walk-artboard")).toBeVisible();
      const scene = async () => (await walkData()).sceneOverrides[0].objects;
      const sign = async () => (await scene()).find((o) => o.id === "sign");
      const before = (await sign()).text;
      await tidy.getByRole("button", { name: "看板", exact: true }).click();
      const name = tidy.getByLabel("看板の店名");
      await expect(name).toHaveValue(before);
      // Each letter is saved as it is typed: nothing waits unsaved.
      await name.press("End");
      await name.pressSequentially("と古地図");
      await expect
        .poll(async () => (await sign()).text)
        .toBe(before + "と古地図");
      await expect(tidy.locator(".walk-sign")).toContainText("古地図");
      await tidy
        .getByRole("group", { name: "店のスタンプ" })
        .getByRole("button", { name: "葉っぱ" })
        .click();
      await expect
        .poll(async () => (await scene()).find((o) => o.id === "stamp").stamp)
        .toBe("leaf");
      const undo = tidy.getByRole("button", { name: "元に戻す", exact: true });
      await undo.click();
      await undo.click();
      // The typed words were one step.
      await expect.poll(async () => (await sign()).text).toBe(before);
      // A POP is written on the book's sheet, with a stamp.
      const first = tidy.locator("[data-placement]").first();
      const id = await first.getAttribute("data-placement");
      const popOf = async () =>
        (await scene()).find((o) => o.kind === "bookPop" && o.parentId === id);
      const popBefore = (await popOf())?.text ?? "";
      await first.press("Enter");
      await tidy.getByRole("button", { name: /POPを(書く|直す)/ }).click();
      const pop = tidy.getByLabel("この本のPOP");
      await pop.fill("");
      await pop.pressSequentially("雨の夜に");
      await expect.poll(async () => (await popOf())?.text).toBe("雨の夜に");
      await tidy.getByRole("button", { name: "できた", exact: true }).click();
      await expect(pop).toHaveCount(0);
      await undo.click();
      await expect
        .poll(async () => (await popOf())?.text ?? "")
        .toBe(popBefore);
      await tidy.getByRole("button", { name: "閉じる" }).first().click();
      await expect(tidy).toHaveCount(0);
    },
  );
  expect(errors).toEqual([]);
  console.log(passed.length + " customization browser checks passed");
} finally {
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ passed, errors }, null, 2),
  );
  await browser.close();
}
