import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { settleBeforeNavigating } from "./journey-layers.mjs";
import { expectReadable } from "./journey-contrast.mjs";
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
const dialog = () =>
  page.getByRole("dialog", { name: "店内を飾りつける", exact: true });
async function open() {
  await page.goto(base + "/my-shop/");
  await page
    .getByRole("button", { name: "店内を飾りつける", exact: true })
    .click();
  await expect(dialog()).toBeVisible();
}
async function save() {
  await dialog()
    .getByRole("button", { name: "店内を保存", exact: true })
    .click();
  await expect(dialog()).toHaveCount(0);
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
async function selectSolaris() {
  await dialog()
    .locator(".scene-placement-list button")
    .filter({ hasText: "ソラリス" })
    .first()
    .click();
  await expect(dialog().locator("#scene-book-form")).toBeVisible();
}
try {
  await page.goto(base + "/my-shop/");
  await page.getByRole("button", { name: "空の棚から始める" }).click();
  await page.getByLabel("書店の名前").fill("私の静かな本屋");
  await page.getByRole("button", { name: "書店をひらく", exact: true }).click();
  await page.getByRole("button", { name: "棚を整える" }).click();
  await expect(page.locator(".shop-editor")).toBeVisible();
  await check(
    "empty saved store explains how to open it instead of opening a different shop",
    async () => {
      await page
        .getByRole("button", { name: "店内を飾りつける", exact: true })
        .click();
      await save();
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
        missing.getByRole("link", { name: "本棚を整える" }),
      ).toHaveAttribute("href", "/my-shop/");
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
    "own-store entry opens an interactive editor; demo shops have no editor",
    async () => {
      await page.goto(base + "/shops/shop-orbit/");
      await expect(
        page.getByRole("button", { name: "店内を飾りつける", exact: true }),
      ).toHaveCount(0);
      await open();
      await expect(
        dialog().locator(".scene-template-options button"),
      ).toHaveCount(3);
      await expect(dialog().locator("[data-placement]")).toHaveCount(2);
      await dialog()
        .getByRole("button", { name: "キャンセル", exact: true })
        .click();
    },
  );
  await check("cancel discards draft template and sign changes", async () => {
    await open();
    await dialog()
      .getByRole("button", { name: /窓辺の選書/ })
      .click();
    await dialog().getByLabel("看板の店名").fill("キャンセルした店");
    await dialog()
      .getByRole("button", { name: "キャンセル", exact: true })
      .click();
    expect((await legacy()).ownShop).toEqual(original);
    const value = await page.evaluate(() =>
      localStorage.getItem("book-town-walk-v1"),
    );
    expect(value ? JSON.parse(value).sceneOverrides : []).toHaveLength(0);
  });
  await check(
    "save persists title, shelf label, illustrated face, POP and airplane stamp",
    async () => {
      await open();
      await dialog().getByLabel("看板の店名").fill("夜道の本屋");
      await dialog().getByLabel("棚の案内札").fill("遠くへ行く本");
      await selectSolaris();
      await dialog()
        .getByLabel("この本のPOP")
        .fill("遠い星の海で、言葉のない相手に出会う。");
      await dialog().getByLabel("POPのスタンプ").selectOption("plane");
      await page.screenshot({
        path: path.join(output, "editor-desktop.png"),
        animations: "disabled",
      });
      await save();
      const data = await walkData();
      expect(data.schemaVersion).toBe(2);
      expect(data.legacyBackups).toHaveLength(1);
      expect(data.legacyBackups[0].shop).toEqual(original);
      expect(
        data.sceneOverrides[0].objects.find(
          (o) => o.id === "pop:placement:mine:a",
        ).stamp,
      ).toBe("plane");
      expect((await legacy()).ownShop).toEqual(original);
    },
  );
  await check(
    "reload restores edited scene and keeps the private book and original shop",
    async () => {
      await open();
      await expect(dialog().getByLabel("看板の店名")).toHaveValue("夜道の本屋");
      await expect(dialog().getByLabel("棚の案内札")).toHaveValue(
        "遠くへ行く本",
      );
      await selectSolaris();
      await expect(dialog().getByLabel("この本のPOP")).toHaveValue(
        "遠い星の海で、言葉のない相手に出会う。",
      );
      await expect(dialog().getByLabel("POPのスタンプ")).toHaveValue("plane");
      await expect(
        dialog().getByText("秘密の言葉", { exact: true }),
      ).toHaveCount(0);
      await expect(
        dialog().getByRole("group", { name: "まだ並べていない本 · 1冊" }),
      ).toBeVisible();
      await dialog()
        .getByRole("button", { name: "キャンセル", exact: true })
        .click();
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
      await expect(page.locator(".bh-pop-text")).toHaveText(
        "遠い星の海で、言葉のない相手に出会う。",
      );
      await expect(page.locator(".bh-pop-stamp")).toBeVisible();
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
      await expect(page.locator(".bh-pop-text")).not.toHaveText(
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
      await dialog()
        .getByRole("button", { name: /窓辺の選書/ })
        .click();
      await save();
      const next = (await walkData()).sceneOverrides[0];
      expect(next.templateId).toBe("window");
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
      expect((await walkData()).legacyBackups).toHaveLength(1);
    },
  );
  await check("take off and replace retains the POP and stamp", async () => {
    await open();
    await selectSolaris();
    await dialog()
      .getByRole("button", { name: "いったん棚から下ろす", exact: true })
      .click();
    await expect(dialog().getByLabel("この本を置く棚")).toHaveValue("");
    await save();
    expect(
      (await walkData()).sceneOverrides[0].objects.find(
        (o) => o.id === "placement:mine:a",
      ).parentId,
    ).toBe(null);
    await open();
    await selectSolaris();
    await expect(dialog().getByLabel("この本のPOP")).toHaveValue(
      "遠い星の海で、言葉のない相手に出会う。",
    );
    await expect(dialog().getByLabel("POPのスタンプ")).toHaveValue("plane");
    await dialog().getByLabel("この本を置く棚").selectOption("row-0");
    await save();
    expect(
      (await walkData()).sceneOverrides[0].objects.find(
        (o) => o.id === "placement:mine:a",
      ).parentId,
    ).toBe("row-0");
  });
  await check(
    "catalog addition and left-to-right reorder persist",
    async () => {
      await open();
      // Romaji and kana find a book here as in every search.
      for (const typed of ["momo", "もも"]) {
        await dialog().getByLabel("棚に加える本を探す").fill(typed);
        await expect(
          dialog().locator(".scene-search-results button").first(),
        ).toContainText("モモ");
      }
      await dialog().getByLabel("棚に加える本を探す").fill("モモ");
      await dialog().locator(".scene-search-results button").first().click();
      await expect(dialog().locator("#scene-book-form")).toContainText("モモ");
      await dialog()
        .getByRole("button", { name: "← 左へ", exact: true })
        .click();
      await dialog()
        .getByLabel("この本のPOP")
        .fill("急がなくてもいい。コーヒーを一杯。");
      await dialog().getByLabel("POPのスタンプ").selectOption("coffee");
      await save();
      const row = (await walkData()).sceneOverrides[0].objects
        .filter((o) => o.kind === "book" && o.parentId === "row-0")
        .sort((a, b) => a.order - b.order);
      expect(row[0].bookId).toBe("momo");
      expect(row[1].bookId).toBe("solaris");
    },
  );
  await check(
    "private shelf is excluded from rendered books and POP discovery",
    async () => {
      await open();
      await dialog().getByLabel("この棚を公開する").uncheck();
      await save();
      await page.goto(base + "/walk/#mine");
      await expect(
        page.locator('[data-placement="placement:mine:a"]'),
      ).toHaveCount(0);
      await expect(
        page.locator(".walk-book-pop").filter({ hasText: "コーヒー" }),
      ).toHaveCount(0);
      await open();
      await dialog().getByLabel("この棚を公開する").check();
      await save();
    },
  );
  await check(
    "mobile editor stays within 320 390 430 widths with usable controls",
    async () => {
      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 884 });
        await open();
        await dialog().getByLabel("看板の店名").scrollIntoViewIfNeeded();
        const sizes = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          width: innerWidth,
          inputs: [
            ...document.querySelectorAll(
              ".scene-section input:not([type=checkbox]),.scene-section select,.scene-template-options button",
            ),
          ].map((e) => e.getBoundingClientRect().height),
        }));
        expect(sizes.doc).toBeLessThanOrEqual(width + 1);
        expect(Math.min(...sizes.inputs)).toBeGreaterThanOrEqual(44);
        await page.screenshot({
          path: path.join(output, "editor-" + width + ".png"),
          animations: "disabled",
        });
        await dialog()
          .getByRole("button", { name: "キャンセル", exact: true })
          .click();
      }
      await page.goto(base + "/walk/#mine");
      await expect(page.locator(".walk-sign")).toHaveText("夜道の本屋");
      await page.screenshot({
        path: path.join(output, "own-store-mobile.png"),
        animations: "disabled",
      });
    },
  );
  await check(
    "write failure leaves the draft open and the published scene unchanged",
    async () => {
      await open();
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
      await dialog().getByLabel("看板の店名").fill("保存できなかった店");
      await dialog()
        .getByRole("button", { name: "店内を保存", exact: true })
        .click();
      await expect(dialog().getByRole("alert")).toContainText(
        "ブラウザに保存できません",
      );
      await expect(dialog().getByLabel("看板の店名")).toHaveValue(
        "保存できなかった店",
      );
      expect(
        await page.evaluate(() => localStorage.getItem("book-town-walk-v1")),
      ).toBe(before);
      await dialog()
        .getByRole("button", { name: "キャンセル", exact: true })
        .click();
      await page.goto(base + "/walk/#mine");
      await expect(page.locator(".walk-sign")).toHaveText("夜道の本屋");
    },
  );
  await check(
    "unknown saved version remains intact and cannot be overwritten by editor",
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
      await other
        .getByRole("button", { name: "店内を飾りつける", exact: true })
        .click();
      await expect(
        other.getByRole("button", { name: "店内を保存", exact: true }),
      ).toBeDisabled();
      expect(
        await other.evaluate(() => localStorage.getItem("book-town-walk-v1")),
      ).toBe(corrupt);
      await locked.close();
    },
  );
  await check(
    "on a phone, a long title in the book search keeps its + full size",
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
      await small.goto(base + "/my-shop/");
      await small
        .getByRole("button", { name: "店内を飾りつける", exact: true })
        .click();
      const editor = small.getByRole("dialog", {
        name: "店内を飾りつける",
        exact: true,
      });
      await editor.getByLabel("棚に加える本を探す").fill("銀河の夜");
      const rows = editor.locator(".scene-search-results button");
      await expect(rows.filter({ hasText: "銀河の夜をわたる" })).toHaveCount(1);
      await expect(rows.filter({ hasText: "銀河鉄道の夜" })).toHaveCount(1);
      // Found and near rows alike: the + never shrinks beside a long title.
      const icons = await rows.evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button
            .querySelector(":scope > svg")
            .getBoundingClientRect();
          return `${Math.round(box.width)}x${Math.round(box.height)}`;
        }),
      );
      expect(icons.length).toBeGreaterThanOrEqual(2);
      expect(new Set(icons)).toEqual(new Set(["16x16"]));
      // The quiet heading over the near row is still readable.
      await expectReadable(editor.locator(".search-near"), "近い題名の本");
      await phone.close();
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
