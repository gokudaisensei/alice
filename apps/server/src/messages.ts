const M: Record<string, string> = {
  ha_unavailable: "The home hub isn't reachable right now, so nothing can be changed. Check that it is powered on and connected to your network.",
  device_unavailable: "That device is offline. Check that it has power and Wi-Fi, then try again.",
  ha_not_admin: "The home hub didn't allow the app to change its settings. Please contact support.",
  ha_rejected: "The home hub rejected that change. Please try again, or contact support if it keeps happening.",
  not_confirmed: "The home hub didn't confirm the change, so it was undone. Please try again.",
  ha_not_loading: "The home hub saved that but isn't loading it, so it was undone. This usually means the hub isn't set up to load scenes, routines and automations created by the app. Please contact support.",
  mode_unavailable: "Household modes aren't set up on the home hub yet. Please contact support.",
  invalid_trigger: "One of the triggers isn't valid.",
  invalid_condition: "One of the conditions isn't valid.",
  invalid_step: "One of the steps isn't valid.",
  unsupported: "This device doesn't support that.",
  invalid_value: "That value isn't allowed for this device.",
};
export const say = (code: string) => M[code] ?? "Something went wrong. Please try again.";
