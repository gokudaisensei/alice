<script lang="ts">
	import { goto } from '$app/navigation';
	import { session } from '#lib/session.svelte.js';
	import { manageNav } from '#lib/nav.js';
	import Page from '#lib/components/app/Page.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import Row from '#lib/components/app/Row.svelte';
	import * as Dialog from '#lib/components/ui/dialog';
	import { Button } from '#lib/components/ui/button';
	import { Bell, LogOut, Palette, Plug } from '@lucide/svelte';

	const manage = $derived(manageNav(session.can));
	const blurb: Record<string, string> = { '/admin/rooms': 'Name rooms, rename devices and make groups', '/admin/users': 'Invite people and choose what they can use', '/admin/voice': 'What Alexa and Google Assistant may control', '/admin/system': 'Connection, backups, updates and support' };
	const initial = $derived((session.me?.displayName ?? '?').trim().charAt(0).toUpperCase());
	const role = $derived(session.me?.role === 'admin' ? 'Admin' : session.me?.role === 'member' ? 'Member' : 'Guest');
	let confirmOut = $state(false), leaving = $state(false);
	async function logout() { leaving = true; await session.signOut(); goto('/login'); }
</script>

<Page title="You" width="md">
	<div class="flex items-center gap-4">
		<span class="flex size-16 items-center justify-center rounded-full bg-primary/12 text-2xl font-semibold text-primary">{initial}</span>
		<div><p class="text-xl font-semibold tracking-[-0.02em]">{session.me?.displayName}</p><p class="text-sm text-muted-foreground">{role} · signed in with a passkey</p></div>
	</div>

	<Section title="Your settings" hint="Only you see these choices.">
		<Group>
			<Row href="/settings" title="Appearance" description="Text size, motion, theme, layout and favourites">{#snippet icon()}<Palette class="size-[18px]" />{/snippet}</Row>
			<Row href="/settings/notifications" title="Notifications" description="What you are told about, and quiet hours">{#snippet icon()}<Bell class="size-[18px]" />{/snippet}</Row>
			<Row href="/devices" title="Devices" description="Everything you can control, with search">{#snippet icon()}<Plug class="size-[18px]" />{/snippet}</Row>
		</Group>
	</Section>

	{#if manage.length}
		<Section title="Household" hint="For the people who look after this home. Changes affect everyone.">
			<Group>{#each manage as n (n.href)}<Row href={n.href} title={n.label} description={blurb[n.href]}>{#snippet icon()}<n.icon class="size-[18px]" />{/snippet}</Row>{/each}</Group>
		</Section>
	{/if}

	<div class="mt-4 border-t pt-6">
		<Button variant="ghost" class="w-full justify-center text-signal sm:w-auto" onclick={() => (confirmOut = true)}><LogOut />Sign out</Button>
	</div>
</Page>

<Dialog.Root bind:open={confirmOut}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header><Dialog.Title>Sign out?</Dialog.Title><Dialog.Description>You will need your passkey to sign back in on this device.</Dialog.Description></Dialog.Header>
		<Dialog.Footer><Button variant="ghost" onclick={() => (confirmOut = false)}>Stay signed in</Button><Button variant="destructive" disabled={leaving} onclick={logout}>Sign out</Button></Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
