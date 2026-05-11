<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import TopBar from '$lib/components/portal/TopBar.svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Plus from '@lucide/svelte/icons/plus';
	import FileText from '@lucide/svelte/icons/file-text';
	import Inbox from '@lucide/svelte/icons/inbox';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Gavel from '@lucide/svelte/icons/gavel';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { Application } from '$lib/server/applications';
	import type { ApplicationStatus } from 'bnr-shared/domain/state-machine';

	let { data } = $props();

	const isApplicant = $derived(data.roles.includes('applicant'));
	const isReviewer = $derived(data.roles.includes('reviewer') || data.roles.includes('admin'));
	const isApprover = $derived(data.roles.includes('approver') || data.roles.includes('admin'));

	// ── Bucketing ──────────────────────────────────────────────────
	const myApplications = $derived(
		data.userId
			? data.applications.filter((a: Application) => a.applicantId === data.userId)
			: ([] as Application[])
	);
	const unassignedSubmissions = $derived(
		data.applications.filter((a: Application) => a.status === 'SUBMITTED')
	);
	const assignedToMe = $derived(
		data.userId
			? data.applications.filter(
					(a: Application) => a.status === 'UNDER_REVIEW' && a.reviewedBy === data.userId
				)
			: ([] as Application[])
	);
	const readyForDecision = $derived(
		data.applications.filter((a: Application) => a.status === 'READY_FOR_DECISION')
	);

	// ── Status presentation ───────────────────────────────────────
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
	<title>BNR Licensing Portal</title>
</svelte:head>

