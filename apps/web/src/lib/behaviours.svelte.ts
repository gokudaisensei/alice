import { api, explain } from './api.js';
import { home } from './home.svelte.js';
import { session } from './session.svelte.js';
import { capitalize } from './utils.js';
import { sentences } from './fmt.js';
import { joinNames, stepsSentence, type Step } from './steps.js';
import { plainWords, type AutomationView, type Condition, type Template, type Trigger } from './automations.js';

export type Kind = 'scene' | 'routine' | 'automation';
const GONE = 'a device that is no longer available';

/** How ids become names, for sentences about scenes, routines and automations. */
export const words = {
	nameOf: (id: string) => home.byId(id)?.name ?? home.scenes.find((s) => s.id === id)?.name ?? GONE,
	unitOf: (id: string) => home.byId(id)?.reading?.unit ?? ''
};

/** What a scene does, in one line. */
const nameOrNull = (id: string) => home.byId(id)?.name ?? home.scenes.find((s) => s.id === id)?.name ?? null;
/** How many of a scene's devices no longer exist. */
export const goneIn = (deviceIds: string[]) => deviceIds.filter((id) => nameOrNull(id) === null).length;
export const sceneDoes = (deviceIds: string[]) => {
	const names = deviceIds.map(nameOrNull).filter((n): n is string => n !== null), gone = deviceIds.length - names.length;
	if (!deviceIds.length) return 'Sets the devices it was made with. Runs when you tap it.';
	if (!names.length) return `Its ${gone === 1 ? 'device is' : `${gone} devices are`} no longer available, so running it does nothing. Delete it or build it again.`;
	return `Sets ${joinNames(names)} the way they were saved${gone ? `; ${gone === 1 ? 'one other device is' : `${gone} others are`} no longer available` : ''}. Runs when you tap it.`;
};
/** What a routine does, in one line. */
export const routineDoes = (steps: { type: string }[]) => sentences(capitalize(stepsSentence(steps as Step[], words.nameOf)) || 'Has no steps yet', 'Runs when you tap it');
/** What an automation does and when, in one line. */
export const automationDoes = (a: { triggers: Trigger[]; conditions: Condition[]; actions: Step[] }) => plainWords(a.triggers, a.conditions, a.actions, words);

/** Scenes, routines and automations as one household's list of behaviours. Automations come from their own API. */
class Behaviours {
	automations = $state<AutomationView[]>([]);
	ideas = $state<Template[]>([]);
	loaded = $state(false);
	error = $state('');

	async load() {
		if (!session.can('automation.manage')) { this.automations = []; this.ideas = []; this.loaded = true; return; }
		const r = await api<{ automations: AutomationView[]; suggested: Template[] }>('GET', '/api/automations');
		if (r.ok) { this.automations = r.data.automations; this.ideas = r.data.suggested; this.error = ''; }
		else this.error = r.data?.message ?? explain(r.data?.error);
		this.loaded = true;
	}

	/** Other behaviours that already use this name, each with what it does, so two "Good Morning"s are never confused. */
	sameName(name: string, self?: { kind: Kind; id: string }): { kind: Kind; does: string }[] {
		const n = name.trim().toLowerCase();
		if (!n) return [];
		const out: { kind: Kind; does: string }[] = [];
		for (const s of home.scenes) if (s.name.trim().toLowerCase() === n && !(self?.kind === 'scene' && self.id === s.id)) out.push({ kind: 'scene', does: sceneDoes(s.deviceIds) });
		for (const r of home.routines) if (r.name.trim().toLowerCase() === n && !(self?.kind === 'routine' && self.id === r.id)) out.push({ kind: 'routine', does: routineDoes(r.steps) });
		for (const a of this.automations) if (a.name.trim().toLowerCase() === n && !(self?.kind === 'automation' && self.id === a.id)) out.push({ kind: 'automation', does: automationDoes(a) });
		return out;
	}
}
export const behaviours = new Behaviours();
