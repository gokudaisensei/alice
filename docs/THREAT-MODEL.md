# Threat model

Scope: one household's box (Raspberry Pi class device) running Home Assistant (HA) separately, plus this app (`app`), a TLS reverse proxy (`caddy`) and an allow-listing egress proxy (`egress`). Company support is remote and optional.

## What we protect
1. **Physical safety and security of the home:** locks, heating, cameras, anything controllable.
2. **Privacy:** who did what at home (per-person history), camera stills, presence/energy patterns.
3. **Credentials:** the HA access key (full administrator rights in HA), passkeys, sessions, the backup key, the release-signing key (company), operator keys.
4. **Integrity of the software:** what runs on the device.
5. **Availability:** the home keeps working when the app, the internet or the hub has a problem.

## Trust boundaries
```
Internet ─▶ Caddy :443 ─▶ app ─▶ (internal network) ─▶ Home Assistant
                         │└────▶ egress proxy ─▶ push services only
                         └─ read-only: updater status      Host updater (root) ─ signed releases only
```
Only Caddy is published. `edge`, `egress_net` and `ha_private` are Docker `internal` networks, so the app has **no route of its own to the internet** (verified by `deploy/test-topology.sh`). Caddy is not on `ha_private`, so HA is unreachable from the public side.

## Threats and what answers them
| Threat | Mitigation | Residual risk |
|---|---|---|
| Internet attacker probes or brute-forces sign-in | Passkeys only (no passwords to guess); per-IP rate limit and lockout on auth; strict CSP; CSRF header + Origin check on every state change; `HttpOnly`, `SameSite`, `__Host-` cookies | Rate-limit counters are in memory and reset on restart |
| Stolen session cookie | Opaque random tokens, only the hash stored; 7-day idle / 30-day absolute expiry; fresh passkey check (10 min) for unlocking, key and backup changes, support grants, updates, voice; instant revocation | A thief with a live cookie can do ordinary, non-sensitive actions until it expires or is revoked |
| Member tries to become admin or reach others' data | Authorization on every route, server-side, deny by default; nobody can grant a permission they lack; only admins create admins; last admin protected; a route sweep test fails if any route is unguarded | A permissions bug in a future route; the sweep catches missing guards, not wrong ones |
| Guest sees the home | Guests start with no devices; rooms, scenes, routines and search only show what was granted | None known |
| Household admin watches individuals | Two audit stores: `security_audit` (actor-attributed, append-only by trigger, no household API reads it) and `activity_events` (no actor column); exports never join actor data | Someone with physical root on the box can read the database |
| Cross-site request forgery / clickjacking / injection | `X-Requested-With` + Origin check, `frame-ancestors 'none'`, CSP with hashes (no inline script), no HTML rendering of user data | Third-party browser bugs |
| Compromised app container | Non-root, read-only filesystem, all capabilities dropped, memory limit, internal-only networks, egress limited to push hosts on 443 | The HA key it holds is a full-administrator key (HA has no narrower scope for its config API). A compromised app can control the whole HA instance |
| Attacker supplies a push endpoint to make the server call internal hosts (SSRF) | Only `https` endpoints on well-known push hosts are accepted; the network itself blocks everything else; the proxy refuses IP literals, other ports and private resolutions | A push service compromising its own clients is out of scope |
| Tampered or malicious update | Ed25519 signature checked against a key pinned on the device; images pinned by digest and limited to the allowed registry; expiry, no downgrade or replay; health-checked, rolled back with data | **Theft of the company's private release key** would let an attacker ship anything. Keep it offline; there is no rotation or revocation scheme yet |
| Support staff overreach or a stolen operator key | Separate identity store, created only at the device; hardware key requested; sessions 30 min idle; an operator sees nothing without a household-granted, time-boxed, scoped session; visible banner; household can end it instantly; every call (and denial) audited with the operator's identity | "Hardware key" is a hint the browser honours; without attestation it can't be proven. Scopes that would let support change things (control, edit, manage users, deploy) are deliberately not implemented |
| Emergency updates abused | Same signature, pinning and health checks as any update; the household is told before (banner, notification admins can't mute, grace period), and after; no data scope | Whoever holds the release key can use it |
| Backup theft | Encrypted with `age` to a public key; the secret half is never stored on the device; archives are re-hashed to catch tampering or rot | Losing the key means the backups can't be read; a thief who has both archive and key reads everything |
| Voice commands | Opt-in per item, never locks, cameras, covers or sensors, fresh passkey check to change | Voice runs inside HA and bypasses per-person permissions and audit; anyone in earshot (or an Alexa/Google account compromise) can use whatever was enabled |
| Someone with physical access | Recovery codes are one-time, time-limited and audited; operator creation is at the device only | Root on the box is full control. That's accepted: physical access is out of scope |
| Lost power or internet | See [OFFLINE.md](OFFLINE.md); HA keeps running automations and schedules independent of the app | Cloud voice and push stop without internet |
| Wrong system clock | Audit retention refuses to delete anything younger than 365 days by the real clock (a database trigger) | A wrong clock can still skew expiry of sessions and releases |
| Data corruption | WAL SQLite, daily integrity-checked, encrypted backups with restore tests; health page checks the database | Single-disk device |

## Explicitly out of scope
Compromise of Home Assistant itself or its add-ons; the security of the household's Wi-Fi and router; Alexa/Google/Nabu Casa accounts; a malicious browser extension or device on the user's side; supply-chain attacks on dependencies (mitigated only by lockfiles and review).

## Assumptions
The device is in the home, updated by signed releases, and its disk is not removed by an attacker; the household keeps the backup key somewhere other than the device; the company keeps the release key offline.
