export type Me = { id: string; displayName: string; role: 'admin' | 'member' | 'guest'; permissions: string[] };

/** What the server says when it refuses: a stable `error` code, usually a friendly `message`, and sometimes where in the request it went wrong. */
export type ApiError = {
	error?: string; message?: string;
	/** For the automation and routine builders: which part of the request was wrong. */
	where?: string; index?: number; step?: number;
};
/** A response is either the data you asked for (`ok`) or an {@link ApiError}. Check `ok` and TypeScript narrows `data` for you. */
export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; data: ApiError };

const asError = (body: unknown): ApiError => (typeof body === 'object' && body !== null ? (body as ApiError) : {});

/** `T` is the shape of a successful response. It is the caller's claim about the endpoint, so state it where the endpoint is called. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
	const res = await fetch(path, {
		method,
		headers: { 'content-type': 'application/json', 'x-requested-with': 'alice' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	let data: unknown = null;
	try { data = await res.json(); } catch { /* an empty or non-JSON body */ }
	return res.ok ? { ok: true, status: res.status, data: data as T } : { ok: false, status: res.status, data: asError(data) };
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

/**
 * What to tell a person when a passkey step failed. A flow throws the server's error code (a string) when the server refused;
 * the browser throws a `NotAllowedError` when the person dismissed the prompt.
 */
export function passkeyFailure(e: unknown, cancelled: string): string {
	if (typeof e === 'string') return explain(e);
	if (typeof e === 'object' && e !== null && 'name' in e && e.name === 'NotAllowedError') return cancelled;
	return explain();
}

import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

/** Confirm identity with a passkey (needed for sensitive actions such as unlocking a door). */
export async function reauth(): Promise<boolean> {
	try {
		const o = await api<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>('POST', '/api/auth/reauth/options');
		if (!o.ok) return false;
		const response = await startAuthentication({ optionsJSON: o.data.options });
		return (await api('POST', '/api/auth/reauth/verify', { challengeId: o.data.challengeId, response })).ok;
	} catch {
		return false;
	}
}

/** For actions that need a fresh passkey check: on "reauth_required", ask once and retry. */
export async function sensitive<T = unknown>(method: string, path: string, body?: unknown) {
	let r = await api<T>(method, path, body);
	if (!r.ok && r.data.error === 'reauth_required' && (await reauth())) r = await api<T>(method, path, body);
	return r;
}
