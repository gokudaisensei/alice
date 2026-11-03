# Acceptance matrix

How each requirement of the specification is met, and the evidence. ✅ shown by an automated test or a recorded real run · 🟡 partly · ⛔ not yet shown. Evidence names are test files or scripts in this repo.

## Network and exposure
| Requirement | Evidence | |
|---|---|---|
| HA is never publicly exposed; only the app is reachable, through a reverse proxy | `deploy/test-topology.sh`: HA answers on the private network only, not from the edge network; app has no route to the internet | ✅ |
| App's outbound traffic is limited | `deploy/egress/test.sh`: only push hosts on 443 through the proxy; IP literals, other ports, private addresses, plain HTTP refused | ✅ |
| HA token stays server-side | Docker secret; never in logs or responses (`app.test.ts`, checked in Docker) | ✅ |

## Identity, roles, permissions
| Requirement | Evidence | |
|---|---|---|
| Passkeys, no passwords | `webauthn.test.ts` (real P-256 / CBOR through a software authenticator) | 🟡 not tried with a real browser authenticator |
| Admin / Member / Guest with per-user permissions, enforced server-side | `authz.test.ts`; `sweep.test.ts` walks every route: anonymous refused, members and guests refused on admin routes, guests refused on automations and edits | ✅ |
| Recovery without passwords | `auth.test.ts` (recovery tokens remove old passkeys and sessions); CLI recovery code | ✅ |
| Escalation rules, last admin protected | `authz.test.ts` | ✅ |
| Fresh check for sensitive actions | unlock, backup key/download/restore test, support grant, updates, voice: each tested to demand re-auth | ✅ |

## Privacy
| Requirement | Evidence | |
|---|---|---|
| Household admins cannot see individual attribution | `activity_events` has no actor column; no API reads `security_audit` (`authz.test.ts`, `updates.test.ts`, `ops.test.ts` check the feed contains no names) | ✅ |
| Audit is append-only and retained 12 months | triggers + `retention.test.ts` (clock can't shorten it) | ✅ |
| Company super-admin: separate identity, supervised sessions | `ops.test.ts`: separate cookies and stores both ways; grant is household-issued, time-boxed, scoped, visible, revocable; every call audited | ✅ (sign-in with a real hardware key ⛔) |
| Emergency maintenance path without household approval, no data scope | `deploy/updater/test.sh`: installs by itself after notice and grace period | ✅ |

## Features
| Requirement | Evidence | |
|---|---|---|
| Capability-aware controls | `real-ha.test.ts` on demo lights, climate, locks, media, energy | ✅ (real vendor hardware ⛔) |
| Honest results: offline device vs hub down; confirmation | `devices.test.ts`; `real-ha.test.ts` (real hub stop/start, wrong key) | ✅ |
| Rooms, groups, favorites, search, dark mode | `devices.test.ts`; browser runs | ✅ |
| Scenes, routines, household modes | `routines.test.ts`; `real-ha.test.ts` (real scripts run, mode helper) | ✅ |
| Guided automation builder, HA as engine | `automations.test.ts`; `real-ha.test.ts`: every trigger/condition shape accepted by real HA, an automation really fires | ✅ |
| Predefined modes only, never auto-acting suggestions | `routines.test.ts` (suggestions are computed, not stored; nothing runs unprompted) | ✅ |
| Notifications: in-app, push, quiet hours, dedupe, rate limit | `notify.test.ts` | ✅ (real push delivery ⛔) |
| Deterministic insights, no AI, no data → no insight, never act | `notify.test.ts` | ✅ |
| Energy awareness | `notify.test.ts`, `real-ha.test.ts` | ✅ |
| Voice: opt-in, low-risk only | `ops.test.ts`; `real-ha.test.ts` (exposure list round trip) | ✅ (Alexa/Google delivery ⛔: cloud not linked in test) |
| Backups with a tested restore | `backup.test.ts`; offline restore command run on a corrupted database | ✅ |
| Guided updates, rollback | `deploy/updater/test.sh` (37 checks on real containers) | ✅ |
| Health page | `backup.test.ts`, `updates.test.ts` | ✅ |

## Explicit exclusions (confirmed absent)
Covers are offered since P3, but opening a garage, gate or door cover asks for a fresh passkey check (`adapters.test.ts`); no AI/ML anywhere (insights are plain SQL thresholds); no user-defined modes (four fixed); no drag-and-drop dashboards (two fixed layouts, ordered lists); no native app (installable web app only); no integration UI for household admins.

## Resilience
| Scenario | Evidence | |
|---|---|---|
| Hub stops and restarts | `real-ha.test.ts` (disruptive): banner state, honest 503s, alerts, automatic recovery | ✅ |
| App restarts | sessions persist (`real-ha.test.ts`) | ✅ |
| Bad update | rolled back with data intact (`updater/test.sh`) | ✅ |
| Wrong clock | audit trigger refuses early deletion (`retention.test.ts`) | ✅ |

## Not demonstrated
Real browser passkeys and a real hardware key; real push delivery; Alexa/Google; real vendor devices; arm64 on a Raspberry Pi (see below); installer and systemd units on a device; release-key rotation. Details and status in `CAVEATS.md`.
