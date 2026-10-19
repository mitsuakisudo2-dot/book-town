// Serves the built site (out/) as Vercel does for the speed checks: over
// HTTP/2 (TLS with a certificate made here, which measure.mjs accepts), with
// brotli and the same cache-control as vercel.json. Over HTTP/1.1 a browser
// asks one site six files at a time, each waiting out the slow line's round
// trip, which Vercel's HTTP/2 does not.
//
//   node scripts/perf/serve.mjs [out] [port]
import { execFileSync } from "node:child_process";
import http2 from "node:http2";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const dir = path.resolve(process.argv[2] ?? "out");
const port = Number(process.argv[3]) || 5181;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

function cacheControl(p) {
  if (p.startsWith("/_next/static/"))
    return "public, max-age=31536000, immutable";
  if (
    p.startsWith("/zxing/") ||
    /^\/home\/.*-v\d+\.webp$/.test(p) ||
    /^\/themes\/.*-v\d+\.(webp|svg)$/.test(p)
  )
    return "public, max-age=31536000, immutable";
  if (p.startsWith("/fonts/") || p === "/themes/woodshop/room.webp")
    return "public, max-age=604800";
  return "public, max-age=0, must-revalidate";
}

// A certificate for 127.0.0.1 alone, made for this run (openssl).
const keys = fs.mkdtempSync(path.join(os.tmpdir(), "book-town-perf-"));
execFileSync(
  "openssl",
  [
    ...["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1"],
    ...["-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"],
    ...["-keyout", path.join(keys, "key.pem")],
    ...["-out", path.join(keys, "cert.pem")],
  ],
  { stdio: "ignore" },
);

const compressed = new Map();
http2
  .createSecureServer(
    {
      key: fs.readFileSync(path.join(keys, "key.pem")),
      cert: fs.readFileSync(path.join(keys, "cert.pem")),
      allowHTTP1: true,
    },
    (req, res) => {
      const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let file = path.join(dir, p);
      if (!file.startsWith(dir)) {
        res.writeHead(403);
        return res.end();
      }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory())
        file = path.join(file, "index.html");
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end("not found");
      }
      const type = types[path.extname(file)] || "application/octet-stream";
      const headers = {
        "content-type": type,
        "cache-control": cacheControl(p),
      };
      let body = fs.readFileSync(file);
      const etag = `"${body.length}-${fs.statSync(file).mtimeMs}"`;
      headers.etag = etag;
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, headers);
        return res.end();
      }
      if (
        /text|javascript|json|svg|manifest|wasm/.test(type) &&
        /br/.test(req.headers["accept-encoding"] || "")
      ) {
        const key = file + etag;
        if (!compressed.has(key))
          compressed.set(
            key,
            zlib.brotliCompressSync(body, {
              params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
            }),
          );
        body = compressed.get(key);
        headers["content-encoding"] = "br";
      }
      headers["content-length"] = body.length;
      res.writeHead(200, headers);
      res.end(body);
    },
  )
  .listen(port, "127.0.0.1", () =>
    console.log("serving", dir, "on", `https://127.0.0.1:${port}`),
  );
