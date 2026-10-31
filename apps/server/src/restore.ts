// Offline restore. Stop the app first:  docker compose stop app
//   docker compose run --rm -v /path/to/backups:/in:ro app bun src/restore.ts /in/<archive> /in/<identity-file>
// It checks the backup before touching anything, and keeps the current database as a dated copy.
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { config } from "./config";
import { decryptWith, inspect } from "./backup";

const [archive, identityFile] = process.argv.slice(2);
if (!archive || !identityFile) { console.error("usage: bun src/restore.ts <archive.age> <identity-file>"); process.exit(1); }
const identity = readFileSync(identityFile, "utf8").split("\n").map((l) => l.trim()).find((l) => l.startsWith("AGE-SECRET-KEY-"));
if (!identity) { console.error("That file doesn't contain a backup key."); process.exit(1); }

const plain = await decryptWith(readFileSync(archive), identity).catch(() => null);
if (!plain) { console.error("That key can't open this backup."); process.exit(1); }
const staged = config.dbPath + ".restoring";
writeFileSync(staged, plain);
const info = inspect(staged);
if (!info.ok) { rmSync(staged); console.error(`The backup failed its integrity check (${info.detail}). Nothing was changed.`); process.exit(1); }

if (existsSync(config.dbPath)) copyFileSync(config.dbPath, `${config.dbPath}.before-restore-${Date.now()}`);
for (const ext of ["-wal", "-shm"]) rmSync(config.dbPath + ext, { force: true }); // stale journal files would corrupt the restored copy
renameSync(staged, config.dbPath);
console.log(`Restored. ${Object.keys(info.counts).length} tables, schema version ${info.version}. Start the app again; any newer migrations apply on start.`);
