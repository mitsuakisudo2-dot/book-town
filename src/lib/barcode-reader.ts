// The continuous scanner's barcode reader (ScanSession.tsx). Where the
// browser's own BarcodeDetector reads EAN-13 (Chrome on Android, on the Mac),
// that one. Elsewhere, Safari on the iPhone among them, the same API from
// barcode-detector: ZXing-C++ built to WebAssembly (zxing-wasm), loaded only
// when the scanner opens. This site serves the .wasm itself, from /zxing/
// (scripts/copy-zxing.mjs puts it there at build), so it is always the
// version the JavaScript was built for, and no outside address is asked.

import { iosDevice } from "./user-agent";

export interface DetectedCode {
  rawValue: string;
}
export interface Detector {
  detect(source: CanvasImageSource | ImageData): Promise<DetectedCode[]>;
}
export interface DetectorClass {
  new (options: { formats: "ean_13"[] }): Detector;
  getSupportedFormats?: () => Promise<readonly string[]>;
}

/** The parts of Emscripten's module settings used here. */
interface ZXingOverrides {
  locateFile(file: string, prefix: string): string;
}
/** What barcode-detector/ponyfill gives (a stand-in in the tests). */
export interface ReaderModule {
  BarcodeDetector: DetectorClass;
  ZXING_WASM_VERSION: string;
  prepareZXingModule(options: {
    overrides: ZXingOverrides;
    fireImmediately: true;
  }): Promise<unknown>;
  purgeZXingModule(): void;
}

/** Where the site serves the reader's WebAssembly (scripts/copy-zxing.mjs). */
export const zxingWasmPath = (version: string) =>
  `/zxing/zxing_reader-${version}.wasm`;

/** A slow network gives up after this long, not never. */
export const READER_TIMEOUT_MS = 15_000;

/**
 * Safari, and every browser on the iPhone and iPad: WebKit. Its own
 * BarcodeDetector, where one is turned on, reads nothing (WebKit bug 281848).
 */
export function webKitOnly(userAgent: string, touchPoints: number): boolean {
  if (iosDevice(userAgent, touchPoints)) return true;
  return (
    /AppleWebKit/.test(userAgent) && !/Chrome|Chromium|Android/.test(userAgent)
  );
}

/** The browser's own reader, unless it is WebKit's. */
function browserReader(): DetectorClass | undefined {
  const own = (window as unknown as { BarcodeDetector?: DetectorClass })
    .BarcodeDetector;
  return own && !webKitOnly(navigator.userAgent, navigator.maxTouchPoints ?? 0)
    ? own
    : undefined;
}

/**
 * How this browser reads barcodes, as far as is known before loading
 * anything: its own reader, ZXing in WebAssembly, or not at all (WebKit's
 * Lockdown Mode has no WebAssembly).
 */
export function readerKind(): "native" | "wasm" | null {
  if (browserReader()) return "native";
  return typeof WebAssembly === "object" ? "wasm" : null;
}

export type ReaderFailure =
  /** This browser cannot: the WebAssembly does not compile here. */
  | "no-reader"
  /** Not this time: the network, or no answer within READER_TIMEOUT_MS. */
  | "reader-failed";
export type ReaderLoad =
  | { ok: true; Detector: DetectorClass; wasm: boolean }
  | { ok: false; why: ReaderFailure };

/**
 * What a failed start of the WebAssembly reader means. Emscripten gives
 * every failure as a RuntimeError, "Aborted(…)", with the first error in its
 * message: a CompileError or LinkError there is this browser's, and anything
 * else (the file not fetched) may go another time.
 */
export function readerFailure(error: unknown): ReaderFailure {
  if (
    typeof WebAssembly === "object" &&
    (error instanceof WebAssembly.CompileError ||
      error instanceof WebAssembly.LinkError)
  )
    return "no-reader";
  const message = String((error as { message?: unknown })?.message ?? error);
  return /\b(CompileError|LinkError)\b/.test(message)
    ? "no-reader"
    : "reader-failed";
}

// One page loads the WebAssembly once, with these settings, whatever reopens
// the scanner (［続ける］, back from ［手で入力］, ［カメラで読む］): new
// settings each time would fetch and compile the megabyte again.
let overrides: ZXingOverrides | undefined;
let loading: Promise<DetectorClass> | null = null;
let loaded: ReaderModule | null = null;

