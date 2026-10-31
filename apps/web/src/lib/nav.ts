import { Activity, Bell, House, LayoutGrid, Mic, Plug, Settings, Sparkles, UserRound, Users, Workflow, Wrench, Zap } from '@lucide/svelte';

export type NavItem = { href: string; label: string; icon: typeof House; show?: boolean; badge?: number; keywords?: string; match?: string[] };

/** The five places you can be. Everything else is one tap inside one of them. */
export function tabs(): NavItem[] {
	return [
		{ href: '/', label: 'Home', icon: House },
		{ href: '/rooms', label: 'Rooms', icon: LayoutGrid },
		{ href: '/routines', label: 'Routines', icon: Sparkles, match: ['/scenes', '/automations'] },
		{ href: '/activity', label: 'Activity', icon: Bell, match: ['/notifications', '/energy'] },
		{ href: '/you', label: 'You', icon: UserRound, match: ['/settings', '/admin'] }
	];
}

export function manageNav(can: (p: string) => boolean): NavItem[] {
	return [
		{ href: '/admin/rooms', label: 'Rooms & devices', icon: Wrench, show: can('admin.access') && can('rooms.manage') },
		{ href: '/admin/users', label: 'People', icon: Users, show: can('admin.access') && can('users.manage') },
		{ href: '/admin/voice', label: 'Voice control', icon: Mic, show: can('admin.access') },
		{ href: '/admin/system', label: 'System', icon: Activity, show: can('admin.access'), keywords: 'health backups updates support' }
	].filter((n) => n.show);
}

/** Everything the search can jump to. */
export function allPages(can: (p: string) => boolean, hasEnergy: boolean): NavItem[] {
	return [
		...tabs(),
		{ href: '/devices', label: 'All devices', icon: Plug },
		{ href: '/routines?tab=scenes', label: 'Scenes', icon: Sparkles },
		{ href: '/routines?tab=automations', label: 'Automations', icon: Workflow, show: can('automation.manage') },
		{ href: '/activity?tab=energy', label: 'Energy', icon: Zap, show: hasEnergy },
		{ href: '/settings', label: 'Appearance and home screen', icon: Settings },
		{ href: '/settings/notifications', label: 'Notification settings', icon: Bell },
		...manageNav(can)
	].filter((n) => n.show !== false);
}
