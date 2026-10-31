# Caveat tracker

Every limitation raised during the build, with where it stands. **Verified** means shown to work against the real thing (a real Home Assistant 2026.10.4 container with the demo integration, real Docker containers, a real local registry) and not only against fakes. Update this file whenever one changes.

Legend: ✅ verified / fixed · 🟡 partly · ⛔ open · ➖ by design (documented, not a defect)

## Found by testing against real Home Assistant
| # | Finding | Status |
|---|---|---|
| H1 | Scenes, routines and automations were reported "not confirmed" on a stock HA: the config API writes `scenes.yaml` / `scripts.yaml` / `automations.yaml`, but HA only loads them if `configuration.yaml` includes them. **Prerequisite:** `automation: !include automations.yaml`, `script: !include scripts.yaml`, `scene: !include scenes.yaml`. The app's honest "not confirmed, undone" response was correct, but its message doesn't say why. | ✅ prerequisite documented (README, runbook 5); the app now says plainly "saved but isn't loading it" (`ha_not_loading`, undone). Tested against a fake hub that saves without loading; not re-run on a real HA with the includes removed |
| H2 | HA Container *does* have a backup integration (`backup/agents/info` answers). The earlier claim "HA Container has no backup API" was wrong. | ⛔ HA's own backup is still not included in our archive or shown on the health page |
| H3 | Tested by `src/real-ha.test.ts` (skipped unless `HA_REAL_URL`/`HA_REAL_TOKEN` are set): connect and describe real devices; real command + confirmation; unlock with re-auth on a real lock; mode helper creation; scene create/activate; routine as a real script that runs; automation accepted, switched off/on, and **actually fires**; every trigger and condition shape accepted (state/for, numeric, sun with offset, time, mode; state/numeric/time/weekday/mode conditions); voice exposure list; energy meters; camera still. | ✅ 11/11 |

| H4 | A command asking for what was already true (turn on a light that is on) was reported unconfirmed, because Home Assistant emits no state change. Now confirmed when the state already matches; a device that ignores a real change is still unconfirmed (regression test added). | ✅ fixed |

