import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return db;
}

export function migrate(db: Database, dir = join(import.meta.dir, "../migrations")): number {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))");
  const done = new Set(db.query("SELECT version FROM schema_migrations").all().map((r: any) => r.version));
  let applied = 0;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const version = parseInt(f, 10);
    if (done.has(version)) continue;
    db.transaction(() => {
      db.exec(readFileSync(join(dir, f), "utf8"));
      db.query("INSERT INTO schema_migrations (version) VALUES (?)").run(version);
    })();
    applied++;
  }
  return applied;
}
