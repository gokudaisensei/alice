import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KEEP } from "./backup";
import { createHealth } from "./health";
import { setup } from "./testkit";

async function home() {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  const j = (m: string, p: string, cookie: string, body?: any) => t.call(m, p, { cookie, body });
  const key = async () => (await j("POST", "/api/admin/backups/key", admin.cookie!)).json as { identity: string; recipient: string };
  return { t, admin: admin.cookie!, member, j, key };
}
const dirs = (t: any) => ({ local: join(t.root, "local"), usb: join(t.root, "usb") });

test("backups need a key first, and only an admin can set one up", async () => {
  const { t, admin, member, j } = await home();
  expect((await j("POST", "/api/admin/backups", admin)).json.error).toBe("no_backup_key");
  expect((await j("POST", "/api/admin/backups/key", member.cookie)).status).toBe(403);
  expect((await j("GET", "/api/admin/backups", member.cookie)).status).toBe(403);
  expect((await t.call("GET", "/api/admin/backups")).status).toBe(401);
  expect((await j("PUT", "/api/admin/backups/recipient", admin, { recipient: "not a key" })).status).toBe(400);
});

test("the secret key is shown once and never stored", async () => {
  const { t, admin, j, key } = await home();
  const k = await key();
  expect(k.identity).toMatch(/^AGE-SECRET-KEY-1/);
  expect(k.recipient).toMatch(/^age1/);
  expect((await j("GET", "/api/admin/backups", admin)).json.recipient).toBe(k.recipient);
  expect((await j("POST", "/api/admin/backups/key", admin)).status).toBe(409); // replacing it is a deliberate act
  const dump = JSON.stringify([t.db.query("SELECT * FROM app_settings").all(), t.db.query("SELECT * FROM security_audit").all(), t.db.query("SELECT * FROM backups").all()]);
  expect(dump).not.toContain("AGE-SECRET-KEY");
  const reauthNeeded = setup(); const a = await reauthNeeded.bootstrapAdmin("x"); // fresh session, then let the window lapse
  reauthNeeded.db.query("UPDATE sessions SET reauth_at = 0").run();
  expect((await reauthNeeded.call("POST", "/api/admin/backups/key", { cookie: a.cookie })).json.error).toBe("reauth_required");
});

test("a backup is encrypted, written to every destination, and checked", async () => {
  const { t, admin, j, key } = await home();
  await key();
  const r = await j("POST", "/api/admin/backups", admin);
  expect(r.status).toBe(200);
  const b = r.json.backup;
  expect(b).toMatchObject({ kind: "manual", level: "integrity_checked", offDevice: true, integrity: { ok: true } });
  expect(b.copies).toEqual([{ name: "This device", local: true, state: "ok" }, { name: "USB drive", local: false, state: "ok" }]);
  for (const d of Object.values(dirs(t))) {
    const f = readdirSync(d).find((x) => x.endsWith(".age"))!;
    expect(f).toMatch(/^alice-\d{8}-\d{6}-[0-9a-f]{6}\.db\.gz\.age$/);
    const bytes = readFileSync(join(d, f));
    expect(new TextDecoder().decode(bytes.subarray(0, 20))).toContain("age-encryption.org"); // never plaintext SQLite
    expect(bytes.includes(Buffer.from("SQLite format"))).toBe(false);
  }
  expect((await j("POST", "/api/admin/backups", admin)).status).toBe(429); // not in a tight loop
});

test("a restore test proves the key opens it, and a wrong key is reported honestly", async () => {
  const { t, admin, j, key } = await home();
  const k = await key();
  const { id } = (await j("POST", "/api/admin/backups", admin)).json.backup;
  const wrong = (await import("./backup")).newKeyPair;
  const other = await wrong();
  let r = await j("POST", `/api/admin/backups/${id}/restore-test`, admin, { identity: other.identity });
  expect(r.json.ok).toBe(false);
  expect(r.json.detail).toContain("can't open this backup");
  expect((await j("GET", "/api/admin/backups", admin)).json.backups[0].level).toBe("integrity_checked");
  expect((await j("POST", `/api/admin/backups/${id}/restore-test`, admin, { identity: "nope" })).status).toBe(400);
  r = await j("POST", `/api/admin/backups/${id}/restore-test`, admin, { identity: k.identity });
  expect(r.json.ok).toBe(true);
  expect(r.json.detail).toContain("tables matched");
  const b = (await j("GET", "/api/admin/backups", admin)).json.backups[0];
  expect([b.level, b.restoreTest.ok]).toEqual(["restore_tested", true]);
  expect(JSON.stringify(t.db.query("SELECT * FROM backups").all())).not.toContain("AGE-SECRET-KEY"); // used in memory only
});

