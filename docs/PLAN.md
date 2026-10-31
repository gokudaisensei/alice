# Smart Home Companion — Phase 1/2 Plan (draft for approval)

## 1. Findings
- Repo is empty (no code, no git, no deploy config). Nothing to reuse.
- Dev host: x86_64, Docker 29, Node (mise), Go, Python3. Target is Raspberry Pi 5 (arm64, 4 GB) → multi-arch images required.
- No Home Assistant instance available here → dev uses a Dockerised HA (or a mock HA server for tests).

## 2. Proposed stack (needs your confirmation)
| Concern | Choice | Why |
|---|---|---|
| Backend | Bun + Elysia + TypeScript | Chosen by you; native WebSocket client for HA, low overhead, arm64 builds available |
| DB | SQLite (WAL) via built-in `bun:sqlite` + versioned SQL migrations | No extra container or driver; fits Pi; consistent backup (`VACUUM INTO`) |
| Frontend | SvelteKit (static adapter, SPA/PWA) + TypeScript, **Tailwind CSS v4 + shadcn-svelte (Bits UI primitives)**, lucide icons | Mature accessible components copied into the repo (we own the code, no runtime UI dependency); theming via shadcn CSS variables gives light/dark. No hand-written component CSS; custom device controls (light dimmer, thermostat dial) are composed from Bits UI primitives + Tailwind. Static build served by the app, no extra container |
| Passkeys | @simplewebauthn/server | Mature WebAuthn implementation |
| Sessions | Opaque server-side session IDs, HttpOnly/Secure/SameSite=Lax cookie, CSRF token | Revocable, no JWT pitfalls |
| Push | Web Push (VAPID) | Only outbound exception besides update checks |
| Proxy | Caddy (TLS, one upstream: app) | Simple HTTPS, single route |
| Containers | `app`, `caddy` (HA is separate, existing) | Minimal |

## 3. Components and trust boundaries
```
Internet -> Caddy (443) -> app:3000 -> [private docker net] -> Home Assistant (WS+REST)
                                  \-> SQLite volume
```
- HA is never published by this stack; app is the only container with a route to HA (dedicated internal network, no host port mapping for HA from this compose file).
- HA long-lived token stored encrypted at rest (key from Docker secret / env file outside repo); never sent to client or logged (log redaction).
- App egress restricted via an egress-proxy/firewall allowlist: push services, update registry, backup destination only. Documented + tested with nftables/Docker network rules.
- HA token limitation: HA long-lived tokens carry the creating user's full rights. Mitigation: dedicated non-admin HA user for the app; documented as a limitation.

## 4. Key design decisions
1. **Authorization**: central policy module (role defaults + per-user feature/device overrides) invoked in every route; deny by default; tests per route.
2. **HA integration**: single persistent WebSocket; state cached in memory (entity id → state, `last_updated`, stale flag); commands are never queued; result reflects HA's service-call response + subsequent state confirmation; group ops return per-device outcomes.
3. **Automations**: app builder model → HA automation config via HA's config API; HA remains the executor; summary generated from saved HA config; unsupported constructs rejected with explanation.
4. **Household modes**: `input_select` helper in HA (Home/Away/Night/Vacation), so HA automations can use it as a condition. App only suggests; never auto-acts.
5. **Audit privacy**: two tables — `activity_events` (household-visible, no actor) and `security_audit` (actor-attributed, readable only by super-admin scope). Household Admin API reads only the former; exports/search never join actor data.
6. **Super-admin**: separate identity store and login path; capability scopes (deploy, diagnostics, read-config, read-telemetry, manage-users, control-devices, edit-automations, backups) — support grants are household-issued, time-boxed, scoped, visibly active, auto-expiring. Emergency deploy path = signed image + audit entry, no data scope.
7. **Backups**: SQLite online backup → encrypted archive → local + off-device (S3-compatible / SFTP); HA backup via HA backup API; "verified" status only after a restore test into a scratch DB.
8. **Retention**: audit 12 mo, notifications 90 d, insight aggregates rolled up; log rotation.
9. **Insights**: deterministic SQL/statistics on HA history sampled at low frequency; no data → no insight.

## 5. Milestones (each deployable and tested)
- M0 Scaffold: monorepo, Docker compose (app+caddy), CI, mock HA, migrations.
- M1 Foundation: users/households, passkeys, sessions, rate limits, authz policy, audit tables, HA connection + health.
- M2 Core UX: shell, home overview, rooms, capability-aware device controls, groups, favorites/preferences, search, dark mode.
- M3 Scenes, routines, household modes.
- M4 Automation builder (templates, guided steps, sentence summary, CRUD, duplicate).
- M5 Notifications (in-app + web push), quiet hours, dedup/rate limits, insights, energy.
- M6 Admin: users/permissions, support-session workflow, health page, backups + restore, guided updates, emergency path.
- M7 Hardening: authz/boundary tests, offline/restart scenarios, arm64 resource profiling, docs (threat model, offline matrix, recovery runbooks).

## 5b. Decisions on previously open questions
**D1 Voice (HA Cloud, chosen for least friction).** Voice uses Home Assistant Cloud (Nabu Casa) for Alexa and Google Assistant. It needs no company-registered skill/action and no certification, and it works over an outbound tunnel from Home Assistant, so no inbound public route to HA and no `/voice` endpoint on the app. The app does not talk to Amazon/Google.
- The app manages a per-item "voice-enabled" flag (default none) and applies it to HA's voice exposure list through HA's exposure API; only devices, scenes and routines (HA scripts/scenes) so flagged are exposed. Never bulk-expose.
- Company responsibility: one HA Cloud subscription and linking per household (setup stays out of household-admin UI).
- Dependencies: Nabu Casa cloud, Amazon/Google clouds, home internet. Voice stops during an outage; local control and local automations are unaffected.
- Limitation: voice commands run inside Home Assistant, so they bypass the app's per-user permissions and per-user audit. Voice is household-level access only; the UI states this, and only low-risk items should be flagged. Locks and other security devices are not offered for voice in v1.
- Limitation: the HA exposure API is an HA-internal WebSocket API and may change between HA versions; the exposure sync is covered by an integration test pinned to the supported HA version.
- Alternative kept for later: a company-owned skill/action calling a narrow app endpoint (gives per-user authz and audit, needs certification).

**D2 Super-admin identity.** Stored on the device in a separate `operators` table (not the household `users` table), passkey-only (hardware security key required by policy), unreachable by household Admin APIs, reachable only on a separate `/ops` route/hostname with its own rate limits. Capability scopes are distinct (see spec 17.3); data-access scopes exist only inside a household-granted, time-boxed support session. No company-hosted control plane in v1. Emergency deploy: a host-level updater (systemd timer, not an app container, no DB/HA access) pulls a release signed with a company key; the verification public key is pinned on the device. It applies without household approval, writes an audit entry, and notifies admins of expected downtime. Limitation: a lost operator key needs on-site/physical recovery.

**D3 Backups (offline-first).** v1 destinations: (a) USB/attached disk, (b) LAN NAS via SFTP/SMB, (c) manual download of an encrypted archive. Archives are encrypted with `age` (recipient key held off-device). No cloud/S3 in v1. A same-house NAS does not protect against fire or theft; the UI states this and recommends periodically carrying a copy off-site. "Verified" status requires a scratch restore test.

## 6. Remaining assumptions
1. Single household per deployment (multi-household isolation designed in via `household_id` on every row, but not exposed).
3. Passkey recovery: Admin-issued one-time enrolment link (time-limited), never password fallback.
6. Push on iOS requires installed PWA — documented limitation.
