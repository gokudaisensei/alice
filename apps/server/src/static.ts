import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

type Entry = { type: string; etag: string; raw: Uint8Array; br?: Uint8Array; gz?: Uint8Array; immutable: boolean };

const TYPES: Record<string, string> = {
  ".html": "text/html;charset=utf-8", ".js": "text/javascript;charset=utf-8", ".css": "text/css;charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain;charset=utf-8", ".ico": "image/x-icon",
};
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".webmanifest", ".txt"]);

/** The built web app, held in memory with Brotli and gzip copies made once at start. Hashed files are cached for a year; the rest revalidate by ETag. */
export function createStatic(dir: string) {
  const files = new Map<string, Entry>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const url = "/" + relative(dir, p).split("\\").join("/");
      const ext = extname(name);
      const raw = new Uint8Array(readFileSync(p));
      const e: Entry = { type: TYPES[ext] ?? "application/octet-stream", etag: `"${createHash("sha1").update(raw).digest("base64url").slice(0, 16)}"`, raw, immutable: url.startsWith("/_app/immutable/") };
      if (COMPRESSIBLE.has(ext) && raw.length > 512) {
        e.br = new Uint8Array(brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }));
        e.gz = new Uint8Array(gzipSync(raw, { level: 9 }));
      }
      files.set(url, e);
    }
  };
  try { walk(dir); } catch { /* no build present */ }

  /** Returns a response for a path, or null when there is no such file and no index.html to fall back on. */
  return function serve(path: string, req: Request): Response | null {
    let url = path;
    try { url = decodeURIComponent(path); } catch { /* keep as is */ }
    let e = files.get(url);
    if (!e || url.endsWith("/")) e = url === "/" || !e ? files.get("/index.html") : e; // SPA fallback
    if (!e) return null;
    const headers: Record<string, string> = { "content-type": e.type, etag: e.etag, vary: "accept-encoding", "cache-control": e.immutable ? "public, max-age=31536000, immutable" : "no-cache" };
    if (req.headers.get("if-none-match") === e.etag) return new Response(null, { status: 304, headers });
    const ae = req.headers.get("accept-encoding") ?? "";
    let body = e.raw;
    if (e.br && /\bbr\b/.test(ae)) { body = e.br; headers["content-encoding"] = "br"; }
    else if (e.gz && /\bgzip\b/.test(ae)) { body = e.gz; headers["content-encoding"] = "gzip"; }
    headers["content-length"] = String(body.length);
    return new Response(body as unknown as BodyInit, { headers });
  };
}
