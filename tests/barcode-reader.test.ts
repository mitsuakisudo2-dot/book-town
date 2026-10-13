import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as ponyfill from "barcode-detector/ponyfill";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import {
  forgetReader,
  guideRect,
  loadDetector,
  readerFailure,
  readerKind,
  webKitOnly,
  zxingWasmPath,
  type DetectorClass,
  type ReaderModule,
} from "../src/lib/barcode-reader";
import { nextFrame } from "../src/lib/scan";
import { readerWasm, SOURCE, wasmName } from "../scripts/copy-zxing.mjs";
import { bookBarcodes, withCheckDigit } from "./ean13.mjs";

// The continuous scanner's barcode reader (barcode-reader.ts): the part of
// the frame under the guide, choosing the browser's own reader or ZXing in
// WebAssembly, loading that once and letting a failed load go, and ZXing
// reading a Japanese book's two codes from a picture. Everything runs inside
// main() because tsx compiles this file as CommonJS.

const ISBN = "9784003101018";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const PRICE = withCheckDigit("192019300700");

/** A reader module that counts what was asked of it. */
function fakeReader(start: (overrides: unknown) => Promise<unknown>) {
  const asked = { prepared: [] as unknown[], purged: 0 };
  class Fake {
    async detect() {
      return [];
    }
  }
  const reader: ReaderModule = {
    BarcodeDetector: Fake as unknown as DetectorClass,
    ZXING_WASM_VERSION: "9.9.9",
    prepareZXingModule({ overrides }) {
      asked.prepared.push(overrides);
      return start(overrides);
    },
    purgeZXingModule() {
      asked.purged += 1;
    },
  };
  return { reader, asked };
}
const aborted = (inner: string) =>
  new WebAssembly.RuntimeError(
    `Aborted(${inner}). Build with -sASSERTIONS for more info.`,
  );

// A check that never settles would end the run quietly, with nothing left
// for Node to wait on and exit code 0: it is a failure here.
let finished = false;
process.on("beforeExit", () => {
  if (finished) return;
  console.error("A check never finished");
  process.exitCode = 1;
});

/**
 * Runs `run` in a browser with this user agent and this BarcodeDetector of
 * its own, as barcode-reader.ts sees them (window and navigator).
 */
