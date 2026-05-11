<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import * as Alert from '$lib/components/ui/alert';
	import { toggleMode } from 'mode-watcher';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Loader2 from '@lucide/svelte/icons/loader-2';

	let { form } = $props();
	let submitting = $state(false);

	const errorCopy: Record<string, { title: string; description: string }> = {
		missing_fields: {
			title: 'Email and password are required',
			description: 'Fill in both fields and try again.'
		},
		invalid_credentials: {
			title: 'Wrong email or password',
			description: 'Double-check the credentials. Accounts are provisioned by an administrator.'
		},
		backend_unreachable: {
			title: 'The portal backend is unreachable',
			description: 'Try again in a moment. If the problem persists, contact your BNR contact.'
		},
		unknown: {
			title: 'Something went wrong',
			description: 'Unexpected error while signing in. Please try again.'
		}
	};
</script>

<svelte:head>
	<title>Sign in · BNR Licensing Portal</title>
</svelte:head>

<div class="grid min-h-svh lg:grid-cols-2">
	<!-- Brand panel -->
	<aside
		class="bg-brand text-brand-foreground relative hidden flex-col justify-between p-10 lg:flex"
	>
		<div class="flex items-center gap-2 text-lg font-semibold tracking-tight">
			<ShieldCheck class="size-6" />
			BNR Licensing Portal
		</div>

		<div class="space-y-6">
			<p class="max-w-md text-3xl leading-tight font-medium">
				Regulated licensing,<br />reviewed in the open.
			</p>
			<ul class="text-brand-foreground/85 space-y-2 text-sm">
				<li class="flex items-start gap-2">
					<span class="bg-brand-foreground/80 mt-2 inline-block size-1 rounded-full"></span>
					Append-only audit, dual-controlled approvals.
				</li>
				<li class="flex items-start gap-2">
					<span class="bg-brand-foreground/80 mt-2 inline-block size-1 rounded-full"></span>
					Documents versioned, hashed, never overwritten.
				</li>
				<li class="flex items-start gap-2">
					<span class="bg-brand-foreground/80 mt-2 inline-block size-1 rounded-full"></span>
					Every decision traceable to actor and timestamp.
				</li>
			</ul>
		</div>

		<p class="text-brand-foreground/70 text-xs">
			© {new Date().getFullYear()} BNR · staff portal
		</p>
	</aside>

	<!-- Form pane -->
	<main class="bg-background relative flex flex-col justify-center px-6 py-12 sm:px-10">
		<Button
			variant="ghost"
			size="icon"
			class="absolute top-4 right-4"
			onclick={toggleMode}
			aria-label="Toggle theme"
		>
			<Sun class="size-4 dark:hidden" />
			<Moon class="hidden size-4 dark:block" />
		</Button>

		<!-- Mobile brand bar -->
		<div class="mb-8 flex items-center gap-2 lg:hidden">
			<div class="bg-brand text-brand-foreground grid size-9 place-items-center rounded-md">
				<ShieldCheck class="size-5" />
			</div>
			<span class="text-base font-semibold tracking-tight">BNR Licensing Portal</span>
		</div>

		<div class="mx-auto w-full max-w-sm space-y-6">
			<header class="space-y-1.5">
				<h1 class="text-2xl font-semibold tracking-tight">Sign in</h1>
				<p class="text-muted-foreground text-sm">
					Use the email associated with your role.
				</p>
			</header>

			{#if form?.error && errorCopy[form.error]}
				<Alert.Root variant="destructive">
					<TriangleAlert class="size-4" />
					<Alert.Title>{errorCopy[form.error].title}</Alert.Title>
					<Alert.Description>{errorCopy[form.error].description}</Alert.Description>
				</Alert.Root>
			{/if}

			<form
				class="space-y-4"
				method="POST"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
				novalidate
			>
				<div class="space-y-2">
					<Label for="email">Email</Label>
					<Input
						id="email"
						name="email"
						type="email"
						autocomplete="username"
						placeholder="you@example.org"
						required
						value={form?.email ?? ''}
						disabled={submitting}
					/>
				</div>

				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<Label for="password">Password</Label>
						<a
							href="/login"
							aria-disabled="true"
							class="text-muted-foreground hover:text-foreground pointer-events-none text-xs underline-offset-4 hover:underline"
						>
							Forgot password?
						</a>
					</div>
					<Input
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
						required
						disabled={submitting}
					/>
				</div>

				<Button type="submit" class="w-full" disabled={submitting}>
					{#if submitting}
						<Loader2 class="size-4 animate-spin" />
						Signing in…
					{:else}
						Sign in
					{/if}
				</Button>
			</form>

			<Alert.Root>
				<Info class="size-4" />
				<Alert.Title>Accounts are provisioned by an administrator</Alert.Title>
				<Alert.Description>
					There is no public sign-up. Reach out to your BNR contact if you need access.
				</Alert.Description>
			</Alert.Root>

			<Separator />

			<p class="text-muted-foreground text-center text-xs">
				By signing in you agree to the portal's
				<a class="hover:text-foreground underline underline-offset-4" href="/login"
					>acceptable-use terms</a
				>.
			</p>
		</div>
	</main>
</div>
