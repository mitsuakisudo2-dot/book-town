import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  ERROR_BOOT,
  MESSAGE_LENGTH,
  REPORTS_PER_PAGE,
  pagePlace,
  reportGate,
  screenError,
  scrubText,
  stackFrames,
  worthSending,
} from "../src/lib/screen-errors";

// An error on a reader's screen is sent with what could name them taken out
// (src/lib/screen-errors.ts, AUD-032). These checks hold that line: no email,
// no title, no search, no ID, no key reaches the report, and a broken loop
// sends a few rows, not thousands.

const root = path.resolve(__dirname, "..");
let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const ORIGIN = "https://booktown.page";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const where = {
  pathname: "/books/",
  origin: ORIGIN,
  userAgent: IPHONE,
  touchPoints: 5,
  build: "917c506",
};

check("an error's words lose what could name a reader", () => {
  assert.equal(
    scrubText("No shop for reader@example.com"),
    "No shop for (email)",
  );
  assert.equal(
    scrubText("Could not save 『ノルウェイの森』 to 「夜の本棚」"),
    "Could not save (…) to (…)",
  );
  assert.equal(
    scrubText(`Unexpected token in "my secret note"`),
    "Unexpected token in (…)",
  );
  assert.equal(
    scrubText("Failed https://booktown.page/search/?q=村上春樹#top"),
    "Failed https://booktown.page/search/",
  );
  assert.equal(
    scrubText("book 2b8c1a3e-1111-4222-8333-444455556666 missing"),
    "book (id) missing",
  );
  assert.equal(scrubText("ISBN 9784101001616 not found"), "ISBN (n) not found");
  assert.equal(
    scrubText(
      'duplicate key value violates unique constraint "shops_name_key" Key (name)=(夜の本棚) already exists.',
    ),
    "duplicate key value violates unique constraint (…) Key (name)=(…) already exists.",
  );
  assert.equal(
    scrubText(
      "bad eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc and sb_publishable_abcdefgh123",
    ),
    "bad *** and ***",
  );
  assert.equal(scrubText("x".repeat(1000)).length, MESSAGE_LENGTH);
  // What a developer needs stays.
  assert.equal(
    scrubText(
      "TypeError: Cannot read properties of undefined (reading 'title')",
    ),
    "TypeError: Cannot read properties of undefined (reading (…))",
  );
});

check("the page is its path, with no query and no IDs", () => {
  assert.equal(pagePlace("/books/"), "/books/");
  assert.equal(pagePlace("/search/?q=夏目漱石&tab=books"), "/search/");
  assert.equal(pagePlace("/shops/#shelf-2"), "/shops/");
  assert.equal(
    pagePlace("/books/2b8c1a3e-1111-4222-8333-444455556666/"),
    "/books/(id)/",
  );
  assert.equal(pagePlace("/books/9784101001616/"), "/books/(id)/");
  assert.equal(pagePlace(""), "/");
});

check("only the site's own script positions are kept", () => {
  const stack = [
    "TypeError: x is undefined",
    "    at a (https://booktown.page/_next/static/chunks/app/page-1a2b.js:1:2345)",
    "    at chrome-extension://abcdef/content.js:10:5",
    "    at b (https://evil.example/tracker.js?user=me:3:4)",
    "    at c (https://booktown.page/_next/static/chunks/main-9f.js?v=1:2:10)",
  ].join("\n");
  assert.equal(
    stackFrames(stack, ORIGIN),
    "page-1a2b.js:1:2345 main-9f.js:2:10",
  );
  assert.equal(stackFrames(undefined, ORIGIN), "");
});

check(
  "a report holds the kind, words, page, positions, build and device",
  () => {
    const error = new TypeError("Cannot read properties of null");
    error.stack = `TypeError: Cannot read properties of null\n    at x (${ORIGIN}/_next/static/chunks/a.js:1:2)`;
    assert.deepEqual(
      screenError("error", error, { ...where, pathname: "/walk/?shop=12345" }),
      {
        kind: "error",
        message: "TypeError: Cannot read properties of null",
        place: "/walk/",
        stack: "a.js:1:2",
        build: "917c506",
        device: "iPhone Safari",
      },
    );
    // Supabase rejects with a plain object, and anything else can be thrown.
    assert.equal(
      screenError(
        "rejection",
        { message: "JWT expired", code: "PGRST301" },
        where,
      ).message,
      "JWT expired",
    );
    assert.equal(
      screenError("rejection", undefined, where).message,
      "[object Undefined]",
    );
    assert.equal(screenError("error", "", where).message, "(no message)");
    // The report has nothing else: no reader, no full user agent.
    assert.deepEqual(Object.keys(screenError("error", error, where)).sort(), [
      "build",
      "device",
      "kind",
      "message",
      "place",
      "stack",
    ]);
  },
);

check("errors the site cannot fix are not sent", () => {
  assert.equal(
    worthSending(screenError("error", "Script error.", where)),
    false,
  );
  assert.equal(
    worthSending(
      screenError("error", new Error("boom"), where),
      "chrome-extension://abc/content.js",
    ),
    false,
  );
  assert.equal(
    worthSending(screenError("error", new Error("boom"), where)),
    true,
  );
});

check("one page sends the same error once and a few in all", () => {
  const pass = reportGate();
  const same = screenError("error", new Error("loop"), where);
  assert.equal(pass(same), true);
  for (let i = 0; i < 100; i += 1) assert.equal(pass(same), false);
  let sent = 1;
  for (let i = 0; i < 100; i += 1)
    if (pass(screenError("error", new Error(`other ${i}`), where))) sent += 1;
  assert.equal(sent, REPORTS_PER_PAGE);
});

check("the first script keeps a few errors and hands them over", () => {
  const listeners: Record<string, (event: unknown) => void> = {};
  const window: Record<string, unknown> = {};
  const context = vm.createContext({
    window,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener;
    },
  });
  vm.runInContext(ERROR_BOOT, context);
  const boom = new Error("before React");
  listeners.error({ error: boom, message: "before React", filename: "a.js" });
  // A picture that did not load has no error.
  listeners.error({ error: undefined, message: "" });
  listeners.unhandledrejection({ reason: "nope" });
  for (let i = 0; i < 20; i += 1)
    listeners.error({ error: new Error(`${i}`), message: "" });
  const kept = window.__screenErrors as unknown[][];
  assert.equal(kept.length, REPORTS_PER_PAGE);
  // The list was made inside the script, so it is compared item by item.
  assert.deepEqual([...kept[0]], ["error", boom, "a.js"]);
  assert.deepEqual([...kept[1]], ["rejection", "nope"]);
  // ErrorWatch sets it to null once it listens itself; the script stops.
  window.__screenErrors = null;
  listeners.error({ error: new Error("after"), message: "" });
  assert.equal(window.__screenErrors, null);
});

check("the layout starts the watch before anything else", () => {
  const layout = readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
  const head = layout.slice(layout.indexOf("<head>"));
  assert.ok(
    head.indexOf("ERROR_BOOT") < head.indexOf("<link"),
    "ERROR_BOOT is the first thing in the head",
  );
  assert.match(layout, /<ErrorWatch \/>/);
  // ErrorWatch sends to report_screen_error only, with these fields.
  const watch = readFileSync(
    path.join(root, "src/components/ErrorWatch.tsx"),
    "utf8",
  );
  assert.match(watch, /rpc\/report_screen_error/);
  for (const field of ["kind", "message", "place", "stack", "build", "device"])
    assert.match(watch, new RegExp(`p_${field}: error\\.${field}`));
});

console.log(`${passed} screen error checks passed`);