async function inBrowser<T>(
  userAgent: string,
  BarcodeDetector: DetectorClass,
  run: () => Promise<T>,
): Promise<T> {
  const globals = globalThis as { window?: unknown };
  const navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globals.window = { BarcodeDetector };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent, maxTouchPoints: 5 },
  });
  try {
    return await run();
  } finally {
    delete globals.window;
    if (navigator) Object.defineProperty(globalThis, "navigator", navigator);
  }
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  await check("the guide's band is found in a frame cut at the sides", () => {
    // A phone held upright: a 1920×1080 frame in a 390×500 box, cover.
    const band = { x: 0, y: 190, width: 390, height: 120 };
    assert.deepEqual(
      guideRect(
        { width: 1920, height: 1080 },
        { width: 390, height: 500 },
        band,
      ),
      { x: 538, y: 410, width: 844, height: 260 },
    );
  });

  await check("and in a frame cut at the top and bottom", () => {
    const area = { x: 100, y: 150, width: 600, height: 100 };
    assert.deepEqual(
      guideRect(
        { width: 1080, height: 1920 },
        { width: 800, height: 400 },
        area,
      ),
      { x: 135, y: 892, width: 810, height: 136 },
    );
    // The same shape: nothing is cut.
    assert.deepEqual(
      guideRect(
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
        { x: 0, y: 90, width: 640, height: 180 },
      ),
      { x: 0, y: 180, width: 1280, height: 360 },
    );
  });

  await check("the band stays inside the frame, or is nothing", () => {
    const frame = { width: 1280, height: 720 };
    const view = { width: 640, height: 360 };
    assert.deepEqual(
      guideRect(frame, view, { x: -20, y: 300, width: 700, height: 100 }),
      { x: 0, y: 600, width: 1280, height: 120 },
    );
    assert.equal(
      guideRect(frame, view, { x: 0, y: 400, width: 640, height: 50 }),
      null,
    );
    // The video has no size yet.
    assert.equal(
      guideRect({ width: 0, height: 0 }, view, { x: 0, y: 0, ...view }),
      null,
    );
  });

  await check(
    "ZXing reads both codes of a book, and only the ISBN counts",
    async () => {
      const bytes = await readFile(SOURCE);
      await prepareZXingModule({
        overrides: {
          wasmBinary: bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        },
        fireImmediately: true,
      });
      const { width, height, gray } = bookBarcodes({
        isbn: ISBN,
        price: PRICE,
      });
      const data = new Uint8ClampedArray(width * height * 4);
      gray.forEach((value: number, at: number) => {
        data.set([value, value, value, 255], at * 4);
      });
      const read = await readBarcodes(
        { data, width, height, colorSpace: "srgb" } as ImageData,
        { formats: ["EAN13"] },
      );
      assert.deepEqual(
        read.map((code) => code.text).sort(),
        [PRICE, ISBN].sort(),
      );
      const frame = nextFrame(
        {},
        read.map((code) => code.text),
      );
      assert.deepEqual(frame.fresh, [{ kind: "isbn", isbn: ISBN }]);
      assert.deepEqual(Object.keys(frame.inView), [ISBN]);
    },
  );

  await check(
    "the WebAssembly in node_modules is the one barcode-detector was built for",
    async () => {
      const sum = createHash("sha256")
        .update(await readFile(SOURCE))
        .digest("hex");
      assert.equal(sum, ponyfill.ZXING_WASM_SHA256);
      const installed = JSON.parse(
        await readFile(
          path.join(path.dirname(SOURCE), "../../package.json"),
          "utf8",
        ),
      ).version;
      assert.equal(installed, ponyfill.ZXING_WASM_VERSION);
      // What scripts/copy-zxing.mjs checks before a build, and the address
      // the page asks for is the file it writes.
      assert.equal((await readerWasm()).length > 0, true);
      assert.equal(
        zxingWasmPath(ponyfill.ZXING_WASM_VERSION),
        "/zxing/" + wasmName(ponyfill.ZXING_WASM_VERSION),
      );
    },
  );

  await check(
    "every build writes the WebAssembly first, Vercel's too",
    async () => {
      const json = async (file: string) =>
        JSON.parse(await readFile(path.join(__dirname, "..", file), "utf8"));
      const { scripts } = await json("package.json");
      for (const name of ["build", "dev"])
        assert.match(scripts[name], /^node scripts\/copy-zxing\.mjs && /);
      // Whatever the project's settings say, Vercel runs that build.
      assert.equal((await json("vercel.json")).buildCommand, "pnpm build");
    },
  );

  await check("WebKit's own reader is passed over, Chrome's is not", () => {
    const iphone = IPHONE;
    const chromeOnIphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1";
    const mac =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
    const android = ANDROID;
    const chromeOnMac =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    assert.equal(webKitOnly(iphone, 5), true);
    assert.equal(webKitOnly(chromeOnIphone, 5), true);
    // An iPad asks for the Mac's page.
    assert.equal(webKitOnly(mac, 5), true);
    assert.equal(webKitOnly(mac, 0), true);
    assert.equal(webKitOnly(android, 5), false);
    assert.equal(webKitOnly(chromeOnMac, 0), false);
  });

  await check("a browser's own reader of EAN-13 loads nothing", async () => {
    let imported = 0;
    class Native {
      static async getSupportedFormats() {
        return ["qr_code", "ean_13"];
      }
      async detect() {
        return [];
      }
    }
    const load = await loadDetector({
      native: Native as unknown as DetectorClass,
      importReader: async () => {
        imported += 1;
        throw new Error("not to be loaded");
      },
    });
    assert.deepEqual(load, {
      ok: true,
      Detector: Native,
      wasm: false,
    });
    assert.equal(imported, 0);
  });

  await check(
    "on an iPhone, WebKit's own reader is passed over for ZXing",
    async () => {
      forgetReader();
      // WebKit's, turned on in Safari's settings: it says it reads EAN-13.
      class WebKits {
        static async getSupportedFormats() {
          return ["ean_13", "qr_code"];
        }
        async detect() {
          return [];
        }
      }
      const { reader } = fakeReader(() => Promise.resolve({}));
      let imported = 0;
      const importReader = async () => {
        imported += 1;
        return reader;
      };
      const native = WebKits as unknown as DetectorClass;
      await inBrowser(IPHONE, native, async () => {
        assert.equal(readerKind(), "wasm");
        assert.deepEqual(await loadDetector({ importReader }), {
          ok: true,
          Detector: reader.BarcodeDetector,
          wasm: true,
        });
      });
      assert.equal(imported, 1);
      // The same reader on Android's Chrome is used, and nothing is loaded.
      forgetReader();
      await inBrowser(ANDROID, native, async () => {
        assert.equal(readerKind(), "native");
        assert.deepEqual(await loadDetector({ importReader }), {
          ok: true,
          Detector: native,
          wasm: false,
        });
      });
      assert.equal(imported, 1);
    },
  );

  await check(
    "a failed load is let go: the network may work another time",
    async () => {
      const { reader, asked } = fakeReader(() =>
        Promise.reject(
          aborted("both async and sync fetching of the wasm failed"),
        ),
      );
      let imported = 0;
      const importReader = async () => {
        imported += 1;
        return reader;
      };
      assert.deepEqual(
        await loadDetector({ native: undefined, importReader }),
        {
          ok: false,
          why: "reader-failed",
        },
      );
      assert.equal(asked.purged, 1);
      // Tried again from the beginning, with the same settings.
      assert.deepEqual(
        await loadDetector({ native: undefined, importReader }),
        {
          ok: false,
          why: "reader-failed",
        },
      );
      assert.equal(imported, 2);
      assert.equal(asked.purged, 2);
      assert.equal(asked.prepared[0], asked.prepared[1]);
    },
  );

  await check(
    "WebAssembly that does not compile here means no reader",
    async () => {
      const { reader, asked } = fakeReader(() =>
        Promise.reject(
          aborted(
            "CompileError: WebAssembly.instantiate(): expected magic word 00 61 73 6d",
          ),
        ),
      );
      assert.deepEqual(
        await loadDetector({
          native: undefined,
          importReader: async () => reader,
        }),
        { ok: false, why: "no-reader" },
      );
      assert.equal(asked.purged, 1);
      assert.equal(
        readerFailure(new WebAssembly.CompileError("x")),
        "no-reader",
      );
      assert.equal(readerFailure(new WebAssembly.LinkError("x")), "no-reader");
      assert.equal(
        readerFailure(new TypeError("Failed to fetch")),
        "reader-failed",
      );
    },
  );

  await check("no answer within the time given is a failure too", async () => {
    const { reader, asked } = fakeReader(() => new Promise(() => {}));
    const started = Date.now();
    assert.deepEqual(
      await loadDetector({
        native: undefined,
        importReader: async () => reader,
        timeoutMs: 30,
      }),
      { ok: false, why: "reader-failed" },
    );
    assert.ok(Date.now() - started < 1000);
    assert.equal(asked.purged, 1);
  });

  await check(
    "the time counts from the start: a script that never comes fails too",
    async () => {
      const started = Date.now();
      assert.deepEqual(
        await loadDetector({
          native: undefined,
          importReader: () => new Promise<ReaderModule>(() => {}),
          timeoutMs: 30,
        }),
        { ok: false, why: "reader-failed" },
      );
      assert.ok(Date.now() - started < 1000);
      // ［カメラで読む］ asks for the script again, not the stalled one.
      const { reader } = fakeReader(() => Promise.resolve({}));
      let imported = 0;
      assert.deepEqual(
        await loadDetector({
          native: undefined,
          importReader: async () => {
            imported += 1;
            return reader;
          },
          timeoutMs: 30,
        }),
        { ok: true, Detector: reader.BarcodeDetector, wasm: true },
      );
      assert.equal(imported, 1);
      forgetReader();
    },
  );

  await check(
    "a script that comes after the time ran out starts nothing",
    async () => {
      const { reader, asked } = fakeReader(() => Promise.resolve({}));
      let arrived!: () => void;
      const came = new Promise<void>((resolve) => (arrived = resolve));
      assert.deepEqual(
        await loadDetector({
          native: undefined,
          importReader: () =>
            new Promise((resolve) =>
              setTimeout(() => {
                resolve(reader);
                arrived();
              }, 60),
            ),
          timeoutMs: 30,
        }),
        { ok: false, why: "reader-failed" },
      );
      await came;
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(asked.prepared.length, 0);
    },
  );

  await check("the script itself not loading is a failure too", async () => {
    let imported = 0;
    const importReader = async (): Promise<ReaderModule> => {
      imported += 1;
      throw new TypeError("Loading chunk failed");
    };
    for (let time = 0; time < 2; time++)
      assert.deepEqual(
        await loadDetector({ native: undefined, importReader }),
        {
          ok: false,
          why: "reader-failed",
        },
      );
    assert.equal(imported, 2);
  });

  await check("the real reader's failures read as they should", async () => {
    // The ponyfill in Node: nothing is fetched, as with no network.
    const said = console.error;
    console.error = () => {};
    try {
      ponyfill.purgeZXingModule();
      const offline = await ponyfill
        .prepareZXingModule({
          overrides: { locateFile: (file: string) => "/zxing/" + file },
          fireImmediately: true,
        })
        .catch((error: unknown) => error);
      assert.equal(readerFailure(offline), "reader-failed");
      ponyfill.purgeZXingModule();
      const broken = await ponyfill
        .prepareZXingModule({
          overrides: { wasmBinary: new Uint8Array([1, 2, 3, 4]).buffer },
          fireImmediately: true,
        })
        .catch((error: unknown) => error);
      assert.equal(readerFailure(broken), "no-reader");
      ponyfill.purgeZXingModule();
    } finally {
      console.error = said;
    }
  });

  await check(
    "the WebAssembly loads once, from this site, with one set of settings",
    async () => {
      forgetReader();
      const { reader, asked } = fakeReader(() => Promise.resolve({}));
      let imported = 0;
      const importReader = async () => {
        imported += 1;
        return reader;
      };
      // A browser whose own reader does not read EAN-13 uses ZXing.
      class Native {
        static async getSupportedFormats() {
          return ["qr_code"];
        }
      }
      const first = await loadDetector({
        native: Native as unknown as DetectorClass,
        importReader,
      });
      const again = await loadDetector({ native: undefined, importReader });
      assert.deepEqual(first, {
        ok: true,
        Detector: reader.BarcodeDetector,
        wasm: true,
      });
      assert.deepEqual(again, first);
      assert.equal(imported, 1);
      assert.equal(asked.prepared.length, 1);
      const settings = asked.prepared[0] as {
        locateFile(file: string, prefix: string): string;
      };
      // An absolute path, whatever page the scanner is opened on.
      assert.equal(
        settings.locateFile("zxing_reader.wasm", ""),
        "/zxing/zxing_reader-9.9.9.wasm",
      );
      // Let go after reads kept failing: loaded again, with the same settings.
      forgetReader();
      assert.equal(asked.purged, 1);
      await loadDetector({ native: undefined, importReader });
      assert.equal(imported, 2);
      assert.equal(asked.prepared[1], settings);
      forgetReader();
    },
  );

  console.log(passed + " barcode reader checks passed");
  finished = true;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
