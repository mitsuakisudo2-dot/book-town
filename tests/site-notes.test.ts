import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SITE_NOTE_LIMITS,
  anchorPath,
  commitOf,
  describeTarget,
  deviceLabel,
  layerTitle,
  meaningfulElement,
  noteBody,
  noteSpotAt,
  pageKey,
  pageOf,
  pinPlace,
  type NoteElement,
  type SiteNoteSpot,
} from "../src/lib/site-notes";
import { forgetDraft, keepDraft, keptDraft } from "../src/lib/site-note-draft";

// The helpers behind 注釈モード: the device's name, the words for what was
// tapped, the path back to it, and where its pin goes. Elements are plain
// objects shaped like the DOM's. Everything runs inside main() because tsx
// compiles this file as CommonJS.

type Fake = NoteElement & { children: Fake[]; parentElement: Fake | null };

const SVG = new Set(["svg", "path", "g", "circle"]);

/** An element with attributes and children (elements or text). */
function el(
  tag: string,
  attributes: Record<string, string> = {},
  ...content: (Fake | string)[]
): Fake {
  const children = content.filter(
    (part): part is Fake => typeof part !== "string",
  );
  const node: Fake = {
    // The DOM upper-cases HTML tags and keeps SVG ones as written.
    tagName: SVG.has(tag) ? tag : tag.toUpperCase(),
    getAttribute: (name) => attributes[name] ?? null,
    get textContent() {
      return content
        .map((part) => (typeof part === "string" ? part : part.textContent))
        .join("");
    },
    parentElement: null,
    children,
  };
  for (const child of children) child.parentElement = node;
  return node;
}

/** Looks up ids among the given trees. */
const finder = (...roots: Fake[]) => {
  const all: Fake[] = [];
  const walk = (node: Fake) => {
    all.push(node);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return (id: string) =>
    all.find((node) => node.getAttribute("id") === id) ?? null;
};

const UA = {
  iPhoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iPhoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iPhoneLine:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.9.0",
  iPhoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone14,5; iOS 17_5; ja_JP)",
  iPhoneInApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  windowsFirefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  headless:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
};

