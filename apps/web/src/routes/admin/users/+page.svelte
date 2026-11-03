<script lang="ts">
	import { Checkbox } from '#lib/components/ui/checkbox';
	import { haptics } from '#lib/haptics.js';
	import { onMount } from 'svelte';
	import { api, explain, sensitive } from '#lib/api.js';
	import { session } from '#lib/session.svelte.js';
	import Page from '#lib/components/app/Page.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import * as Dialog from '#lib/components/ui/dialog';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu';
	import { Button } from '#lib/components/ui/button';
	import { Badge } from '#lib/components/ui/badge';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import { Copy, Ellipsis, UserPlus, Users } from '@lucide/svelte';
	import { plural } from '#lib/fmt.js';
	import SkeletonList from '#lib/components/app/SkeletonList.svelte';

	type User = { id: string; displayName: string; role: 'admin' | 'member' | 'guest'; status: string };
	let users = $state<User[]>([]);
	let error = $state(''), loaded = $state(false);
	let inviteOpen = $state(false), name = $state(''), role = $state<'admin' | 'member' | 'guest'>('member'), busy = $state(false), acting = $state<Record<string, boolean>>({});
	let result = $state<{ title: string; code: string; hours: number } | null>(null), copied = $state(false);

	const ROLE = { admin: 'Admin', member: 'Member', guest: 'Guest' } as const;
	const ABOUT = { admin: 'Manages everything, including people.', member: 'Uses every device and makes scenes and automations.', guest: 'Uses only the devices you choose.' } as const;
	const isAdmin = $derived(session.me?.role === 'admin');
	const roles = $derived((isAdmin ? ['admin', 'member', 'guest'] : ['member', 'guest']) as ('admin' | 'member' | 'guest')[]);
	const link = (code: string) => `${location.origin}/setup?code=${encodeURIComponent(code)}`;

	async function load() { const r = await api<{ users: User[] }>('GET', '/api/admin/users'); if (r.ok) users = r.data.users; else error = explain(r.data?.error); loaded = true; }
	onMount(load);

	async function invite() {
		busy = true; error = '';
		const r = await sensitive<{ enrollmentCode: string }>('POST', '/api/admin/users', { displayName: name.trim(), role });
		busy = false;
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		inviteOpen = false; result = { title: `Invite ${name.trim()}`, code: r.data.enrollmentCode, hours: 24 }; name = ''; await load();
	}
	async function recovery(u: User, invite = false) {
		if (acting[u.id]) return;
		acting[u.id] = true;
		const r = await sensitive<{ enrollmentCode: string }>('POST', `/api/admin/users/${u.id}/recovery`);
		acting[u.id] = false;
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		result = { title: invite ? `Invite ${u.displayName}` : `New passkey for ${u.displayName}`, code: r.data.enrollmentCode, hours: 1 };
	}
	async function setRole(u: User, to: User['role']) {
		if (acting[u.id]) return;
		acting[u.id] = true;
		const r = await sensitive('PATCH', `/api/admin/users/${u.id}`, { role: to });
		acting[u.id] = false;
		if (!r.ok) error = r.data?.error === 'last_admin' ? 'There has to be at least one admin.' : (r.data?.message ?? explain(r.data?.error)); else error = '';
		await load();
	}
	async function remove(u: User) {
		if (!confirm(u.status === 'pending' ? `Cancel the invitation for ${u.displayName}? Their link will stop working.` : `Remove ${u.displayName}? They'll be signed out everywhere and lose access.`)) return;
		if (acting[u.id]) return;
		acting[u.id] = true;
		const r = await sensitive('DELETE', `/api/admin/users/${u.id}`);
		acting[u.id] = false;
		if (!r.ok) error = r.data?.error === 'last_admin' ? 'There has to be at least one admin.' : (r.data?.message ?? explain(r.data?.error)); else error = '';
		await load();
	}
	async function copy(text: string) { try { await navigator.clipboard.writeText(text); copied = true; setTimeout(() => (copied = false), 1800); } catch {} }
	const joined = $derived(users.filter((u) => u.status !== 'pending')), waiting = $derived(users.filter((u) => u.status === 'pending'));
	const initial = (n: string) => n.trim().charAt(0).toUpperCase();
	const statusText = (s: string) => (s === 'pending' ? 'Invited' : s === 'revoked' ? 'Removed' : '');
</script>

