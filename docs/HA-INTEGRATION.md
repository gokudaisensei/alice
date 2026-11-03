# Deep Home Assistant integration: plan

Status: proposal. Target: **Home Assistant Container** only (no Supervisor, no add-ons, no ingress, no HA OS features). Written against the code in `apps/server/src` as of commit `d0829a3`.

## 0. Progress

| Phase | State |
|---|---|
| P1 transport | Heartbeat, safe parsing, live registry re-read, hub info (version, time zone, units) are in. **Still open:** split into transport and model, `subscribe_entities`, using `ha.info` for units. |
| P2 areas | Done: areas and floors read live; preview-and-import of areas as rooms and labels as groups; devices follow their area unless the household placed them; write-back (new rooms create an area, renaming a linked room renames the area, placing a device in a linked room updates the hub; best effort except rename); "About this device" from the registry (maker, model, firmware, integration, battery, labels); floor name on rooms. **Known limits:** removing a device from a linked room cannot clear an area it inherits from its physical device; floors are shown as a label, not as tabs on the home screen; not viewed in a browser or run on a real HA. |

## 1. Principle

Today HA is a state feed and a YAML writer. The goal is to make **HA's own data model the backbone** and keep Alice for what HA cannot do: passkey identity and roles, plain-language UX, honest "confirmed or not" command semantics, guided builders, household-level alerts, encrypted backups and signed updates.

Rules that stay true after every phase:

1. HA stays the source of truth for structure and state. Alice keeps only an *overlay* (colour, icon, order, who may see what).
2. Cached state is shown as stale whenever the hub is unreachable. Commands are never queued or retried. "Confirmed" means a state change was observed.
3. HA is never exposed to the internet. Alice's egress stays allow-listed.
4. Every new HA call has a fake in `apps/mock-ha` **and** a case in `real-ha.test.ts` against a real container.
5. Anything optional degrades gracefully. A missing HA feature (no Energy setup, no `person` entities, no custom component) hides the Alice feature, it never breaks the app.

## 2. What HA Container gives us, and what it does not

| Available | Not available |
|---|---|
| Full WebSocket and REST API with a long-lived token | Supervisor API, add-ons, ingress, `SUPERVISOR_TOKEN` |
| Registries: entity, device, area, floor, label, config entries | One-click install of anything. Everything is configured by mounting files |
| Recorder statistics, history, logbook, Energy preferences | HA OS host controls (reboot host, disk, network) |
| Automation traces, `search/related`, blueprints | |
| Assist (`conversation/process`), `person`, `zone`, `calendar`, `weather`, `todo` | |
| `custom_components/` loaded from the mounted `/config` | HACS is not preinstalled (we ship the component ourselves) |
| Webhooks, `fire_event`, `notify` services | |
| `backup` integration (local agent) | Supervisor-style full backups |

Consequence: any HA-side piece Alice needs (section 8) is a **custom integration copied into `/config/custom_components/alice`**, installed by `alice.sh`, not an add-on.

## 3. Feature set today (before)

Verified from routes in `apps/server/src`, pages in `apps/web/src/routes`, and `docs/ACCEPTANCE.md`.

### 3.1 Identity, access, operations (not HA related, unchanged)
- Passkey sign-in, first-run setup code, recovery codes, re-authentication for sensitive actions.
- Roles admin / member / guest, per-person device overrides, guests never see energy.
- Privacy-preserving audit, 12-month retention, supervised company support sessions, emergency updater path.
- Encrypted backups with tested restore, signed guided updates with rollback, health page.

### 3.2 Home model
- **Rooms, device names, hidden flags, icons, groups: all stored in Alice's SQLite.** HA areas, floors and labels are not read.
- Physical-device grouping from the device registry, one-time at connect (never refreshed).
- Favorites, per-person ordering, search, rule-based natural language (`lib/intent.ts`: on/off, dim, lock, run scene or routine; never unlock).
- Live updates by long-poll over a local change log.

