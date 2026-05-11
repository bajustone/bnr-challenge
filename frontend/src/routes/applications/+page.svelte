<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import FileText from '@lucide/svelte/icons/file-text';
	import {
		APPLICATION_STATUSES,
		type ApplicationStatus
	} from 'bnr-shared/domain/state-machine';
	import type { Application } from '$lib/server/applications';

	let { data } = $props();

	let query = $state('');

	const isApplicant = $derived(data.roles.includes('applicant'));
	const isStaff = $derived(
		data.roles.includes('reviewer') ||
			data.roles.includes('approver') ||
			data.roles.includes('admin')
	);

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return data.applications.filter((a: Application) => {
			if (data.filter.onlyMine && a.applicantId !== data.userId) return false;
			if (data.filter.onlyAssigned && a.reviewedBy !== data.userId) return false;
			if (q) {
				const hay = `${a.institutionName} ${a.institutionType} ${a.id}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});

	function updateUrl(next: { status?: ApplicationStatus | null; mine?: boolean; assigned?: boolean }) {
		const params = new URLSearchParams(page.url.searchParams);
		if (next.status === null) params.delete('status');
		else if (next.status !== undefined) params.set('status', next.status);
		if (next.mine === true) params.set('mine', '1');
		else if (next.mine === false) params.delete('mine');
		if (next.assigned === true) params.set('assigned', '1');
		else if (next.assigned === false) params.delete('assigned');
		const qs = params.toString();
		goto(`/applications${qs ? `?${qs}` : ''}`, { keepFocus: true, noScroll: true });
	}

	const statusTone: Record<ApplicationStatus, string> = {
		DRAFT: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
		SUBMITTED: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
		UNDER_REVIEW: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300',
		RFI_REQUESTED: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
		READY_FOR_DECISION: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300',
		APPROVED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
		REJECTED: 'bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-300',
		WITHDRAWN: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300'
	};

	function short(id: string): string {
		return id.slice(0, 8);
	}

	function instType(raw: string): string {
		return raw.replaceAll('_', ' ');
	}
</script>

<svelte:head>
	<title>Applications · BNR Licensing</title>
</svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Applications</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			{#if isStaff}
				All applications visible to your role.
			{:else}
				Your applications.
			{/if}
		</p>
	</div>
	<div class="flex items-center gap-2">
		<Badge variant="outline" class="gap-1.5">
			<FileText class="size-3.5" />
			{filtered.length} of {data.applications.length}
		</Badge>
		{#if isApplicant}
			<Button href="/applications/new" class="gap-1.5">
				<Plus class="size-4" />
				New
			</Button>
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
		{#if isStaff}
			<Button
				variant={data.filter.onlyAssigned ? 'secondary' : 'outline'}
				size="sm"
				onclick={() => updateUrl({ assigned: !data.filter.onlyAssigned })}
			>
				Assigned to me
			</Button>
		{/if}
		{#if isApplicant && isStaff}
			<Button
				variant={data.filter.onlyMine ? 'secondary' : 'outline'}
				size="sm"
				onclick={() => updateUrl({ mine: !data.filter.onlyMine })}
			>
				Mine only
			</Button>
		{/if}
	</div>

	<div class="flex flex-wrap items-center gap-1">
		<span class="text-muted-foreground mr-1 text-xs">Status:</span>
		<Button
			variant={data.filter.status === null ? 'secondary' : 'ghost'}
			size="sm"
			class="h-7 px-2 text-xs"
			onclick={() => updateUrl({ status: null })}
		>
			any
		</Button>
		{#each APPLICATION_STATUSES as s (s)}
			<Button
				variant={data.filter.status === s ? 'secondary' : 'ghost'}
				size="sm"
				class="h-7 px-2 font-mono text-[11px] tracking-tight"
				onclick={() => updateUrl({ status: s })}
			>
				{s}
			</Button>
		{/each}
	</div>
</div>

<Card.Root class="mt-4 overflow-hidden p-0">
	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead class="bg-muted/50 text-muted-foreground text-[11px] uppercase tracking-wide">
				<tr class="border-b">
					<th class="px-4 py-2.5 text-left font-semibold">Ref</th>
					<th class="px-4 py-2.5 text-left font-semibold">Institution</th>
					<th class="px-4 py-2.5 text-left font-semibold">Status</th>
					{#if isStaff}
						<th class="px-4 py-2.5 text-left font-semibold">Reviewer</th>
					{/if}
					<th class="px-4 py-2.5 text-left font-semibold">Updated</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as a (a.id)}
					<tr class="hover:bg-muted/40 border-b transition-colors last:border-b-0">
						<td class="px-4 py-3 align-top">
							<a class="font-mono text-xs hover:underline" href={`/applications/${a.id}`}
								>{short(a.id)}</a
							>
							<div class="text-muted-foreground mt-0.5 text-[11px]">
								{new Date(a.createdAt).toLocaleDateString()}
							</div>
						</td>
						<td class="px-4 py-3 align-top">
							<a class="font-medium hover:underline" href={`/applications/${a.id}`}
								>{a.institutionName}</a
							>
							<div class="text-muted-foreground text-xs">{instType(a.institutionType)}</div>
						</td>
						<td class="px-4 py-3 align-top">
							<span
								class="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] tracking-tight {statusTone[
									a.status
								]}"
							>
								{a.status}
							</span>
						</td>
						{#if isStaff}
							<td class="px-4 py-3 align-top">
								{#if a.reviewedBy}
									<span class="font-mono text-xs">{short(a.reviewedBy)}</span>
								{:else}
									<span class="text-muted-foreground text-xs">—</span>
								{/if}
							</td>
						{/if}
						<td class="px-4 py-3 align-top text-xs">
							{new Date(a.updatedAt).toLocaleDateString()}
						</td>
					</tr>
				{/each}

				{#if filtered.length === 0 && !data.loadError}
					<tr>
						<td colspan={isStaff ? 5 : 4} class="text-muted-foreground px-4 py-12 text-center">
							<div class="flex flex-col items-center gap-2 text-sm">
								<CircleHelp class="size-5 opacity-60" />
								<p>No applications match the current filters.</p>
								{#if isApplicant && data.applications.length === 0}
									<Button href="/applications/new" size="sm" class="mt-1 gap-1.5">
										<Plus class="size-4" />
										Start one
									</Button>
								{/if}
							</div>
						</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
</Card.Root>
