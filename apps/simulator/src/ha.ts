// Talks to Home Assistant over its REST API: read everything, write helpers, call services.
import type { HaAttrs, HaState, Out } from "./world";

export function createHa(url: string, token: string) {
	const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
	const post = (path: string, body: unknown) => fetch(url + path, { method: "POST", headers: H, body: JSON.stringify(body) }).then((r) => r.text()).catch(() => "");
	const states = new Map<string, HaState>();
	let queue: Promise<unknown>[] = [];
	const out: Out = {
		number: (helper, v) => void queue.push(post("/api/services/input_number/set_value", { entity_id: `input_number.${helper}`, value: v })),
		bool: (helper, on) => void queue.push(post(`/api/services/input_boolean/turn_${on ? "on" : "off"}`, { entity_id: `input_boolean.${helper}` })),
		call: (domain, service, entity, data = {}) => void queue.push(post(`/api/services/${domain}/${service}`, { entity_id: entity, ...data })),
	};
	return {
		states, out,
		view: (id: string) => states.get(id),
		async refresh() {
			const r = await fetch(url + "/api/states", { headers: H });
			if (!r.ok) throw new Error(`Home Assistant said ${r.status}`);
			for (const s of (await r.json()) as { entity_id: string; state: string; attributes?: HaAttrs }[]) states.set(s.entity_id, { state: s.state, attrs: s.attributes ?? {} });
		},
		/** Send everything the last step asked for. */
		async flush() { const q = queue; queue = []; await Promise.all(q); },
		call: (domain: string, service: string, entity: string, data: HaAttrs = {}) => post(`/api/services/${domain}/${service}`, { entity_id: entity, ...data }),
	};
}