### 3.3 Controls (9 HA domains understood)
| Domain | What works |
|---|---|
| light | on/off, brightness, colour temperature, hue/saturation |
| switch | on/off |
| fan | on/off, speed % |
| climate | target temperature, HVAC mode (unit hardcoded °C) |
| lock | lock; unlock with fresh re-auth |
| media_player | play, pause, volume, power |
| camera | still image through the proxy |
| sensor, binary_sensor | readings; classless binary sensors and text/timestamp sensors hidden |
| everything else | **hidden** (cover, vacuum, humidifier, valve, water_heater, siren, alarm panel, number, select, button, weather, person, calendar, todo, update, remote, lawn_mower, …) |

### 3.4 Scenes, routines, automations, modes
- Scenes: created from a **snapshot of lights, switches and fans only**; written to `scenes.yaml`.
- Routines: ordered steps written as HA scripts.
- Automations: guided builder, written to `automations.yaml`. Triggers: device state, sensor threshold, time, sun with offset, mode. Conditions: device state, sensor, time window, mode, weekday. Run now, duplicate, enable/disable, preview in plain words.
- Household modes: four fixed (`home`, `away`, `night`, `vacation`) in an `input_select` helper Alice creates. A "everyone left" suggestion is derived from `person.*`.
- **HA-native** automations, scripts and scenes are largely invisible; there is no "why did it not run".

### 3.5 Alerts and insights
- Alerts: device offline, lock left open, hub down, power over limit, insights. Web push, quiet hours, dedupe, rate limit.
- Insights from Alice's **own 15-minute sampler**: left on for long, standby draw, energy up vs last week.
- Power limits that switch a plug off.

### 3.6 Energy, history, media
- Energy page from the sampler (about 35 days kept). Weekly chart only has the days sampled.
- Device history: 24 hours via REST history, state only.
- Camera: still frames only.

### 3.7 Voice
- Admin toggle to expose entities to HA Cloud assistants (`homeassistant/expose_entity`). Nothing else.

### 3.8 HA connection
- One WebSocket, `subscribe_events(state_changed)` + `get_states`, registry read once.
- No heartbeat, unguarded JSON parse, no registry change events.
- Needs an **admin** long-lived token for config writes and `configuration.yaml` includes for scenes, scripts and automations.
- HA's own backups, repairs, pending updates and persistent notifications are not shown anywhere.

## 4. Feature set after (target)

Each row says which phase delivers it (P0 to P9, section 7).

### 4.1 Home model
| Feature | Phase |
|---|---|
| **HA areas and floors become rooms and levels.** Alice stores only colour, icon, order. Renaming or moving a device in HA appears live in Alice | P2 |
| Optional write-back: create, rename, assign areas from Alice's admin screens (HA stays consistent) | P2 |
| **HA labels** usable as groups and as automation targets ("all lights labelled Evening") | P2 |
| Live registry: new integrations, renamed devices, disabled entities, moved areas update without restart | P1 |
| Unit system, timezone, locale, currency from HA `get_config`; °F, mph, 12/24h handled everywhere | P1 |
| Device detail shows manufacturer, model, firmware, integration, connection type, battery, signal, "last seen" from the registry | P2 |
| Floor-aware home screen (levels as tabs or sections) | P2 |

