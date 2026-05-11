<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Separator } from '$lib/components/ui/separator';
	import Search from '@lucide/svelte/icons/search';
	import Users from '@lucide/svelte/icons/users';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { ROLES, type Role } from 'bnr-shared/domain/state-machine';
	import type { AdminUser } from '$lib/server/admin';

	let { data } = $props();

	// ── Local UI state ──────────────────────────────────────────────
	let query = $state('');
	let roleFilter = $state<Role | 'any'>('any');
	let statusFilter = $state<'active' | 'disabled' | 'any'>('active');
	let expandedUserId = $state<string | null>(null);
	// In-flight toggles, keyed `${userId}:${role}` so multiple toggles can run in parallel.
	let pending = $state(new Set<string>());

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return data.users.filter((u: AdminUser) => {
			if (q) {
				const hay = `${u.name} ${u.email}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			if (roleFilter !== 'any' && !u.roles.includes(roleFilter)) return false;
			if (statusFilter === 'active' && u.disabledAt) return false;
			if (statusFilter === 'disabled' && !u.disabledAt) return false;
			return true;
		});
	});

	function toggleExpanded(id: string) {
		expandedUserId = expandedUserId === id ? null : id;
	}

	const errorCopy: Record<string, string> = {
		unauthorized: 'You are signed out. Refresh to retry.',
		forbidden: 'You do not have permission for this change.',
		not_found: 'That role assignment was not found.',
		conflict: 'Conflict — refresh and try again.',
		unreachable: 'Backend unreachable. Try again in a moment.',
		invalid_input: 'Invalid role or user id.',
		unknown: 'Unexpected error.'
	};

	function initials(u: AdminUser): string {
		return (
			(u.name || u.email || '?')
				.split(/\s+/)
				.filter(Boolean)
				.slice(0, 2)
				.map((p) => p[0]?.toUpperCase() ?? '')
				.join('') || '?'
		);
	}

	const totalActive = $derived(data.users.filter((u: AdminUser) => !u.disabledAt).length);
</script>

<svelte:head>
	<title>Users & roles · BNR Admin</title>
</svelte:head>

<!-- Header -->
<div class="flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Users &amp; roles</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			Grant or revoke staff roles. Every change is recorded in the audit log.
		</p>
	</div>
	<div class="flex items-center gap-2">
		<Badge variant="outline" class="gap-1.5">
			<Users class="size-3.5" />
			{data.users.length} total · {totalActive} active
		</Badge>
	</div>
</div>

{#if data.loadError}
	<Alert.Root variant="destructive" class="mt-6">
		<TriangleAlert class="size-4" />
		<Alert.Title>Couldn't load users</Alert.Title>
		<Alert.Description>The backend returned: {data.loadError}.</Alert.Description>
	</Alert.Root>
{/if}

<!-- Toolbar -->
<div class="mt-6 flex flex-wrap items-center gap-2">
	<div class="relative">
		<Search class="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
		<Input
			bind:value={query}
			placeholder="Search name or email"
			class="w-72 pl-8"
			type="search"
		/>
	</div>

	<div class="flex items-center gap-1">
		<span class="text-muted-foreground text-xs">Role:</span>
		<Button
			variant={roleFilter === 'any' ? 'secondary' : 'ghost'}
			size="sm"
			class="h-7 px-2 text-xs"
			onclick={() => (roleFilter = 'any')}
		>
			any
		</Button>
		{#each ROLES as r (r)}
			<Button
				variant={roleFilter === r ? 'secondary' : 'ghost'}
				size="sm"
				class="h-7 px-2 text-xs"
				onclick={() => (roleFilter = r)}
			>
				{r}
			</Button>
		{/each}
	</div>

	<div class="flex items-center gap-1">
		<span class="text-muted-foreground text-xs">Status:</span>
		{#each ['active', 'disabled', 'any'] as const as s (s)}
			<Button
				variant={statusFilter === s ? 'secondary' : 'ghost'}
				size="sm"
				class="h-7 px-2 text-xs"
				onclick={() => (statusFilter = s)}
			>
				{s}
			</Button>
		{/each}
	</div>
</div>

<!-- Table -->
<Card.Root class="mt-4 overflow-hidden p-0">
	<table class="w-full text-sm">
		<thead class="bg-muted/50 text-muted-foreground text-[11px] uppercase tracking-wide">
			<tr class="border-b">
				<th class="px-4 py-2.5 text-left font-semibold">User</th>
				<th class="px-4 py-2.5 text-left font-semibold">Roles</th>
				<th class="px-4 py-2.5 text-left font-semibold">Status</th>
				<th class="px-4 py-2.5 text-right font-semibold">Actions</th>
			</tr>
		</thead>
		<tbody>
			{#each filtered as u (u.id)}
				{@const isOpen = expandedUserId === u.id}
				<tr class="border-b last:border-b-0">
					<td class="px-4 py-3 align-top">
						<div class="flex items-center gap-2.5">
							<div
								class="bg-brand/10 text-brand grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
							>
								{initials(u)}
							</div>
							<div class="min-w-0">
								<div class="truncate font-medium">{u.name || '—'}</div>
								<div class="text-muted-foreground truncate text-xs">{u.email}</div>
							</div>
						</div>
					</td>
					<td class="px-4 py-3 align-top">
						{#if u.roles.length === 0}
							<span class="text-muted-foreground text-xs italic">no roles</span>
						{:else}
							<div class="flex flex-wrap gap-1">
								{#each u.roles as r (r)}
									<Badge variant="secondary" class="text-[10px] uppercase tracking-wide"
										>{r}</Badge
									>
								{/each}
							</div>
						{/if}
					</td>
					<td class="px-4 py-3 align-top">
						{#if u.disabledAt}
							<Badge variant="outline" class="text-[10px]">
								disabled · {new Date(u.disabledAt).toLocaleDateString()}
							</Badge>
						{:else}
							<Badge
								class="bg-emerald-500/15 text-[10px] text-emerald-700 dark:text-emerald-300"
							>
								active
							</Badge>
						{/if}
					</td>
					<td class="px-4 py-3 text-right align-top">
						<Button
							variant="ghost"
							size="sm"
							class="gap-1.5"
							onclick={() => toggleExpanded(u.id)}
							aria-expanded={isOpen}
							aria-controls={`roles-${u.id}`}
						>
							Manage roles
							<ChevronDown
								class="size-3.5 transition-transform {isOpen ? 'rotate-180' : ''}"
							/>
						</Button>
					</td>
				</tr>

				{#if isOpen}
					<tr id={`roles-${u.id}`} class="bg-muted/30 border-b last:border-b-0">
						<td colspan="4" class="px-4 py-4">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-muted-foreground mr-1 text-xs">Toggle role:</span>
								{#each ROLES as role (role)}
									{@const has = u.roles.includes(role)}
									{@const key = `${u.id}:${role}`}
									{@const busy = pending.has(key)}
									<form
										method="POST"
										action={has ? '?/revoke' : '?/grant'}
										use:enhance={() => {
											pending = new Set(pending).add(key);
											return async ({ result }) => {
												const next = new Set(pending);
												next.delete(key);
												pending = next;
												if (result.type === 'success') {
													toast.success(
														`${has ? 'Revoked' : 'Granted'} ${role}`,
														{ description: u.email }
													);
													await invalidateAll();
												} else if (result.type === 'failure') {
													const code =
														(result.data as { code?: string } | undefined)?.code ?? 'unknown';
													toast.error('Role change failed', {
														description: errorCopy[code] ?? code
													});
												} else if (result.type === 'error') {
													toast.error('Role change failed', {
														description: result.error?.message ?? 'unknown'
													});
												}
											};
										}}
									>
										<input type="hidden" name="userId" value={u.id} />
										<input type="hidden" name="role" value={role} />
										<button
											type="submit"
											disabled={busy}
											class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs uppercase tracking-wide transition-colors disabled:opacity-60 {has
												? 'border-brand/40 bg-brand/10 text-brand hover:bg-brand/15'
												: 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}"
										>
											{#if busy}
												<Loader2 class="size-3 animate-spin" />
											{:else}
												<span
													class="inline-block size-1.5 rounded-full {has
														? 'bg-brand'
														: 'bg-muted-foreground/40'}"
												></span>
											{/if}
											{role}
										</button>
									</form>
								{/each}
							</div>
							<p class="text-muted-foreground mt-3 text-xs">
								Clicking <em>{u.roles.length === 0 ? 'grants' : 'toggles'}</em> the role. The
								backend enforces dual control on approvals — the same user can hold both
								<span class="font-medium">reviewer</span> and
								<span class="font-medium">approver</span>, but cannot review and approve the
								same application.
							</p>
						</td>
					</tr>
				{/if}
			{/each}

			{#if filtered.length === 0 && !data.loadError}
				<tr>
					<td colspan="4" class="text-muted-foreground px-4 py-10 text-center text-sm">
						No users match the current filters.
					</td>
				</tr>
			{/if}
		</tbody>
	</table>
</Card.Root>

<Separator class="my-8" />

<Card.Root>
	<Card.Header>
		<Card.Title class="text-base">Notes</Card.Title>
	</Card.Header>
	<Card.Content class="text-muted-foreground space-y-1.5 text-sm">
		<p>• User accounts are provisioned by self-signup or seeded directly in the database — there is no admin "invite" flow in this iteration.</p>
		<p>• Granting <span class="text-foreground font-medium">admin</span> is irreversible from the UI of the same user; an admin can't revoke their own last admin role.</p>
		<p>• Every grant/revoke writes an audited row (<code class="bg-muted rounded px-1 py-0.5 text-xs">user.role_granted</code> / <code class="bg-muted rounded px-1 py-0.5 text-xs">user.role_revoked</code>).</p>
	</Card.Content>
</Card.Root>
