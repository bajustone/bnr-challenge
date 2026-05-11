<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { toggleMode } from 'mode-watcher';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';

	let { data } = $props();
</script>

<svelte:head>
	<title>BNR Licensing Portal</title>
</svelte:head>

<div class="bg-background text-foreground min-h-svh">
	<header class="border-b">
		<div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
			<div class="flex items-center gap-2">
				<div class="bg-brand text-brand-foreground grid size-7 place-items-center rounded-md">
					<ShieldCheck class="size-4" />
				</div>
				<span class="text-sm font-semibold tracking-tight">BNR Licensing Portal</span>
			</div>
			<div class="flex items-center gap-2">
				<Button variant="ghost" size="icon" onclick={toggleMode} aria-label="Toggle theme">
					<Sun class="size-4 dark:hidden" />
					<Moon class="hidden size-4 dark:block" />
				</Button>
				<form method="POST" action="/logout">
					<Button type="submit" variant="outline" size="sm">
						<LogOut class="size-4" />
						Sign out
					</Button>
				</form>
			</div>
		</div>
	</header>

	<main class="mx-auto max-w-5xl px-6 py-10">
		<Card.Root>
			<Card.Header>
				<div class="flex items-center justify-between gap-2">
					<Card.Title>Welcome, {data.user?.name ?? 'there'}</Card.Title>
					<Badge variant="secondary">signed in</Badge>
				</div>
				<Card.Description>
					{data.user?.email}
				</Card.Description>
			</Card.Header>
			<Card.Content class="text-muted-foreground space-y-2 text-sm">
				<p>
					You're authenticated against the BNR backend. The applications, documents, and admin
					screens land in subsequent commits — wired against the OpenAPI surface served at
					<code class="bg-muted rounded px-1 py-0.5 text-xs">/openapi.json</code> on the backend.
				</p>
				<p>
					Every page in this app is gated by
					<code class="bg-muted rounded px-1 py-0.5 text-xs">hooks.server.ts</code>: an
					unauthenticated request bounces straight to <code class="bg-muted rounded px-1 py-0.5 text-xs">/login</code>.
				</p>
			</Card.Content>
			<Separator />
			<Card.Footer class="text-muted-foreground text-xs">
				Session id: <span class="font-mono">—</span>
			</Card.Footer>
		</Card.Root>
	</main>
</div>
