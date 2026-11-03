export const PERMISSIONS = [
  "device.control", "scene.activate", "automation.manage",
  "rooms.manage", "users.manage", "admin.access", "prefs.edit",
  "scenes.manage", // create/edit scenes and routines
  "modes.set",     // switch household mode
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type Role = "admin" | "member" | "guest";
export const ROLES: readonly Role[] = ["admin", "member", "guest"];

export const isPermission = (value: unknown): value is Permission => typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
export const isRole = (value: unknown): value is Role => typeof value === "string" && (ROLES as readonly string[]).includes(value);

// Guests hold the feature permission but get no devices until explicitly granted (M2 device grants).
const DEFAULTS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  member: ["device.control", "scene.activate", "automation.manage", "prefs.edit", "scenes.manage", "modes.set"],
  guest: ["device.control", "scene.activate", "prefs.edit"],
};

export function effectivePermissions(role: Role, overrides: Record<string, boolean>): Permission[] {
  const set = new Set<Permission>(DEFAULTS[role]);
  for (const [p, granted] of Object.entries(overrides)) {
    if (!isPermission(p)) continue;
    if (granted) set.add(p); else set.delete(p);
  }
  return [...set];
}
