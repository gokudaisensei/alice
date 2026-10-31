#!/usr/bin/env bash
# Real-network test: a container on an internal-only network has NO internet route, and can reach only the allow-listed
# push hosts, through the proxy. Needs docker and outbound internet from this machine.
set -uo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; N=alicetest_int; P=alicetest_pub; IMG=oven/bun:1-slim
pass=0; failn=0; ok() { pass=$((pass+1)); echo "ok   - $1"; }; no() { failn=$((failn+1)); echo "FAIL - $1"; }
cleanup() { docker rm -f alicetest-egress >/dev/null 2>&1; docker network rm $N $P >/dev/null 2>&1; }; trap cleanup EXIT; cleanup
docker network create --internal $N >/dev/null; docker network create $P >/dev/null
docker run -d --name alicetest-egress --network $N --network-alias egress -v "$D/proxy.ts:/egress/proxy.ts:ro" $IMG bun /egress/proxy.ts >/dev/null
docker network connect $P alicetest-egress; sleep 2
probe() { docker run --rm --network $N -e "T=$1" $IMG bun -e "$2" 2>&1; }
CONNECT='const net=require("net");const [h,p]=process.env.T.split(":");const s=net.connect(3128,"egress",()=>s.write(`CONNECT ${h}:${p} HTTP/1.1\r\nHost: ${h}:${p}\r\n\r\n`));s.once("data",d=>{console.log(String(d).split("\r\n")[0]);s.destroy()});s.on("error",e=>console.log("ERR "+e.code));setTimeout(()=>{console.log("TIMEOUT");process.exit()},8000)'
r=$(probe x 'try{await fetch("https://example.com",{signal:AbortSignal.timeout(6000)});console.log("REACHED")}catch(e){console.log("NO ROUTE")}'); [ "$r" = "NO ROUTE" ] && ok "app side has no direct internet (example.com)" || no "direct internet reachable: $r"
r=$(probe x 'try{await fetch("https://1.1.1.1",{signal:AbortSignal.timeout(6000)});console.log("REACHED")}catch(e){console.log("NO ROUTE")}'); [ "$r" = "NO ROUTE" ] && ok "app side has no direct internet (1.1.1.1)" || no "direct IP reachable: $r"
r=$(probe fcm.googleapis.com:443 "$CONNECT"); [[ "$r" == *"200"* ]] && ok "the push host is reachable through the proxy" || no "push host not reachable via proxy: $r"
r=$(probe updates.push.services.mozilla.com:443 "$CONNECT"); [[ "$r" == *"200"* ]] && ok "a suffix-listed push host is reachable" || no "mozilla push not reachable: $r"
r=$(probe example.com:443 "$CONNECT"); [[ "$r" == *"403"* ]] && ok "any other host is refused" || no "example.com not refused: $r"
r=$(probe fcm.googleapis.com:8123 "$CONNECT"); [[ "$r" == *"403"* ]] && ok "a listed host on another port is refused" || no "port not refused: $r"
r=$(probe 127.0.0.1:443 "$CONNECT"); [[ "$r" == *"403"* ]] && ok "an IP literal is refused" || no "IP literal not refused: $r"
r=$(probe 192.168.1.1:443 "$CONNECT"); [[ "$r" == *"403"* ]] && ok "a private address is refused" || no "private address not refused: $r"
r=$(probe x 'const s=require("net").connect(3128,"egress",()=>s.write("GET http://fcm.googleapis.com/ HTTP/1.1\r\nHost: fcm.googleapis.com\r\n\r\n"));s.once("data",d=>{console.log(String(d).split("\r\n")[0]);s.destroy()});setTimeout(()=>process.exit(),5000)'); [[ "$r" == *"405"* ]] && ok "plain HTTP through the proxy is refused" || no "plain HTTP not refused: $r"
# a real push-service round trip through the proxy: an invalid subscription must be answered BY the push service (an HTTP error), not fail on the network
cat > /tmp/egress-push.ts <<'TS'
import webpush from "web-push";
const k = webpush.generateVAPIDKeys();
try { await webpush.sendNotification({ endpoint: "https://fcm.googleapis.com/fcm/send/invalid-test", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } }, "x", { proxy: "http://egress:3128", vapidDetails: { subject: "mailto:t@example.com", publicKey: k.publicKey, privateKey: k.privateKey }, timeout: 15000 }); console.log("SENT"); }
catch (e: any) { console.log(e?.statusCode ? "ANSWERED_BY_PUSH_SERVICE " + e.statusCode : "NETWORK_FAILURE " + (e?.code ?? e?.message)); }
TS
ROOT="$(cd "$D/../.." && pwd)"; cp /tmp/egress-push.ts "$ROOT/apps/server/.egress-probe.ts"
r=$(docker run --rm --network $N -v "$ROOT:/repo:ro" -w /repo/apps/server $IMG bun .egress-probe.ts 2>&1 | tail -1); rm -f "$ROOT/apps/server/.egress-probe.ts"
 [[ "$r" == ANSWERED_BY_PUSH_SERVICE* ]] && ok "web-push reaches the real push service through the proxy ($r)" || no "web-push through proxy: $r"
docker logs alicetest-egress 2>&1 | grep -q DENY && ok "the proxy logged what it refused" || no "no deny log"
echo; echo "passed: $pass   failed: $failn"; [ "$failn" -eq 0 ]
