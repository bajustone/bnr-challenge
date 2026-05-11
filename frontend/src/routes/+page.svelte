<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { toggleMode } from 'mode-watcher';
	import { toast } from 'svelte-sonner';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
</script>

<main class="bg-background text-foreground grid min-h-svh place-items-center p-6">
	<Card.Root class="w-full max-w-md">
		<Card.Header>
			<div class="flex items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<ShieldCheck class="size-5" />
					<Card.Title>BNR Licensing Portal</Card.Title>
				</div>
				<Badge variant="secondary">setup</Badge>
			</div>
			<Card.Description>
				Frontend skeleton — design system online. No feature screens yet.
			</Card.Description>
		</Card.Header>
		<Card.Content class="text-muted-foreground text-sm">
			This page exists to prove the toolchain: Tailwind&nbsp;v4, shadcn-svelte primitives,
			dark mode via <code>mode-watcher</code>, and Lucide icons.
		</Card.Content>
		<Separator />
		<Card.Footer class="gap-2">
			<Button href="/login">Go to sign-in</Button>
			<Button onclick={() => toast.success('Toaster is wired.')} variant="secondary">
				Test toast
			</Button>
			<Button variant="outline" size="icon" onclick={toggleMode} aria-label="Toggle theme">
				<Sun class="size-4 dark:hidden" />
				<Moon class="hidden size-4 dark:block" />
			</Button>
		</Card.Footer>
	</Card.Root>
</main>
