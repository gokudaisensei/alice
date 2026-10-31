#!/usr/bin/env bash
# End-to-end test of the updater against REAL containers (no mocks): signature checks, update, health-gated rollback,
# data safety, emergency installs, household-approved installs, registry-by-digest installs.
# Needs docker, jq, openssl. Builds the app image from this repo first.   Usage: deploy/updater/test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
W="$(mktemp -d)"; export ALICE_UPDATER_CONF="$W/updater.conf"
P=alicetest; VOL="${P}_app_data"; UP="$ROOT/deploy/updater/alice-updater"; REL="$ROOT/deploy/release/alice-release"
pass=0; failn=0
ok() { pass=$((pass+1)); echo "ok   - $1"; }
no() { failn=$((failn+1)); echo "FAIL - $1"; }
check() { local d=$1; shift; if "$@" >"$W/last.log" 2>&1; then ok "$d"; else no "$d"; sed 's/^/       | /' "$W/last.log" | tail -8; fi; }
refuse() { local d=$1; shift; if "$@" >"$W/last.log" 2>&1; then no "$d (was accepted!)"; else ok "$d"; fi; }
cleanup() { docker compose -p $P -f "$ROOT/deploy/docker-compose.yml" --env-file "$W/release.env" down -v >/dev/null 2>&1; docker rm -f alicetest-registry >/dev/null 2>&1; docker rmi -f alice-app:1.0.0 alice-app:1.1.0 alice-app:1.2.0 alice-app:1.3.0 alice-app:1.4.0 alice-app:1.5.0 127.0.0.1:5055/alice:1.5.0 >/dev/null 2>&1; docker network rm ha_private >/dev/null 2>&1; docker run --rm --user 0 --entrypoint sh -v "$W:/w" oven/bun:1-slim -c "rm -rf /w/state /w/backups" >/dev/null 2>&1; rm -rf "$W"; }
trap cleanup EXIT
ver() { docker compose -p $P -f "$ROOT/deploy/docker-compose.yml" --env-file "$W/release.env" exec -T app bun -e 'const r=await fetch("http://127.0.0.1:3000/healthz");console.log((await r.json()).version)' 2>/dev/null | tr -d '\r\n'; }
events() { jq -r '.type' "$W/state/out/events.jsonl" 2>/dev/null | tr '\n' ' '; }
vol_sh() { docker run --rm --user 0 --entrypoint sh -v "$VOL:/d" alice-app:1.0.0 -c "$1"; }

echo "# building the app image (1.0.0)"
docker build -q -t alice-app:1.0.0 -f "$ROOT/Dockerfile" "$ROOT" >/dev/null || { echo "build failed"; exit 1; }
derive() { printf 'FROM alice-app:1.0.0\nLABEL release=%s\n%s\n' "$1" "${2:-}" | docker build -q -t "alice-app:$1" - >/dev/null; }
derive 1.1.0; derive 1.2.0 'CMD ["bun","-e","process.exit(1)"]'; derive 1.3.0; derive 1.4.0; derive 1.5.0
docker network create --internal ha_private >/dev/null 2>&1 || true

mkdir -p "$W/state/out" "$W/state/in" "$W/keys" "$W/backups" "$W/other-keys"; chmod 755 "$W/state/out"; chmod 1777 "$W/state/in" "$W/backups"   # the installer creates these before the app starts
"$REL" keygen "$W/keys" >/dev/null; "$REL" keygen "$W/other-keys" >/dev/null
cat > "$W/release.env" <<ENV
ALICE_IMAGE=alice-app:1.0.0
ALICE_VERSION=1.0.0
UPDATES_DIR=$W/state
BACKUP_DIR=$W/backups
HA_URL=http://127.0.0.1:1
ENV
cat > "$W/updater.conf" <<CONF
COMPOSE_FILE=$ROOT/deploy/docker-compose.yml
COMPOSE_PROJECT=$P
RELEASE_ENV=$W/release.env
DATA_VOLUME=$VOL
STATE_DIR=$W/state
PUBKEY=$W/keys/release.pub
REGISTRY_PREFIX=127.0.0.1:5055/alice
GRACE_SECONDS=3
HEALTH_TIMEOUT=60
SOURCE_URL=file://$W/feed
CONF
export COMPOSE_PROJECT_NAME=$P
dc() { docker compose -p $P -f "$ROOT/deploy/docker-compose.yml" --env-file "$W/release.env" "$@"; }
dc up -d --no-deps app >/dev/null 2>&1
for i in $(seq 1 40); do [ "$(ver)" = 1.0.0 ] && break; sleep 2; done
[ "$(ver)" = 1.0.0 ] && ok "baseline 1.0.0 is running and healthy" || { no "baseline did not start"; dc logs app | tail; exit 1; }
vol_sh 'echo precious > /d/marker && chown 1000:1000 /d/marker'
bundle() { "$REL" bundle --key "$W/keys/release.key" --image "alice-app:$1" --version "$1" --out "$W/b-$1" "${@:2}" >/dev/null; }