{#snippet person(u: User)}
	{@const pending = u.status === 'pending'}
	<div class="flex min-h-16 items-center gap-3 px-4 py-3 {pending ? 'bg-muted/40' : ''} {u.status === 'revoked' ? 'opacity-55' : ''}">
		<span class="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold {pending ? 'border border-dashed border-muted-foreground/50 text-muted-foreground' : 'bg-primary/12 text-primary'}">{initial(u.displayName)}</span>
		<div class="min-w-0 flex-1">
			<p class="truncate text-[0.9375rem] font-medium leading-tight {pending ? 'text-muted-foreground' : ''}">{u.displayName}{#if u.id === session.me?.id}<span class="font-normal text-muted-foreground">&nbsp;(you)</span>{/if}</p>
			<p class="text-sm text-muted-foreground">{pending ? `${ROLE[u.role]} · hasn’t joined yet` : ROLE[u.role]}</p>
		</div>
		{#if statusText(u.status)}<Badge variant="outline" class={pending ? 'border-dashed' : ''}>{statusText(u.status)}</Badge>{/if}
		{#if u.status !== 'revoked'}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger disabled={!!acting[u.id]} class="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50" aria-label="Actions for {u.displayName}"><Ellipsis class="size-4" /></DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-56">
					{#if pending}
						<DropdownMenu.Item onSelect={() => recovery(u, true)}>Resend link</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={() => (location.href = `/admin/users/${u.id}`)}>Choose what they can use</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Item class="text-signal" onSelect={() => remove(u)}>Cancel invitation</DropdownMenu.Item>
					{:else}
						<DropdownMenu.Item onSelect={() => (location.href = `/admin/users/${u.id}`)}>Choose what they can use</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={() => recovery(u)}>Give a new passkey link</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Label>Change role</DropdownMenu.Label>
						{#each (['admin', 'member', 'guest'] as const).filter((r) => r !== u.role && (isAdmin || r !== 'admin') && (isAdmin || u.role !== 'admin')) as r}<DropdownMenu.Item onSelect={() => setRole(u, r)}>Make {ROLE[r].toLowerCase()}</DropdownMenu.Item>{/each}
						<DropdownMenu.Separator />
						<DropdownMenu.Item class="text-signal" onSelect={() => remove(u)}>Remove access</DropdownMenu.Item>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
	</div>
{/snippet}

<Page title="People" subtitle="Everyone with access to your home." width="md">
	{#snippet actions()}<Button onclick={() => (inviteOpen = true)}><UserPlus />Invite</Button>{/snippet}
	{#if error}<p role="alert" class="rounded-2xl bg-signal-soft px-4 py-3 text-sm text-signal-foreground">{error}</p>{/if}
	{#if !loaded}<SkeletonList kind="rows" count={3} />{/if}
	{#if joined.length}
		<Group>{#each joined as u (u.id)}{@render person(u)}{/each}</Group>
	{/if}
	{#if waiting.length}
		<section class="space-y-2"><h2 class="heading">Waiting to join</h2><p class="text-sm text-muted-foreground">{plural(waiting.length, 'invitation')} not yet accepted. If a link has expired, resend it.</p>
			<Group>{#each waiting as u (u.id)}{@render person(u)}{/each}</Group></section>
	{/if}
	{#if loaded && users.length <= 1 && !waiting.length}<Empty icon={Users} title="Just you for now" description="Invite family, housemates or guests. Each person gets their own passkey and sees only what you let them use." action="Invite someone" onclick={() => (inviteOpen = true)} />{/if}
	<details class="rounded-2xl bg-secondary/60 px-4 py-3 text-sm"><summary class="cursor-pointer font-medium">What can each role do?</summary>
		<dl class="mt-2 space-y-1.5">{#each roles as r}<div><dt class="inline font-medium">{ROLE[r]}.</dt> <dd class="inline text-muted-foreground">{ABOUT[r]}</dd></div>{/each}</dl>
	</details>
</Page>

<Dialog.Root bind:open={inviteOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header><Dialog.Title>Invite someone</Dialog.Title><Dialog.Description>They'll set up their own passkey from a link you send them. You can change their role later.</Dialog.Description></Dialog.Header>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); invite(); }}>
			<div class="space-y-1.5"><Label for="inv-name">Name</Label><Input id="inv-name" bind:value={name} maxlength={60} placeholder="e.g. Sam" required /></div>
			<fieldset class="space-y-2"><legend class="mb-1 text-sm font-medium">Role</legend>
				{#each roles as r}
					<button type="button" role="radio" aria-checked={role === r} onclick={() => { haptics.tap(); role = r; }} class="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors active:bg-muted {role === r ? 'border-transparent bg-primary/10' : ''}"><Checkbox checked={role === r} class="mt-0.5" /><span><span class="block text-sm font-medium">{ROLE[r]}</span><span class="text-sm text-muted-foreground">{ABOUT[r]}</span></span></button>
				{/each}
			</fieldset>
			{#if error}<p role="alert" class="text-sm text-signal">{error}</p>{/if}
			<Dialog.Footer><Button type="button" variant="ghost" onclick={() => (inviteOpen = false)}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create invite'}</Button></Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!result} onOpenChange={(o) => { if (!o) result = null; }}>
	<Dialog.Content class="sm:max-w-md">
		{#if result}
			<Dialog.Header><Dialog.Title>{result.title}</Dialog.Title><Dialog.Description>Send them this link. It works once and expires in {result.hours === 1 ? 'an hour' : `${result.hours} hours`}.</Dialog.Description></Dialog.Header>
			<div class="space-y-3">
				<p class="break-all rounded-xl bg-secondary px-3 py-2.5 font-mono text-xs">{link(result.code)}</p>
				<div class="flex items-center gap-2"><Button onclick={() => copy(link(result!.code))}><Copy />{copied ? 'Copied' : 'Copy link'}</Button><span class="text-sm text-muted-foreground">or code <span class="font-mono">{result.code.slice(0, 6)}…</span></span></div>
				<p class="text-sm text-muted-foreground">Anyone with the link can sign in as them, so share it only with them.</p>
			</div>
			<Dialog.Footer><Button variant="secondary" onclick={() => (result = null)}>Done</Button></Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