const withinTime = <T>(promise: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`The barcode reader did not start in ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

async function startWasm(
  importReader: () => Promise<ReaderModule>,
  timeoutMs: number,
): Promise<DetectorClass> {
  let reader: ReaderModule | undefined;
  let givenUp = false;
  const start = async () => {
    const imported = await importReader();
    // The script came after the time ran out: the next start has it.
    if (givenUp) return imported.BarcodeDetector;
    reader = loaded = imported;
    const version = imported.ZXING_WASM_VERSION;
    // An absolute path: Emscripten would look beside the page otherwise
    // (/profiles/me/zxing_reader.wasm).
    overrides ??= {
      locateFile: (file, prefix) =>
        file.endsWith(".wasm") ? zxingWasmPath(version) : prefix + file,
    };
    // Awaited here: a start that failed stays in the reader, and every
    // detect() after it fails ("Barcode detection service unavailable").
    await imported.prepareZXingModule({ overrides, fireImmediately: true });
    return imported.BarcodeDetector;
  };
  try {
    // The time counts from the start: the script itself, a chunk of this
    // site's JavaScript, can stall on a weak network as well as the .wasm.
    return await withinTime(start(), timeoutMs);
  } catch (error) {
    givenUp = true;
    // Let go, so the next start tries again from the beginning.
    reader?.purgeZXingModule();
    throw error;
  }
}

/**
 * The reader to use, ready to read: the browser's own where it reads EAN-13
 * and is not WebKit's, otherwise ZXing in WebAssembly. The WebAssembly is
 * loaded once for the page; a failed load is forgotten, to be tried again.
 * `importReader` and `native` stand in for the real ones in the tests.
 */
export async function loadDetector(
  options: {
    importReader?: () => Promise<ReaderModule>;
    native?: DetectorClass;
    timeoutMs?: number;
  } = {},
): Promise<ReaderLoad> {
  const native = "native" in options ? options.native : browserReader();
  if (native) {
    try {
      const formats = await native.getSupportedFormats?.();
      if (!formats || formats.includes("ean_13"))
        return { ok: true, Detector: native, wasm: false };
    } catch {
      // Unknown: read with it all the same.
      return { ok: true, Detector: native, wasm: false };
    }
  }
  if (typeof WebAssembly !== "object") return { ok: false, why: "no-reader" };
  const starting = (loading ??= startWasm(
    options.importReader ?? (() => import("barcode-detector/ponyfill")),
    options.timeoutMs ?? READER_TIMEOUT_MS,
  ));
  try {
    return { ok: true, Detector: await starting, wasm: true };
  } catch (error) {
    if (loading === starting) loading = null;
    return { ok: false, why: readerFailure(error) };
  }
}

/** Reads kept failing: the WebAssembly is let go, and loaded again next time. */
export function forgetReader() {
  loaded?.purgeZXingModule();
  loaded = null;
  loading = null;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The part of a camera frame under `area`, in the frame's own pixels and
 * within it. The frame (`frame`: its own size) is shown in an element of
 * `view`'s size with object-fit: cover, so the sides or the top and bottom
 * are cut; `area` is a box on the screen, from the element's top left.
 * Null when nothing of the frame is under it.
 */
export function guideRect(
  frame: { width: number; height: number },
  view: { width: number; height: number },
  area: Box,
): Box | null {
  if (!(
    frame.width > 0 &&
    frame.height > 0 &&
    view.width > 0 &&
    view.height > 0
  ))
    return null;
  const scale = Math.max(view.width / frame.width, view.height / frame.height);
  const left = (view.width - frame.width * scale) / 2;
  const top = (view.height - frame.height * scale) / 2;
  const within = (value: number, most: number) =>
    Math.min(most, Math.max(0, value));
  const x = Math.floor(within((area.x - left) / scale, frame.width));
  const y = Math.floor(within((area.y - top) / scale, frame.height));
  const right = Math.ceil(
    within((area.x + area.width - left) / scale, frame.width),
  );
  const bottom = Math.ceil(
    within((area.y + area.height - top) / scale, frame.height),
  );
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}
