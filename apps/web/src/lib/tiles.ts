import type { Device } from './home.svelte.js';
/** Climate, cameras and media get a wide tile; everything else is a square one. */
export const isWide = (d: Device) => ['climate', 'camera', 'media'].includes(d.category);
export const tileClass = (d: Device) => (isWide(d) ? 'col-span-2 sm:col-span-1' : '');
