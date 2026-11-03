<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import { session } from '#lib/session.svelte.js';
	import { home } from '#lib/home.svelte.js';
	import { chrome } from '#lib/chrome.svelte.js';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { dur } from '#lib/motion.js';
	import { notifications } from '#lib/notifications.svelte.js';
	import { tabs, manageNav, type NavItem } from '#lib/nav.js';
	import Notice from '#lib/components/app/Notice.svelte';
	import HubBanner from '#lib/components/app/HubBanner.svelte';
	import SupportBanner from '#lib/components/app/SupportBanner.svelte';
	import UpdateBanner from '#lib/components/app/UpdateBanner.svelte';
	import CommandPalette from '#lib/components/app/CommandPalette.svelte';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu';
	import { Button } from '#lib/components/ui/button';
	import { ArrowDown, ChevronLeft, Loader2, LogOut, Moon, Search, Settings, Sun, SunMoon } from '@lucide/svelte';
	import SelectBar from '#lib/components/app/SelectBar.svelte';
	import { ui } from '#lib/ui.svelte.js';
	import { install } from '#lib/install.svelte.js';
	import { pull, edge, pullToRefresh, edgeBack } from '#lib/gestures.svelte.js';
	import { startShake, stopShake } from '#lib/shake.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	const publicPaths = ['/login', '/setup'];

	// Show last time's home at once (kept only on this device), then confirm with the server.
	session.restore(); if (session.me) home.restore();
	onMount(async () => {
		if (session.me || home.loaded) document.getElementById('boot')?.remove();
		if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
		// Signed-in pages ask for the home directly (it carries who you are); only public pages need the separate check.
		if (publicPaths.includes(page.url.pathname) || page.url.pathname.startsWith('/ops')) await session.refresh(); else await home.load();
		session.loaded = true;
		document.getElementById('boot')?.remove();
		if (!session.me && !publicPaths.includes(page.url.pathname) && !page.url.pathname.startsWith('/ops')) goto('/login');
	});
	onMount(() => install.start());
	// Phone gestures: pull down to refresh, swipe in from the left edge to go back (installed app only), shake to undo.
	onMount(() => {
		if (!matchMedia('(pointer: coarse)').matches) return;
		const stops = [pullToRefresh(() => home.load()), edgeBack(() => page.url.pathname !== '/')];
		return () => stops.forEach((f) => f());
	});
	const signedIn = $derived(!!session.me);
	$effect(() => { if (signedIn && ui.shake) startShake(); else stopShake(); }); // not the object itself: refreshing it must not restart everything
	$effect(() => { if (signedIn) { untrack(() => { home.load().then(() => { home.connect(); notifications.start(); }); }); } else { untrack(() => { home.disconnect(); notifications.stop(); }); } });

	// Light/dark: the person's own choice, defaulting to the device setting.
	$effect(() => {
		const pref = home.prefs?.appearance ?? 'system';
		const mq = matchMedia('(prefers-color-scheme: dark)');
		const apply = () => { const dark = pref === 'dark' || (pref === 'system' && mq.matches); document.documentElement.classList.toggle('dark', dark); document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove()); const meta = document.createElement('meta'); meta.name = 'theme-color'; meta.content = dark ? '#080b16' : '#edf0f8'; document.head.append(meta); };
		apply(); mq.addEventListener('change', apply);
		return () => mq.removeEventListener('change', apply);
	});

	// Switching tabs replaces the history entry instead of stacking one, so Back leaves a tab rather than walking through every tab you touched.
	// Each tab also remembers where you had scrolled to and which sub-tab (Scenes, Energy…) you were on.
	const scrolls = new Map<string, number>();
	let subtabs = $state<Record<string, string>>({});
	try { subtabs = JSON.parse(sessionStorage.getItem('subtabs:v1') ?? '{}'); } catch {}
	const here_ = (u: URL) => u.pathname + u.search;
	beforeNavigate(({ from }) => { if (from) scrolls.set(here_(from.url), window.scrollY); });
	afterNavigate(({ to, type }) => {
		if (!to) return;
		const sub = to.url.searchParams.get('tab');
		if (sub && subtabs[to.url.pathname] !== sub) { subtabs[to.url.pathname] = sub; try { sessionStorage.setItem('subtabs:v1', JSON.stringify(subtabs)); } catch {} }
		const y = scrolls.get(here_(to.url));
		if (y !== undefined && (type === 'goto' || type === 'link')) for (const ms of [0, 80, 320]) setTimeout(() => window.scrollTo(0, y), ms);
	});
	const target = (n: NavItem) => (subtabs[n.href] ? `${n.href}?tab=${subtabs[n.href]}` : n.href);
	function go(e: MouseEvent, n: NavItem) {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault(); const fresh = !here(n); pending = n.href; goto(target(n), { replaceState: fresh }).finally(() => { pending = null; });
	}
	const tabRoot = $derived(tabs().some((t) => t.href === path));
	// The tab you tapped lights up at once, even if the page behind it is slow to arrive.
	let pending = $state<string | null>(null);
	afterNavigate(() => { pending = null; });

	const nav = $derived(tabs().map((n) => (n.href === '/activity' ? { ...n, badge: notifications.unread } : n)));
	const manage = $derived(manageNav(session.can));
	const path = $derived(page.url.pathname);
	const here = (n: NavItem) => (pending ? pending === n.href : n.href === '/' ? path === '/' : [n.href, ...(n.match ?? [])].some((h) => path === h || path.startsWith(h + '/')));
	const initial = $derived((session.me?.displayName ?? '?').trim().charAt(0).toUpperCase());
	const roleLabel = $derived(session.me?.role === 'admin' ? 'Admin' : session.me?.role === 'member' ? 'Member' : 'Guest');

	async function logout() { await session.signOut(); goto('/login'); }
	function onKey(e: KeyboardEvent) { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && session.me) { e.preventDefault(); chrome.search = !chrome.search; } }
	const setAppearance = (a: 'system' | 'light' | 'dark') => home.savePrefs({ appearance: a });
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><link rel="icon" href={favicon} /><title>Home</title><meta name="theme-color" content="#edf0f8" media="(prefers-color-scheme: light)" /><meta name="theme-color" content="#080b16" media="(prefers-color-scheme: dark)" /></svelte:head>

