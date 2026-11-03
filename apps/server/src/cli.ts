// Physical-access recovery: run inside the container (`docker compose exec app bun src/cli.ts ...`).
// Anyone who can run this already controls the device; every use is audited.
import { config } from "./config";
import { audit } from "./audit";
import { ensureBootstrapCode, issueEnrollmentToken } from "./auth";
import { migrate, openDb } from "./db";
import { createOperator } from "./ops";
import { all, one } from "./sql";

const db = openDb(config.dbPath); migrate(db);
const [cmd, arg] = process.argv.slice(2);
if (cmd === "setup-code") {
  const c = ensureBootstrapCode(db);
  console.log(c ? `Setup code: ${c}` : "Already set up. Use: recovery-code <user-id>");
} else if (cmd === "recovery-code" && arg) {
  const u = one<{ id: string; household_id: string }>(db, "SELECT id, household_id FROM users WHERE id = ? AND status != 'revoked'", arg);
  if (!u) { console.error("No such active user"); process.exit(1); }
  audit(db, { householdId: u.household_id, actorType: "system", action: "cli.recovery_issued", target: u.id, outcome: "success", reason: "physical access" });
  console.log(`Recovery code (1 hour, single use): ${issueEnrollmentToken(db, "recovery", u.id)}`);
} else if (cmd === "list-admins") {
  console.table(all(db, "SELECT id, display_name, status FROM users WHERE role='admin'"));
} else if (cmd === "operator-code" && arg) {
  const o = createOperator(db, arg);
  console.log(`Operator ${o.id} created. Enrollment code (1 hour, single use, needs a hardware security key): ${o.token}`);
} else if (cmd === "list-operators") {
  console.table(all(db, "SELECT id, name, status FROM operators"));
} else if (cmd === "revoke-operator" && arg) {
  db.query("UPDATE operators SET status = 'revoked' WHERE id = ?").run(arg);
  db.query("DELETE FROM operator_sessions WHERE operator_id = ?").run(arg);
  audit(db, { actorType: "system", action: "operator.revoked", target: arg, outcome: "success", reason: "physical access" });
  console.log("Revoked.");
} else { console.log("usage: setup-code | recovery-code <user-id> | list-admins | operator-code <name> | list-operators | revoke-operator <id>\n       (restore: bun src/restore.ts <archive> <identity-file>, with the app stopped)"); process.exit(1); }
