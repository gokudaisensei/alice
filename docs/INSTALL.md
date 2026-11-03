# Install and set up, from an empty box to a working household

This guide takes you from bare hardware to a household using the app. It follows `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/updater/` and `.env.example`. Steps marked **(not yet verified)** have been written but not run on the target hardware; see `docs/CAVEATS.md`.

## 0. How the pieces fit

Home Assistant (HA) is the engine: it talks to the devices. This app is a separate front door on top of it (passkey sign-in, roles, rooms, scenes, alerts, insights, energy). It is **not** an HA add-on or integration. It talks to HA over HA's REST and WebSocket API with one access token.

```
Phone (PWA) ──HTTPS──> Caddy ──> app ──ha_private (internal)──> Home Assistant ──> devices
                                  │
                                  ├─ SQLite on the app_data volume
                                  └─ egress proxy ──> push-service hosts, port 443 only
```

| Container | Job | Network |
|---|---|---|
| `caddy` | HTTPS and certificates; forwards to the app only | `edge`, `internet` |
| `app` | The API and the web app; the only thing that can reach HA | `edge`, `ha_private`, `egress_net` (no internet route) |
| `egress` | The app's one way out: push services | `egress_net`, `internet` |
| Home Assistant | Separate install, outside this compose file | `ha_private` plus a normal network |

HA is never published to the internet. Do not forward HA's port 8123 on your router.

## 1. What you need

| Item | Notes |
|---|---|
| A small always-on Linux box | Target is a Raspberry Pi 5 (4 GB, arm64). Any x86_64 mini PC also works. Use an SSD, not an SD card |
| Docker and Docker Compose | Docker 24+ with the compose plugin |
| `jq` and `openssl` | Needed by the updater installer |
| A fixed LAN address | A DHCP reservation on your router is enough |
| A **permanent domain name** | For example `home.example.com`. Passkeys and push notifications are tied to it, so a temporary address (a quick tunnel) does not work in production |
| A way to reach the box from outside | Either port 80 and 443 forwarded to the box, or a named Cloudflare tunnel on your domain |
| A backup disk | A USB disk or network share, mounted on the box |
| Device radios, if needed | A Zigbee or Z-Wave USB stick for those device types. Wi-Fi and Matter devices need no extra hardware |

## 2. Prepare the host

1. Install a 64-bit Linux and keep it updated.
2. Install Docker and the compose plugin, and add your user to the `docker` group.
3. Mount the backup disk, for example at `/mnt/backup`. It must be writable by uid 1000, which is the user the app runs as:
   ```bash
   sudo chown 1000:1000 /mnt/backup
   ```
4. Check the clock is correct (`timedatectl`). Certificates and passkeys fail with a wrong clock.

## 3. Install Home Assistant

HA Container is what this project was tested against.

1. Create the private network the app will use. It is `internal`, so nothing on it can reach the internet:
   ```bash
   docker network create --internal ha_private
   ```
2. Run HA attached to **two** networks: `ha_private` (so the app can reach it) and a normal network (so HA can reach its own integrations and cloud services). Mount its config folder, and do not publish port 8123 beyond your LAN if you can avoid it.
3. Open HA in a browser on your LAN, create the owner account, and set the location, time zone and units.
4. **Required one-time configuration.** The app saves scenes, routines and automations as HA files, and HA only loads them if `configuration.yaml` includes them. Add:
   ```yaml
   automation: !include automations.yaml
   script: !include scripts.yaml
   scene: !include scenes.yaml
   ```
   Create the three files if they do not exist (each can contain just `[]`). Restart HA. Without this, the app reports "saved but isn't loading it" and undoes the change.
5. Create the access token the app will use: in HA, open your profile, then Security, then **Long-lived access tokens**, then Create token. Copy it once; HA never shows it again.
   - The design plan recommends a dedicated, non-admin HA user for this token. Runbook 4 says to use an administrator user. These two documents disagree; decide before release. A token carries all the rights of the user who created it.

## 4. Set up the devices (in HA, not in the app)

Devices are paired with HA. The app discovers them from HA.

1. **Add the integrations.** In HA, open Settings, then Devices and services, then Add integration:
   - Zigbee (ZHA or Zigbee2MQTT) or Z-Wave: plug in the stick first.
   - Matter: commission with the HA companion app.
   - Wi-Fi brands (Hue, Shelly, Tuya, TP-Link and others): use their own integrations.
2. **Name things well.** Names show up as tiles in the app. Use plain names such as "Kitchen ceiling light", not "light.0x00158d...".
3. **Assign every device to an area.** HA areas become the app's rooms. A device with no area ends up unsorted.
4. **Energy.** For the Energy page, power sensors need device class `power` (W) and energy sensors need `energy` (kWh), with the right state class so HA keeps history.
5. **Safety devices.** Locks, door and window contact sensors, smoke and leak sensors feed the alerts. Check each one reports state changes before you rely on it.
6. **Check in HA first.** Control each device from HA's own dashboard. If it does not work there, it will not work in the app.

