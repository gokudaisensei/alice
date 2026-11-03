// Shapes the server sends that more than one screen reads. Each mirrors what the matching route in apps/server returns.

/** A support session the household has allowed. */
export type Support = { id: string; scopes: string[]; expiresAt: number; connected: boolean; operatorName: string | null };

/** The state of the host updater. Without an updater on this device, only `current` is known. */
export type UpdateStatus =
	| { configured: false; current: string }
	| {
			configured: true; current: string; state: string; message: string;
			available: { version: string; notes: string; created: string } | null;
			lastCheckAt: number | null; refusedRecently: boolean;
	  };

/** One line of the health page. */
export type Check = { id: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string; advice?: string };
export type Facts = { version: string; uptimeSeconds: number; memoryMb: number; dbBytes: number; schema: number; pushDevices: number };
/** The home's health, as the household sees it and as a support operator is shown it. */
export type Health = { overall: 'ok' | 'warn' | 'fail'; checks: Check[]; facts: Facts };
