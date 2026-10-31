// The app's only way out to the internet. The app sits on internal-only networks with no route outward; this tiny
// CONNECT proxy is on both sides and will tunnel to a short list of push-service hosts on port 443, and nothing else.
// No plain HTTP, no other ports, no IP literals, and no host that resolves to a private address (DNS-rebinding guard).
import { createServer, connect } from "node:net";
import { lookup } from "node:dns/promises";

const ALLOW = (process.env.EGRESS_ALLOW ?? "fcm.googleapis.com,.push.services.mozilla.com,.push.apple.com,.notify.windows.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const PORT = Number(process.env.EGRESS_PORT ?? 3128);
const allowed = (h: string) => ALLOW.some((a) => (a.startsWith(".") ? h.endsWith(a) : h === a));
const isPrivate = (ip: string) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|fc|fd|fe80)/i.test(ip) || ip === "::";
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

createServer((client) => {
  client.setTimeout(30_000);
  client.once("data", async (buf) => {
    const head = buf.toString("latin1"), m = /^CONNECT ([^\s:]+):(\d+) HTTP\/1\.[01]\r\n/.exec(head);
    const deny = (code: string, why: string) => { log(`DENY ${why}`); client.end(`HTTP/1.1 ${code}\r\nConnection: close\r\n\r\n`); };
    if (!m) return deny("405 Method Not Allowed", "not CONNECT");
    const host = m[1].toLowerCase(), port = Number(m[2]);
    if (port !== 443) return deny("403 Forbidden", `${host}:${port} port`);
    if (!allowed(host)) return deny("403 Forbidden", `${host} not on the list`);
    let ip: string;
    try { ip = (await lookup(host)).address; } catch { return deny("502 Bad Gateway", `${host} does not resolve`); }
    if (isPrivate(ip)) return deny("403 Forbidden", `${host} resolves to a private address`);
    const up = connect({ host: ip, port: 443 });
    up.once("connect", () => { log(`ALLOW ${host}`); client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); const rest = buf.subarray(buf.indexOf("\r\n\r\n") + 4); if (rest.length) up.write(rest); client.pipe(up); up.pipe(client); });
    up.on("error", () => client.destroy()); client.on("error", () => up.destroy()); client.on("close", () => up.destroy()); up.on("close", () => client.destroy());
  });
  client.on("timeout", () => client.destroy());
}).listen(PORT, () => log(`egress proxy on :${PORT}, allowing ${ALLOW.join(" ")}`));
