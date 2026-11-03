import { say } from "./messages";

/** The only part of Elysia's `set` that the route helpers touch. */
export type StatusSetter = { status?: number | string };

/** A route failure as the client sees it: a stable `error` code, plus a friendly `message` when asked. */
export type ErrorBody = { error: string; message?: string };

/** Set the status and return `{ error }`. */
export function deny(set: StatusSetter, status: number, error: string): { error: string } {
  set.status = status;
  return { error };
}

/** Like {@link deny}, with the household-friendly text from `messages.ts` and optional extra fields. */
export function denyWith<Extra extends object = {}>(set: StatusSetter, status: number, error: string, extra?: Extra): { error: string; message: string } & Extra {
  set.status = status;
  return { error, message: say(error), ...extra } as { error: string; message: string } & Extra;
}

/** Request bodies are untrusted: `unknown` until narrowed. Anything that isn't a plain object reads as empty. */
export type JsonObject = Record<string, unknown>;
export function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : {};
}

/** The string behind `value`, or `fallback` for anything that isn't one. */
export const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

/** `String(value ?? "")`: the lenient coercion used for user-typed names. */
export const text = (value: unknown): string => String(value ?? "");

/** A finite number, or null. */
export const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Narrow `value` to one of `allowed` (usable with `as const` tuples). */
export const oneOf = <const T extends readonly string[]>(allowed: T, value: unknown): value is T[number] =>
  typeof value === "string" && (allowed as readonly string[]).includes(value);

/** A person-entered name: trimmed, 1 to 60 characters, or null. */
export const cleanName = (value: unknown): string | null => {
  const s = text(value).trim();
  return s && s.length <= 60 ? s : null;
};

/** `value` as a list of unknowns, or null when it isn't an array. (`Array.isArray` alone would give `any[]`.) */
export const asList = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

/** An operation that did not happen: the HTTP status to answer with, and why. */
export type Failure = { status: number; error: string };
