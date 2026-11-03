import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

/** "kitchen" becomes "Kitchen". */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The one item of a list that has exactly one, otherwise undefined: for "Front door is unlocked" versus "3 doors are unlocked". */
export const only = <T>(xs: readonly T[]): T | undefined => (xs.length === 1 ? xs[0] : undefined);