## 5. Deploy the app

1. Put the repository on the box, for example in `/opt/alice`.
2. Save the token from step 3.5 as the secret file, with no trailing newline:
   ```bash
   printf '%s' 'PASTE_TOKEN' > deploy/secrets/ha_token
   chmod 600 deploy/secrets/ha_token
   ```
3. Create the environment file from the example and edit it:
   ```bash
   cp .env.example deploy/.env
   ```
   | Variable | Meaning |
   |---|---|
   | `SITE_ADDRESS` | Your domain, for example `home.example.com`. Caddy gets a certificate for it |
   | `HA_URL` | `http://homeassistant:8123` if HA's container is named `homeassistant` on `ha_private`; otherwise its address on that network |
   | `BACKUP_DIR` | The mounted backup disk, for example `/mnt/backup` |
   | `VAPID_SUBJECT` | A real contact address for push services, for example `mailto:you@example.com` |
   | `UPDATES_DIR` | Where the updater and app exchange files; use `/var/lib/alice` (the updater installer creates it) |
4. Point DNS at the box (or at your tunnel) before the first start, so the certificate can be issued.
5. Build and start:
   ```bash
   cd /opt/alice/deploy
   docker compose -p alice up -d --build
   docker compose -p alice ps          # app should become "healthy"
   ```
   The app's push keys (VAPID) are generated automatically on first start and stored in its database.
6. Check it from outside your network: `https://home.example.com/healthz` should answer `{"ok":true,...}`.

## 6. First run

1. Get the one-time setup code. It is printed in the app's log, valid for one hour:
   ```bash
   docker compose -p alice logs app | grep "setup code"
   ```
   If it has expired:
   ```bash
   docker compose -p alice exec app bun src/cli.ts setup-code
   ```
2. On your phone, open `https://home.example.com/setup` and enter the code.
3. Enter your name and create a **passkey** (Face ID, fingerprint or device PIN). You become the household admin.
4. Add the app to your home screen:
   - **iPhone (Safari):** Share, then Add to Home Screen. Required for push notifications (iOS 16.4 or later).
   - **Android (Chrome):** menu, then Install app.
5. Open the app from the home-screen icon, and check the devices and rooms appear.

## 7. Set up the household

1. **People.** Add each person as a member or guest. For a guest, choose exactly which devices, scenes and tabs they can see; guests never see energy or insights. Each person gets a one-time invitation link and creates their own passkey.
2. **Rooms and groups.** Review the rooms built from HA's areas; rename or reorder them, and add groups.
3. **Scenes and routines.** Create them in the app. It writes them into HA and confirms HA loaded them.
4. **Household modes** (home, away, night and similar): set what each one does.
5. **Alerts.** Each person opens Settings, then Notifications, and turns alerts on for their own device. Set quiet hours. Set the power-alert limits per plug.
6. **Backups.** In System, then Backups, set a backup key and a destination, and make a first backup. Store the key **off the device** (password manager or printed). Without it no backup can be opened. The app keeps the last 7 per destination.
7. **Health.** System, then Health shows whether HA is reachable, free disk space, the last backup and the data self-check.

## 8. Install the updater

Updates are signed releases. The updater runs on the host, outside the containers.

1. You need the company's release **public** key (`release.pub`).
2. Install:
   ```bash
   sudo deploy/updater/install.sh /path/to/release.pub
   sudoedit /etc/alice/updater.conf
   ```
   Set the compose file path, `RELEASE_ENV`, the data volume (`alice_app_data` for project `alice`), `SOURCE_URL` and `REGISTRY_PREFIX`.
3. Create `/opt/alice/release.env` with `ALICE_IMAGE`, `ALICE_VERSION`, `UPDATES_DIR=/var/lib/alice` and the other compose variables.
4. Check: `alice-updater status`.

Details, the emergency path and the company-side tooling are in `docs/UPDATES.md`. **(Not yet verified on a real Raspberry Pi under real systemd.)**

## 9. Acceptance checks before you hand it over

- [ ] `https://your-domain/healthz` answers from outside the home network.
- [ ] Sign in on two phones with separate passkeys.
- [ ] Control one light, one switch and one lock from the app, and confirm the device responds.
- [ ] Change something in HA directly; the app updates within a few seconds.
- [ ] Create a scene and a routine; confirm they appear in HA.
- [ ] A guest can see only what you allowed.
- [ ] Trigger an alert (open a contact sensor) and receive a push on each phone.
- [ ] Make a backup, then **restore it on a spare machine** (`docs/RUNBOOKS.md`, section 6).
- [ ] Turn HA off for a minute and confirm the app shows "Home hub unreachable", then recovers by itself.
- [ ] Reboot the box; everything comes back without help.
- [ ] Lose-a-phone drill: use the admin recovery link (runbook 1).

