<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { session } from '#lib/session.svelte.js';
	import { api } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { notifications } from '#lib/notifications.svelte.js';
	import Notice from '#lib/components/app/Notice.svelte';
	import HubBanner from '#lib/components/app/HubBanner.svelte';
	import SupportBanner from '#lib/components/app/SupportBanner.svelte';
	import UpdateBanner from '#lib/components/app/UpdateBanner.svelte';
	import { Button } from '#lib/components/ui/button';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	const publicPaths = ['/login', '/setup'];

	onMount(async () => {
		await session.refresh();
		if (!session.me && !publicPaths.includes(page.url.pathname) && !page.url.pathname.startsWith('/ops')) goto('/login');
	});

	// Live updates only while signed in; everything is torn down on sign-out.
	$effect(() => {
		if (session.me) { home.load(); home.connect(); notifications.start(); } else { home.disconnect(); notifications.stop(); }
	});

	// Light/dark: the user's own choice, defaulting to the device setting.
	$effect(() => {
		const pref = home.prefs?.appearance ?? 'system';
		const mq = matchMedia('(prefers-color-scheme: dark)');
		const apply = () => document.documentElement.classList.toggle('dark', pref === 'dark' || (pref === 'system' && mq.matches));
		apply();
		mq.addEventListener('change', apply);
		return () => mq.removeEventListener('change', apply);
	});

	const nav = $derived([
		{ href: '/', label: 'Home' },
		{ href: '/rooms', label: 'Rooms' },
		{ href: '/devices', label: 'Devices' },
		{ href: '/scenes', label: 'Scenes' },
		...(session.can('automation.manage') ? [{ href: '/automations', label: 'Automations' }] : []),
		...(home.devices.some((d) => d.category === 'energy') ? [{ href: '/energy', label: 'Energy' }] : []),
		{ href: '/notifications', label: 'Alerts', badge: notifications.unread },
		{ href: '/settings', label: 'Settings' }
	]);
	const adminNav = $derived([
		{ href: '/admin/rooms', label: 'Rooms & devices', show: session.can('admin.access') && session.can('rooms.manage') },
		{ href: '/admin/users', label: 'People', show: session.can('admin.access') && session.can('users.manage') },
		{ href: '/admin/voice', label: 'Voice', show: session.can('admin.access') },
		{ href: '/admin/system', label: 'System', show: session.can('admin.access') }
	].filter((n) => n.show));
	const here = (href: string) => (href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href));

	async function logout() {
		await api('POST', '/api/auth/logout');
		session.me = null;
		goto('/login');
	}
</script>

<svelte:head><link rel="icon" href={favicon} /><title>Home</title></svelte:head>

{#if page.url.pathname.startsWith('/ops')}
	{@render children()}
{:else if session.me}
	<div class="min-h-dvh md:grid md:grid-cols-[14rem_1fr]">
		<aside class="hidden border-r p-4 md:flex md:flex-col md:gap-1">
			<p class="mb-4 font-semibold">My Home</p>
			{#each nav as n}
				<Button variant={here(n.href) ? 'secondary' : 'ghost'} href={n.href} class="justify-start">{n.label}{#if n.badge}<span class="ml-auto rounded-full bg-primary px-1.5 text-xs text-primary-foreground" aria-label="{n.badge} unread">{n.badge}</span>{/if}</Button>
			{/each}
			{#if adminNav.length}
				<p class="mt-4 px-3 text-xs font-medium uppercase text-muted-foreground">Manage</p>
				{#each adminNav as n}
					<Button variant={here(n.href) ? 'secondary' : 'ghost'} href={n.href} class="justify-start">{n.label}</Button>
				{/each}
			{/if}
			<Button variant="ghost" class="mt-auto justify-start" onclick={logout}>Sign out</Button>
		</aside>
		<div class="pb-20 md:pb-0"><HubBanner /><SupportBanner /><UpdateBanner />{@render children()}</div>
		<nav class="fixed inset-x-0 bottom-0 flex gap-1 overflow-x-auto border-t bg-background p-2 md:hidden [&>*]:shrink-0 [&>*]:flex-1" aria-label="Main">
			{#each nav as n}
				<Button variant={here(n.href) ? 'secondary' : 'ghost'} href={n.href}>{n.label}{#if n.badge}<span class="ml-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground" aria-label="{n.badge} unread">{n.badge}</span>{/if}</Button>
			{/each}
		</nav>
		<Notice />
	</div>
{:else if session.loaded || publicPaths.includes(page.url.pathname)}
	{@render children()}
{/if}
