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
| M1/M7 | Git repository | ✅ initialised; work is committed (not pushed anywhere) |
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
| M5 | Unread count polls every 30 s and on focus. Device state, mode and shared data now update live through the long-poll (see Live sync) | ➖ |
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
| M7 | Resource profile | 🟡 measured on x86 in the real container (512 MB / 1 CPU limit): ~40 MB idle, 90 MB peak, 8.7k requests/s with 25 clients and 5 live streams (measured on the old stream design, before long-polling), 0 errors. **Not measured on a Pi**; CPU figures won't transfer, memory should |

## Interface redesign
| Area | Caveat | Status |
|---|---|---|
| Phone | Press-and-hold-then-slide to dim a light is built with pointer events and checked only for logic and layout in a desktop browser; **not tried on a real touch screen** (iOS Safari and Android Chrome scroll and gesture handling differ) | ⛔ |
| Phone | Bottom drawers swipe to close but have a single height (no half/full detents) | ➖ |
| Search | "Turn off the kitchen lights" is understood by fixed rules (`lib/intent.ts`, unit tested): on/off, dim to N%, lock, run a scene or routine. It never unlocks, and says nothing rather than guess between near matches. Verified once against the real hub | ✅ |
| Personal | The "often used" row counts this person's own taps (3 or more); time-of-day suggestions match scene and routine *names* (night, morning, evening). Both only suggest | ✅ |
| History | The device drawer's 24-hour strip comes from HA's history API. Verified against the real hub; the time before HA's first record is left blank | ✅ |
| Touch | Everything touch-related (icon-to-switch, press-hold-slide dimming, swipe rows, hold-to-reorder favorites, swipe between rooms, hold a status chip for bulk actions, haptics) is **checked in a desktop browser with pointer events only**, not on a real phone | ⛔ |
| Haptics | Android uses the vibration API. iPhone Safari has no such API, so a tick is produced by toggling a hidden switch control (works on recent iOS). Unverified on a device; there is a Settings switch to turn it off | ⛔ |
| Push buttons | The "Lock" button on an open-door notification works where the browser supports notification actions (Android Chrome and desktop); iPhone Safari does not show action buttons, so the tap opens the app instead. The button's request path is tested; the phone side is not | 🟡 |
| App shortcuts | Long-press-the-icon shortcuts (`?do=lock-all` and friends) come from the web app manifest: Android Chrome supports them, iPhone does not. Icons are generated PNGs | 🟡 |
| Scene progress | Quick-action pills show a spinner, then a tick. They cannot say "5 of 6 done", because the hub only reports that a scene was sent or a routine started | ➖ |
| Admin | Device "hide from everyone" is no longer in the interface (the server still supports it); the room screen has rename and remove | ⛔ |
| Layout | Checked on a 375 px phone (light and dark) and a 1280 px desktop for Home, Routines, Activity, You and the automation builder; not every page in every combination | 🟡 |

