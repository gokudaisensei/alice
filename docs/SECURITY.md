# Security notes (M1)

## Authentication
- Passkeys only (WebAuthn, discoverable credentials, user verification required). No passwords, no 2FA in v1.
- First admin: one-time **setup code** printed to the app log on first start (valid 1 h, single use). Re-issue on the host: `docker compose exec app bun src/cli.ts setup-code` (only while no users exist).
- Invites: an admin issues a single-use code (24 h) for a *pending* user; the invitee registers a passkey with it.
- Recovery: an admin issues a single-use code (1 h). Completing it **deletes the user's old passkeys and sessions** (lost-device model), so recovery never leaves a weaker path than a passkey. If every admin is locked out, recovery needs host access: `docker compose exec app bun src/cli.ts recovery-code <user-id>` (audited). Operator-assisted recovery arrives with the support workflow (M6).

## Sessions
| Setting | Value |
|---|---|
| Token | 256-bit random, only its SHA-256 is stored; new token on every login (no fixation) |
| Cookie | `__Host-sid`, HttpOnly, Secure, SameSite=Lax, Path=/ |
| Idle timeout | 7 days |
| Absolute lifetime | 30 days |
| Re-auth for sensitive actions | passkey assertion within the last 10 minutes (user/permission management, invites, recovery) |
| Revocation | removing a user, or completing recovery, deletes their sessions immediately |

## Abuse protection
- 30 requests/min per source on `/api/auth/*`; 10 failed logins per source per 15 min lock that source out (also for correct credentials). In-memory, resets on restart.
- Source IP = last `X-Forwarded-For` entry, which only Caddy (the sole route to the app) can set. **Do not publish the app port directly.**
- Login failures return one generic message (no account enumeration).

## CSRF / headers
State-changing `/api/*` requests need `X-Requested-With: alice` and, if present, a matching `Origin`. No CORS is granted. Responses carry CSP, `nosniff`, frame denial and no-referrer.

## Authorization
Every protected route calls `authorize()` server-side (deny by default, household-scoped queries). The web UI hides navigation only as a convenience. Escalation rules: only admins can mint admins or hand out `users.manage`/`admin.access`; nobody can grant a permission they lack; the last active admin cannot be demoted or removed.

## Device access (M2)
- Admins and members can use all household devices; guests start with none and need an explicit per-device grant. Any user's access can be overridden per device (allow/deny). Changing access needs `users.manage` plus a recent re-authentication.
- A device you can't use is indistinguishable from one that doesn't exist (404). Search, rooms, groups, favourites and the live stream all apply the same check, and the stream re-checks the session on every event, so revoked users stop receiving immediately. Room names are only revealed to people who can use something in them (or manage rooms).
- Group commands only touch members the caller may control, never name the others, and report `partial` when some were skipped or failed.
- Unlocking a door needs re-authentication; lock and unlock are audited. Commands are never queued: unreachable hub or offline device = refusal.
- Camera pictures are proxied through the app; the Home Assistant token never reaches the browser.

## Scenes, routines and modes (M3)
- **Home Assistant stays the engine.** Scenes and routines are written into HA through its config API (scenes and scripts) and run by HA. The app stores a routine's steps itself (so it can edit and summarise them) next to the HA script it created. Every write is confirmed by seeing the entity appear in HA; if HA rejects or doesn't confirm, nothing is saved and the person is told.
- **Suggested vs configured.** The four templates (Good Morning, Good Night, Leaving Home, Arriving Home) are suggestions with no HA footprint. Nothing is created, and nothing runs, until someone with `scenes.manage` chooses the steps and saves. Nothing in the server runs a routine except an explicit run request.
- **Routines can only use what their author can use**, step by step. Unlocking is never allowed in a stored routine. Running a routine needs its own access (guests need an explicit grant), so a guest can run a routine without being able to control each device in it. That is the intended model.
- **Honest run result.** HA runs the steps; the app can only say "started", never that every step worked.
- **Modes** are an `input_select` helper in HA (`input_select.alice_household_mode`, created on first connect), so HA automations can use it as a condition. Changing a mode changes only the mode. A presence-based hint ("everyone seems to be away") is a suggestion the person must accept.
- **Known limitation: HA admin token.** Creating scenes, scripts and helpers needs a Home Assistant *administrator* token. HA does not offer a narrower scope for its config API, so the app's token can do more than the app uses. Mitigations: the token never leaves the server, is read from a Docker secret, and is never logged; the app only calls the config API from audited, permission-checked routes. Without an admin token, reading and controlling devices still works, but scenes, routines and modes report that they can't be changed.
- Requires Home Assistant 2024.8 or newer (script steps use the `action:` key).

