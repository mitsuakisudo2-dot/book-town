// Puts the barcode reader's WebAssembly where the site serves it itself:
// public/zxing/zxing_reader-<version>.wasm, next to public/zxing/LICENSE.txt.
// The browsers without a reader of their own (Safari on the iPhone) read
// barcodes with it (src/lib/barcode-reader.ts). package.json's build and dev
// run this first; public/zxing/ is not kept in git.
//
// The file is checked against the sha256 that barcode-detector's JavaScript
// was built for, so the build stops when zxing-wasm was upgraded alone: the
// two are upgraded together, to the zxing-wasm that barcode-detector names.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ZXING_CPP_COMMIT,
  ZXING_WASM_SHA256,
  ZXING_WASM_VERSION,
} from "barcode-detector/ponyfill";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const modules = path.join(root, "node_modules");
export const SOURCE = path.join(
  modules,
  "zxing-wasm/dist/reader/zxing_reader.wasm",
);
const TARGET = path.join(root, "public/zxing");
/** The file's name, as src/lib/barcode-reader.ts asks for it. */
export const wasmName = (version) => `zxing_reader-${version}.wasm`;

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * The reader's WebAssembly from node_modules, once it is the one
 * barcode-detector expects; otherwise an error saying what to do.
 */
export async function readerWasm() {
  const installed = JSON.parse(
    await readFile(path.join(modules, "zxing-wasm/package.json"), "utf8"),
  ).version;
  const bytes = await readFile(SOURCE);
  const sum = sha256(bytes);
  if (installed !== ZXING_WASM_VERSION || sum !== ZXING_WASM_SHA256)
    throw new Error(
      `zxing-wasm ${installed} is not the one barcode-detector was built ` +
        `for (zxing-wasm ${ZXING_WASM_VERSION}, sha256 ${ZXING_WASM_SHA256}; ` +
        `this file is ${sum}). Upgrade barcode-detector and zxing-wasm ` +
        `together, zxing-wasm to the version barcode-detector names.`,
    );
  return bytes;
}

async function license() {
  const text = (file) => readFile(file, "utf8");
  const [apache, zxingWasm, detector] = await Promise.all([
    text(path.join(root, "scripts/licenses/Apache-2.0.txt")),
    text(path.join(modules, "zxing-wasm/LICENSE")),
    text(path.join(modules, "barcode-detector/LICENSE")),
  ]);
  const detectorVersion = JSON.parse(
    await text(path.join(modules, "barcode-detector/package.json")),
  ).version;
  const rule = (title) =>
    `\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}\n\n`;
  return (
    `The barcode reader of this site\n\n` +
    `${wasmName(ZXING_WASM_VERSION)} is zxing-wasm ${ZXING_WASM_VERSION} ` +
    `(https://github.com/Sec-ant/zxing-wasm).\n` +
    `It is built from ZXing-C++ (https://github.com/zxing-cpp/zxing-cpp, ` +
    `commit ${ZXING_CPP_COMMIT})\n` +
    `and zxing-wasm's src/cpp/ZXingWasm.cpp, both under the Apache License, ` +
    `Version 2.0\n(the full text is at the end of this file), and from ` +
    `zxing-wasm's own code, under the MIT License.\n` +
    `It also contains stb_image (https://github.com/nothings/stb), which its ` +
    `author offers\nin the public domain or under the MIT License.\n\n` +
    `The JavaScript that loads it is barcode-detector ${detectorVersion} ` +
    `(https://github.com/Sec-ant/barcode-detector),\nunder the MIT License.\n` +
    rule("zxing-wasm: MIT License") +
    zxingWasm.trimEnd() +
    "\n" +
    rule("barcode-detector: MIT License") +
    detector.trimEnd() +
    "\n" +
    rule("ZXing-C++ and ZXingWasm.cpp: Apache License, Version 2.0") +
    apache.replace(/^\n+/, "")
  );
}

async function main() {
  const bytes = await readerWasm();
  await mkdir(TARGET, { recursive: true });
  // Only this version: a file left from an earlier one is not shipped.
  for (const name of await readdir(TARGET))
    if (name !== wasmName(ZXING_WASM_VERSION) && name !== "LICENSE.txt")
      await rm(path.join(TARGET, name), { recursive: true, force: true });
  await writeFile(path.join(TARGET, wasmName(ZXING_WASM_VERSION)), bytes);
  await writeFile(path.join(TARGET, "LICENSE.txt"), await license());
  console.log(
    `public/zxing/${wasmName(ZXING_WASM_VERSION)} (${bytes.length} bytes, sha256 checked)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
