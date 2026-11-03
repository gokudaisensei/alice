// Adds a "generic" camera that streams a video served over http inside the test container (HA only accepts network stream sources).
// Usage: bun camera.ts <base url> <dir with admin.tok> <stream url>        prints the new camera's entity id
const [BASE, DIR, STREAM] = [process.argv[2]!, process.argv[3]!, process.argv[4]!];
const H = { authorization: `Bearer ${(await Bun.file(`${DIR}/admin.tok`).text()).trim()}`, "content-type": "application/json" };
const post = async (p: string, b: unknown) => ((await (await fetch(BASE + p, { method: "POST", headers: H, body: JSON.stringify(b) })).json()) as Record<string, any>);
const before = new Set(((await (await fetch(BASE + "/api/states", { headers: H })).json()) as { entity_id: string }[]).map((e) => e.entity_id));
let r = await post("/api/config/config_entries/flow", { handler: "generic", show_advanced_options: false });
r = await post(`/api/config/config_entries/flow/${r.flow_id}`, { still_image_url: "", stream_source: STREAM, advanced: { rtsp_transport: "tcp", authentication: "basic", verify_ssl: true, framerate: 5 } });
if (r.step_id === "user_confirm") r = await post(`/api/config/config_entries/flow/${r.flow_id}`, { confirmed_ok: true });
if (r.type !== "create_entry") throw new Error("could not add the camera: " + JSON.stringify(r.errors ?? r));
await Bun.sleep(1500);
const after = ((await (await fetch(BASE + "/api/states", { headers: H })).json()) as { entity_id: string }[]).map((e) => e.entity_id).filter((id) => id.startsWith("camera.") && !before.has(id));
if (!after[0]) throw new Error("no new camera appeared");
console.log(after[0]);