test("a changed or missing copy is noticed, and the intact one is still used", async () => {
  const { t, admin, j, key } = await home();
  const k = await key();
  const { id, name } = (await j("POST", "/api/admin/backups", admin)).json.backup;
  writeFileSync(join(dirs(t).usb, name), "bit rot");
  let b = (await j("GET", "/api/admin/backups", admin)).json.backups[0];
  expect(b.copies.map((c: any) => c.state)).toEqual(["ok", "changed"]);
  expect(b.offDevice).toBe(false); // the only good copy is on the device itself
  expect((await j("POST", `/api/admin/backups/${id}/restore-test`, admin, { identity: k.identity })).json.ok).toBe(true);
  const dl = await t.app.handle(new Request(`http://localhost/api/admin/backups/${id}/download`, { headers: { cookie: admin, "x-requested-with": "alice" } }));
  expect(dl.status).toBe(200);
  expect(Buffer.from(await dl.arrayBuffer()).equals(readFileSync(join(dirs(t).local, name)))).toBe(true);
  for (const d of Object.values(dirs(t))) { try { require("node:fs").rmSync(join(d, name)); } catch {} }
  const r = await j("POST", `/api/admin/backups/${id}/restore-test`, admin, { identity: k.identity });
  expect(r.json.ok).toBe(false);
  expect(r.json.detail).toContain("No intact copy");
  b = (await j("GET", "/api/admin/backups", admin)).json.backups[0];
  expect(b.copies.map((c: any) => c.state)).toEqual(["missing", "missing"]);
  expect((await j("GET", `/api/admin/backups/${id}/download`, admin)).status).toBe(404);
});

test("downloads need a fresh confirmation and old backups are pruned", async () => {
  const { t, admin, member, j, key } = await home();
  await key();
  const first = (await j("POST", "/api/admin/backups", admin)).json.backup;
  expect((await j("GET", `/api/admin/backups/${first.id}/download`, member.cookie)).status).toBe(403);
  t.db.query("UPDATE sessions SET reauth_at = 0").run();
  expect((await j("GET", `/api/admin/backups/${first.id}/download`, admin)).json.error).toBe("reauth_required");
  for (let i = 0; i < KEEP + 3; i++) { t.clock.t += 60_000; await t.backups.create((t.db.query("SELECT id FROM households").get() as any).id, "auto"); }
  expect(readdirSync(dirs(t).local).filter((f) => f.endsWith(".age")).length).toBe(KEEP);
  expect(existsSync(join(dirs(t).local, first.name))).toBe(false);
});

test("the health page says what is wrong and what to do", async () => {
  const { t, admin, member, j, key } = await home();
  const h = () => j("GET", "/api/admin/health", admin).then((r) => r.json);
  const by = (r: any, id: string) => r.checks.find((c: any) => c.id === id);
  expect((await j("GET", "/api/admin/health", member.cookie)).status).toBe(403);
  let r = await h();
  expect(by(r, "hub").status).toBe("ok");
  expect(by(r, "backup")).toMatchObject({ status: "warn", detail: "Backups aren't set up yet." });
  const k = await key();
  expect(by(await h(), "backup").detail).toBe("No backup has been made yet.");
  const { id } = (await j("POST", "/api/admin/backups", admin)).json.backup;
  r = await h();
  expect(by(r, "backup").status).toBe("warn");
  expect(by(r, "backup").detail).toContain("never test-restored");
  await j("POST", `/api/admin/backups/${id}/restore-test`, admin, { identity: k.identity });
  expect(by(await h(), "backup").status).toBe("ok");
  t.clock.t += 3 * 86400_000;
  expect(by(await h(), "backup")).toMatchObject({ status: "warn" });
  t.ha.setStale(true);
  r = await h();
  expect(by(r, "hub").status).toBe("fail");
  expect(by(r, "hub").advice).toContain("powered on");
  expect(r.overall).toBe("fail");
  expect(JSON.stringify(r)).not.toMatch(/token|password|AGE-/i);
  void createHealth;
});

test("the download check confirms a fresh passkey and an intact copy without sending the file", async () => {
  const { t, admin, j, key } = await home();
  await key();
  const { id } = (await j("POST", "/api/admin/backups", admin)).json.backup;
  const r = await j("GET", `/api/admin/backups/${id}/ready`, admin);
  expect([r.status, r.json]).toEqual([200, { ok: true }]);
  t.db.query("UPDATE sessions SET reauth_at = 0").run();
  expect((await j("GET", `/api/admin/backups/${id}/ready`, admin)).json.error).toBe("reauth_required");
});
