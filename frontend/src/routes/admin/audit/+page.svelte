<script lang="ts">
	import { page } from '$app/state';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import type { AuditRow } from '$lib/server/admin';

	let { data } = $props();

	let expanded = $state<string | null>(null);

	function short(id: string | null | undefined): string {
		return id ? id.slice(0, 8) : '—';
	}

	function actionTone(action: string): string {
		// Convention: action strings look like `application.approved`,
		// `user.role_granted`, `application.request_info`. Map the verb to a tone.
		const verb = action.split('.').pop() ?? '';
		if (verb === 'approved') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
		if (verb === 'rejected' || verb === 'role_revoked')
			return 'bg-rose-500/15 text-rose-700 dark:text-rose-300';
		if (verb === 'request_info' || verb === 'role_granted')
			return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
		return 'bg-muted text-foreground';
	}

	function formatTime(iso: string): string {
		return iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
	}

	function prettyJson(v: unknown): string {
		try {
			return JSON.stringify(v, null, 2);
		} catch {
			return String(v);
		}
	}

	const offset = $derived(data.query.offset ?? 0);
	const hasNext = $derived(data.rows.length === data.pageSize);
	const hasPrev = $derived(offset > 0);
	const rangeStart = $derived(data.rows.length === 0 ? 0 : offset + 1);
	const rangeEnd = $derived(offset + data.rows.length);

	function pageHref(nextOffset: number): string {
		const params = new URLSearchParams(page.url.searchParams);
		if (nextOffset <= 0) params.delete('offset');
		else params.set('offset', String(nextOffset));
		const qs = params.toString();
		return `/admin/audit${qs ? `?${qs}` : ''}`;
	}
</script>

<svelte:head>
	<title>Audit log · BNR Admin</title>
</svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Audit log</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			Append-only, hash-chained. Each row is signed against the previous one — the verifier
			catches tampering end to end.
		</p>
	</div>
	<div class="flex items-center gap-2">
		<Badge variant="outline" class="gap-1.5">
			<ScrollText class="size-3.5" />
			{rangeStart}–{rangeEnd}
		</Badge>
		<Button href="/admin/audit/verify" variant="outline" size="sm" class="gap-1.5">
			<CheckCheck class="size-3.5" />
			Verifier
		</Button>
	</div>
</div>