## Automations (M4)
- Home Assistant stays the engine: each automation is written to HA through its config API (`automation/config/alice_auto_<id>`) and HA watches triggers and runs actions. The app keeps the structured definition so it can be edited and explained; whether it is on is read from HA, never stored.
- Needs `automation.manage` (admins and members by default, not guests) plus the same HA administrator token as scenes and routines.
- **Every device an automation touches is checked against the author**, in triggers, conditions and actions. Someone who cannot use a device cannot create, see, edit, switch, copy or delete an automation that references it (all answer 404). Anyone who *can* manage it acts on the whole automation, so an admin should expect members to see automations built from devices they share.
- Triggers: device state (optionally "for N"), sensor threshold, time, sunrise/sunset with offset, household mode change. Conditions: device state, sensor range, time window, mode, weekdays. Actions reuse the routine step compiler (device, scene, mode, wait). **Unlocking is never allowed in an action**; a lock may be a trigger or condition.
- Honest results: a write only counts once HA lists the automation with its new name; on/off only once HA's state flips. An unconfirmed create is rolled back. Editing keeps a switched-off automation off. A copy starts switched off.
- Requires Home Assistant 2024.10 or newer (new `triggers:`/`trigger:` syntax).
- Writes are audited in `security_audit` (actor-attributed, not visible to household admins). Nothing is written to `activity_events`.
- Not yet: running an automation on demand, failure notifications (arrive with M5), and an "unavailable device" alert beyond the needs-attention flag.

