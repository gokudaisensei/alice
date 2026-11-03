import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statfsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import * as age from "age-encryption";
import { activity, audit } from "./audit";
import { authorize } from "./guard";
import { openReadonly } from "./db";
import { asObject, denyWith as deny } from "./http";
import type { SessionUser } from "./session";
import { all, one, scalar } from "./sql";

export type Dest = { name: string; dir: string; local: boolean };
type BackupRow = {
  id: string; household_id: string; created_at: number; name: string; kind: "auto" | "manual"; size: number; sha256: string;
  schema_version: number; counts: string; integrity_ok: number; integrity_detail: string; dests: string;
  restore_tested_at: number | null; restore_tested_ok: number | null; restore_detail: string | null;
};
/** What a restore test says back: a refusal (nothing was tested), or a verdict. */
type RestoreOutcome = { status: 400 | 404; error: string } | { status: 200; ok: boolean; detail: string };
export const KEEP = 7, STALE_MS = 48 * 3600_000;
const PATTERN = /^alice-\d{8}-\d{6}-[0-9a-f]{6}\.db\.gz\.age$/;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const IDENTITY = /^AGE-SECRET-KEY-1[A-Z0-9]{50,}$/, RECIPIENT = /^age1[a-z0-9]{50,}$/;

/** Parse "usb=/backups/usb,nas=/backups/nas" (set by whoever installs the box, never from the UI). */
export function parseDests(dataDir: string, spec: string): Dest[] {
  const out: Dest[] = [{ name: "This device", dir: join(dataDir, "backups"), local: true }];
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [name = "", dir] = part.includes("=") ? part.split("=") : [part, part];
    if (dir?.startsWith("/")) out.push({ name: name.trim(), dir: dir.trim(), local: false });
  }
  return out;
}

/** A temporary directory that deletes itself when its `using` scope ends, however that happens. */
function tempDir(prefix: string): { path: string } & Disposable {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return { path, [Symbol.dispose]: () => rmSync(path, { recursive: true, force: true }) };
}

/** Open a database copy read-only and say what is inside it. Nothing here touches the live database. */
export function inspect(path: string) {
  using handle = openReadonly(path);
  const d = handle.db;
  const ic = all<{ integrity_check: string }>(d, "PRAGMA integrity_check").map((r) => r.integrity_check);
  const tables = all<{ name: string }>(d, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name);
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = scalar(d, `SELECT COUNT(*) FROM "${t}"`, 0);
  const version = scalar(d, "SELECT MAX(version) FROM schema_migrations", 0);
  return { ok: ic.length === 1 && ic[0] === "ok", detail: ic.join("; "), counts, version };
}

export async function encryptTo(plain: Uint8Array, recipient: string) {
  const e = new age.Encrypter(); e.addRecipient(recipient);
  return e.encrypt(gzipSync(plain));
}
export async function decryptWith(archive: Uint8Array, identity: string) {
  const d = new age.Decrypter(); d.addIdentity(identity);
  return gunzipSync(await d.decrypt(archive));
}

