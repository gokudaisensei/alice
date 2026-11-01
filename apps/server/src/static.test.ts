import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { createStatic } from "./static";

const dir = mkdtempSync(join(tmpdir(), "web-"));
mkdirSync(join(dir, "_app/immutable"), { recursive: true });
const js = "console.log('hello world');".repeat(100);
writeFileSync(join(dir, "index.html"), "<!doctype html><title>Home</title>".repeat(30));
writeFileSync(join(dir, "_app/immutable/app.abc.js"), js);
const serve = createStatic(dir);
const req = (h: Record<string, string> = {}) => new Request("http://x/", { headers: h });

test("serves Brotli or gzip when accepted, plain otherwise", async () => {
  const br = serve("/_app/immutable/app.abc.js", req({ "accept-encoding": "gzip, br" }))!;
  expect(br.headers.get("content-encoding")).toBe("br");
  expect(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString()).toBe(js);
  const gz = serve("/_app/immutable/app.abc.js", req({ "accept-encoding": "gzip" }))!;
  expect(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()).toBe(js);
  const plain = serve("/_app/immutable/app.abc.js", req())!;
  expect(plain.headers.get("content-encoding")).toBeNull();
  expect(await plain.text()).toBe(js);
});

test("hashed files cache for a year; the page revalidates by ETag", () => {
  expect(serve("/_app/immutable/app.abc.js", req())!.headers.get("cache-control")).toContain("immutable");
  const page = serve("/", req())!;
  expect(page.headers.get("cache-control")).toBe("no-cache");
  const again = serve("/", req({ "if-none-match": page.headers.get("etag")! }))!;
  expect(again.status).toBe(304);
});

test("unknown paths fall back to the app page, and there is no file escape", () => {
  expect(serve("/rooms/kitchen", req())!.headers.get("content-type")).toContain("text/html");
  expect(serve("/../../etc/passwd", req())!.headers.get("content-type")).toContain("text/html");
});