{#snippet mark()}
	<span class="flex size-8 items-center justify-center rounded-[10px] bg-primary text-primary-foreground" aria-hidden="true">
		<svg viewBox="0 0 24 24" class="size-[18px]" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.2 12 4.5l8 6.7"/><path d="M6.2 10v9.5h11.6V10"/><path d="M10 19.5v-5h4v5"/></svg>
	</span>
{/snippet}

{#snippet navLink(n: NavItem)}
	<a href={target(n)} onclick={(e) => go(e, n)} aria-current={here(n) ? 'page' : undefined}
		class="group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[0.9375rem] font-medium transition-colors {here(n) ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}">
		<n.icon class="size-[18px] shrink-0 {here(n) ? 'text-primary' : ''}" />
		<span class="flex-1 truncate">{n.label}</span>
		{#if n.badge}<span class="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-semibold text-primary-foreground" aria-label="{n.badge} unread">{n.badge}</span>{/if}
	</a>
{/snippet}

{#if navigating.to}
	<div class="pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5 overflow-hidden bg-primary/15" role="progressbar" aria-label="Loading"><div class="h-full w-1/3 animate-[load_1.1s_ease-in-out_infinite] rounded-full bg-primary"></div></div>
{/if}
{#if pull.y > 0}
	<div class="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center" style="transform: translateY({pull.y / 2 - 20}px)" aria-hidden="true">
		<span class="flex size-10 items-center justify-center rounded-full border bg-card shadow-lg {pull.armed || pull.busy ? 'text-primary' : 'text-muted-foreground'}">
			{#if pull.busy}<Loader2 class="size-5 animate-spin" />{:else}<ArrowDown class="size-5 transition-transform duration-200 {pull.armed ? 'rotate-180' : ''}" />{/if}
		</span>
	</div>
{/if}
{#if edge.p > 0}
	<div class="pointer-events-none fixed left-0 top-1/2 z-[60] -translate-y-1/2" style="opacity:{edge.p}; transform: translate({-24 + edge.p * 30}px, -50%)" aria-hidden="true"><span class="flex size-11 items-center justify-center rounded-full border bg-card shadow-lg"><ChevronLeft class="size-5" /></span></div>
{/if}

{#if page.url.pathname.startsWith('/ops')}
	{@render children()}
{:else if session.me && path === '/panel'}
	{@render children()}
	<Notice />
{:else if session.me}
	<div class="min-h-dvh md:grid md:grid-cols-[15.5rem_1fr]">
		<aside class="sticky top-0 hidden h-dvh flex-col gap-1 border-r bg-raised px-3 py-4 md:flex">
			<a href="/" class="mb-5 flex items-center gap-2.5 px-1.5">{@render mark()}<span class="text-[1.0625rem] font-semibold tracking-tight">Home</span></a>
			<nav class="flex flex-col gap-0.5" aria-label="Main">{#each nav.slice(0, 4) as n (n.href)}{@render navLink(n)}{/each}</nav>
			{#if manage.length}
				<p class="mb-1 mt-6 px-2.5 text-xs font-medium text-muted-foreground">Manage</p>
				<nav class="flex flex-col gap-0.5" aria-label="Manage">{#each manage as n (n.href)}{@render navLink(n)}{/each}</nav>
			{/if}
			<div class="mt-auto">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger class="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-muted">
						<span class="flex size-8 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{initial}</span>
						<span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium leading-tight">{session.me.displayName}</span><span class="block text-xs text-muted-foreground">{roleLabel}</span></span>
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" side="top" class="w-52">
						<DropdownMenu.Item onSelect={() => goto('/you')}><Settings class="size-4" />Settings</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Label>Appearance</DropdownMenu.Label>
						<DropdownMenu.Item onSelect={() => setAppearance('system')}><SunMoon class="size-4" />Match device</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={() => setAppearance('light')}><Sun class="size-4" />Light</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={() => setAppearance('dark')}><Moon class="size-4" />Dark</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Item onSelect={logout}><LogOut class="size-4" />Sign out</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</aside>

		<div class="min-w-0">
			<!-- Desktop: a search field. Phone: nothing at the top until the large title scrolls away, then a slim title bar. -->
			<header class="sticky top-0 z-30 hidden h-14 border-b bg-background/80 backdrop-blur-xl md:block"><div class="mx-auto flex h-full w-full max-w-6xl items-center gap-3 px-10">
				<button type="button" onclick={() => (chrome.search = true)} class="flex h-9 w-full max-w-sm items-center gap-2 rounded-xl border bg-card px-3 text-sm text-muted-foreground transition-colors hover:border-input">
					<Search class="size-4" /><span class="flex-1 text-left">Search or jump to…</span><kbd class="rounded-md border bg-muted px-1.5 text-[11px] font-medium">⌘K</kbd>
				</button>
				<div class="ml-auto flex items-center gap-1">
					<Button variant="ghost" size="icon" href="/activity" class="relative" aria-label="Alerts{notifications.unread ? `, ${notifications.unread} unread` : ''}">
						<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>{#if notifications.unread}<span class="absolute right-1.5 top-1.5 size-2 rounded-full bg-signal ring-2 ring-background"></span>{/if}
					</Button>
				</div>
			</div></header>
			<div class="pointer-events-none fixed inset-x-0 top-0 z-30 flex h-11 items-center justify-center border-b bg-background/85 backdrop-blur-xl transition-opacity duration-200 md:hidden {chrome.compact ? 'opacity-100' : 'opacity-0'}" aria-hidden={!chrome.compact}>
				<span class="text-[0.9375rem] font-semibold tracking-[-0.01em]">{chrome.title}</span>
			</div>
			<HubBanner /><SupportBanner /><UpdateBanner />
			<div class="pb-[4.5rem] md:pb-0 {pull.y > 0 && !pull.busy ? '' : 'transition-transform duration-200'}" style={pull.y > 0 || pull.busy ? `transform: translateY(${pull.y}px)` : ''}>{#key path}<div in:fly={{ y: 10, duration: dur(240), easing: cubicOut }}>{@render children()}</div>{/key}</div>
		</div>

		<nav class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background/90 px-1 pb-[max(0.125rem,env(safe-area-inset-bottom))] pt-0.5 backdrop-blur-xl md:hidden" aria-label="Main">
			{#each nav as t (t.href)}
				<a href={target(t)} onclick={(e) => go(e, t)} aria-current={here(t) ? 'page' : undefined} class="relative flex flex-col items-center gap-px rounded-lg py-1 text-[10px] font-medium transition-colors duration-200 before:absolute before:left-1/2 before:top-0 before:h-0.5 before:-translate-x-1/2 before:rounded-full before:bg-primary before:transition-all before:duration-300 {here(t) ? 'text-primary before:w-7 before:opacity-100' : 'text-muted-foreground before:w-0 before:opacity-0'}">
					{#if t.href === '/you'}<span class="flex size-[21px] items-center justify-center rounded-full text-[11px] font-semibold {here(t) ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">{initial}</span>{:else}<t.icon class="size-[21px] transition-transform duration-300 {here(t) ? '-translate-y-px scale-110' : ''}" />{/if}{t.label}
					{#if t.badge}<span class="absolute right-[calc(50%-18px)] top-0.5 size-2 rounded-full bg-signal ring-2 ring-background"></span>{/if}
				</a>
			{/each}
		</nav>

		{#if ui.oneHand && tabRoot}
			<button type="button" onclick={() => (chrome.search = true)} aria-label="Search" class="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform active:scale-95 md:hidden"><Search class="size-5" /></button>
		{/if}
		<CommandPalette bind:open={chrome.search} />
		<SelectBar />
		<Notice />
	</div>
{:else if session.loaded || publicPaths.includes(page.url.pathname)}
	{@render children()}
{/if}
