import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const base = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/walk-qa",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.BOOK_TOWN_CHROME ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const passed = [],
  errors = [];
const context = await browser.newContext({
  viewport: { width: 390, height: 884 },
  hasTouch: true,
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
async function check(name, run) {
  await run();
  passed.push(name);
  console.log("PASS " + name);
}
async function go(route = "/walk/") {
  await page.goto(base + route);
  await expect(page.locator(".walk-owner")).toBeVisible();
  await page.waitForFunction(() => localStorage.getItem("book-town-walk-v1"));
}
async function swipe(dx, dy) {
  await page.locator(".walk-stage").evaluate(
    (el, { dx, dy }) => {
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 7,
          button: 0,
          clientX: 150,
          clientY: 450,
        }),
      );
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 7,
          button: 0,
          clientX: 150 + dx,
          clientY: 450 + dy,
        }),
      );
    },
    { dx, dy },
  );
}
try {
  await go();
  await check("five mobile destinations with walk in center", async () => {
    const links = page.locator(".town-bottom-nav a");
    await expect(links).toHaveCount(5);
    await expect(links.nth(2)).toHaveAttribute("href", "/walk/");
    await expect(page.locator(".town-bottom-nav")).toBeVisible();
  });
  await check(
    "fit and no page scrolling at 320 375 390 430 widths",
    async () => {
      for (const width of [320, 375, 390, 430]) {
        await page.setViewportSize({ width, height: 884 });
        const bounds = await page.evaluate(() => {
          const b = document
            .querySelector(".walk-artboard")
            .getBoundingClientRect();
          const nav = document
            .querySelector(".town-bottom-nav")
            .getBoundingClientRect();
          return {
            x: b.x,
            y: b.y,
            w: b.width,
            h: b.height,
            navY: nav.y,
            docW: document.documentElement.scrollWidth,
            docH: document.documentElement.scrollHeight,
            width: innerWidth,
            height: innerHeight,
          };
        });
        expect(bounds.docW).toBeLessThanOrEqual(width + 1);
        expect(bounds.docH).toBeLessThanOrEqual(885);
        expect(bounds.y + bounds.h).toBeLessThanOrEqual(bounds.navY + 1);
        expect(bounds.x).toBeGreaterThanOrEqual(-1);
        expect(bounds.w / bounds.h).toBeCloseTo(9 / 16, 2);
        await page.screenshot({
          path: path.join(output, "walk-" + width + ".png"),
        });
      }
      await page.setViewportSize({ width: 390, height: 884 });
    },
  );
  await check(
    "tap book, keep store fixed during modal, and restore focus",
    async () => {
      const book = page.locator("[data-placement]").first();
      await book.focus();
      await book.press("Enter");
      await expect(page.locator(".bh-dialog")).toBeVisible();
      await page.keyboard.press("PageDown");
      await expect(page.locator(".walk-progress")).toContainText("1 /");
      await page.locator(".bh-dialog").press("Escape");
      await expect(page.locator(".bh-dialog")).toHaveCount(0);
      await expect(book).toBeFocused();
    },
  );
  await check(
    "book neighbors remain in furniture and POP reaction uses legacy identity",
    async () => {
      await page.locator("[data-placement]").first().press("Enter");
      await expect(page.locator(".bh-book-heading h2")).toContainText(
        "ソラリス",
      );
      await page.locator(".bh-pop-reactions button").first().click();
      const saved = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("book-town-v1")).data.popReactions,
      );
      expect(
        saved[JSON.stringify(["shop-orbit", "orbit-unknown", "o1"])],
      ).toContain("like");
      await page.getByRole("button", { name: "次の本", exact: true }).click();
      await expect(page.locator(".bh-book-heading h2")).not.toContainText(
        "ソラリス",
      );
      await expect(page.locator(".walk-progress")).toContainText("1 /");
      await page.locator(".bh-dialog").press("Escape");
    },
  );
  await check("POP full text is separate from shop gesture", async () => {
    await page
      .getByRole("button", { name: "ソラリスのPOP全文を読む", exact: true })
      .click();
    await expect(page.locator(".walk-full-pop")).toContainText("異星人の話");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".walk-progress")).toContainText("1 /");
    await page.keyboard.press("Escape");
  });
  await check(
    "thin spine opens shelf magnification and book closes back to it",
    async () => {
      const spine = page
        .locator(".walk-book.is-spine [data-placement]")
        .first();
      await spine.click();
      await expect(page.locator(".walk-close-shelf")).toBeVisible();
      await page.locator(".walk-close-book").first().click();
      await expect(page.locator(".bh-dialog")).toBeVisible();
      await page.locator(".bh-dialog").press("Escape");
      await expect(page.locator(".walk-close-shelf")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".walk-close-shelf")).toHaveCount(0);
    },
  );
  await check(
    "vertical swipe moves one shop; horizontal and tap do not",
    async () => {
      await swipe(0, -100);
      await expect(page.locator(".walk-progress")).toContainText("2 /");
      await swipe(100, 0);
      await expect(page.locator(".walk-progress")).toContainText("2 /");
      await swipe(0, 3);
      await expect(page.locator(".walk-progress")).toContainText("2 /");
      await swipe(0, 100);
      await expect(page.locator(".walk-progress")).toContainText("1 /");
    },
  );
  await check("native touch scroll produces one shop transition", async () => {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 210, y: 640 }],
    });
    for (const y of [610, 570, 510, 460])
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 210, y }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(page.locator(".walk-progress")).toContainText("2 /");
  });
  await check(
    "reactions and resume survive tab navigation and reload",
    async () => {
      await page
        .getByRole("button", { name: "この店が好き", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "この店が好き", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.locator(".town-bottom-nav a").first().click();
      await expect(
        page.locator(".street-view, .home-view").first(),
      ).toBeVisible();
      await page.locator(".town-bottom-nav a").nth(2).click();
      await expect(page.locator(".walk-progress")).toContainText("2 /");
      await page.reload();
      await expect(page.locator(".walk-progress")).toContainText("2 /");
      await expect(
        page.getByRole("button", { name: "この店が好き", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    },
  );
  await check(
    "shared target beats resume and native demo placement opens",
    async () => {
      await go("/walk/#shop-rain");
      await expect(page.locator(".walk-sign")).toContainText("雨と翻訳");
      const native = page
        .locator('[data-placement^="demo-placement:"]')
        .first();
      await native.focus();
      await native.press("Enter");
      await expect(page.locator(".bh-dialog")).toBeVisible();
      await page.locator(".bh-pop-reactions button").first().click();
      const saved = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("book-town-walk-v1")).walkState
            .placementReactions,
      );
      expect(
        Object.keys(saved).some((k) => k.includes("demo-placement:")),
      ).toBeTruthy();
      await page.locator(".bh-dialog").press("Escape");
    },
  );
  await check(
    "message is explicitly unsent and saved only locally",
    async () => {
      await page
        .getByRole("button", {
          name: "店主に伝える（送信されないデモ）",
          exact: true,
        })
        .click();
      await expect(
        page.getByText("送信されないデモです。", { exact: false }),
      ).toBeVisible();
      await page
        .getByRole("textbox", { name: "店主に伝えたい言葉" })
        .fill("また訪れたい本屋でした");
      await page
        .getByRole("button", { name: "手元に保存する", exact: true })
        .click();
      const saved = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("book-town-walk-v1")).walkState
            .reactions["shop-rain"],
      );
      expect(saved.message).toBe("また訪れたい本屋でした");
    },
  );
  await check("finite end and explicit restart", async () => {
    await go("/walk/#shop-lamplight");
    await page.getByRole("button", { name: "次の書店", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "今日めぐれる書店はここまで" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "最初からめぐる", exact: false })
      .click();
    await expect(page.locator(".walk-progress")).toContainText("1 /");
  });
  await check("PC sidebar keyboard navigation and reduced motion", async () => {
    await page.setViewportSize({ width: 1395, height: 884 });
    await expect(page.locator('.town-sidebar a[href="/walk/"]')).toBeVisible();
    await page.locator(".walk-stage").focus();
    await page.keyboard.press("PageDown");
    await expect(page.locator(".walk-progress")).toContainText("2 /");
    await page.keyboard.press("PageUp");
    await expect(page.locator(".walk-progress")).toContainText("1 /");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".walk-artboard")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
    await page.screenshot({ path: path.join(output, "walk-pc.png") });
  });
  await check(
    "history clear resets position and preserves reactions",
    async () => {
      await page
        .getByRole("button", { name: "その他のメニュー", exact: true })
        .click();
      await page.getByRole("button", { name: "訪問履歴", exact: true }).click();
      const before = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("book-town-walk-v1")).walkState
            .reactions,
      );
      await page
        .getByRole("button", { name: "訪問履歴と途中位置を削除", exact: true })
        .click();
      const saved = await page.evaluate(
        () => JSON.parse(localStorage.getItem("book-town-walk-v1")).walkState,
      );
      expect(saved.visits).toEqual({});
      expect(saved.session.index).toBe(0);
      expect(saved.reactions).toEqual(before);
    },
  );
  await check(
    "short screen remains contained and table is independent",
    async () => {
      await page.setViewportSize({ width: 390, height: 640 });
      await go("/walk/#shop-window");
      await expect(page.locator('[data-furniture="table"]')).toBeVisible();
      const fit = await page.evaluate(() => {
        const stage = document
          .querySelector(".walk-artboard")
          .getBoundingClientRect();
        const nav = document
          .querySelector(".town-bottom-nav")
          .getBoundingClientRect();
        return {
          bottom: stage.bottom,
          nav: nav.top,
          height: document.documentElement.scrollHeight,
        };
      });
      expect(fit.bottom).toBeLessThanOrEqual(fit.nav + 1);
      expect(fit.height).toBeLessThanOrEqual(641);
      await page.screenshot({
        path: path.join(output, "walk-table-short.png"),
      });
    },
  );
  await check(
    "corrupt saved data is retained and does not affect old storage",
    async () => {
      const isolated = await browser.newContext({
        viewport: { width: 390, height: 884 },
      });
      const other = await isolated.newPage();
      await other.addInitScript(() =>
        localStorage.setItem("book-town-walk-v1", "{broken"),
      );
      await other.goto(base + "/walk/");
      await expect(other.locator(".walk-save-warning")).toContainText(
        "元のデータは保持",
      );
      await other
        .getByRole("button", { name: "この店が好き", exact: true })
        .click();
      expect(
        await other.evaluate(() => localStorage.getItem("book-town-walk-v1")),
      ).toBe("{broken");
      await isolated.close();
    },
  );
  await check(
    "storage write failure is reported without claiming saved",
    async () => {
      const isolated = await browser.newContext({
        viewport: { width: 390, height: 884 },
      });
      const other = await isolated.newPage();
      await other.addInitScript(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "book-town-walk-v1")
            throw new DOMException("quota", "QuotaExceededError");
          return original.call(this, key, value);
        };
      });
      await other.goto(base + "/walk/");
      await expect(other.locator(".walk-save-warning")).toContainText(
        "保存できません",
      );
      await other
        .getByRole("button", { name: "この店が好き", exact: true })
        .click();
      await expect(
        other.getByRole("button", { name: "この店が好き", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        await other.evaluate(() => localStorage.getItem("book-town-walk-v1")),
      ).toBeNull();
      await isolated.close();
    },
  );
  expect(errors).toEqual([]);
  console.log(passed.length + " walk browser checks passed");
} finally {
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ passed, errors }, null, 2),
  );
  await browser.close();
}
