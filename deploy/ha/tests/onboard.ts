// Gives a brand-new Home Assistant container an administrator and a second user who is NOT one, and writes a long-lived key for each.
// Usage: bun onboard.ts <base url> <output dir>      (test containers only: the passwords are fixed and public)
const [BASE, OUT] = [process.argv[2]!, process.argv[3]!], CLIENT = BASE + "/", WS = BASE.replace(/^http/, "ws") + "/api/websocket";
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const token = async (code: string) => ((await (await fetch(BASE + "/auth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "authorization_code", code, client_id: CLIENT }) })).json()) as { access_token: string }).access_token;
type Conn = { ask: (m: Record<string, unknown>) => Promise<any>; close: () => void };
const conn = (tok: string) => new Promise<Conn>((res) => {
  const ws = new WebSocket(WS); let id = 1; const w = new Map<number, (m: any) => void>();
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: tok })); else if (m.type === "auth_ok") res({ close: () => ws.close(), ask: (msg) => new Promise((r) => { const i = id++; w.set(i, r); ws.send(JSON.stringify({ id: i, ...msg })); }) }); else if (m.id) w.get(m.id)?.(m); };
});
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ob = await fetch(BASE + "/api/onboarding/users", json({ client_id: CLIENT, name: "Admin", username: "admin", password: "test-admin-pass-1", language: "en" }));
const a = await conn(await token(((await ob.json()) as { auth_code: string }).auth_code));
const admin = (await a.ask({ type: "auth/long_lived_access_token", client_name: "test-admin", lifespan: 2 })).result as string;
const uid = (await a.ask({ type: "config/auth/create", name: "Alice app", group_ids: ["system-users"] })).result.user.id as string;
await a.ask({ type: "config/auth_provider/homeassistant/create", user_id: uid, username: "aliceapp", password: "test-app-pass-1" });
const flow = (await (await fetch(BASE + "/auth/login_flow", json({ client_id: CLIENT, handler: ["homeassistant", null], redirect_uri: CLIENT }))).json()) as { flow_id: string };
const done = (await (await fetch(`${BASE}/auth/login_flow/${flow.flow_id}`, json({ client_id: CLIENT, username: "aliceapp", password: "test-app-pass-1" }))).json()) as { result: string };
const u = await conn(await token(done.result));
const app = (await u.ask({ type: "auth/long_lived_access_token", client_name: "test-app", lifespan: 2 })).result as string;
if ((await u.ask({ type: "auth/current_user" })).result.is_admin) throw new Error("the second user is an administrator");
await Bun.write(`${OUT}/admin.tok`, admin, { mode: 0o600 }); await Bun.write(`${OUT}/app.tok`, app, { mode: 0o600 });
a.close(); u.close(); process.exit(0);
