<script lang="ts">
	import { goto } from '$app/navigation';
	import { session } from '#lib/session.svelte.js';
	import { manageNav } from '#lib/nav.js';
	import Page from '#lib/components/app/Page.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import Row from '#lib/components/app/Row.svelte';
	import { Button } from '#lib/components/ui/button';
	import { Bell, LogOut, Palette, Plug } from '@lucide/svelte';

	const manage = $derived(manageNav(session.can));
	const blurb: Record<string, string> = { '/admin/rooms': 'Rooms, device names and groups', '/admin/users': 'Invite people and choose what they can use', '/admin/voice': 'What Alexa and Google may control', '/admin/system': 'Health, backups, updates and support' };
	const initial = $derived((session.me?.displayName ?? '?').trim().charAt(0).toUpperCase());
	const role = $derived(session.me?.role === 'admin' ? 'Admin' : session.me?.role === 'member' ? 'Member' : 'Guest');
	async function logout() { await session.signOut(); goto('/login'); }
</script>

<Page title="You" width="md">
	<div class="flex items-center gap-4">
		<span class="flex size-16 items-center justify-center rounded-full bg-primary/12 text-2xl font-semibold text-primary">{initial}</span>
		<div><p class="text-xl font-semibold tracking-[-0.02em]">{session.me?.displayName}</p><p class="text-sm text-muted-foreground">{role} · signed in with a passkey</p></div>
	</div>

	<Section title="Make it yours">
		<Group>
			<Row href="/settings" title="Appearance and home screen" description="Light or dark, layout, favorites and room order">{#snippet icon()}<Palette class="size-[18px]" />{/snippet}</Row>
			<Row href="/settings/notifications" title="Notifications" description="What to be told about, and quiet hours">{#snippet icon()}<Bell class="size-[18px]" />{/snippet}</Row>
			<Row href="/devices" title="All devices" description="Everything you can control, with search">{#snippet icon()}<Plug class="size-[18px]" />{/snippet}</Row>
		</Group>
	</Section>

	{#if manage.length}
		<Section title="Manage your home">
			<Group>{#each manage as n (n.href)}<Row href={n.href} title={n.label} description={blurb[n.href]}>{#snippet icon()}<n.icon class="size-[18px]" />{/snippet}</Row>{/each}</Group>
		</Section>
	{/if}

	<div><Button variant="secondary" onclick={logout}><LogOut />Sign out</Button></div>
</Page>