## Milestone caveats
| Area | Caveat | Status |
|---|---|---|
| M1 | Passkeys exercised with a software authenticator only; real browser platform authenticator over real HTTPS not tried | ⛔ |
| M1 | Rate-limit counters and login challenges live in memory and reset on restart | ➖ single instance |
| M1/M7 | No git repository; nothing committed | ⛔ |
| M2 | Capability detection verified on HA's demo devices (lights, fans, climate, locks, media, covers, cameras, energy sensors), not on real vendor hardware | 🟡 |
| M2 | Camera stills through HA's proxy | ✅ (demo camera) |
| M2 | arm64 image | ✅ builds with `buildx --platform linux/arm64` (99 MB) and starts and serves `/healthz` under QEMU emulation (165 MB resident while emulated). 🟡 **Not run on real Raspberry Pi hardware**: speed, thermals, SD/SSD behaviour and real-world memory are unmeasured |
| M2 | Outbound allow-list | ✅ M7: internal-only networks + allow-listing proxy; `deploy/egress/test.sh` and `deploy/test-topology.sh` on real networks and the real FCM endpoint |
| M3 | Needs an HA **administrator** token (HA has no narrower scope for its config API); needs HA 2024.8+ | ➖ documented. Verified on 2026.10.4 ✅ |
| M3 | Scenes, routines, mode helper against real HA | ✅ (see H3) |
| M4 | Automations not executed in the old mock | ✅ now verified firing on real HA |
| M4 | Needs HA 2024.10+ (`triggers:` syntax) | ➖ verified on 2026.10.4 ✅ |
| M4 | Starter ideas stay listed after one is built from them | ⛔ cosmetic |
| M4 | Mobile bottom nav scrolls sideways (7+ items) | ⛔ cosmetic |
| M4 | Routine builder re-checked after the shared-editor refactor | 🟡 type-checked and built; the automation builder uses the same editor and was run in a browser |
| M5 | Web push to a real push service (FCM/Mozilla/Apple) never sent; subscription flow and the sender are tested against a fake | ⛔ |
| M5 | Rule timers and sampler live in memory: a restart restarts the "has it lasted" clock | ➖ |
| M5 | Unread count polls every 30 s and on focus, not live over the stream | ➖ |
| M5 | iOS push needs the app added to the Home Screen | ➖ |
| M6 | Operator sign-in with a hardware key not tried (no key available); logic tested with the fake authenticator | ⛔ |
| M6 | "Hardware key required" is an authenticator-attachment hint; without attestation it can't be proven | ➖ |
| M6 | Voice exposure against real HA | ✅ exposure list round-trip verified; ⛔ HA Cloud itself is not linked in the test container (`logged_in: false`), so Alexa/Google delivery is untested |
| M6 | Backup limits: same-house drive doesn't survive fire/theft; NAS must be mounted on the host; losing the key loses the backups | ➖ |
| M6 | A backup download fetched the file twice | ✅ fixed (a `ready` check does the passkey step; the file is fetched once) |
| M6 | Operator scopes `manage-users`, `control-devices`, `edit-automations`, `deploy` not implemented | ➖ deliberately omitted so far |
| M6 | Audit-log retention job | ✅ M7: daily job; the audit table's trigger refuses early deletion even with a wrong clock (`retention.test.ts`) |
| M6b | Updater and emergency path | see `docs/UPDATES.md`; tested on real containers (`deploy/updater/test.sh`) |
| M6b | Installer and systemd units not run on a real device; the timer and path unit firing under real systemd untested; registry over TLS/auth untested; release-key rotation/revocation not designed | ⛔ |
| M7 | Threat model, offline matrix, recovery runbooks, acceptance matrix | ✅ written (`THREAT-MODEL.md`, `OFFLINE.md`, `RUNBOOKS.md`, `ACCEPTANCE.md`); the runbooks have not been rehearsed by someone other than the author |
| M7 | Every-route authorization/CSRF/garbage-input sweep | ✅ `sweep.test.ts` (fails if any new route is unguarded) |
| M7 | Hub stop/start, wrong key, app restart | ✅ on a real HA (`real-ha.test.ts`, with `HA_REAL_DOCKER`) |
| M7 | Resource profile | 🟡 measured on x86 in the real container (512 MB / 1 CPU limit): ~40 MB idle, 90 MB peak, 8.7k requests/s with 25 clients and 5 live streams, 0 errors. **Not measured on a Pi**; CPU figures won't transfer, memory should |

## Interface redesign
| Area | Caveat | Status |
|---|---|---|
| Phone | Press-and-hold-then-slide to dim a light is built with pointer events and checked only for logic and layout in a desktop browser; **not tried on a real touch screen** (iOS Safari and Android Chrome scroll and gesture handling differ) | ⛔ |
| Phone | Bottom drawers swipe to close but have a single height (no half/full detents) | ➖ |
| Search | "Turn off the kitchen lights" is understood by fixed rules (`lib/intent.ts`, unit tested): on/off, dim to N%, lock, run a scene or routine. It never unlocks, and says nothing rather than guess between near matches. Verified once against the real hub | ✅ |
| Personal | The "often used" row counts this person's own taps (3 or more); time-of-day suggestions match scene and routine *names* (night, morning, evening). Both only suggest | ✅ |
| History | The device drawer's 24-hour strip comes from HA's history API. Verified against the real hub; the time before HA's first record is left blank | ✅ |
| Layout | Checked on a 375 px phone (light and dark) and a 1280 px desktop for Home, Routines, Activity, You and the automation builder; not every page in every combination | 🟡 |

## Re-running the real-world checks
```
# Real Home Assistant (container already seeded; token in the scratchpad)
HA_REAL_URL=http://127.0.0.1:8123 HA_REAL_TOKEN=… bun test apps/server/src/real-ha.test.ts
# Updater against real containers and a real local registry
deploy/updater/test.sh
```