### 4.2 Controls
| Feature | Phase |
|---|---|
| Table-driven adapters per domain, with a **generic fallback** built from `supported_features` and `get_services` schemas, so unknown devices are controllable instead of hidden | P3 |
| **New domains:** cover (open/close/position/tilt), vacuum (start/pause/dock/fan speed/locate), humidifier, valve, water_heater, siren, alarm_control_panel (arm/disarm with PIN and re-auth), number, select, input_*, button, remote, lawn_mower | P3 |
| Climate: fan mode, preset, humidity target, swing, heat/cool range, auxiliary modes | P3 |
| Light: effects, white channels, transition time, per-colour-mode correctness | P3 |
| Media: source select, now playing art and title, seek, mute, shuffle/repeat, browse media, group/join | P3, P9 |
| Weather card and forecast (via `weather.get_forecasts` with a service response) | P3 |
| Calendar and todo cards (read, add, complete) | P3 |
| **Live camera video** (HLS or WebRTC through Alice's proxy) with a still as fallback | P9 |
| Update entities: "firmware available" shown, install requires admin and re-auth | P6 |
| Devices that need a code (locks, alarms) keep the existing re-auth rule | P3 |

### 4.3 Scenes, routines, automations
| Feature | Phase |
|---|---|
| Scenes capture covers, climate, media volume and scripts, not only light/switch/fan (HA `scene.create` snapshots, then persisted) | P5 |
| **Why didn't it run?** Per-automation trace view from `trace/list` and `trace/get`, with failing condition in plain words | P5 |
| **Impact check** before hide, delete, rename: "used by 3 automations and 1 scene" (`search/related`) | P5 |
| HA-native automations, scripts and scenes listed (read-only badge) and runnable; Alice-owned ones stay editable | P5 |
| Automation preflight with HA's own validation (`validate_config`, `check_config`) before reload; removes the `ha_not_loading` guess | P5 |
| **More triggers:** someone arrives/leaves home or a zone, calendar event, weather condition, state of any entity, numeric threshold on any sensor, device-class triggers (door opens, motion, smoke, leak, low battery), time pattern, webhook, HA event | P5 |
| **More conditions:** nobody/anybody home, specific person, zone, weather, calendar busy, sun position | P5 |
| **More steps:** notify (via Alice), delay, wait for a state, if/then, repeat until, set mode, set any supported control, run script | P5 |
| Blueprints: import an HA blueprint and fill it in with the guided form | P5 (stretch) |
| Modes remain four fixed values in the UI but are backed by a proper `select` from the custom component | P8 |

### 4.4 Alerts and awareness
| Feature | Phase |
|---|---|
| New alert kinds: **smoke, CO, water leak, gas, tamper, door/window open too long, low battery, device unavailable (per class), alarm triggered** from device classes | P6 |
| HA **persistent notifications** and **repairs** shown in Alice and optionally pushed | P6 |
| HA **pending updates** (core and integrations) shown to admins | P6 |
| HA's own **backup** status on the health page and "back up HA now" (`backup/info`, `backup/generate`) | P6 |
| HA **system health**, recorder database size, integration setup errors on the health page | P6 |
| HA events can raise Alice alerts through `alice.notify` | P8 |
| Critical alerts bypass quiet hours when the person opted in | P6 |

### 4.5 Energy and history
| Feature | Phase |
|---|---|
| Alice reads HA's **Energy dashboard configuration** (grid, solar, battery, per-device, gas, water) with `energy/get_prefs` | P4 |
| Daily, weekly, monthly, yearly consumption from **recorder statistics** instead of Alice's own sampler (history from day one, not from install) | P4 |
| Solar production, self-consumption, grid import/export, cost with tariff entities | P4 |
| Per-device ranking uses HA statistics; sampler remains the fallback when statistics are absent | P4 |
| Device history: attribute-aware charts (temperature, brightness, position) from `history/stream` and long-term statistics, up to months | P4 |
| Activity feed merges **logbook** entries (who or what changed it: automation, voice, app, physical) with Alice's own events, without adding per-person attribution | P4 |
| Insights use statistics baselines instead of a 35-day window | P4 |

### 4.6 Voice and language
| Feature | Phase |
|---|---|
| Search bar sends unmatched text to **HA Assist** (`conversation/process`), with Alice's own rules first and the "never unlock" guard kept | P7 |
| Exposed-entity management mirrors HA's Assist exposure per entity and per assistant (not only the Cloud toggle) | P7 |
| Optional browser speech-to-text feeding the same path | P7 (stretch) |

### 4.7 Security and connection
| Feature | Phase |
|---|---|
| Heartbeat (`ping`/`pong`), guarded parsing, coalesced messages, `subscribe_entities` for large homes | P1 |
| **Non-admin HA token** when the custom component is installed: config writes go through scoped `alice/*` WebSocket commands that only touch Alice-owned objects (`alice_` prefix) | P8 |
| Custom component exposes: household mode `select`, a `binary_sensor` for "Alice online", `alice.notify` service, an `alice_event` for HA automations | P8 |
| `alice.sh` installs and upgrades the component into the mounted HA config directory | P8 |

## 5. Before and after at a glance

| Capability | Before | After |
|---|---|---|
| Rooms | Alice-only | HA areas and floors, Alice overlay |
| Domains | 9 | 25+, plus generic fallback |
| Units | °C hardcoded | HA's unit system |
| Structure freshness | read once | live registry events |
| Energy history | from install, 35 days, 15-minute samples | from HA statistics, years |
| Automations | own model, own YAML, no diagnosis | richer model, traces, impact checks, HA-native visible |
| Triggers | 5 | about 14 |
| Alerts | 5 kinds | 14+ kinds incl. safety and battery |
| HA health | connected or not | repairs, updates, backups, system health |
| Voice | cloud exposure toggle | Assist text commands, per-entity exposure |
| Camera | stills | stills and live |
| Token | admin | non-admin with component, admin without |
| Backups | Alice only | Alice plus HA's status and trigger |

## 6. Architecture

```
          ┌──────────────────────────── apps/server ────────────────────────────┐
HA  ◄──►  │ HaTransport  ──►  HaModel  ──►  Adapters  ──►  Services (existing) │ ──► web
(WS+REST) │ ping, auth,       entities,     per domain,      devices, scenes,  │
          │ reconnect,        devices,      generic          automations,      │
          │ typed commands    areas, floors fallback         energy, alerts    │
          │                   labels, config                                    │
          │                   services                                          │
          └─────────────────────────────────────────────────────────────────────┘
HA custom_components/alice  ◄──►  scoped WS commands, select, notify, events   (P8)
```

- **`HaTransport`** (refactor of `ha.ts`): connection state, heartbeat, typed `send<T>()`, event subscriptions, REST helpers. No domain knowledge.
- **`HaModel`** (new): in-memory caches built from `get_states`/`subscribe_entities`, the four registries, `get_config`, `get_services`. Emits typed change events (`entity`, `registry`, `config`, `conn`). `HaApi` stays as the narrow interface the rest of the server and the fakes implement; `HaModel` is what `HaApi.entities/parents/secondary` read from.
- **Adapters** (replace the `switch` in `capabilities.ts`): `{ domain, describe(entity, ctx) → Descriptor, toServiceCall(descriptor, command) → ServiceCall }` registered in a table. A generic adapter handles unknown domains from `supported_features` and the service schema. `ACTIONS` becomes data, still validated server-side.
- **Overlay tables** (SQLite): `rooms` gains `ha_area_id`, `device_meta` keeps colour/icon/name overrides only where they differ from HA.
- **Services** stay where they are and call the model instead of reading `ha.entities` directly.

## 7. Phases

Order is by dependency. Sizes: S ≈ 2–3 days, M ≈ 1–1.5 weeks, L ≈ 2–3 weeks, for one engineer including tests and docs.

### P0. Test harness first (S)
- Extend `apps/mock-ha` to answer: `get_config`, `get_services`, the four registries with area/floor/label, registry update events, `ping`, `recorder/statistics_during_period`, `logbook/get_events`, `trace/*`, `search/related`, `energy/get_prefs`, `conversation/process`, `repairs/list_issues`, `persistent_notification/get`.
- Extend `apps/simulator/ha` fixtures (areas, floors, labels, covers, vacuum, alarm panel, weather, calendar, person, zone).
- A `deploy/test-ha/` compose that starts a real HA Container with the demo integration plus the fixture package, used by `real-ha.test.ts` and CI.
- **Done when:** the new mock passes a contract test that is also run against the real container, so fake and real cannot drift.

### P1. Transport and model (M)
- Split `ha.ts` into `HaTransport` and `HaModel`.
- Heartbeat every 30 s, close and reconnect after a missed pong. Guard `JSON.parse`. Use `supported_features: [coalesce_messages]`.
- Switch to `subscribe_entities` with diff application; keep a fallback to `state_changed` for older HA.
- Subscribe to `entity_registry_updated`, `device_registry_updated`, `area_registry_updated`, `floor_registry_updated`, `label_registry_updated`, `core_config_updated`. Debounce and rebuild only what changed.
- Load `get_config` (units, timezone, location, version) and `get_services`. Expose `ha.config` read-only (rename the current write helper to `ha.writeConfig`).
- Replace hardcoded `°C` and `Intl` assumptions with the HA unit system; add °F/°C conversion for display only.
- Version gate: record HA version, show a warning on the health page below the supported minimum.
- **Tests:** reconnect, half-open socket, registry rename arrives live, large-home load (2,000 entities) with memory and CPU measured.

### P2. Areas, floors, labels, device details (M)
- On first run after upgrade, **import** HA areas into `rooms` (match by name where a room already exists, otherwise create), and map existing `room_id` assignments onto them. A one-time admin screen shows what will change and applies it on confirmation. Never delete a room automatically.
- Entities inherit area from their own `area_id`, else their device's. Alice's per-device room override still wins.
- `rooms` gets `ha_area_id`; colour, icon, order stay Alice-only. Floors add a `level` grouping.
- Admin write-back (behind a setting, default on): create, rename and delete areas and assign devices through `config/area_registry/*` and `config/device_registry/update`. If HA rejects it, nothing local changes.
- Labels become selectable groups and targets.
- Device detail drawer: manufacturer, model, firmware (`sw_version`), integration, battery level, last seen, "reconnect hint" text.
- **Tests:** import is idempotent; rename in HA propagates; write-back failure leaves both sides unchanged.

### P3. Device breadth (L)
- Convert `describe`/`toServiceCall` to the adapter table (section 6). Keep `Control`/`Action` unions but add controls: `position`, `tilt`, `preset`, `mode`, `source`, `humidity`, `number`, `option`, `button`, `arm`.
- Domains: cover, vacuum, humidifier, valve, water_heater, siren, alarm_control_panel, number, select, input_boolean/number/select/button, button, remote, lawn_mower, weather (read), calendar (read, create event), todo (read, add, complete), person/zone (read), update (read).
- Generic fallback: read `supported_features`, `get_services` fields and selectors; offer only controls for fields it can render (boolean, number range, select). Mark as "basic control" in the UI.
- Safety classes: unlock, disarm, garage/gate cover open, valve open, water heater above a limit require fresh re-auth. This is a single table, not scattered `if`s.
- UI: new tiles and detail sheets in `DeviceCard.svelte`, icon mapping in `icons.ts`.
- Weather and calendar use service responses (`return_response`), added to `HaTransport.callService`.
- **Tests:** one test per adapter in `devices.test.ts` using fixtures; sweep test still fails on any unguarded new route; real-HA test for each domain that the demo integration provides.

### P4. Energy, history, logbook (L)
- `EnergyService`: read `energy/get_prefs`; resolve source entities to `statistic_id`s; query `recorder/statistics_during_period` (hour/day/month) and `recorder/get_statistics_metadata`.
- Energy page: consumption, solar, grid import/export, battery, gas, water, cost; keep "using power now" from live state.
- Sampler remains and is used only for entities with no statistics. A `source` field tells the UI which is shown.
- Device history: `history/stream` for short ranges (attributes included), statistics for ranges over 10 days.
- Activity: `logbook/get_events` for the visible entities, rendered in plain language with an origin label (automation, script, physical, app, voice). The existing privacy rule stays: no actor names in household-visible data.
- Insights: baselines from statistics (e.g. this week vs the median of the last 8), configurable sensitivity.
- Guests still never see energy; test remains.
- **Tests:** statistics gap handling, unit conversion (Wh/kWh/MWh), HA with no Energy configured (page shows setup guidance rather than empty charts).

### P5. Automation intelligence (L)
- Trace: `trace/list` and `trace/get` per automation and script, mapped to a plain-language timeline ("Ran at 07:00, skipped: nobody was home"). Surface a "Why didn't it run?" action on every automation.
- `search/related` on any device or room before hide, rename, delete, and in the device drawer ("Used by").
- Validate before reload with `validate_config` and `/api/config/core/check_config`; reload only on success; on failure return the HA message translated to plain language.
- Read HA-native automations, scripts and scenes (`config/automation/config`, state attributes) and show them under a "From Home Assistant" heading: run, enable/disable, view; edit only Alice-owned (`alice_` id prefix).
- Extend builder model and `lib/automations.ts`: new trigger, condition and step types listed in 4.3, compiled to HA YAML, each with a plain-words renderer and a preview, as today.
- Scenes: capture via `scene.create` with `snapshot_entities`, then persist the resulting config; supports covers, climate, media volume.
- Blueprint import (stretch): list `blueprint/list`, render the input form from the blueprint's `input` schema.
- **Tests:** every new shape accepted by the real container and one of each actually fires (follow the existing H3 pattern).

### P6. HA health and safety alerts (M)
- Subscribe to `persistent_notification` and poll `repairs/list_issues` (and the repairs event). Admins see them; optional push.
- Pending updates from `update.*` entities; install button for admins (re-auth).
- HA backups: `backup/info` and `backup/agents/info` on the health page; "Back up HA now" calls `backup/generate`. Closes caveat H2.
- System health (`system_health/info`) and config entries in error state (`config/config_entries/entry`) summarised for admins.
- New alert kinds driven by device class: smoke, co, gas, moisture (leak), tamper, safety, battery low (`battery_level` attribute or `battery` class), door/window open too long, alarm triggered, vibration.
- Alert severity: critical alerts may bypass quiet hours only when the person opts in (new preference). Default off.
- **Tests:** dedupe across restarts, rate limits, quiet-hour bypass only when opted in, guests receive only alerts for devices they can see.

### P7. Assist and voice (M)
- `POST /api/assist` → `conversation/process` with the current language. Alice's own rules in `intent.ts` run first (they are safer and instant). Anything unmatched goes to Assist.
- Response filtering: only the speech text and a success flag are returned. Any action that would unlock or disarm is refused at the Alice layer and the person is told to use the device card.
- Assist exposure: list and toggle per entity via `homeassistant/expose_entity`/`homeassistant/expose_new_entities`, for `conversation` as well as cloud assistants.
- Stretch: browser `SpeechRecognition` feeding the same endpoint.
- **Tests:** unlock phrases refused; no HA response text is trusted as HTML.

### P8. The `alice` custom integration (L)
Delivered as `deploy/ha/custom_components/alice/` and copied into the mounted HA config volume by `alice.sh ha-component install|upgrade` (the box already controls that mount, since HA Container needs `/config` anyway).

- Config flow with a single "link this Alice" step; no cloud.
- Entities: `select.alice_household_mode` (replaces the `input_select` helper; migration keeps the current state), `binary_sensor.alice_online`, one `binary_sensor` per open Alice alert category (so HA automations can react).
- Services: `alice.notify(message, title?, people?, severity?)` so any HA automation can push through Alice; `alice.set_mode`.
- Events: `alice_event` for modes, arrivals, alert raised.
- Scoped WebSocket commands, all restricted to objects whose id starts with `alice_`: `alice/scene_write`, `alice/script_write`, `alice/automation_write`, `alice/delete`. With them Alice can run on a **non-admin HA user token**, shrinking the blast radius of a leaked token. Without the component Alice keeps working with an admin token exactly as today.
- Version handshake: Alice refuses to use commands from a component with an incompatible protocol version and says so on the health page.
- **Tests:** component unit tests with `pytest-homeassistant-custom-component`; a real-container test that a non-admin token cannot read other users or create non-`alice_` objects.

### P9. Live media (M, stretch)
- Camera: `camera/stream` for HLS and `camera/webrtc/offer` for WebRTC, proxied through Alice with the same auth as snapshots; audio and PTZ out of scope.
- Media browse (`media_player/browse_media`) with a simple picker; group and join for speakers.
- Bandwidth guard: one stream per camera per household, idle timeout, guests only if granted.
- **Tests:** stream URL never leaks the HA token; proxy rejects other hosts.

## 8. Cross-cutting work

- **Docs:** update `INSTALL.md` (component install, optional non-admin token), `SECURITY.md` (new calls, token scope), `THREAT-MODEL.md` (component, stream proxy, Assist), `OFFLINE.md` (what happens when HA features are missing), `CAVEATS.md` (close H2, add new rows), `ACCEPTANCE.md`.
- **Migration:** every phase ships additive migrations (`0012_*.sql` onward). No destructive change to `rooms` or `device_meta`; area import is reversible by a "detach from HA" action.
- **Feature detection:** `GET /api/bootstrap` gains a `haFeatures` object (`areas`, `energy`, `assist`, `component`, `statistics`, `traces`). The web app hides features that are not present.
- **Performance budget:** idle memory under 150 MB with 2,000 entities; initial model load under 3 s on a Pi 4 class device; registry events processed in under 50 ms each. Measure in `deploy/` as the existing resource profile does.
- **Compatibility:** declare a minimum HA version (current docs assume 2024.10 for `triggers:` syntax; `subscribe_entities` coalescing and `search/related` need a later floor, to be pinned in P0 by running the contract tests against the real container).

## 9. Risks

| Risk | Mitigation |
|---|---|
| HA's WebSocket API is semi-internal and changes between releases | Contract tests against a real container in CI, a version gate, and one typed command layer so a change touches one file |
| Importing areas surprises households that already organised rooms in Alice | Preview-and-confirm import, no automatic deletion, "detach from HA" |
| Generic controls misbehave on odd integrations | Only render fields with selectors Alice understands; label as "basic control"; admin can hide |
| More alert kinds cause noise | Per-kind mute (already exists), dedupe, rate limit, off-by-default for the noisy ones |
| Custom component adds a maintenance surface and a second thing to install | Optional; Alice keeps full function without it; version handshake |
| Statistics unavailable or recorder excluded | Sampler fallback and `source` label |
| Assist could be used to bypass lock policy | Rules first, then post-filter and refuse unlock/disarm at the Alice layer |

## 10. Decisions needed from you

1. **Rooms:** HA areas as the source of truth with Alice overlay (recommended), or keep Alice-owned rooms and only suggest from areas?
2. **Write-back:** should Alice be allowed to create and rename HA areas and labels, or stay read-only on structure?
3. **Custom component (P8):** acceptable to ask users to mount and install it, in return for a non-admin token? Or admin token only?
4. **Scope of P3:** include alarm panels, valves and water heaters (safety critical, need re-auth rules), or defer them?
5. **Camera video (P9):** in scope for this effort?
6. **Minimum HA version** to support.

## 11. Suggested delivery order

P0 → P1 → P2 (first user-visible release: areas, live registry, units) → P3 and P4 in parallel by two people → P5 → P6 → P7 → P8 → P9. A release can ship after each of P2, P4, P5, P6.
