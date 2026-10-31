#!/usr/bin/env bash
# Brings up the real deployment topology (app + egress proxy, internal-only networks) next to a REAL Home Assistant
# container and checks what the design promises: the app reaches Home Assistant over the private network, has no route
# of its own to the internet, and can reach a push service only through the allow-listing proxy.
#   deploy/test-topology.sh <ha-container-name> <path-to-ha-token-file>
set -uo pipefail
HA="${1:?ha container name}"; TOKEN="${2:?token file}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; C="$ROOT/deploy/docker-compose.yml"; P=alicetopo
pass=0; failn=0; ok() { pass=$((pass+1)); echo "ok   - $1"; }; no() { failn=$((failn+1)); echo "FAIL - $1"; }
cp -p "$ROOT/deploy/secrets/ha_token" "$ROOT/deploy/secrets/ha_token.bak" 2>/dev/null
cleanup() {
  docker compose -p $P -f "$C" down -v >/dev/null 2>&1; docker network disconnect ha_private "$HA" >/dev/null 2>&1; docker network rm ha_private >/dev/null 2>&1
  [ -f "$ROOT/deploy/secrets/ha_token.bak" ] && mv -f "$ROOT/deploy/secrets/ha_token.bak" "$ROOT/deploy/secrets/ha_token"; rm -rf "$ROOT/deploy/updates" "$ROOT/deploy/backups"; }
trap cleanup EXIT
cp "$TOKEN" "$ROOT/deploy/secrets/ha_token"
docker network create --internal ha_private >/dev/null; docker network connect --alias homeassistant ha_private "$HA"
mkdir -p "$ROOT/deploy/updates/out" "$ROOT/deploy/updates/in" "$ROOT/deploy/backups"; chmod 1777 "$ROOT/deploy/updates/in" "$ROOT/deploy/backups"
ALICE_IMAGE=alice-app:topo docker compose -p $P -f "$C" build app >/dev/null 2>&1 || { echo "build failed"; exit 1; }
ALICE_IMAGE=alice-app:topo HA_URL=http://homeassistant:8123 ORIGIN=http://localhost docker compose -p $P -f "$C" up -d app egress >/dev/null 2>&1
for i in $(seq 1 40); do [ "$(docker inspect -f '{{.State.Health.Status}}' $(docker compose -p $P -f "$C" ps -q app) 2>/dev/null)" = healthy ] && break; sleep 2; done
APP=$(docker compose -p $P -f "$C" ps -q app)
exec_app() { docker exec -i "$APP" bun -e "$1" 2>&1 | tail -1; }
r=$(exec_app 'for(let i=0;i<30;i++){const r=await (await fetch("http://127.0.0.1:3000/api/health")).json();if(r.homeAssistant==="ok"){console.log("ok");process.exit()}await Bun.sleep(1000)}console.log("not connected")'); [ "$r" = ok ] && ok "the app reaches Home Assistant over the private network" || no "app did not connect to HA: $r"
r=$(exec_app 'try{await fetch("https://example.com",{signal:AbortSignal.timeout(6000)});console.log("REACHED")}catch{console.log("NO ROUTE")}'); [ "$r" = "NO ROUTE" ] && ok "the app container has no route to the internet" || no "app reached the internet: $r"
r=$(exec_app 'try{await fetch("http://homeassistant:8123/api/",{signal:AbortSignal.timeout(5000)});console.log("HA REACHABLE")}catch{console.log("no")}'); [ "$r" = "HA REACHABLE" ] && ok "Home Assistant answers on the private network" || no "HA not reachable: $r"
r=$(docker run --rm --network "${P}_edge" oven/bun:1-slim bun -e 'try{await fetch("http://homeassistant:8123",{signal:AbortSignal.timeout(4000)});console.log("REACHED")}catch{console.log("NO")}' 2>&1 | tail -1); [ "$r" = NO ] && ok "something on the public-facing network (where Caddy sits) cannot reach Home Assistant" || no "HA reachable from the edge network: $r"
r=$(exec_app 'const webpush=require("web-push");const k=webpush.generateVAPIDKeys();try{await webpush.sendNotification({endpoint:"https://fcm.googleapis.com/fcm/send/invalid-test",keys:{p256dh:"BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",auth:"tBHItJI5svbpez7KI4CCXg"}},"x",{proxy:process.env.EGRESS_PROXY,vapidDetails:{subject:"mailto:t@example.com",publicKey:k.publicKey,privateKey:k.privateKey},timeout:15000});console.log("SENT")}catch(e){console.log(e?.statusCode?"ANSWERED "+e.statusCode:"NETWORK_FAILURE "+(e?.code??e?.message))}'); [[ "$r" == ANSWERED* ]] && ok "from inside the app, a push reaches the real push service via the proxy ($r)" || no "push from the app container: $r"
r=$(docker exec "$APP" sh -c 'touch /app/x 2>&1; echo $?' | tail -1); [ "$r" != 0 ] && ok "the app's filesystem is read-only" || no "app filesystem is writable"
[ "$(docker exec "$APP" id -u)" != 0 ] && ok "the app does not run as root" || no "app runs as root"
echo; echo "passed: $pass   failed: $failn"; [ "$failn" -eq 0 ]
