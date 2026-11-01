import type { Device } from './home.svelte.js';
/** Climate, cameras and media get a wide tile; everything else is a square one. Every tile fills its grid cell, so rows stay even. */
export const isWide = (d: Device) => ['climate', 'camera', 'media'].includes(d.category);
export const tileClass = (d: Device) => `cv-auto h-full ${isWide(d) ? 'col-span-2' : ''}`;
