import type { Database } from "bun:sqlite";
import { SESSION } from "./session";

const DAY = 86400_000;
/** What is kept, and for how long. Run daily. Everything here is also written down in docs/SECURITY.md. */
export const RETENTION = { auditDays: 365, activityDays: 365, notificationDays: 90, supportSessionDays: 90, enrollmentDays: 2 };

export function runRetention(db: Database, now: number = Date.now()) {
  const del = (sql: string, ...p: number[]) => db.query(sql).run(...p).changes;
  // The audit table's own triggers refuse to delete anything younger than 365 days by the real clock. If this clock is wrong
  // (e.g. jumped forward), that refusal is the safety net: skip the audit step, keep everything, and carry on with the rest.
  let audit = 0, auditBlocked = false;
  try { audit = del("DELETE FROM security_audit WHERE ts < ?", now - RETENTION.auditDays * DAY); } catch { auditBlocked = true; }
  return {
    audit, auditBlocked,
    activity: del("DELETE FROM activity_events WHERE ts < ?", now - RETENTION.activityDays * DAY),
    notifications: del("DELETE FROM notifications WHERE created_at < ?", now - RETENTION.notificationDays * DAY),
    sessions: del("DELETE FROM sessions WHERE created_at < ? OR last_seen < ?", now - SESSION.absoluteMs, now - SESSION.idleMs),
    operatorSessions: del("DELETE FROM operator_sessions WHERE created_at < ? OR last_seen < ?", now - 8 * 3600_000, now - 30 * 60_000),
    enrollment: del("DELETE FROM enrollment_tokens WHERE expires_at < ?", now - RETENTION.enrollmentDays * DAY)
      + del("DELETE FROM operator_enrollment WHERE expires_at < ?", now - RETENTION.enrollmentDays * DAY),
    supportSessions: del("DELETE FROM support_sessions WHERE expires_at < ?", now - RETENTION.supportSessionDays * DAY),
    dismissals: del("DELETE FROM insight_dismissals WHERE until < ?", now),
    samples: del("DELETE FROM samples WHERE ts < ?", now - 35 * DAY),
  };
}
