import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { activity } from "./audit";
import { authorize } from "./guard";
import { say } from "./messages";
import type { HaApi } from "./ha";
import type { DeviceService } from "./devices";

export const MODES = ["home", "away", "night", "vacation"] as const;
export type Mode = (typeof MODES)[number];
/** Lives in Home Assistant so HA automations can use it as a condition. */
export const MODE_ENTITY = "input_select.alice_household_mode";

export async function ensureModeHelper(ha: HaApi): Promise<"exists" | "created" | "failed"> {
  if (ha.entities.has(MODE_ENTITY)) return "exists";
  const r = await ha.ws({ type: "input_select/create", name: "Alice household mode", options: [...MODES], initial: "home", icon: "mdi:home-switch" });
  return r.success ? "created" : "failed";
}

/** A suggestion only. Nothing here ever changes a mode or a device. */
export function modeSuggestion(ha: HaApi, current: Mode | null): { mode: Mode; reason: string } | null {
  const people = [...ha.entities.values()].filter((e) => e.entity_id.startsWith("person.") && e.state !== "unknown" && e.state !== "unavailable");
  if (!people.length || ha.isStale()) return null;
  const away = people.every((p) => p.state !== "home");
  if (current === "home" && away) return { mode: "away", reason: "Everyone seems to be away." };
  if (current === "away" && !away) return { mode: "home", reason: "Someone seems to be home." };
  return null;
}

export const currentMode = (ha: HaApi): Mode | null => {
  const s = ha.entities.get(MODE_ENTITY)?.state;
  return (MODES as readonly string[]).includes(s ?? "") ? (s as Mode) : null;
};

export function modeRoutes(db: Database, ha: HaApi, secure: boolean, svc: DeviceService) {
  const deny = (set: any, status: number, error: string) => { set.status = status; return { error, message: say(error) }; };

  return new Elysia({ name: "modes" })
    .get("/api/mode", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const ok = svc.accessor(g.user), current = currentMode(ha);
      // What each mode is actually connected to, so the effect of switching is never a mystery.
      const linked: Record<string, string[]> = Object.fromEntries(MODES.map((m) => [m, []]));
      for (const r of db.query("SELECT id, name, steps FROM routines WHERE household_id = ?").all(g.user.householdId) as any[]) {
        if (!ok(`routine:${r.id}`)) continue;
        for (const s of JSON.parse(r.steps)) if (s.type === "mode") linked[s.mode].push(r.name);
      }
      return {
        available: ha.entities.has(MODE_ENTITY) && !ha.isStale(), current, modes: MODES,
        canSet: g.user.permissions.includes("modes.set"), linkedRoutines: linked,
        suggestion: modeSuggestion(ha, current),
        note: "Changing the mode doesn't switch any devices by itself. Only routines and automations you've set up do that.",
      };
    })
    .post("/api/mode", async ({ request, body, set }: any) => {
      const g = authorize(db, request, secure, ["modes.set"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const mode = body?.mode;
      if (!(MODES as readonly string[]).includes(mode)) return deny(set, 400, "invalid_value");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const before = ha.entities.get(MODE_ENTITY);
      if (!before) return deny(set, 409, "mode_unavailable");
      if (before.state === mode) return { ok: true, confirmed: true, mode, unchanged: true };
      const r = await ha.callService("input_select", "select_option", { option: mode }, MODE_ENTITY);
      if (!r.ok) return deny(set, r.error === "ha_unavailable" ? 503 : 409, r.error);
      const confirmed = await ha.waitForChange(MODE_ENTITY, before, 1500);
      const now = currentMode(ha);
      if (confirmed && now === mode) activity(db, g.user.householdId, "mode", `Household mode set to ${mode}`);
      return { ok: true, confirmed: confirmed && now === mode, mode: now };
    });
}