const spotOf = (change: Partial<SiteNoteSpot> = {}): SiteNoteSpot => ({
  page: "/",
  x: 100,
  y: 1500,
  viewportW: 390,
  viewportH: 844,
  scrollY: 1200,
  target: "",
  layer: null,
  anchor: "",
  anchorX: null,
  anchorY: null,
  ...change,
});

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  await check(
    "a device is named by its system and browser, nothing more",
    () => {
      const cases: [string, number, string][] = [
        [UA.iPhoneSafari, 5, "iPhone Safari"],
        [UA.iPhoneChrome, 5, "iPhone Chrome"],
        [UA.iPhoneLine, 5, "iPhone LINE"],
        [UA.iPhoneInstagram, 5, "iPhone Instagram"],
        [UA.iPhoneInApp, 5, "iPhone アプリ内"],
        // iPadOS Safari calls itself a Mac; only the touch screen tells.
        [UA.macSafari, 5, "iPad Safari"],
        [UA.macSafari, 0, "Mac Safari"],
        [UA.androidChrome, 5, "Android Chrome"],
        [UA.androidWebView, 5, "Android アプリ内"],
        [UA.windowsEdge, 0, "Windows Edge"],
        [UA.windowsFirefox, 0, "Windows Firefox"],
        [UA.headless, 0, "Linux Chrome"],
        ["", 0, ""],
      ];
      for (const [ua, touch, label] of cases) {
        const named = deviceLabel(ua, touch);
        assert.equal(named, label, ua);
        assert.ok(named.length <= SITE_NOTE_LIMITS.device);
        assert.doesNotMatch(named, /\d/);
      }
    },
  );

  await check("what was tapped is the button around an icon, in words", () => {
    const path = el("path");
    const button = el(
      "button",
      { "aria-label": "お知らせ", class: "top-bell" },
      el("svg", {}, path),
    );
    el("header", {}, button);
    assert.equal(meaningfulElement(path), button);
    assert.equal(describeTarget(meaningfulElement(path)), "ボタン「お知らせ」");
    const link = el("a", { href: "/" }, "本の街へ");
    el("main", {}, link);
    assert.equal(describeTarget(link), "リンク「本の街へ」");
    // A dialog is what a note is left in, never what it is about.
    const welcome = el("h2", {}, "Book Townへようこそ");
    el(
      "div",
      { role: "dialog", "aria-label": "Book Townへようこそ" },
      el("div", { class: "modal-top" }, welcome),
    );
    assert.equal(meaningfulElement(welcome), welcome);
    assert.equal(describeTarget(welcome), "見出し「Book Townへようこそ」");
    // Out of a drawing that is not inside anything pressable.
    const lone = el("path");
    const picture = el(
      "div",
      { class: "scene" },
      el("svg", {}, el("g", {}, lone)),
    );
    assert.equal(meaningfulElement(lone), picture);
  });

  await check(
    "an element is named by its label, alt, placeholder or text",
    () => {
      assert.equal(
        describeTarget(el("img", { alt: "夜の本屋の看板" })),
        "画像「夜の本屋の看板」",
      );
      const typed = el("input", { placeholder: "本や、気になる書店を探す" });
      assert.equal(describeTarget(typed), "入力欄「本や、気になる書店を探す」");
      const title = el("span", { id: "shop-title" }, "軌道書房");
      const region = el("section", { "aria-labelledby": "shop-title" });
      el("main", {}, title, region);
      assert.equal(
        describeTarget(region, finder(title.parentElement!)),
        "「軌道書房」",
      );
      assert.equal(
        describeTarget(el("p", {}, "  夜に\n  だけ  開く \n 本屋 ")),
        "「夜に だけ 開く 本屋」",
      );
      const long = describeTarget(el("p", {}, "あ".repeat(200)));
      assert.equal(long, "「" + "あ".repeat(59) + "…」");
      // A field's own words are never read: an input has no text.
      assert.equal(describeTarget(el("textarea", {})), "入力欄");
    },
  );

  await check("the heading before it says where on the page it was", () => {
    const button = el("button", {}, "好き");
    const page = el(
      "main",
      {},
      el("h1", {}, "本の街"),
      el(
        "section",
        {},
        el("h2", {}, "軌道書房"),
        el("div", { class: "rail" }, el("p", {}, "棚"), button),
        el("h2", {}, "次の書店"),
      ),
    );
    el("body", {}, page);
    assert.equal(describeTarget(button), "ボタン「好き」 / 見出し「軌道書房」");
    // A heading itself needs no heading of its own.
    const heading = page.children[0];
    assert.equal(describeTarget(heading), "見出し「本の街」");
    // One that only repeats the name is passed over for the one before.
    const named = el("a", {}, "軌道書房");
    el("main", {}, el("h1", {}, "書店めぐり"), el("h2", {}, named));
    assert.equal(
      describeTarget(named),
      "リンク「軌道書房」 / 見出し「書店めぐり」",
    );
    // Nothing past a dialog's edge: its title has a column of its own.
    const inside = el("p", {}, "ようこそ");
    el(
      "body",
      {},
      el("h1", {}, "本の街"),
      el("div", { role: "dialog" }, el("div", {}, inside)),
    );
    assert.equal(describeTarget(inside), "「ようこそ」");
    const wordy = el("button", {}, "い".repeat(500));
    el("section", {}, el("h2", {}, "う".repeat(500)), wordy);
    assert.ok([...describeTarget(wordy)].length <= SITE_NOTE_LIMITS.target);
  });

  await check(
    "a dialog's title: its label, then labelledby, then a heading",
    () => {
      const heading = el("h2", { id: "held" }, "ソラリス");
      assert.equal(
        layerTitle(
          el(
            "dialog",
            { "aria-label": "Book Townへようこそ", "aria-labelledby": "held" },
            heading,
          ),
        ),
        "Book Townへようこそ",
      );
      const book = el(
        "dialog",
        { "aria-labelledby": "held" },
        el("div", {}, heading),
      );
      assert.equal(layerTitle(book, finder(book)), "ソラリス");
      assert.equal(
        layerTitle(
          el(
            "div",
            { role: "dialog" },
            el("div", {}, el("h3", {}, "通報する")),
          ),
        ),
        "通報する",
      );
      assert.equal(
        layerTitle(el("div", { role: "dialog" }, el("p", {}, "本文"))),
        "",
      );
    },
  );

  await check("the path back to an element is short and steady", () => {
    const like = el("button", { class: "reaction is-active active w-1/2 big" });
    const rail = el(
      "div",
      { class: "bh-actions" },
      el("button", { class: "reaction" }),
      like,
    );
    const main = el(
      "main",
      { class: "town-main view-book" },
      el("section", { class: "hero" }, rail),
    );
    const body = el("body", {}, main);
    assert.equal(
      anchorPath(like, body),
      "main.town-main.view-book > section.hero > div.bh-actions > button.reaction.big:nth-of-type(2)",
    );
    // An element with a usable id starts the path; a generated one does not.
    const own = el("p", {});
    el("div", { id: "shop-orbit" }, el("div", { id: "_r_1_" }, own));
    assert.equal(anchorPath(own, null), "#shop-orbit > div > p");
    // Inside a dialog the path starts below it, and never names the root.
    const inDialog = el("h2", {});
    const dialog = el(
      "dialog",
      { class: "bh-dialog" },
      el("div", { class: "bh-top" }, inDialog),
    );
    assert.equal(anchorPath(inDialog, dialog), "div.bh-top > h2");
    // At most eight steps, at most 500 characters.
    let deep = el("span", {});
    const leaf = deep;
    for (let i = 0; i < 12; i++)
      deep = el("div", { class: "x".repeat(90) }, deep);
    const path = anchorPath(leaf, null);
    assert.ok(path.split(" > ").length <= 8);
    assert.ok(path.length <= SITE_NOTE_LIMITS.anchor);
    assert.ok(path.endsWith("span"));
  });

  await check("a tap's place is rounded, and never above the page", () => {
    assert.deepEqual(
      noteSpotAt({
        clientX: 120.6,
        clientY: 40.4,
        scrollX: 0,
        scrollY: 300.2,
        width: 390,
        height: 844,
      }),
      { x: 121, y: 341, viewportW: 390, viewportH: 844, scrollY: 300 },
    );
    // iOS bounces past the top: a negative scroll counts as none.
    assert.deepEqual(
      noteSpotAt({
        clientX: 10,
        clientY: 20,
        scrollX: -3,
        scrollY: -40,
        width: 390,
        height: 844,
      }),
      { x: 10, y: 20, viewportW: 390, viewportH: 844, scrollY: 0 },
    );
  });

  await check(
    "a pin goes back to its element, or near where it was left",
    () => {
      const now = {
        width: 390,
        height: 844,
        scrollX: 0,
        scrollY: 1000,
        pageHeight: 4000,
      };
      const rect = { left: 100, top: 200, width: 80, height: 40 };
      const anchored = spotOf({ anchorX: 0.5, anchorY: 0.25 });
      // On the page: a point in the page, scrolling with it.
      assert.deepEqual(
        pinPlace(anchored, now, { rect, onScreen: false, clip: null }),
        {
          left: 140,
          top: 1210,
          fixed: false,
          why: null,
        },
      );
      // On a sticky bar or in a dialog: a point on the screen.
      assert.deepEqual(
        pinPlace(anchored, now, { rect, onScreen: true, clip: null }),
        {
          left: 140,
          top: 210,
          fixed: true,
          why: null,
        },
      );
      assert.deepEqual(
        pinPlace({ ...anchored, layer: "ソラリス" }, now, {
          rect,
          onScreen: false,
          clip: null,
        }),
        { left: 140, top: 210, fixed: true, why: null },
      );
      // Not found: where it was left, scaled to this width, and only near.
      assert.deepEqual(pinPlace(spotOf(), now, null), {
        left: 100,
        top: 1500,
        fixed: false,
        why: "changed",
      });
      assert.deepEqual(pinPlace(spotOf(), { ...now, width: 780 }, null), {
        left: 200,
        top: 1500,
        fixed: false,
        why: "other-size",
      });
      // A dialog's note was left on the screen, not in the page.
      assert.equal(pinPlace(spotOf({ layer: "ソラリス" }), now, null).top, 300);
    },
  );

  await check(
    "a pin never reaches past an edge, and says when it is hidden",
    () => {
      const now = {
        width: 390,
        height: 844,
        scrollX: 0,
        scrollY: 0,
        pageHeight: 900,
      };
      // Half its 44px hit area from every edge.
      assert.deepEqual(
        pinPlace(spotOf({ x: 389, y: 899, scrollY: 0 }), now, null),
        {
          left: 368,
          top: 878,
          fixed: false,
          why: "changed",
        },
      );
      assert.equal(pinPlace(spotOf({ x: 0, y: 0 }), now, null).left, 22);
      // A book scrolled out of its shelf's rail: at the rail's edge, marked hidden.
      const rail = { left: 0, top: 300, width: 390, height: 160 };
      const book = { left: 880, top: 320, width: 60, height: 90 };
      const hidden = pinPlace(spotOf({ anchorX: 0.5, anchorY: 0.5 }), now, {
        rect: book,
        onScreen: false,
        clip: rail,
      });
      assert.deepEqual(hidden, {
        left: 368,
        top: 365,
        fixed: false,
        why: "hidden",
      });
      // In a dialog, scrolled out of sight below: kept on the screen.
      const below = pinPlace(
        spotOf({ layer: "ソラリス", anchorX: 0.5, anchorY: 0.5 }),
        now,
        {
          rect: { left: 40, top: 1300, width: 100, height: 40 },
          onScreen: false,
          clip: { left: 10, top: 60, width: 370, height: 700 },
        },
      );
      assert.equal(below.why, "hidden");
      assert.equal(below.top, 738);
      assert.equal(below.fixed, true);
    },
  );

  await check("the page a note keeps: what the app reads, nothing more", () => {
    const at = (pathname: string, search = "", hash = "") =>
      pageOf({ pathname, search, hash });
    assert.equal(at("/shop/", "?id=A&fbclid=x"), "/shop/?id=A");
    assert.equal(
      at("/search/", "?q=%E5%A4%9C&utm_source=line&gclid=1"),
      "/search/?q=%E5%A4%9C",
    );
    assert.equal(at("/walk/", "", "#shop-orbit"), "/walk/#shop-orbit");
    // A sign-in link's keys, or what was typed in the street's search, never.
    assert.equal(at("/", "", "#search=%E5%A4%9C"), "/");
    assert.equal(
      at("/login/", "", "#access_token=secret&type=magiclink"),
      "/login/",
    );
    assert.equal(at("/" + "a".repeat(600)).length, SITE_NOTE_LIMITS.page);
    assert.notEqual(
      pageKey("/shop/?id=A&show=following"),
      pageKey("/shop/?id=B"),
    );
    assert.equal(pageKey("/shop/?id=A&show=following"), pageKey("/shop/?id=A"));
    assert.equal(pageKey("/search/?q=x"), "/search/");
    assert.notEqual(pageKey("/walk/#shop-orbit"), pageKey("/walk/#shop-rain"));
  });

  await check("a note's words are trimmed and kept to 2000 characters", () => {
    assert.equal(noteBody("  戻るの字が小さい　\n"), "戻るの字が小さい");
    assert.equal(noteBody(" 　\n"), null);
    assert.equal(noteBody("あ".repeat(2000)), "あ".repeat(2000));
    assert.equal(noteBody("あ".repeat(2001)), null);
    // Counted as the database counts them: by character, not by UTF-16 unit.
    assert.equal(noteBody("📚".repeat(2000)), "📚".repeat(2000));
  });

  await check(
    "a half-written note is kept per account, and only with words",
    () => {
      forgetDraft();
      const spot = spotOf();
      keepDraft({ userId: "a", pageKey: "/", text: "途中", spot });
      assert.equal(keptDraft("a")?.text, "途中");
      assert.equal(keptDraft("b"), null);
      keepDraft({ userId: "a", pageKey: "/", text: "  ", spot });
      assert.equal(keptDraft("a"), null);
      keepDraft({ userId: "a", pageKey: "/", text: "また", spot: null });
      forgetDraft();
      assert.equal(keptDraft("a"), null);
    },
  );

  await check("only a commit's id is kept as the build", () => {
    assert.equal(commitOf("d9eb95a"), "d9eb95a");
    assert.equal(commitOf("main"), null);
    assert.equal(commitOf(undefined), null);
  });

  await check("the app's limits are the database's", () => {
    const sql = readFileSync(
      join(
        __dirname,
        "..",
        "supabase",
        "migrations",
        "20261023000000_site_notes.sql",
      ),
      "utf8",
    );
    const number = (pattern: RegExp) => Number(pattern.exec(sql)?.[1]);
    assert.equal(
      number(/char_length\(body\) between 1 and (\d+)/),
      SITE_NOTE_LIMITS.body,
    );
    assert.equal(
      number(/char_length\(page\) between 1 and (\d+)/),
      SITE_NOTE_LIMITS.page,
    );
    assert.equal(
      number(/char_length\(target\) <= (\d+)/),
      SITE_NOTE_LIMITS.target,
    );
    assert.equal(
      number(/char_length\(layer\) between 1 and (\d+)/),
      SITE_NOTE_LIMITS.layer,
    );
    assert.equal(
      number(/char_length\(anchor\) <= (\d+)/),
      SITE_NOTE_LIMITS.anchor,
    );
    assert.equal(
      number(/char_length\(device\) <= (\d+)/),
      SITE_NOTE_LIMITS.device,
    );
    assert.equal(number(/\) >= (\d+) then/), SITE_NOTE_LIMITS.perHour);
  });

  console.log(passed + " site note checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
