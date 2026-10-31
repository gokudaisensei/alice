export type Me = { id: string; displayName: string; role: 'admin' | 'member' | 'guest'; permissions: string[] };

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
	const res = await fetch(path, {
		method,
		headers: { 'content-type': 'application/json', 'x-requested-with': 'alice' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	let data: any = null;
	try { data = await res.json(); } catch {}
	return { ok: res.ok, status: res.status, data };
}

const messages: Record<string, string> = {
	invalid_or_expired_code: 'That code is invalid or has expired.',
	passkey_rejected: 'Your passkey could not be verified. Please try again.',
	login_failed: 'Sign-in failed. Please try again.',
	rate_limited: 'Too many attempts. Please wait a few minutes.',
	forbidden: "You don't have permission to do that.",
	reauth_required: 'Please confirm it is you with your passkey.'
};
export const explain = (code?: string) => messages[code ?? ''] ?? 'Something went wrong. Please try again.';

import { startAuthentication } from '@simplewebauthn/browser';

/** Confirm identity with a passkey (needed for sensitive actions such as unlocking a door). */
export async function reauth(): Promise<boolean> {
	try {
		const o = await api('POST', '/api/auth/reauth/options');
		if (!o.ok) return false;
		const response = await startAuthentication({ optionsJSON: o.data.options });
		return (await api('POST', '/api/auth/reauth/verify', { challengeId: o.data.challengeId, response })).ok;
	} catch {
		return false;
	}
}

/** For actions that need a fresh passkey check: on "reauth_required", ask once and retry. */
export async function sensitive<T = any>(method: string, path: string, body?: unknown) {
	let r = await api<T>(method, path, body);
	if (!r.ok && (r.data as any)?.error === 'reauth_required' && (await reauth())) r = await api<T>(method, path, body);
	return r;
}