echo "# verification: things that must be refused"
bundle 1.1.0 --notes "First update"
sed "s|^PUBKEY=.*|PUBKEY=$W/other-keys/release.pub|" "$W/updater.conf" > "$W/other.conf"
refuse "a signature from another key is refused" env ALICE_UPDATER_CONF="$W/other.conf" "$UP" verify "$W/b-1.1.0/manifest.json" "$W/b-1.1.0/manifest.json.sig"
jq '.version="9.9.9"' "$W/b-1.1.0/manifest.json" > "$W/tampered.json"
refuse "a tampered manifest is refused" "$UP" verify "$W/tampered.json" "$W/b-1.1.0/manifest.json.sig"
check  "the genuine manifest verifies" "$UP" verify "$W/b-1.1.0/manifest.json" "$W/b-1.1.0/manifest.json.sig"
"$REL" bundle --key "$W/keys/release.key" --image alice-app:1.1.0 --version 1.1.0 --days 0 --out "$W/b-expired" >/dev/null; sleep 1
refuse "an expired release is refused" "$UP" verify "$W/b-expired/manifest.json" "$W/b-expired/manifest.json.sig"
"$REL" bundle --key "$W/keys/release.key" --image alice-app:1.1.0 --version 1.0.0 --out "$W/b-same" >/dev/null
refuse "the same version is refused (no replays)" "$UP" verify "$W/b-same/manifest.json" "$W/b-same/manifest.json.sig"
cp -r "$W/b-1.1.0" "$W/b-badtar"; echo junk >> "$W/b-badtar/image.tar"
refuse "an image file that doesn't match the signed checksum is refused" "$UP" apply --bundle "$W/b-badtar"
[ "$(ver)" = 1.0.0 ] && ok "nothing changed after those refusals" || no "version changed after refusals"
"$REL" publish --key "$W/keys/release.key" --image "evil.example/alice@sha256:$(printf 'a%.0s' {1..64})" --version 1.1.0 --out "$W/b-evil" >/dev/null
refuse "an image outside the allowed registry is refused" "$UP" verify "$W/b-evil/manifest.json" "$W/b-evil/manifest.json.sig"
"$REL" bundle --key "$W/keys/release.key" --image alice-app:1.1.0 --version 1.1.0 --out "$W/b-wrongid" >/dev/null
jq '.imageId="sha256:'"$(printf 'b%.0s' {1..64})"'"' "$W/b-wrongid/manifest.json" > "$W/m.json" && openssl pkeyutl -sign -inkey "$W/keys/release.key" -rawin -in "$W/m.json" -out "$W/m.json.sig" && mv "$W/m.json" "$W/b-wrongid/manifest.json" && mv "$W/m.json.sig" "$W/b-wrongid/manifest.json.sig"
refuse "a signed release whose image is not the one named is refused" "$UP" apply --bundle "$W/b-wrongid"
[ "$(ver)" = 1.0.0 ] && ok "still on 1.0.0" || no "version changed"
grep -q update_refused "$W/state/out/events.jsonl" && ok "refusals are recorded for the app to audit" || no "no refusal events"

echo "# an offline bundle update"
check "bundle 1.1.0 installs" "$UP" apply --bundle "$W/b-1.1.0"
[ "$(ver)" = 1.1.0 ] && ok "now running 1.1.0" || no "not running 1.1.0 (got '$(ver)')"
[ "$(vol_sh 'cat /d/marker')" = precious ] && ok "household data survived the update" || no "data lost in update"
case "$(events)" in *update_starting*update_succeeded*) ok "events: starting then succeeded";; *) no "events were: $(events)";; esac
[ "$(jq -r .state "$W/state/out/status.json")" = ok ] && ok "status says ok" || no "status not ok"
ls "$W/state/snapshots" | grep -q . && ok "a safety copy of the data was kept" || no "no snapshot"

echo "# a bad release is rolled back, with data intact"
vol_sh 'echo written-after-1.1.0 > /d/marker2 && chown 1000:1000 /d/marker2'
bundle 1.2.0
"$UP" apply --bundle "$W/b-1.2.0" >/dev/null 2>&1; rc=$?
[ $rc -ne 0 ] && ok "the update reports failure" || no "bad update reported success"
[ "$(ver)" = 1.1.0 ] && ok "rolled back: 1.1.0 is running and healthy again" || no "not back on 1.1.0 (got '$(ver)')"
[ "$(vol_sh 'cat /d/marker2')" = written-after-1.1.0 ] && ok "data from before the failed update is intact" || no "data lost in rollback"
grep -q '"rolledBack":true' "$W/state/out/events.jsonl" && ok "event says it was rolled back" || no "no rollback event"
[ "$(jq -r .state "$W/state/out/status.json")" = failed ] && ok "status says failed (and undone)" || no "status not failed"
[ "$(sed -n 's/^ALICE_VERSION=//p' "$W/release.env")" = 1.1.0 ] && ok "release.env points back at 1.1.0" || no "release.env wrong"

