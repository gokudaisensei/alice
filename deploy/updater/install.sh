#!/usr/bin/env bash
# Installs the host updater on the device. Run as root, once, by whoever sets the device up.
#   sudo deploy/updater/install.sh /path/to/release.pub
# The public key is the ONLY trust anchor: the updater installs nothing that isn't signed by its private half.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
PUB="${1:?usage: install.sh /path/to/release.pub}"; HERE="$(cd "$(dirname "$0")" && pwd)"
command -v jq >/dev/null && command -v openssl >/dev/null && command -v docker >/dev/null || { echo "needs docker, jq and openssl" >&2; exit 1; }
openssl pkey -pubin -in "$PUB" -noout || { echo "that is not a public key" >&2; exit 1; }
install -d -m 755 /etc/alice /var/lib/alice
install -d -m 755 /var/lib/alice/out; install -d -m 1777 /var/lib/alice/in   # created BEFORE the app starts, or Docker makes them root-only
install -m 644 "$PUB" /etc/alice/release.pub
install -m 755 "$HERE/alice-updater" /usr/local/sbin/alice-updater
[ -e /etc/alice/updater.conf ] || install -m 644 "$HERE/updater.conf.example" /etc/alice/updater.conf
install -m 644 "$HERE"/systemd/* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now alice-updater-check.timer alice-updater-request.path
echo "Installed. Edit /etc/alice/updater.conf (compose file, release.env, data volume, feed URL, registry prefix), then check: alice-updater status"
