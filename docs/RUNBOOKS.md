# Runbooks

Commands assume the install lives in `/opt/alice` and the compose project is `alice`. "On the device" means a shell on the box.

## 1. Someone lost their passkey or phone
An admin: People → the person → **Recovery link**. They open it, create a new passkey. Their old passkeys and sessions stop working immediately.

## 2. The only admin is locked out
On the device: `docker compose -p alice exec app bun src/cli.ts list-admins`, then `… recovery-code <user-id>`. One hour, one use, audited as "physical access".

## 3. "Home hub unreachable"
1. Is the hub powered and on the network? 2. System → Health says whether it is unreachable or **refused the key** (see 4). 3. When it returns, the app reconnects on its own; nothing to restart.

## 4. The hub refuses the app's key (after rotating or deleting it in HA)
Create a new long-lived token in HA (use an administrator user), write it to `deploy/secrets/ha_token`, then `docker compose -p alice up -d --force-recreate app`.

## 5. Scenes, routines or automations "saved but not loading"
HA must load the files the app writes. In HA's `configuration.yaml`:
```
automation: !include automations.yaml
script: !include scripts.yaml
scene: !include scenes.yaml
```
Create the three files if missing, restart HA once.

## 6. Restore after a disk failure or corruption
1. Stop the app: `docker compose -p alice stop app`.
2. Get the newest archive from the USB disk or share (`alice-YYYYMMDD-….db.gz.age`) and your **backup key file**.
3. `docker compose -p alice run --rm -v /path/to/archives:/in:ro app bun src/restore.ts /in/<archive> /in/<key-file>`. It checks the backup before touching anything and keeps the old database as `app.db.before-restore-<time>`.
4. `docker compose -p alice up -d app`. Newer migrations apply on start. People sign in with the same passkeys (same domain).
5. HA's own configuration is not in this archive. Restore it from your HA backup.

## 7. Backup key lost
Existing backups can't be opened by anyone. System → Backups → set a new key (passkey check), make a new backup, and store the new key off the device.

## 8. An update failed or the app won't start
`alice-updater status` shows `ok`, `failed` (undone, on the previous version) or `broken`. If broken: `alice-updater rollback` puts back the previous version and the data copy taken before the update. Collect `docker compose -p alice logs app` for support. Never delete `/var/lib/alice/snapshots` until it is healthy.

## 9. Install an update offline
`alice-updater apply --bundle /mnt/usb/alice-1.4.0/` (manifest, signature and image file from the company).

## 10. Company: ship a release, or an emergency fix
```
alice-release publish --key release.key --image registry/alice/app@sha256:… --version 1.4.1 --notes "…" --out feed/
alice-release publish … --emergency --reason "Fixes CVE-…" --out feed/
```
Upload `feed/` to the update URL. Devices check hourly. An emergency release installs by itself after announcing it and waiting five minutes; confirm in the household's audit trail ("update.emergency_succeeded").

## 11. Add or remove a support operator
On the device: `docker compose -p alice exec app bun src/cli.ts operator-code "<name>"` gives a one-hour code; they register a hardware key at `/ops`. Remove: `… revoke-operator <id>` (their sessions end at once).

## 12. Help a household give support access
System → Support access → choose what and for how long (passkey check). The operator connects at `/ops`; the banner shows who. End it any time from the same page.

## 13. Replace the device
Install the stack on the new device with the **same domain**, restore the latest backup (6), put the HA key in the secret (4), reconnect the backup drive. Passkeys are bound to the domain, so they keep working. A **different domain** invalidates every passkey: use runbook 2, then 1 for each person.

## 14. Disk nearly full
System → Health shows free space. Old backups are pruned automatically (last 7 per destination); check `/var/lib/alice/snapshots` and Docker images (`docker image prune`).

## 15. The app's data fails its self-check
Don't keep running on it. Restore the latest backup (6). Health shows "App data: failed a self-check".
