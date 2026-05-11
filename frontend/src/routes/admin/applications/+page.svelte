<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Search from '@lucide/svelte/icons/search';
	import FileText from '@lucide/svelte/icons/file-text';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import { APPLICATION_STATUSES, type ApplicationStatus } from 'bnr-shared/domain/state-machine';
	import type { Application } from '$lib/server/admin';
	import { classifyStuck, idleDays } from '$lib/admin/stuck';

	let { data } = $props();

	let query = $state('');

	const now = new Date();

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return data.applications.filter((a: Application) => {
			if (data.filter.onlyStuck && !classifyStuck(a, now).stuck) return false;
			if (!q) return true;
			const hay = `${a.institutionName} ${a.institutionType} ${a.id}`.toLowerCase();
			return hay.includes(q);
		});
	});

	const totalStuck = $derived(
		data.applications.filter((a: Application) => classifyStuck(a, now).stuck).length
	);

	function setFilter(next: { status?: ApplicationStatus | null; stuck?: boolean | null }) {
		const params = new URLSearchParams(page.url.searchParams);
		if (next.status === null) params.delete('status');
		else if (next.status !== undefined) params.set('status', next.status);
		if (next.stuck === null) params.delete('stuck');
		else if (next.stuck === true) params.set('stuck', '1');
		else if (next.stuck === false) params.delete('stuck');
		const qs = params.toString();
		goto(`/admin/applications${qs ? `?${qs}` : ''}`, { keepFocus: true, noScroll: true });
	}

	const statusTone: Record<
		ApplicationStatus,
		{ chip: string; label: string }
	> = {
		DRAFT: { chip: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300', label: 'DRAFT' },
		SUBMITTED: { chip: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300', label: 'SUBMITTED' },
		UNDER_REVIEW: { chip: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300', label: 'UNDER_REVIEW' },
		RFI_REQUESTED: { chip: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300', label: 'RFI_REQUESTED' },
		READY_FOR_DECISION: { chip: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300', label: 'READY_FOR_DECISION' },
		APPROVED: { chip: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300', label: 'APPROVED' },
		REJECTED: { chip: 'bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-300', label: 'REJECTED' },
		WITHDRAWN: { chip: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300', label: 'WITHDRAWN' }
	};

	function short(id: string): string {
		return id.slice(0, 8);
	}

	function institutionTypeLabel(raw: string): string {
		return raw.replaceAll('_', ' ');
	}
</script>

<svelte:head>
	<title>Applications · BNR Admin</title>
</svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Applications</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			Read-only oversight across every applicant. Mutations happen in the reviewer / approver
			views.
		</p>
	</div>
	<div class="flex items-center gap-2">
		<Badge variant="outline" class="gap-1.5">
			<FileText class="size-3.5" />
			{data.applications.length} loaded
		</Badge>
		{#if totalStuck > 0}
			<Badge class="bg-amber-500/15 text-amber-700 dark:text-amber-300 gap-1.5">
				<TriangleAlert class="size-3.5" />
				{totalStuck} stuck
			</Badge>
		{/if}
	</div>
</div>

{#if data.loadError}
	<Alert.Root variant="destructive" class="mt-6">
		<TriangleAlert class="size-4" />
		<Alert.Title>Couldn't load applications</Alert.Title>
		<Alert.Description>The backend returned: {data.loadError}.</Alert.Description>
	</Alert.Root>
{/if}

<!-- Toolbar -->
<div class="mt-6 flex flex-col gap-3">
	<div class="flex flex-wrap items-center gap-2">
		<div class="relative">
			<Search class="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
			<Input
				bind:value={query}
				placeholder="Search name, type, id"
				class="w-72 pl-8"
				type="search"
			/>
		</div>
		<Button
			variant={data.filter.onlyStuck ? 'secondary' : 'outline'}
			size="sm"
			class="gap-1.5"
			onclick={() => setFilter({ stuck: !data.filter.onlyStuck })}
		>
			<TriangleAlert class="size-3.5" />
			Stuck only
		</Button>
	</div>

	<div class="flex flex-wrap items-center gap-1">
		<span class="text-muted-foreground mr-1 text-xs">Status:</span>
		<Button
			variant={data.filter.status === null ? 'secondary' : 'ghost'}
			size="sm"
			class="h-7 px-2 text-xs"
			onclick={() => setFilter({ status: null })}
		>
			any
		</Button>
		{#each APPLICATION_STATUSES as s (s)}
			<Button
				variant={data.filter.status === s ? 'secondary' : 'ghost'}
				size="sm"
				class="h-7 px-2 font-mono text-[11px] tracking-tight"
				onclick={() => setFilter({ status: s })}
			>
				{s}
			</Button>
		{/each}
	</div>
</div>

<!-- Table -->
<Card.Root class="mt-4 overflow-hidden p-0">
	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead class="bg-muted/50 text-muted-foreground text-[11px] uppercase tracking-wide">
				<tr class="border-b">
					<th class="px-4 py-2.5 text-left font-semibold">Ref</th>
					<th class="px-4 py-2.5 text-left font-semibold">Institution</th>
					<th class="px-4 py-2.5 text-left font-semibold">Status</th>
					<th class="px-4 py-2.5 text-left font-semibold">Reviewer</th>
					<th class="px-4 py-2.5 text-left font-semibold">Decision</th>
					<th class="px-4 py-2.5 text-left font-semibold">Idle</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as a (a.id)}
					{@const verdict = classifyStuck(a, now)}
					{@const tone = statusTone[a.status]}
					<tr class="hover:bg-muted/40 border-b transition-colors last:border-b-0">
						<td class="px-4 py-3 align-top">
							<div class="font-mono text-xs">{short(a.id)}</div>
							<div class="text-muted-foreground mt-0.5 text-[11px]">
								{new Date(a.createdAt).toLocaleDateString()}
							</div>
						</td>
						<td class="px-4 py-3 align-top">
							<div class="font-medium">{a.institutionName}</div>
							<div class="text-muted-foreground text-xs">
								{institutionTypeLabel(a.institutionType)}
							</div>
						</td>
						<td class="px-4 py-3 align-top">
							<span
								class="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] tracking-tight {tone.chip}"
							>
								{tone.label}
							</span>
						</td>
						<td class="px-4 py-3 align-top">
							{#if a.reviewedBy}
								<div class="font-mono text-xs">{short(a.reviewedBy)}</div>
								{#if a.reviewedAt}
									<div class="text-muted-foreground text-[11px]">
										{new Date(a.reviewedAt).toLocaleDateString()}
									</div>
								{/if}
							{:else}
								<span class="text-muted-foreground text-xs">—</span>
							{/if}
						</td>
						<td class="px-4 py-3 align-top">
							{#if a.decision}
								<Badge
									class={a.decision === 'APPROVED'
										? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px]'
										: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 text-[10px]'}
								>
									{a.decision}
								</Badge>
								{#if a.decidedBy}
									<div class="text-muted-foreground mt-0.5 font-mono text-[11px]">
										by {short(a.decidedBy)}
									</div>
								{/if}
							{:else}
								<span class="text-muted-foreground text-xs">—</span>
							{/if}
						</td>
						<td class="px-4 py-3 align-top">
							{#if verdict.stuck}
								<div class="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
									<TriangleAlert class="size-3.5" />
									{verdict.idleDays}d
								</div>
								<div class="text-muted-foreground mt-0.5 text-[11px]">
									&gt; {verdict.thresholdDays}d threshold
								</div>
							{:else}
								<div class="tabular-nums">{idleDays(a, now)}d</div>
							{/if}
						</td>
					</tr>
				{/each}

				{#if filtered.length === 0 && !data.loadError}
					<tr>
						<td colspan="6" class="text-muted-foreground px-4 py-12 text-center">
							<div class="flex flex-col items-center gap-2 text-sm">
								<CircleHelp class="size-5 opacity-60" />
								<p>No applications match the current filters.</p>
							</div>
						</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
</Card.Root>

<p class="text-muted-foreground mt-3 text-xs">
	Stuck thresholds: <span class="text-foreground">RFI 7d</span> · <span class="text-foreground">READY_FOR_DECISION 5d</span> ·
	<span class="text-foreground">UNDER_REVIEW 10d</span>. Idle is measured against
	<code class="text-[11px]">updatedAt</code>.
</p>
