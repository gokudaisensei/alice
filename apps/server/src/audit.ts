import type { Database } from "bun:sqlite";

export type AuditEntry = {
  householdId?: string | null;
  actorType: "user" | "anonymous" | "system" | "operator";
  actorId?: string | null;
  action: string;
  target?: string | null;
  outcome: "success" | "failure" | "denied";
  reason?: string | null;
};

export function audit(db: Database, e: AuditEntry) {
  db.query(
    "INSERT INTO security_audit (ts, household_id, actor_type, actor_id, action, target, outcome, reason) VALUES (?,?,?,?,?,?,?,?)",
  ).run(Date.now(), e.householdId ?? null, e.actorType, e.actorId ?? null, e.action, e.target ?? null, e.outcome, e.reason ?? null);
}

// Household-visible record. Never takes an actor.
export function activity(db: Database, householdId: string, kind: string, summary: string) {
  db.query("INSERT INTO activity_events (ts, household_id, kind, summary) VALUES (?,?,?,?)").run(Date.now(), householdId, kind, summary);
}