<div class="bg-background text-foreground min-h-svh">
	<TopBar user={data.user} roles={data.roles} />

	<main class="mx-auto max-w-6xl px-6 py-8">
		<!-- Greeting -->
		<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
			<div>
				<h1 class="text-2xl font-semibold tracking-tight">
					Welcome, {data.user?.name ?? 'there'}
				</h1>
				<p class="text-muted-foreground mt-1 text-sm">{data.user?.email}</p>
			</div>
			{#if isApplicant}
				<Button href="/applications/new" class="gap-1.5">
					<Plus class="size-4" />
					New application
				</Button>
			{/if}
		</div>

		{#if data.loadError}
			<Alert.Root variant="destructive" class="mb-6">
				<TriangleAlert class="size-4" />
				<Alert.Title>Couldn't load applications</Alert.Title>
				<Alert.Description>The backend returned: {data.loadError}.</Alert.Description>
			</Alert.Root>
		{/if}

		<div class="space-y-6">
			<!-- Applicant queue -->
			{#if isApplicant}
				{@const open = myApplications.filter(
					(a: Application) => !['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(a.status)
				)}
				<Card.Root>
					<Card.Header>
						<div class="flex items-center justify-between gap-2">
							<div class="flex items-center gap-2">
								<FileText class="text-brand size-4" />
								<Card.Title class="text-base">My applications</Card.Title>
							</div>
							<Badge variant="outline">{open.length} open · {myApplications.length} total</Badge>
						</div>
					</Card.Header>
					<Card.Content class="p-0">
						{#if myApplications.length === 0}
							<div class="text-muted-foreground flex flex-col items-center gap-2 px-6 py-10 text-sm">
								<Inbox class="size-5 opacity-60" />
								<p>You haven't started any applications yet.</p>
								<Button href="/applications/new" size="sm" class="mt-1 gap-1.5">
									<Plus class="size-4" />
									Start one
								</Button>
							</div>
						{:else}
							<ul class="divide-y">
								{#each myApplications as a (a.id)}
									<li>
										<a
											href={`/applications/${a.id}`}
											class="hover:bg-muted/40 flex items-center gap-3 px-4 py-3 transition-colors"
										>
											<div class="min-w-0 flex-1">
												<div class="truncate font-medium">{a.institutionName}</div>
												<div class="text-muted-foreground truncate text-xs">
													{instType(a.institutionType)} · updated
													{new Date(a.updatedAt).toLocaleDateString()}
												</div>
											</div>
											<span
												class="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] tracking-tight {statusTone[
													a.status
												]}"
											>
												{a.status}
											</span>
											<ArrowRight class="text-muted-foreground size-4" />
										</a>
									</li>
								{/each}
							</ul>
						{/if}
					</Card.Content>
				</Card.Root>
			{/if}

			<!-- Reviewer queues -->
			{#if isReviewer}
				<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
					<Card.Root>
						<Card.Header>
							<div class="flex items-center justify-between gap-2">
								<div class="flex items-center gap-2">
									<Inbox class="text-brand size-4" />
									<Card.Title class="text-base">Submitted</Card.Title>
								</div>
								<Badge variant="outline">{unassignedSubmissions.length}</Badge>
							</div>
							<Card.Description>Awaiting a reviewer to assign themselves.</Card.Description>
						</Card.Header>
						<Card.Content class="p-0">
							{#if unassignedSubmissions.length === 0}
								<p class="text-muted-foreground px-6 py-8 text-center text-sm">
									Inbox zero. Nothing to claim right now.
								</p>
							{:else}
								<ul class="divide-y">
									{#each unassignedSubmissions.slice(0, 6) as a (a.id)}
										<li>
											<a
												href={`/applications/${a.id}`}
												class="hover:bg-muted/40 flex items-center gap-3 px-4 py-3 transition-colors"
											>
												<div class="min-w-0 flex-1">
													<div class="truncate font-medium">{a.institutionName}</div>
													<div class="text-muted-foreground text-xs">
														submitted
														{a.submittedAt
															? new Date(a.submittedAt).toLocaleDateString()
															: '—'}
													</div>
												</div>
												<span class="text-muted-foreground font-mono text-xs">{short(a.id)}</span>
											</a>
										</li>
									{/each}
								</ul>
								{#if unassignedSubmissions.length > 6}
									<div class="border-t px-4 py-2 text-right">
										<Button
											href="/applications?status=SUBMITTED"
											variant="ghost"
											size="sm"
											class="gap-1.5"
										>
											See all {unassignedSubmissions.length}
											<ArrowRight class="size-3.5" />
										</Button>
									</div>
								{/if}
							{/if}
						</Card.Content>
					</Card.Root>

					<Card.Root>
						<Card.Header>
							<div class="flex items-center justify-between gap-2">
								<div class="flex items-center gap-2">
									<ClipboardCheck class="text-brand size-4" />
									<Card.Title class="text-base">Assigned to me</Card.Title>
								</div>
								<Badge variant="outline">{assignedToMe.length}</Badge>
							</div>
							<Card.Description>Under review — your turn to progress.</Card.Description>
						</Card.Header>
						<Card.Content class="p-0">
							{#if assignedToMe.length === 0}
								<p class="text-muted-foreground px-6 py-8 text-center text-sm">
									Nothing under your name right now.
								</p>
							{:else}
								<ul class="divide-y">
									{#each assignedToMe as a (a.id)}
										<li>
											<a
												href={`/applications/${a.id}`}
												class="hover:bg-muted/40 flex items-center gap-3 px-4 py-3 transition-colors"
											>
												<div class="min-w-0 flex-1">
													<div class="truncate font-medium">{a.institutionName}</div>
													<div class="text-muted-foreground text-xs">
														updated {new Date(a.updatedAt).toLocaleDateString()}
													</div>
												</div>
												<span class="text-muted-foreground font-mono text-xs">{short(a.id)}</span>
											</a>
										</li>
									{/each}
								</ul>
							{/if}
						</Card.Content>
					</Card.Root>
				</div>
			{/if}

			<!-- Approver queue -->
			{#if isApprover}
				<Card.Root>
					<Card.Header>
						<div class="flex items-center justify-between gap-2">
							<div class="flex items-center gap-2">
								<Gavel class="text-brand size-4" />
								<Card.Title class="text-base">Ready for my decision</Card.Title>
							</div>
							<Badge variant="outline">{readyForDecision.length}</Badge>
						</div>
						<Card.Description>
							Reviewer signed off — your approval (or rejection) is the final step. Dual control:
							you can't decide on cases you reviewed.
						</Card.Description>
					</Card.Header>
					<Card.Content class="p-0">
						{#if readyForDecision.length === 0}
							<p class="text-muted-foreground px-6 py-8 text-center text-sm">
								Nothing waiting on a decision.
							</p>
						{:else}
							<ul class="divide-y">
								{#each readyForDecision as a (a.id)}
									{@const blocked = data.userId !== null && a.reviewedBy === data.userId}
									<li>
										<a
											href={`/applications/${a.id}`}
											class="hover:bg-muted/40 flex items-center gap-3 px-4 py-3 transition-colors"
										>
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-2">
													<span class="truncate font-medium">{a.institutionName}</span>
													{#if blocked}
														<Badge variant="outline" class="gap-1 text-[10px]">
															<TriangleAlert class="size-3" />
															you reviewed
														</Badge>
													{/if}
												</div>
												<div class="text-muted-foreground text-xs">
													reviewed by
													<span class="font-mono">{a.reviewedBy ? short(a.reviewedBy) : '—'}</span>
													·
													{a.reviewedAt ? new Date(a.reviewedAt).toLocaleDateString() : '—'}
												</div>
											</div>
											<ArrowRight class="text-muted-foreground size-4" />
										</a>
									</li>
								{/each}
							</ul>
						{/if}
					</Card.Content>
				</Card.Root>
			{/if}

			<!-- Nothing-to-show fallback (rare) -->
			{#if !isApplicant && !isReviewer && !isApprover}
				<Card.Root>
					<Card.Header>
						<Card.Title>No roles assigned</Card.Title>
						<Card.Description>
							Your account doesn't have any portal roles yet. Ask an administrator to grant
							access.
						</Card.Description>
					</Card.Header>
				</Card.Root>
			{/if}
		</div>
	</main>
</div>
