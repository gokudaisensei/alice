<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";

	export const buttonVariants = tv({
		base: "focus-visible:ring-ring/40 aria-invalid:border-destructive rounded-xl border border-transparent bg-clip-padding text-sm font-medium tracking-[-0.01em] focus-visible:ring-4 active:not-aria-[haspopup]:scale-[0.98] [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-[background-color,color,transform,box-shadow] duration-150 outline-none select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklab,var(--primary),var(--foreground)_10%)]",
				outline: "border-border bg-card hover:bg-muted aria-expanded:bg-muted",
				secondary: "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklab,var(--secondary),var(--foreground)_6%)]",
				ghost: "text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
				destructive: "bg-signal-soft text-signal-foreground hover:bg-[color-mix(in_oklab,var(--signal-soft),var(--signal)_14%)]",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 gap-1.5 px-3.5 [@media(pointer:coarse)]:h-11",
				xs: "h-6 gap-1 rounded-lg px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
				sm: "h-8 gap-1.5 rounded-lg px-3 text-[0.8125rem] [@media(pointer:coarse)]:h-10 [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-11 gap-2 rounded-2xl px-5 text-[0.9375rem]",
				icon: "size-9 [@media(pointer:coarse)]:size-11",
				"icon-xs": "relative size-6 rounded-lg after:absolute after:-inset-2 after:content-[''] [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "relative size-8 rounded-lg after:absolute after:-inset-1.5 after:content-['']",
				"icon-lg": "size-11 rounded-2xl",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
	export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = "default",
		size = "default",
		ref = $bindable(null),
		href = undefined,
		type = "button",
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? "link" : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
