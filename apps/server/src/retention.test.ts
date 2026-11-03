import { expect, test } from "bun:test";
import { all, scalar } from "./sql";
import { RETENTION, runRetention } from "./retention";
import { setup } from "./testkit";

const DAY = 86400_000;

test("old history is removed on schedule and recent history is untouched", async () => {
  const t = setup(); const a = await t.bootstrapAdmin("a1"); void a;
  const h = scalar(t.db, "SELECT id FROM households", ""), now = Date.now();
  const audit = t.db.query("INSERT INTO security_audit (ts, household_id, actor_type, action, outcome) VALUES (?,?,?,?,?)");
  audit.run(now - 400 * DAY, h, "user", "old.thing", "success"); audit.run(now - 364 * DAY, h, "user", "recent.thing", "success");
  const act = t.db.query("INSERT INTO activity_events (ts, household_id, kind, summary) VALUES (?,?,?,?)");
  act.run(now - 400 * DAY, h, "x", "old"); act.run(now - 10 * DAY, h, "x", "new");
  const u = scalar(t.db, "SELECT id FROM users", "");
  const note = t.db.query("INSERT INTO notifications (id, household_id, user_id, kind, title, body, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?)");
  note.run("n1", h, u, "hub", "old", "b", "k1", now - 100 * DAY); note.run("n2", h, u, "hub", "new", "b", "k2", now - 5 * DAY);
  t.db.query("INSERT INTO samples (entity_id, ts, value) VALUES ('a', ?, 1), ('a', ?, 1)").run(now - 40 * DAY, now - DAY);
  t.db.query("INSERT INTO sessions (token_hash, user_id, created_at, last_seen, reauth_at) VALUES ('stale', ?, ?, ?, 0)").run(u, now - 40 * DAY, now - 40 * DAY);
  t.db.query("INSERT INTO enrollment_tokens (token_hash, purpose, user_id, expires_at) VALUES ('t', 'invite', ?, ?)").run(u, now - 5 * DAY);
  const r = runRetention(t.db, now);
  expect(r).toMatchObject({ audit: 1, activity: 1, notifications: 1, samples: 1, sessions: 1, enrollment: 1 });
  expect(all<{ action: string }>(t.db, "SELECT action FROM security_audit WHERE action LIKE '%.thing'").map((x) => x.action)).toEqual(["recent.thing"]);
  expect(all<{ summary: string }>(t.db, "SELECT summary FROM activity_events WHERE kind='x'").map((x) => x.summary)).toEqual(["new"]);
  expect(t.db.query("SELECT token_hash FROM sessions WHERE token_hash = 'stale'").get()).toBeNull();
  expect(RETENTION.auditDays).toBe(365);
});

test("the audit log cannot be shortened even by calling the job with a bad clock", async () => {
  const t = setup(); await t.bootstrapAdmin("a1");
  const before = scalar(t.db, "SELECT COUNT(*) n FROM security_audit", 0);
  expect(before).toBeGreaterThan(0);
  const r = runRetention(t.db, Date.now() + 999 * DAY); // a far-future clock tries to age everything out
  expect([r.audit, r.auditBlocked]).toEqual([0, true]);
  // the table's own triggers decide what may be deleted, using the real clock
  expect(scalar(t.db, "SELECT COUNT(*) n FROM security_audit", 0)).toBe(before);
});