{#if data.loadError}
	<Alert.Root variant="destructive" class="mt-6">
		<TriangleAlert class="size-4" />
		<Alert.Title>Couldn't load audit rows</Alert.Title>
		<Alert.Description>The backend returned: {data.loadError}.</Alert.Description>
	</Alert.Root>
{/if}

<!-- Filters -->
<Card.Root class="mt-6">
	<Card.Content class="pt-6">
		<form method="GET" class="grid grid-cols-1 gap-3 md:grid-cols-4">
			<div class="space-y-1.5">
				<Label for="resourceType" class="text-xs">Resource type</Label>
				<Input
					id="resourceType"
					name="resourceType"
					placeholder="application, user, …"
					value={data.query.resourceType ?? ''}
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="resourceId" class="text-xs">Resource id</Label>
				<Input
					id="resourceId"
					name="resourceId"
					placeholder="uuid"
					value={data.query.resourceId ?? ''}
					class="font-mono text-xs"
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="actorId" class="text-xs">Actor id</Label>
				<Input
					id="actorId"
					name="actorId"
					placeholder="uuid"
					value={data.query.actorId ?? ''}
					class="font-mono text-xs"
				/>
			</div>
			<div class="flex items-end gap-2">
				<Button type="submit" class="flex-1">Apply filters</Button>
				<Button
					type="button"
					variant="outline"
					size="icon"
					aria-label="Reset filters"
					onclick={() => {
						window.location.href = '/admin/audit';
					}}
				>
					<RotateCcw class="size-4" />
				</Button>
			</div>
		</form>
	</Card.Content>
</Card.Root>

<!-- Table -->
<Card.Root class="mt-4 overflow-hidden p-0">
	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead class="bg-muted/50 text-muted-foreground text-[11px] uppercase tracking-wide">
				<tr class="border-b">
					<th class="px-4 py-2.5 text-left font-semibold">When (UTC)</th>
					<th class="px-4 py-2.5 text-left font-semibold">Actor</th>
					<th class="px-4 py-2.5 text-left font-semibold">Action</th>
					<th class="px-4 py-2.5 text-left font-semibold">Resource</th>
					<th class="px-4 py-2.5 text-right font-semibold w-10"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.rows as r (r.id)}
					{@const open = expanded === r.id}
					<tr
						class="hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-ring/50 cursor-pointer border-b transition-colors last:border-b-0 focus:outline-none focus-visible:outline-2"
						role="button"
						tabindex="0"
						aria-expanded={open}
						aria-controls={`audit-row-${r.id}`}
						onclick={() => (expanded = open ? null : r.id)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								expanded = open ? null : r.id;
							} else if (e.key === 'Escape' && open) {
								expanded = null;
							}
						}}
					>
						<td class="px-4 py-3 align-top font-mono text-xs">{formatTime(r.occurredAt)}</td>
						<td class="px-4 py-3 align-top">
							<div class="font-mono text-xs">{short(r.actorId)}</div>
							<div class="text-muted-foreground mt-0.5 text-[11px] uppercase tracking-wide">
								{r.actorRole}
							</div>
						</td>
						<td class="px-4 py-3 align-top">
							<span
								class="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] tracking-tight {actionTone(
									r.action
								)}"
							>
								{r.action}
							</span>
						</td>
						<td class="px-4 py-3 align-top">
							<div class="text-muted-foreground text-xs">{r.resourceType}</div>
							<div class="font-mono text-xs">{short(r.resourceId)}</div>
						</td>
						<td class="px-4 py-3 text-right align-top">
							<ChevronDown
								class="text-muted-foreground inline size-3.5 transition-transform {open
									? 'rotate-180'
									: ''}"
							/>
						</td>
					</tr>
					{#if open}
						<tr id={`audit-row-${r.id}`} class="bg-muted/20 border-b last:border-b-0">
							<td colspan="5" class="px-4 py-4">
								<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
									<div>
										<div class="text-muted-foreground mb-1.5 text-[11px] uppercase tracking-wide">Before</div>
										<pre
											class="bg-background overflow-auto rounded border p-3 text-[11px] leading-snug font-mono">{prettyJson(
												r.beforeState
											)}</pre>
									</div>
									<div>
										<div class="text-muted-foreground mb-1.5 text-[11px] uppercase tracking-wide">After</div>
										<pre
											class="bg-background overflow-auto rounded border p-3 text-[11px] leading-snug font-mono">{prettyJson(
												r.afterState
											)}</pre>
									</div>
								</div>
								<div class="mt-3">
									<div class="text-muted-foreground mb-1.5 text-[11px] uppercase tracking-wide">Metadata</div>
									<pre
										class="bg-background overflow-auto rounded border p-3 text-[11px] leading-snug font-mono">{prettyJson(
											r.metadata
										)}</pre>
								</div>
								<div class="text-muted-foreground mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
									<div>
										<span class="font-medium">Row id:</span>
										<span class="font-mono">{r.id}</span>
									</div>
									<div>
										<span class="font-medium">Actor:</span>
										<span class="font-mono">{r.actorId}</span>
									</div>
									<div>
										<span class="font-medium">Resource:</span>
										<span class="font-mono">{r.resourceType}/{r.resourceId}</span>
									</div>
								</div>
							</td>
						</tr>
					{/if}
				{/each}

				{#if data.rows.length === 0 && !data.loadError}
					<tr>
						<td colspan="5" class="text-muted-foreground px-4 py-12 text-center">
							<div class="flex flex-col items-center gap-2 text-sm">
								<CircleHelp class="size-5 opacity-60" />
								<p>No audit rows match the current filters.</p>
							</div>
						</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
</Card.Root>

<!-- Pagination -->
<div class="mt-3 flex items-center justify-between">
	<p class="text-muted-foreground text-xs">
		Page size {data.pageSize}. Showing {rangeStart}–{rangeEnd}.
	</p>
	<div class="flex items-center gap-1">
		<Button
			href={hasPrev ? pageHref(Math.max(0, offset - data.pageSize)) : undefined}
			variant="outline"
			size="sm"
			class="gap-1.5"
			disabled={!hasPrev}
		>
			<ChevronLeft class="size-3.5" />
			Prev
		</Button>
		<Button
			href={hasNext ? pageHref(offset + data.pageSize) : undefined}
			variant="outline"
			size="sm"
			class="gap-1.5"
			disabled={!hasNext}
		>
			Next
			<ChevronRight class="size-3.5" />
		</Button>
	</div>
</div>