## Notifications, insights, energy (M5)
- **One row per recipient.** Entity-bound alerts (device offline, door left unlocked, insights) go only to people who can use that device; household-wide alerts (hub unreachable/back) go to admins and members, never guests. Everyone reads, marks and mutes only their own.
- **Deterministic rules over Home Assistant state, nothing else.** A problem must last first (offline 5 min, unlocked 10 min, hub 2 min), so blips are silent. Nothing here ever acts on a device.
- **Noise control:** a finding repeats at most once per 6 hours (insights: 3 days); more than 10 alerts an hour collapse into one "held back" line with no push; quiet hours (per person, own time zone) hold back push only, the inbox keeps everything. Alerts older than 90 days are deleted daily.
- **Push is the only new outbound traffic**, and only to well-known push services. The browser supplies the endpoint, so the server accepts only `https` hosts on an allowlist (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`, no ports or credentials), otherwise a subscriber could point the server at Home Assistant or the LAN. Payloads are encrypted by the push protocol and carry only a title, a line of text and a page to open. Dead subscriptions are removed when the service reports them gone. VAPID keys are generated on first use and stored in the app database (back them up with it).
- **Insights** come from 15-minute samples kept 35 days: a light/fan/switch on 8+ hours, a power meter that never drops below 5 W across at least three quarters of a day, a daily kWh total 30% and 1 kWh above its recent average. Too little data, or any gap in sampling, means no insight. Each carries its numbers, is dismissible per person, and never changes anything. Energy meters are shown separately and never summed.
- Known limits: sampling and rule timers live in process memory, so a restart restarts the "has it lasted" clock; iOS needs the app added to the Home Screen for push; push delivery to real services has not been tested here (fake sender in tests, subscription flow only exercised against the dev server).

## Operations (M6, part 1)
**Health.** `/api/admin/health` reports the hub link, data self-check, storage, backups and sampling in plain language, each with what to do. It holds no personal data, so support is shown the same thing.

**Backups (offline-first, no cloud).** Nightly and on demand, the app takes a consistent SQLite snapshot, **opens it and checks it** (integrity check plus per-table row counts), gzips it and encrypts it with `age` to a public key. The secret half is generated once, shown once for download and never stored; the app cannot read its own backups. Copies go to this device plus any destination the installer mounts (`BACKUP_DIRS`: USB disk, or a NAS share mounted on the host); the last 7 are kept per destination; files are written atomically. A backup earns trust in stages and the UI says which: *checked* (opened and verified when made) then *restore tested* (decrypted with the key, restored into a scratch copy, tables compared). Copies are re-hashed on every view to catch bit rot. Setting or changing the key, downloading, and restore tests need a fresh passkey check, and every action is audited. Real restores are offline: `bun src/restore.ts <archive> <key-file>` with the app stopped; it verifies first and keeps the old database as a dated copy.
- Limits: the same-house NAS or drive does not survive fire or theft; the UI says to carry a copy off-site. SFTP/SMB are not spoken natively: mount the share on the host. The Home Assistant configuration is not included (HA Container has no backup API); back up its config directory with host tooling. Losing the key means losing the backups, by design.

**Support access.** Operators are a separate identity store (`operators`, own passkeys, own cookie, own limits, 30-minute idle / 8-hour absolute sessions), created only at the device (`cli.ts operator-code <name>`) and registered with a roaming key. Household sessions mean nothing on `/api/ops/*` and operator sessions mean nothing elsewhere. An operator sees nothing until a household admin grants a **time-boxed (1-72 h), scoped** session (re-auth required); the operator then claims it (one at a time). Scopes today: `diagnostics` (the health snapshot) and `read_config` (names and summaries of rooms, devices, routines, automations; never people, history, sessions or credentials). The grant is shown to everyone in the home as a banner, can be ended by any admin at once, and ends by itself. Every operator call is audited with the operator's identity (including denials); the household's activity feed shows that support connected and ended, without a name.
- Limits: "hardware key required" is requested via the authenticator-attachment hint, which browsers honour but we cannot prove without attestation. Scopes `manage-users`, `control-devices`, `edit-automations` and `deploy` are not implemented. A lost operator key needs on-site recovery (`revoke-operator`, then a new code).

**Voice.** Per-item opt-in (devices of low risk, scenes, routines; never locks, cameras, covers or sensors), applied to Home Assistant Cloud's exposure list for Alexa and Google. A change is recorded only if Home Assistant accepts it, and needs a fresh passkey check. Voice commands bypass per-user permissions and audit, and the UI says so. The HA exposure/status commands are internal WebSocket APIs: the exact payloads follow HA's frontend and are pinned only by tests against a fake, **not yet verified against a real HA 2024.x**.

## Hardening (M7)
- **Network:** `edge`, `egress_net` and `ha_private` are Docker `internal` networks, so the app has no route of its own to the internet. Its only way out is `deploy/egress/proxy.ts`: CONNECT-only, push-service hosts on port 443, no IP literals, no private resolutions, no plain HTTP, every refusal logged. Caddy is on the public network and the edge network, never `ha_private`. `ha_private` must be created with `--internal`. Verified with real containers, a real HA and the real FCM endpoint.
- **Route sweep:** `sweep.test.ts` enumerates every registered API route. Anything not on the short public list must refuse anonymous callers; operator routes must refuse every household session; all `/api/admin/*` must refuse members and guests; every state change must refuse a missing CSRF header or a foreign Origin; no route may return 5xx for malformed input.
- **Retention (daily):** security audit 365 days (the table's own trigger enforces the floor), activity feed 365 days, notifications 90 days, readings 35 days, expired sessions, enrolment tokens and ended support sessions cleaned up.
- **Honest failure messages:** a hub that saves what the app writes but doesn't load it is reported as such and the write is undone.

## Content-Security-Policy
`script-src 'self'` plus the SHA-256 hash of each inline script in the built `index.html` (SvelteKit's start-up snippet). Computed once at server start from the build that ships in the same image, so no `unsafe-inline` for scripts. Rebuilding the web app requires restarting the server.

## Audit
- `security_audit`: actor-attributed, append-only (triggers block updates and deletes younger than 365 days). **No household API reads it.** Super-admin access is added in M6.
- `activity_events`: household-visible, no actor column by design.

## Known limitations (M1)
- Login/enrolment challenges and rate-limit counters live in process memory (single instance).
- Server-side WebAuthn is tested against a software authenticator (real P-256 keys, CBOR attestation, DER signatures; `src/softauth.ts`). The browser client path (`@simplewebauthn/browser` + a platform authenticator) and HTTPS origin/RP-ID matching on the real device still need a manual check.