export function createBackups(db: Database, dests: Dest[], now: () => number = Date.now) {
  const setting = (h: string, k: string) => one<{ value: string }>(db, "SELECT value FROM app_settings WHERE household_id = ? AND key = ?", h, k)?.value;
  const recipient = (h: string) => setting(h, "backup.recipient") ?? null;
  const setRecipient = (h: string, r: string) => db.query("INSERT INTO app_settings (household_id, key, value) VALUES (?,?,?) ON CONFLICT(household_id, key) DO UPDATE SET value = excluded.value").run(h, "backup.recipient", r);
  const recipientOk = (r: unknown): r is string => {
    if (typeof r !== "string" || !RECIPIENT.test(r)) return false;
    try { new age.Encrypter().addRecipient(r); return true; } catch { return false; }
  };

  function destinations() {
    return dests.map((d) => {
      let ok = false, free: number | null = null;
      try { mkdirSync(d.dir, { recursive: true }); accessSync(d.dir, constants.W_OK); ok = true; const s = statfsSync(d.dir); free = Number(s.bavail) * Number(s.bsize); } catch {}
      return { name: d.name, local: d.local, writable: ok, freeBytes: free };
    });
  }

  async function create(householdId: string, kind: "auto" | "manual") {
    const r = recipient(householdId);
    if (!r) return { error: "no_backup_key" as const };
    using scratch = tempDir("alice-bk-");
    const snap = join(scratch.path, "snap.db");
    db.query("VACUUM INTO ?").run(snap);
    const info = inspect(snap);
    const enc = await encryptTo(readFileSync(snap), r);
    const t = now(), stamp = new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const name = `alice-${stamp.slice(0, 8)}-${stamp.slice(8, 14)}-${randomUUID().slice(0, 6)}.db.gz.age`;
    const results = dests.map((d) => {
      try {
        mkdirSync(d.dir, { recursive: true });
        const tmp = join(d.dir, `.${name}.part`);
        writeFileSync(tmp, enc); renameSync(tmp, join(d.dir, name)); // never leave half a file under the real name
        for (const f of readdirSync(d.dir).filter((f) => PATTERN.test(f)).sort().reverse().slice(KEEP)) unlinkSync(join(d.dir, f));
        return { name: d.name, ok: true };
      } catch (e) { return { name: d.name, ok: false, error: String((e as NodeJS.ErrnoException).code ?? "write_failed") }; }
    });
    const id = randomUUID();
    db.query("INSERT INTO backups (id, household_id, created_at, name, kind, size, sha256, schema_version, counts, integrity_ok, integrity_detail, dests) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, householdId, t, name, kind, enc.length, sha(enc), info.version, JSON.stringify(info.counts), info.ok ? 1 : 0, info.detail, JSON.stringify(results));
    return { id };
  }

  const rows = (h: string) => all<BackupRow>(db, "SELECT * FROM backups WHERE household_id = ? ORDER BY created_at DESC LIMIT 30", h);
  const fileFor = (row: BackupRow) => {
    for (const d of dests) { const p = join(d.dir, row.name); if (existsSync(p)) { const b = readFileSync(p); if (sha(b) === row.sha256) return b; } }
    return null;
  };
  /** Is every copy still there and unchanged? */
  function copies(row: BackupRow) {
    return dests.map((d) => { const p = join(d.dir, row.name); let state: "ok" | "changed" | "missing" = "missing"; if (existsSync(p)) state = sha(readFileSync(p)) === row.sha256 ? "ok" : "changed"; return { name: d.name, local: d.local, state }; });
  }
  function view(row: BackupRow) {
    const c = copies(row), offDevice = c.some((x) => !x.local && x.state === "ok");
    // none -> intact (opened and checked at creation) -> restore_tested (decrypted with the key and compared)
    const level = row.restore_tested_ok ? "restore_tested" : row.integrity_ok ? "integrity_checked" : "failed";
    return { id: row.id, createdAt: row.created_at, kind: row.kind, size: row.size, name: row.name, level, integrity: { ok: !!row.integrity_ok, detail: row.integrity_detail }, copies: c, offDevice,
      restoreTest: row.restore_tested_at ? { at: row.restore_tested_at, ok: !!row.restore_tested_ok, detail: row.restore_detail } : null };
  }

  /** Prove the archive can really be read back with the household's key. The key is used in memory and never stored. */
  async function restoreTest(householdId: string, id: string, identity: unknown): Promise<RestoreOutcome> {
    const row = one<BackupRow>(db, "SELECT * FROM backups WHERE id = ? AND household_id = ?", id, householdId);
    if (!row) return { status: 404, error: "not_found" };
    if (typeof identity !== "string" || !IDENTITY.test(identity.trim())) return { status: 400, error: "invalid_input" };
    const file = fileFor(row);
    const finish = (ok: boolean, detail: string) => { db.query("UPDATE backups SET restore_tested_at = ?, restore_tested_ok = ?, restore_detail = ? WHERE id = ?").run(now(), ok ? 1 : 0, detail, id); return { ok, detail }; };
    if (!file) return { status: 200, ...finish(false, "No intact copy of this backup was found, so it can't be restored.") };
    using scratch = tempDir("alice-rt-");
    let plain: Uint8Array;
    try { plain = await decryptWith(file, identity.trim()); } catch { return { status: 200, ...finish(false, "That key can't open this backup. Check you're using the key saved when backups were set up.") }; }
    const p = join(scratch.path, "restored.db"); writeFileSync(p, plain);
    const got = inspect(p), want = JSON.parse(row.counts) as Record<string, number>;
    if (!got.ok) return { status: 200, ...finish(false, `The restored copy failed its integrity check: ${got.detail}`) };
    const off = Object.keys(want).filter((t) => got.counts[t] !== want[t]);
    if (off.length) return { status: 200, ...finish(false, `The restored copy doesn't match what was backed up (${off.join(", ")}).`) };
    return { status: 200, ...finish(true, `Restored into a scratch copy: integrity check passed and all ${Object.keys(want).length} tables matched.`) };
  }

  /** Overall state for the health page. */
  function status(householdId: string) {
    const latest = one<BackupRow>(db, "SELECT * FROM backups WHERE household_id = ? AND integrity_ok = 1 ORDER BY created_at DESC LIMIT 1", householdId);
    const v = latest ? view(latest) : null;
    return { recipientSet: !!recipient(householdId), latest: v, overdue: !latest || now() - latest.created_at > STALE_MS, destinations: destinations() };
  }
  return { recipient, setRecipient, recipientOk, destinations, create, view, rows, fileFor, restoreTest, status };
}
export type Backups = ReturnType<typeof createBackups>;

export async function newKeyPair() { const identity = await age.generateIdentity(); return { identity, recipient: await age.identityToRecipient(identity) }; }

export function backupRoutes(db: Database, secure: boolean, bk: Backups, now: () => number = Date.now) {
  let lastRun = 0;
  const log = (u: Pick<SessionUser, "householdId" | "id">, action: string, target?: string, outcome: "success" | "failure" = "success") => audit(db, { householdId: u.householdId, actorType: "user", actorId: u.id, action, target: target ?? null, outcome });
  return new Elysia({ name: "backups" })
    .get("/api/admin/backups", ({ request, set }) => {
      const g = authorize(db, request, secure, ["admin.access"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const s = bk.status(g.user.householdId);
      return { recipientSet: s.recipientSet, recipient: bk.recipient(g.user.householdId), destinations: s.destinations, overdue: s.overdue, backups: bk.rows(g.user.householdId).map(bk.view) };
    })
    // The secret half is shown once, to be kept off this device. Only the public half is stored.
    .post("/api/admin/backups/key", async ({ request, set }) => {
      const g = authorize(db, request, secure, ["admin.access"], true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (bk.recipient(g.user.householdId)) return deny(set, 409, "invalid_input"); // replacing a key must be deliberate: use PUT
      const k = await newKeyPair(); bk.setRecipient(g.user.householdId, k.recipient);
      log(g.user, "backup.key_generated"); return k;
    })
    .put("/api/admin/backups/recipient", ({ request, body, set }) => {
      const g = authorize(db, request, secure, ["admin.access"], true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const recipient = asObject(body).recipient;
      if (!bk.recipientOk(recipient)) return deny(set, 400, "invalid_input");
      bk.setRecipient(g.user.householdId, recipient); log(g.user, "backup.recipient_changed"); return { ok: true };
    })
    .post("/api/admin/backups", async ({ request, set }) => {
      const g = authorize(db, request, secure, ["admin.access"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (now() - lastRun < 20_000) return deny(set, 429, "rate_limited");
      lastRun = now();
      const r = await bk.create(g.user.householdId, "manual");
      if ("error" in r) return deny(set, 409, String(r.error));
      log(g.user, "backup.create", r.id); activity(db, g.user.householdId, "backup", "A backup was made");
      const made = one<BackupRow>(db, "SELECT * FROM backups WHERE id = ?", r.id);
      return { ok: true, backup: made ? bk.view(made) : null };
    })
    .post("/api/admin/backups/:id/restore-test", async ({ request, params, body, set }) => {
      const g = authorize(db, request, secure, ["admin.access"], true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const r = await bk.restoreTest(g.user.householdId, params.id, asObject(body).identity);
      if ("error" in r) return deny(set, r.status, r.error);
      log(g.user, "backup.restore_test", params.id, r.ok ? "success" : "failure");
      return { ok: r.ok, detail: r.detail };
    })
    // Lets the page do the passkey check first, so the (large) file is only fetched once, by the browser's own download.
    .get("/api/admin/backups/:id/ready", ({ request, params, set }) => {
      const g = authorize(db, request, secure, ["admin.access"], true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row = one<BackupRow>(db, "SELECT * FROM backups WHERE id = ? AND household_id = ?", params.id, g.user.householdId);
      return row && bk.fileFor(row) ? { ok: true } : deny(set, 404, "not_found");
    })
    .get("/api/admin/backups/:id/download", ({ request, params, set }) => {
      const g = authorize(db, request, secure, ["admin.access"], true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row = one<BackupRow>(db, "SELECT * FROM backups WHERE id = ? AND household_id = ?", params.id, g.user.householdId);
      const file = row ? bk.fileFor(row) : null;
      if (!row || !file) return deny(set, 404, "not_found");
      log(g.user, "backup.download", row.id);
      return new Response(file, { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${row.name}"`, "cache-control": "no-store" } });
    });
}
