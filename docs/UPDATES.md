# Updates and the emergency path

## Who can do what
| | Can start an update? | Can install something unsigned? | Touches household data? |
|---|---|---|---|
| Household admin (in the app) | Yes: only a release the device already verified | No | No |
| Company support operator | **No** (no `deploy` scope in the app) | No | Only inside a household-granted support session |
| Host updater (root, outside the containers) | Yes: normal releases only after approval; *emergency* releases on its own | **Never**: it checks a signature against a key pinned on the device | Takes a raw safety copy of the data volume (stays on the device); never opens the database |
| Anyone with the company's private release key | Yes, by signing a release | n/a | n/a |

The one trust anchor is `/etc/alice/release.pub`. The private key stays offline at the company; losing it means a new key must be installed on each device on-site.

## What a release is
A `manifest.json` plus `manifest.json.sig` (Ed25519, raw signature over the manifest bytes). The manifest names the version, an `expires` date, whether it is an `emergency` release (and why), release notes, and **exactly one image**: either
- a registry image pinned by digest (`repo@sha256:…`, must start with the device's `REGISTRY_PREFIX`), or
- an offline bundle (`image.tar` with its SHA-256 and the Docker image ID), for a USB stick.

The updater refuses: a bad or foreign signature; a tampered manifest; an expired release; a version that is not newer (no downgrades, no replay of an old signed release); a missing `minVersion`; an image outside the allowed registry or not pinned; a bundle whose checksum or image ID differs from the signed values.

## The two paths
**Guided (normal) updates.** `alice-updater check` runs hourly (systemd timer). A verified newer release is recorded as *available*; the app shows it under System → Updates with the notes. An admin presses *Install now* (fresh passkey check). The app writes `request.json` naming the version; a systemd path unit starts `apply-request`, which installs it **only if it equals the release the updater itself already verified**: the app cannot choose anything else.

**Emergency path.** An `emergency: true` release found by `check` is installed without waiting for approval, because a security fix cannot wait for a household to notice. It is still signed, still digest-pinned, still health-checked and rolled back on failure. Before touching anything the updater publishes an `update_starting` event (reason, start time) and waits `GRACE_SECONDS` (default 5 minutes). The app turns that into a banner for everyone and a notification to admins that **cannot be muted**, then an audit entry, an "urgent security update was installed" entry in the household activity feed, and a final notification. No data scope is involved.

**Offline bundle.** `alice-updater apply --bundle /mnt/usb/alice-1.4.0/`, run on-site as root. Same checks.

## The update itself
1. Verify (above). 2. Announce (`update_starting`). 3. Stop the app and copy the data volume to `/var/lib/alice/snapshots/<time>-<version>` (last 2 kept). 4. Switch `ALICE_IMAGE`/`ALICE_VERSION` in `release.env`, start the app. 5. Wait for the container health check **and** the reported version to match. 6. On success, publish `update_succeeded`. On failure or timeout: stop, put back the previous `release.env` **and the data snapshot** (migrations only move forward, so the old version needs the old data), start the previous version, publish `update_failed` with whether it was undone. Anything written in the minutes between stop and failure is not kept; the household is told "nothing was lost" only because the window starts with the app stopped.

## Install on a device
```
sudo deploy/updater/install.sh /path/to/release.pub
sudoedit /etc/alice/updater.conf
```
Create `release.env` (with `ALICE_IMAGE`, `ALICE_VERSION`, `UPDATES_DIR=/var/lib/alice`, plus the other compose variables). Compose must find `/var/lib/alice/out` and `/in` already existing (the installer creates them).

## Company side
```
deploy/release/alice-release keygen ./keys                       # once; keep release.key offline
deploy/release/alice-release publish --key keys/release.key --image registry.example.com/alice/app@sha256:… --version 1.4.0 --notes "…" --out ./feed
deploy/release/alice-release publish … --emergency --reason "Fixes CVE-…"
deploy/release/alice-release bundle  --key keys/release.key --image alice-app:1.4.0 --version 1.4.0 --out ./usb-bundle
```
Serve `./feed/manifest.json` and `.sig` over https at `SOURCE_URL`.

## Tested
`deploy/updater/test.sh` runs all of the above against real containers and a real local registry: signature, tamper, expiry, replay, checksum, image-ID and registry-prefix refusals; a bundle update with data intact; a deliberately broken release rolled back with data intact; a normal release offered but not installed; an unverified approval refused; a registry install by digest; an emergency install after the grace period with its notice first.

## Not covered
Installing on a real Raspberry Pi/arm64 (the installer and systemd units are written but not run here); the hourly timer and path unit firing under real systemd; a registry behind TLS and auth; key rotation and revocation of the release key; a downgrade or rollback to a *signed older* release on purpose (today: `alice-updater rollback` to the last snapshot only).
