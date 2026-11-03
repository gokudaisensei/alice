import { tmpdir } from "node:os";
import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { adminRoutes } from "./admin";
import { authRoutes } from "./auth";
import type { HaApi } from "./ha";
import { createDeviceService, deviceRoutes } from "./devices";
import { manageRoutes } from "./manage";
import { haRoomRoutes } from "./haRooms";
import { createHaEnergy, haEnergyRoutes } from "./haEnergy";
import { logbookRoutes } from "./logbook";
import { assistRoutes } from "./haAssist";
import { automationInsightRoutes } from "./automationInsight";
import { createHaStatus, haStatusRoutes, type HaStatusService } from "./haStatus";
import { createStatic } from "./static";
import { createPowerLimits, powerRoutes, type PowerLimits } from "./power";
import { createSync, syncRoutes } from "./sync";
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
import { scalar } from "./sql";

export type AppDeps = {
  db: Database; ha: HaApi; webauthn: WebAuthnService;
  origin: string; cookieSecure: boolean; webDir?: string;
  push?: PushSender; now?: () => number;
  backups?: Backups; dbPath?: string; version?: string; updates?: Updates; powerLimits?: PowerLimits; haStatus?: HaStatusService;
};

/** Strict CSP. SvelteKit's static build has one inline start-up script; allow exactly that script by hash, nothing else inline. */
export function buildCsp(webDir?: string): string {
  const hashes: string[] = [];
  const index = webDir ? join(webDir, "index.html") : "";
  if (index && existsSync(index)) {
    for (const m of readFileSync(index, "utf8").matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g))
      hashes.push(`'sha256-${createHash("sha256").update(m[1] ?? "").digest("base64")}'`);
  }
  return ["default-src 'self'", `script-src 'self' ${hashes.join(" ")}`.trim(), "img-src 'self' data:", "style-src 'self' 'unsafe-inline'", "connect-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");
}

