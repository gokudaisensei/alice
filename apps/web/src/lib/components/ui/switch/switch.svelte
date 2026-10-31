<script lang="ts">
	import { Switch as SwitchPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "#lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		checked = $bindable(false),
		size = "default",
		...restProps
	}: WithoutChildrenOrChild<SwitchPrimitive.RootProps> & {
		size?: "sm" | "default";
	} = $props();
</script>

<SwitchPrimitive.Root
	bind:ref
	bind:checked
	data-slot="switch"
	data-size={size}
	class={cn(
		"data-[state=checked]:bg-primary data-[state=unchecked]:bg-[color-mix(in_oklab,var(--input),var(--foreground)_8%)] focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 shrink-0 rounded-full border border-transparent focus-visible:ring-3 aria-invalid:ring-3 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:border-transparent data-[size=default]:h-[26px] data-[size=default]:w-[44px] data-[size=sm]:h-[20px] data-[size=sm]:w-[34px] peer group/switch relative inline-flex items-center transition-colors duration-200 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 data-disabled:cursor-not-allowed data-disabled:opacity-50",
		className
	)}
	{...restProps}
>
	<SwitchPrimitive.Thumb
		data-slot="switch-thumb"
		class={cn(
			"bg-white rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.28)] group-data-[size=default]/switch:size-[22px] group-data-[size=sm]/switch:size-4 group-data-[size=default]/switch:data-[state=checked]:translate-x-[20px] group-data-[size=sm]/switch:data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-[2px] pointer-events-none block ring-0 transition-transform duration-200 ease-[cubic-bezier(.3,.7,.2,1)]",
			"rtl:data-[state=checked]:translate-x-[calc(-100%)]"
		)}
	/>
</SwitchPrimitive.Root>