echo "# a normal release found by the check is offered, not installed; the household approves it"
mkdir -p "$W/feed"; "$REL" bundle --key "$W/keys/release.key" --image alice-app:1.4.0 --version 1.4.0 --notes "Nicer things" --out "$W/b-1.4.0" >/dev/null
"$REL" publish --key "$W/keys/release.key" --image "127.0.0.1:5055/alice@sha256:$(printf 'c%.0s' {1..64})" --version 1.4.0 --notes "Nicer things" --out "$W/feed" >/dev/null
"$UP" check >/dev/null 2>&1
[ "$(ver)" = 1.1.0 ] && ok "check did not install a normal release" || no "check installed without approval"
[ "$(jq -r .version "$W/state/out/available.json" 2>/dev/null)" = 1.4.0 ] && ok "it is recorded as available (with notes)" || no "available.json missing"
echo '{"version":"6.6.6"}' > "$W/state/in/request.json"
refuse "a request for a release that wasn't verified is refused" "$UP" apply-request
[ ! -e "$W/state/in/request.json" ] && ok "the request is consumed either way" || no "request left behind"
[ "$(ver)" = 1.1.0 ] && ok "still 1.1.0" || no "changed"

echo "# registry install, pinned by digest (real local registry)"
docker run -d --name alicetest-registry -p 127.0.0.1:5055:5000 registry:2 >/dev/null 2>&1; sleep 3
docker tag alice-app:1.5.0 127.0.0.1:5055/alice:1.5.0 && docker push -q 127.0.0.1:5055/alice:1.5.0 >/dev/null 2>&1
DIGEST=$(docker image inspect --format '{{index .RepoDigests 0}}' 127.0.0.1:5055/alice:1.5.0 2>/dev/null)
docker rmi -f alice-app:1.5.0 127.0.0.1:5055/alice:1.5.0 >/dev/null 2>&1
rm -rf "$W/feed"; mkdir -p "$W/feed"; "$REL" publish --key "$W/keys/release.key" --image "$DIGEST" --version 1.5.0 --notes "Registry release" --out "$W/feed" >/dev/null
"$UP" check >/dev/null 2>&1
[ "$(jq -r .version "$W/state/out/available.json" 2>/dev/null)" = 1.5.0 ] && ok "registry release is offered" || no "registry release not offered"
echo '{"version":"1.5.0"}' > "$W/state/in/request.json"
check "the approved registry release installs (image pulled by digest)" "$UP" apply-request
[ "$(ver)" = 1.5.0 ] && ok "now running 1.5.0" || no "not on 1.5.0 (got '$(ver)')"
[ "$(vol_sh 'cat /d/marker')" = precious ] && ok "data still intact" || no "data lost"

echo "# an emergency release installs by itself, after telling the household"
derive 1.6.0 >/dev/null 2>&1; "$REL" bundle --key "$W/keys/release.key" --image alice-app:1.6.0 --version 1.6.0 --emergency --reason "Security fix" --out "$W/b-1.6.0" >/dev/null
rm -rf "$W/feed"; mkdir -p "$W/feed"; cp "$W/b-1.6.0/manifest.json"* "$W/feed/"
# a feed manifest names a bundle; the emergency path for bundles is on-site, so serve the same release as a registry image instead
docker tag alice-app:1.6.0 127.0.0.1:5055/alice:1.6.0 && docker push -q 127.0.0.1:5055/alice:1.6.0 >/dev/null 2>&1
D6=$(docker image inspect --format '{{index .RepoDigests 0}}' 127.0.0.1:5055/alice:1.6.0); docker rmi -f 127.0.0.1:5055/alice:1.6.0 alice-app:1.6.0 >/dev/null 2>&1
"$REL" publish --key "$W/keys/release.key" --image "$D6" --version 1.6.0 --emergency --reason "Security fix" --out "$W/feed" >/dev/null
t0=$(date +%s); "$UP" check >/dev/null 2>&1; t1=$(date +%s)
[ "$(ver)" = 1.6.0 ] && ok "emergency release installed with no approval" || no "emergency release not installed (got '$(ver)')"
[ $((t1 - t0)) -ge 3 ] && ok "it waited out the grace period so the notice could be delivered" || no "no grace period (${t0}->${t1})"
jq -e 'select(.type=="update_starting" and .emergency==true and .reason=="Security fix") | .startsAt' "$W/state/out/events.jsonl" >/dev/null && ok "a starting notice with the reason and start time was published first" || no "no emergency notice"
echo "$(events)" | grep -q "update_succeeded" && ok "and a success event after" || no "no success event"
docker rmi -f alice-app:1.6.0 >/dev/null 2>&1

echo; echo "passed: $pass   failed: $failn"; [ "$failn" -eq 0 ]