## Live sync, access and theme (latest round)
| Area | Caveat | Status |
|---|---|---|
| Live sync | Cloudflare quick tunnels (trycloudflare) deliver SSE headers but no body, so the app uses a long-poll (`GET /api/sync?rev=N`, held up to 25 s) instead. Verified through the tunnel at about 1 s. The old `/api/stream` endpoint is kept but the client no longer uses it | ✅ API level, ⛔ not tried on two real phones |
| Live sync | Admin pages that fetch their own data (people, access, system) don't update live; they refresh when you open them | ➖ |
| Live sync | The change log is in memory (last 1000 changes). After a restart or a long offline gap, clients do a full reload | ➖ |
| Live sync | At most 6 concurrent sync requests per person (more get 429) | ➖ |
| Guests | Guests never see energy meters (even if granted), the Energy and Insights pages and cards, or insight notifications; `/api/energy` returns 403 for them. Covered by `guest-energy.test.ts` | ✅ tested, ⛔ not viewed in a real guest session (seeded guest Nani can't sign in) |
| Access page | Per-person page with category tabs, bulk switches and role-aware content (guest: rooms, devices, scenes, routines, abilities; member adds automations). Automations are read-only: a person sees one only if they can use every device and scene it touches | ✅ API tested, ⛔ not viewed in a browser |
| Theme | Cobalt and amber palette, light and dark. Contrast checked by calculation (text 17:1, controls and "on" tiles 6 to 13:1); not checked with a colour-blindness simulator or on real screens | 🟡 |
| Theme | Home-screen icon on a phone updates only after reinstalling the PWA or clearing its cache | ➖ |
| Desktop | Consistent left alignment, auto-fill tile grid, capped camera pictures, home side column from 1280 px, hover lift on tiles. Checked at 1024, 1440 and 1920 px (light) for Home, Rooms, Devices, Routines, Activity, People, You, System, Rooms & devices and the automation editor | ✅ |
| Desktop | Dark theme on desktop, Settings, the access page and the scene/routine editors not checked; Routines, People and Activity are narrow lists with empty space at wide widths | 🟡 |
| Energy page | Rebuilt for phones: the whole-home meters on top with a 24-hour range marker, one weekly chart with a meter picker (labelled bars, average line, best day), a ranked "Using power now" list (top 6, expandable), other readings folded away. Seeded page went from 3417 px to 1364 px tall. Viewed at phone and desktop width; the weekly chart only has the days the sampler has recorded; "whole-home" meters are picked by name (whole, house, grid, solar, total) | 🟡 not tried on a real phone |
| Insights page | Grouped ("Always on", "Higher than usual", other) with one tappable line each; details and actions open on tap, one at a time. The five seeded insights now fit on one phone screen (was 1208 px of scrolling). Home's "Worth a look" cards are unchanged | 🟡 viewed at phone width only |
| Alerts page | Unread by default (All when nothing is unread), grouped by day, one line each; tapping opens the row and marks it read (it stays put until you leave), "Automate this" inside. Notification settings is an icon. Viewed at phone width only | 🟡 |
| Power alert | Limits in watts are set by hand per power meter (device sheet: "Alert me above"; admins and members; saved in `power_limits`, audited). No limit means no alert. A reading above the limit for 5 minutes sends one "power" notification (not repeated for 6 hours, mutable, never sent to guests). A short burst is ignored; changing or removing a limit restarts the clock. Tested with fakes (`power.test.ts`) and end to end on the seeded home | 🟡 |
| Power alert | The "Switch off" button on the notification finds the plug's own switch by name ("Kettle Power" to "Kettle" or "Kettle Plug"); with no clear match there is no button. The button's request path is written but not exercised on a phone, and the 5-minute wait is one setting for everyone, not per plug. After a restart the clock starts again | ⛔ |
| Test data | The tunnel instance and HA container are seeded with a simulated home (89 devices, 9 rooms); seeded members Maya, Dev and Nani have no passkeys | ➖ |

## Speed
| Area | Caveat | Status |
|---|---|---|
| Server | App files are held in memory with Brotli and gzip copies; hashed files are cached for a year and the page revalidates by ETag (`static.ts`, tested). The main script went from 59 KB to 15 KB over the wire | ✅ |
| Start-up | `GET /api/bootstrap` returns the first screen in one request instead of 8 (tested for permissions) | ✅ |
| Start-up | The last screen is kept in this device's browser storage and painted at once (about 80 ms against about 365 ms from the network on localhost), then refreshed. Cleared on sign-out; ignored if it belongs to another person | ✅ measured on desktop localhost only; ⛔ not measured on a phone or over the tunnel |
| Start-up | A service worker keeps the app's own files so it opens without waiting; `/api/` is never stored. Registers and serves from cache over the https tunnel (the embedded browser refuses it on plain http localhost) | ✅ over the tunnel; ⛔ not on a real phone |
| Start-up | The page asks for `/api/bootstrap` itself before the scripts arrive, and the whole app is one script and one stylesheet (`bundleStrategy: 'single'`, 197 KB compressed) instead of 54 files. Through the quick tunnel from a cold start, live data went from about 1270 ms to about 880 ms; with the service worker, saved data paints at about 135 ms and live data at about 380 ms | ✅ desktop browser at phone width |
| Tunnel | A quick tunnel adds roughly 130 to 250 ms to every request (local is about 1 ms) and about 370 ms to fetch the page cold. That is the Cloudflare route, not the app; a LAN address or a named tunnel near you will be faster | ➖ |
| Start-up | A bug found while measuring: refreshing the sign-in object restarted loading in a loop (hundreds of requests). Fixed and confirmed at one request each | ✅ |
| Fonts | The 132 KB headline font is unchanged (subsetting its axes risked changing the look) | ⛔ |
| Taps | Device switches already show the result at once and undo on failure; scenes, routines and group buttons still wait for the hub | 🟡 |

## Home simulator (`apps/simulator`)
| Area | Caveat | Status |
|---|---|---|
| Simulator | Replaces the old drifting-sensor script. Plays four residents (weekday and weekend routines, a different offset each day), weather and sun, room-by-room heat, CO2 and damp, per-appliance power profiles, honest energy counters and random faults, against the real Home Assistant. 3D house at http://localhost:3100 with a time dial (real time to 1200x), pause, clickable lights, plugs, fans and locks, and buttons to cause a fault | ✅ 6 model tests (a full weekday, heating, open window, energy only rising); run live against HA and viewed |
| Simulator | 3D shows brightness, fan speed, thermostat, vents, covers, garage door, pergola, TV, clouds, power tags and posed people (sit, lie, walk). Undoing a fault from the app ends it and reverses the animation (tested). Click a fan to cycle its speed; shift-click a light to cycle its brightness | ✅ 8 model tests; viewed on desktop |
| Simulator | Doors: three door leaves that swing (contact sensor or someone walking through), bolts that slide with lock and unlock, checked numerically for all three locks. Unlocking alone does not swing a door open (a real lock doesn't). The embedded browser pane pauses animation frames while hidden, so the page now also steps its animation on a timer | ✅ |
| Simulator | Heating and cooling follow `climate.ecobee`; its own reported room temperature stays HA's demo value, so the thermostat tile in the app and the simulated rooms can disagree | 🟡 |
| Simulator | "Device offline" is not simulated (template entities have no availability switch); rain, seasons and a second floor are not either | ➖ |
| Simulator | At fast clocks Home Assistant's history is stamped with real time, so charts compress; keep fast runs short | ➖ |
| Simulator | The residents' light and plug actions go through normal Home Assistant calls, so your app shows them as they happen; a person using the app is not overridden (the residents only act on arrivals, departures and schedules) | ✅ |
| Simulator | Reachable from outside only with an access key (`SIM_KEY`, cookie after the first visit, same-origin check on actions). Opened through its own quick tunnel and loaded in the embedded browser; the 3D scene on a real phone is untried | 🟡 |

## Phone gestures and comfort
| Area | Caveat | Status |
|---|---|---|
| Tiles | Press and hold lifts a tile. Slide sideways to set brightness, fan speed, thermostat target or volume (a tick at each notch); let go without sliding for a menu (select several, favorite, details and history, automate, rename, move to a room). Double tap goes to the level you last chose. Arithmetic is tested (`scrub.test.ts`) | ✅ tried on a Motorola Edge 50 Pro (Chrome, Android 16): hold, slide, menu, select several, double tap |
| Unlocking | Unlocking a door needs a hold that fills (about 0.7 s); locking is a plain tap. Keyboard and screen readers confirm directly | ✅ tried on the same phone; a quick tap only explains, a full hold unlocks (it asked for no passkey because the sign-in was recent) |
| Undo | Switching, dimming, fan and temperature changes can be undone: shake the phone (Settings, Comfort) or press Undo in the toast shown after bulk actions. Locking is never undone into unlocking. The mapping is tested (`undo.test.ts`) | 🟡 the Undo button and the undo logic are tried on the phone (this found and fixed a bug where Undo did nothing); the physical shake itself is not |
| Screen | Pull down to refresh, swipe in from the left edge to go back (installed app only; browsers already do this), hold a room's name to switch the whole room off, hold-to-confirm for risky actions, a "Ready for bed?" / morning card, a warning when a heater, oven or garage is on or open | ✅ pull to refresh, room hold and the kettle warning tried on the phone; 🟡 the edge swipe and the night and morning cards are not |
| Offline | Offline phone: banner, tiles read "Paused", controls refuse with a message. Hub unreachable keeps its own banner | 🟡 |
| Comfort | Reduce motion, one-handed search button, larger text and buttons; kept on the phone. A wall panel (`/panel`: clock, big tiles, screen kept awake where supported, dims after 2 minutes) and a shareable status picture (`/glance`) | 🟡 wall-lock needs a browser that supports it |
| Feedback | After a command the icon gives a small spring (success) or wobbles under a soft red wash (failure); the tile itself no longer moves | 🟡 untried on a real phone |
| Transition | Opening a tile's details glides its icon up into the sheet header using the browser's view-transition support; browsers without it, and people who reduce motion, just see the sheet open | ✅ seen in a screen recording from the phone |
| Energy | "Share this week" on the Energy page makes a picture of the weekly chart for the share sheet (or a download). The drawing was checked with sample data; the Android share sheet opened with the picture on the phone | ✅ |
| Not built | Blinds scrubbing (the app has no cover devices yet) | ➖ |
| Already there before this round | Bottom sheets, sideways room swiping, "often used" strip, icon shortcuts (lock all, good night, lights off), "Automate this" on alerts | ✅ |

## Re-running the real-world checks
```
# Real Home Assistant (container already seeded; token in the scratchpad)
HA_REAL_URL=http://127.0.0.1:8123 HA_REAL_TOKEN=… bun test apps/server/src/real-ha.test.ts
# Updater against real containers and a real local registry
deploy/updater/test.sh
```
