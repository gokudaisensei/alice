import { tmpdir } from "node:os";
import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { adminRoutes } from "./admin";
import { authRoutes } from "./auth";
import type { HaApi } from "./ha";
import { createDeviceService, deviceRoutes } from "./devices";
import { manageRoutes } from "./manage";
import { prefsRoutes } from "./prefs";
import { modeRoutes } from "./modes";
import { createSceneService, sceneRoutes } from "./scenes";
import { createRoutineService, routineRoutes } from "./routines";
import { createAutomationService, automationRoutes } from "./automations";
import { createNotifier, notifyRoutes, type PushSender } from "./notify";
import { createInsights, insightRoutes } from "./insights";
import { createBackups, backupRoutes, parseDests, type Backups } from "./backup";
import { createHealth, healthRoutes } from "./health";
import { voiceRoutes } from "./voice";
import { opsRoutes, supportRoutes } from "./ops";
import { createUpdates, updateRoutes, type Updates } from "./updates";
import type { WebAuthnService } from "./webauthn";

export type AppDeps = {
  db: Database; ha: HaApi; webauthn: WebAuthnService;
  origin: string; cookieSecure: boolean; webDir?: string;
  push?: PushSender; now?: () => number;
  backups?: Backups; dbPath?: string; version?: string; updates?: Updates;
};

/** Strict CSP. SvelteKit's static build has one inline start-up script; allow exactly that script by hash, nothing else inline. */
export function buildCsp(webDir?: string): string {
  const hashes: string[] = [];
  const index = webDir ? join(webDir, "index.html") : "";
  if (index && existsSync(index)) {
    for (const m of readFileSync(index, "utf8").matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g))
      hashes.push(`'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);
  }
  return ["default-src 'self'", `script-src 'self' ${hashes.join(" ")}`.trim(), "img-src 'self' data:", "style-src 'self' 'unsafe-inline'", "connect-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");
}

export function createApp(deps: AppDeps) {
  const devices = createDeviceService(deps.db, deps.ha);
  const csp = buildCsp(deps.webDir);
  const scenes = createSceneService(deps.db, deps.ha, devices), routines = createRoutineService(deps.db, deps.ha, devices);
  const automations = createAutomationService(deps.db, deps.ha, devices, routines);
  const notifier = createNotifier(deps.db, devices, deps.push ?? null, deps.now), insights = createInsights(deps.db, deps.ha, devices, deps.now);
  const backups = deps.backups ?? createBackups(deps.db, parseDests(tmpdir(), ""), deps.now);
  const updates = deps.updates ?? createUpdates(deps.db, null, deps.version ?? "dev", deps.now);
  const health = createHealth(deps.db, deps.ha, backups, updates, { version: deps.version ?? "dev", startedAt: Date.now(), dbPath: deps.dbPath ?? ":memory:", now: deps.now });
  return new Elysia()
    .onError(({ code, set }) => {
      // Never leak internals to clients.
      if (code === "NOT_FOUND") { set.status = 404; return { error: "not_found" }; }
      if (code === "PARSE" || code === "VALIDATION") { set.status = 400; return { error: "invalid_input" }; }
      set.status = 500;
      return { error: "internal_error" };
    })
    .onRequest(({ request, set }) => {
      set.headers["x-content-type-options"] = "nosniff";
      set.headers["referrer-policy"] = "no-referrer";
      set.headers["x-frame-options"] = "DENY";
      set.headers["content-security-policy"] = csp;
      // CSRF: SameSite=Lax cookie + Origin check + required custom header (can't be sent cross-site without CORS, which we never grant).
      const m = request.method;
      if (m !== "GET" && m !== "HEAD" && new URL(request.url).pathname.startsWith("/api/")) {
        const origin = request.headers.get("origin");
        if ((origin && origin !== deps.origin) || request.headers.get("x-requested-with") !== "alice") {
          set.status = 403;
          return new Response(JSON.stringify({ error: "csrf" }), { status: 403, headers: { "content-type": "application/json" } });
        }
      }
    })
    .use(authRoutes({ db: deps.db, webauthn: deps.webauthn, origin: deps.origin, cookieSecure: deps.cookieSecure }))
    .use(adminRoutes(deps.db, deps.cookieSecure))
    .use(deviceRoutes(deps.db, deps.ha, deps.cookieSecure, devices, (u, q) => ({ scenes: scenes.search(u, q), routines: routines.search(u, q) })))
    .use(modeRoutes(deps.db, deps.ha, deps.cookieSecure, devices))
    .use(sceneRoutes(deps.db, deps.ha, deps.cookieSecure, devices, scenes))
    .use(routineRoutes(deps.db, deps.ha, deps.cookieSecure, devices, routines))
    .use(automationRoutes(deps.db, deps.ha, deps.cookieSecure, automations))
    .use(backupRoutes(deps.db, deps.cookieSecure, backups, deps.now))
    .use(healthRoutes(deps.db, deps.cookieSecure, health))
    .use(updateRoutes(deps.db, deps.cookieSecure, updates, notifier))
    .use(voiceRoutes(deps.db, deps.ha, deps.cookieSecure))
    .use(supportRoutes(deps.db, deps.cookieSecure))
    .use(opsRoutes({ db: deps.db, webauthn: deps.webauthn, secure: deps.cookieSecure, ha: deps.ha, health, routines, automations }))
    .use(notifyRoutes(deps.db, deps.cookieSecure, notifier))
    .use(insightRoutes(deps.db, deps.cookieSecure, insights, deps.now))
    .use(manageRoutes(deps.db, deps.ha, deps.cookieSecure))
    .use(prefsRoutes(deps.db, deps.cookieSecure, devices))
    // For the container health check and the updater: is THIS app up, and which version. Deliberately independent of Home Assistant.
    .get("/healthz", ({ set }) => {
      try { const schema = (deps.db.query("SELECT MAX(version) v FROM schema_migrations").get() as any).v; return { ok: true, version: deps.version ?? "dev", schema }; }
      catch { set.status = 503; return { ok: false }; }
    })
    .get("/api/health", () => {
      let dbOk = true;
      try { deps.db.query("SELECT 1").get(); } catch { dbOk = false; }
      return { app: "ok", database: dbOk ? "ok" : "error", homeAssistant: deps.ha.health() };
    })
    .get("/*", async ({ path, set }) => {
      const dir = deps.webDir;
      if (!dir || path.startsWith("/api/")) { set.status = 404; return { error: "not_found" }; }
      const rel = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, "");
      const file = Bun.file(join(dir, rel));
      if (rel !== "/" && (await file.exists())) return file;
      return Bun.file(join(dir, "index.html")); // SPA fallback
    });
}