## 10. Day-to-day

| Task | Where |
|---|---|
| Add or remove a person | People |
| Install an update | System, then Updates, then Install now (asks for your passkey) |
| Lost phone or passkey | Admin: People, then the person, then Recovery link (runbook 1) |
| Only admin is locked out | On the box: `docker compose -p alice exec app bun src/cli.ts list-admins`, then `recovery-code <user-id>` (runbook 2) |
| App will not start after an update | `alice-updater status`, then `alice-updater rollback` (runbook 8) |
| Disk filling | System, then Health; prune old backups and Docker images (runbook 14) |

## 11. Moving to another domain or device

Passkeys are bound to the domain. **Same domain on a new device:** restore the latest backup, passkeys keep working. **A different domain:** every passkey stops working. Use the recovery code (runbook 2), then a recovery link for each person (runbook 1). This is also what happens whenever a temporary tunnel address changes, which is why production needs a permanent domain.

## 12. Known limits

- HA's own backups are not part of the app's backup archive. Back up HA separately (`docs/CAVEATS.md`, H2).
- The whole path, on a Raspberry Pi with real devices and real phones, has not been run end to end. The compose stack has only been tested next to a test HA (`deploy/test-topology.sh`).
- iPhone push works only for the installed home-screen app, and iOS can clear a web app's stored data when it is unused for a long time.
- The 3D simulator in `apps/simulator` is a development tool. Do not deploy it to a production box.

## 13. Quick path: the app on one machine, Home Assistant on another

If HA already runs elsewhere (for example a Raspberry Pi with `network_mode: host`), skip the compose stack and use the script in the repository root. It needs only `bash`, `curl` and [Bun](https://bun.sh) (it offers to install Bun):

```bash
git clone <your repository> alice && cd alice
./alice.sh install http://ha.local:8123     # checks HA, asks for a long-lived token, builds the web app
./alice.sh start --tunnel                   # or just `start` for http://localhost:3000 on this machine
```

`start` prints the address and the one-time setup code. `--tunnel` needs `cloudflared`; the address it gives changes on every start, and passkeys belong to the address, so after a new address use `./alice.sh cli list-admins` then `./alice.sh cli recovery-code <id>`. Other commands: `stop`, `status`, `logs`, `cli <command>`. State (config, token with mode 600, database, logs) is in `.alice/`, which is git-ignored. Change the port with `PORT=3100 ./alice.sh install …`.

This path runs without the compose network isolation (no private HA network, no egress proxy) and without the signed-update host service. Use section 5 for a production box.

## 14. Optional: the Alice integration inside Home Assistant

Without it, the app needs an **administrator** key for Home Assistant (that is how it writes scenes, routines and automations). With it, scenes, routines and automations are written through a small integration that checks everything first, so the app can run with a key that is **not** an administrator's. A leaked key then cannot do more than the app can: it can only write items whose names start with `alice_`, in shapes the app itself makes (no templates; a short list of services; never unlocking, disarming or opening a garage, gate or water or gas valve).

1. On the machine that holds Home Assistant's configuration folder: `./alice.sh ha-component /path/to/config`. It copies the integration and adds `alice:` to `configuration.yaml`. Make sure `configuration.yaml` also has `automation: !include automations.yaml`, `script: !include scripts.yaml` and `scene: !include scenes.yaml`.
2. Restart Home Assistant. Check Settings, Devices and services: "Alice" appears. The app's System page then says "Installed".
3. (Optional) In Home Assistant, Settings, People, add a user for the app **without** "Administrator", sign in as that user, create a long-lived token (Profile, Security) and use it as the app's key (`./alice.sh install` again, or replace the token file).

What a key that is not an administrator's cannot do, measured on Home Assistant 2026.10.4: create or rename areas from the app, read automation traces ("Why didn't it run?"), see or start Home Assistant's own backups, take doors and alarms out of Home Assistant's assistant ("Keep them out of reach"), create the household mode helper the first time (create it once with an administrator key, or define `input_select.alice_household_mode` in `configuration.yaml`), and install updates. Each shows a plain "the home hub didn't allow it" message. Everything else works: all device control, rooms and floors, energy, history, the log, alerts, Home Assistant status, Assist, and writing scenes, routines and automations.

The integration also adds a service, `alice.notify` (message, title, severity, audience): an automation in Home Assistant can call it to send a message to the people in the home through the app; `severity: critical` may sound during quiet hours for people who allowed that.

To check it on a throwaway Home Assistant (needs docker and bun; touches nothing you already run): `deploy/ha/test-container.sh`.