export function createApp(deps: AppDeps) {
  const devices = createDeviceService(deps.db, deps.ha);
  const sync = createSync(deps.ha);
  const powerLimits = deps.powerLimits ?? createPowerLimits(deps.db, deps.now);
  const csp = buildCsp(deps.webDir);
  const staticFiles = deps.webDir ? createStatic(deps.webDir) : null;
  const scenes = createSceneService(deps.ha, devices), routines = createRoutineService(deps.db, deps.ha, devices);
  const automations = createAutomationService(deps.db, deps.ha, devices, routines);
  const notifier = createNotifier(deps.db, devices, deps.push ?? null, deps.now), insights = createInsights(deps.db, deps.ha, devices, deps.now);
  const backups = deps.backups ?? createBackups(deps.db, parseDests(tmpdir(), ""), deps.now);
  const updates = deps.updates ?? createUpdates(deps.db, null, deps.version ?? "dev", deps.now);
  const health = createHealth(deps.db, deps.ha, backups, updates, { version: deps.version ?? "dev", startedAt: Date.now(), dbPath: deps.dbPath ?? ":memory:", now: deps.now });
  let self: { handle(r: Request): Promise<Response> } | null = null;
  const app = new Elysia()
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
      return undefined;
    })
    .onAfterResponse(({ request, set }) => {
      // Anything a person changes (rooms, groups, scenes, access...) tells every other open screen to refresh. Device commands already arrive as device events.
      const path = new URL(request.url).pathname;
      if (request.method === "GET" || request.method === "HEAD" || !path.startsWith("/api/") || Number(set.status ?? 200) >= 400) return;
      if (/^\/api\/(auth|me|ops|sync|stream|notifications)\b/.test(path) || /\/(command|activate|run)$/.test(path)) return;
      sync.bump();
    })
    .use(authRoutes({ db: deps.db, webauthn: deps.webauthn, origin: deps.origin, cookieSecure: deps.cookieSecure }))
    .use(adminRoutes(deps.db, deps.cookieSecure))
    .use(deviceRoutes(deps.db, deps.ha, deps.cookieSecure, devices, (u, q) => ({ scenes: scenes.search(u, q), routines: routines.search(u, q) })))
    .use(modeRoutes(deps.db, deps.ha, deps.cookieSecure, devices))
    .use(sceneRoutes(deps.db, deps.ha, deps.cookieSecure, devices, scenes))
    .use(routineRoutes(deps.db, deps.ha, deps.cookieSecure, devices, routines))
    .use(automationInsightRoutes(deps.db, deps.ha, deps.cookieSecure, automations, devices))
    .use(automationRoutes(deps.db, deps.ha, deps.cookieSecure, automations))
    .use(backupRoutes(deps.db, deps.cookieSecure, backups, deps.now))
    .use(healthRoutes(deps.db, deps.cookieSecure, health))
    .use(updateRoutes(deps.db, deps.cookieSecure, updates, notifier))
    .use(voiceRoutes(deps.db, deps.ha, deps.cookieSecure))
    .use(supportRoutes(deps.db, deps.cookieSecure))
    .use(opsRoutes({ db: deps.db, webauthn: deps.webauthn, secure: deps.cookieSecure, ha: deps.ha, health, routines, automations }))
    .use(notifyRoutes(deps.db, deps.cookieSecure, notifier))
    .use(insightRoutes(deps.db, deps.cookieSecure, insights, deps.now))
    .use(haEnergyRoutes(deps.db, deps.cookieSecure, devices, createHaEnergy(deps.ha, deps.now)))
    .use(haStatusRoutes(deps.db, deps.ha, deps.cookieSecure, deps.haStatus ?? createHaStatus(deps.db, deps.ha, deps.now)))
    .use(assistRoutes(deps.db, deps.ha, deps.cookieSecure, devices, deps.now))
    .use(logbookRoutes(deps.db, deps.ha, deps.cookieSecure, devices, deps.now))
    .use(manageRoutes(deps.db, deps.ha, deps.cookieSecure))
    .use(haRoomRoutes(deps.db, deps.ha, deps.cookieSecure))
    .use(syncRoutes(deps.db, deps.cookieSecure, sync, devices))
    .use(powerRoutes(deps.db, deps.ha, deps.cookieSecure, powerLimits, devices))
    .use(prefsRoutes(deps.db, deps.cookieSecure, devices))
    // For the container health check and the updater: is THIS app up, and which version. Deliberately independent of Home Assistant.
    .get("/healthz", ({ set }) => {
      try { const schema = scalar(deps.db, "SELECT MAX(version) FROM schema_migrations", 0); return { ok: true, version: deps.version ?? "dev", schema }; }
      catch { set.status = 503; return { ok: false }; }
    })
    .get("/api/health", () => {
      let dbOk = true;
      try { deps.db.query("SELECT 1").get(); } catch { dbOk = false; }
      return { app: "ok", database: dbOk ? "ok" : "error", homeAssistant: deps.ha.health() };
    })
    // Everything the first screen needs in one round trip, built from the app's own endpoints so permissions are exactly the same.
    .get("/api/bootstrap", async ({ request, set }) => {
      const cookie = request.headers.get("cookie") ?? "";
      const get = async (path: string) => {
        const r = await self?.handle(new Request(new URL(path, request.url).toString(), { headers: { cookie } }));
        return r?.ok ? await r.json() as unknown : null;
      };
      const [me, devices, rooms, groups, prefs, mode, scenes, routines] = await Promise.all(["/api/me", "/api/devices", "/api/rooms", "/api/groups", "/api/me/prefs", "/api/mode", "/api/scenes", "/api/routines"].map(get));
      if (!me) { set.status = 401; return { error: "unauthenticated" }; }
      set.headers["cache-control"] = "no-store";
      return { me, devices, rooms, groups, prefs, mode, scenes, routines };
    })
    .get("/*", ({ path, set, request }) => {
      if (!staticFiles || path.startsWith("/api/")) { set.status = 404; return { error: "not_found" }; }
      return staticFiles(path, request) ?? (() => { set.status = 404; return { error: "not_found" }; })();
    });
  self = app;
  return app;
}
