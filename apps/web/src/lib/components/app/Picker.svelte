<script lang="ts" generics="T extends string | number">
	import * as Drawer from '#lib/components/ui/drawer';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu';
	import { viewport } from '#lib/viewport.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import { Check, ChevronsUpDown } from '@lucide/svelte';

	type Opt = { value: T; label: string };
	/** Replaces the browser's own dropdown: a menu under the field on a computer, a bottom list with big rows on a phone. */
	let { value = $bindable(), options, label, class: cls = '', placeholder = 'Choose', capitalize = false, onchange }: {
		value: T | undefined; options: Opt[]; label: string; class?: string; placeholder?: string; capitalize?: boolean; onchange?: (v: T) => void;
	} = $props();
	let open = $state(false);
	const current = $derived(options.find((o) => String(o.value) === String(value)));
	function pick(v: T) { haptics.tap(); value = v; open = false; onchange?.(v); }
</script>

{#snippet trigger()}
	<span class="min-w-0 flex-1 truncate text-left {capitalize ? 'capitalize' : ''}">{current?.label ?? placeholder}</span><ChevronsUpDown class="size-3.5 shrink-0 text-muted-foreground" />
{/snippet}

{#if viewport.phone}
	<button type="button" class="field flex items-center justify-between gap-2 {cls}" aria-label={label} aria-haspopup="listbox" onclick={() => (open = true)}>{@render trigger()}</button>
	<Drawer.Root bind:open>
		<Drawer.Content class="max-h-[80dvh] rounded-t-3xl">
			<div class="overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
				<Drawer.Header class="px-2 pb-2"><Drawer.Title class="text-left text-lg font-semibold tracking-[-0.02em]">{label}</Drawer.Title><Drawer.Description class="sr-only">Choose one</Drawer.Description></Drawer.Header>
				<div role="listbox" aria-label={label} class="space-y-0.5">
					{#each options as o (o.value)}
						{@const sel = String(o.value) === String(value)}
						<button type="button" role="option" aria-selected={sel} onclick={() => pick(o.value)} class="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base transition-colors active:bg-muted {sel ? 'bg-primary/10 font-medium' : ''}">
							<span class="flex-1 {capitalize ? 'capitalize' : ''}">{o.label}</span>{#if sel}<Check class="size-5 text-primary" />{/if}
						</button>
					{/each}
				</div>
			</div>
		</Drawer.Content>
	</Drawer.Root>
{:else}
	<DropdownMenu.Root bind:open>
		<DropdownMenu.Trigger class="field flex items-center justify-between gap-2 {cls}" aria-label={label}>{@render trigger()}</DropdownMenu.Trigger>
		<DropdownMenu.Content align="start" class="max-h-72 min-w-44 overflow-y-auto">
			{#each options as o (o.value)}
				{@const sel = String(o.value) === String(value)}
				<DropdownMenu.Item onSelect={() => pick(o.value)} class={sel ? 'font-medium' : ''}><span class="flex-1 {capitalize ? 'capitalize' : ''}">{o.label}</span>{#if sel}<Check class="size-4 text-primary" />{/if}</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/if}
