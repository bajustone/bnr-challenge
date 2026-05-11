<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import * as Alert from '$lib/components/ui/alert';
	import Users from '@lucide/svelte/icons/users';
	import FileText from '@lucide/svelte/icons/file-text';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import type { ApplicationStatus } from 'bnr-shared/domain/state-machine';

	let { data } = $props();

	// All lucide icons share the same component signature.
	type Icon = typeof Users;
	type Tile = { href: string; icon: Icon; title: string; body: string };

	const tiles: Tile[] = [
		{
			href: '/admin/users',
			icon: Users,
			title: 'Users & roles',
			body: 'Grant or revoke reviewer / approver / admin roles. Every change is audited.'
		},
		{
			href: '/admin/applications',
			icon: FileText,
			title: 'Applications',
			body: 'Read-only oversight across every applicant, status, and assignee.'
		},
		{
			href: '/admin/audit',
			icon: ScrollText,
			title: 'Audit log',
			body: 'Filter the append-only audit trail; drill into row-level diffs.'
		},
		{
			href: '/admin/audit/verify',
			icon: CheckCheck,
			title: 'Chain verifier',
			body: 'Walk the SHA-256 hash chain end-to-end; surface the first bad row if any.'
		}
	];

	// ── Workflow chart helpers ─────────────────────────────────────
	const maxCount = $derived(Math.max(1, ...data.statusCounts.map((s) => s.count)));

	// Status → swatch (Tailwind background classes resolved at build time).
	const statusTone: Record<ApplicationStatus, { dot: string; bar: string; label: string }> = {
		DRAFT: { dot: 'bg-slate-400', bar: 'bg-slate-400', label: 'DRAFT' },
		SUBMITTED: { dot: 'bg-sky-500', bar: 'bg-sky-500', label: 'SUBMITTED' },
		UNDER_REVIEW: { dot: 'bg-indigo-500', bar: 'bg-indigo-500', label: 'UNDER_REVIEW' },
		RFI_REQUESTED: { dot: 'bg-amber-500', bar: 'bg-amber-500', label: 'RFI_REQUESTED' },
		READY_FOR_DECISION: {
			dot: 'bg-cyan-500',
			bar: 'bg-cyan-500',
			label: 'READY_FOR_DECISION'
		},
		APPROVED: { dot: 'bg-emerald-500', bar: 'bg-emerald-500', label: 'APPROVED' },
		REJECTED: { dot: 'bg-rose-500', bar: 'bg-rose-500', label: 'REJECTED' },
		WITHDRAWN: { dot: 'bg-zinc-400', bar: 'bg-zinc-400', label: 'WITHDRAWN' }
	};

	const totalApplications = $derived(data.statusCounts.reduce((a, s) => a + s.count, 0));
</script>

<!-- Page header -->
<div class="flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Dashboard</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			Welcome, <span class="text-foreground font-medium">{data.user?.name ?? 'admin'}</span>. Live
			oversight across users, applications, and the audit chain.
		</p>
	</div>
	<Badge variant="outline" class="gap-1.5">
		<ShieldCheck class="size-3.5" />
		Admin
	</Badge>
</div>

<!-- Backend warnings (any individual call failed) -->
{#if data.errors.users || data.errors.applications || data.errors.audit}
	<Alert.Root variant="destructive" class="mt-6">
		<TriangleAlert class="size-4" />
		<Alert.Title>Some metrics couldn't load</Alert.Title>
		<Alert.Description>
			{#if data.errors.users}<div>• users</div>{/if}
			{#if data.errors.applications}<div>• applications</div>{/if}
			{#if data.errors.audit}<div>• audit chain</div>{/if}
		</Alert.Description>
	</Alert.Root>
{/if}

<!-- Metric strip -->
<section class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Key metrics">
	<Card.Root class="p-4">
		<div class="flex items-center justify-between">
			<div class="text-muted-foreground text-xs">Open applications</div>
			<FileText class="text-muted-foreground/70 size-3.5" />
		</div>
		<div class="mt-2 flex items-baseline gap-2">
			<div class="text-2xl font-semibold tabular-nums">{data.totals.openApplications}</div>
			<span class="text-muted-foreground text-xs">of {totalApplications}</span>
		</div>
		<div class="text-muted-foreground mt-1 text-xs">Not yet in a terminal status.</div>
	</Card.Root>

	<Card.Root class="p-4">
		<div class="flex items-center justify-between">
			<div class="text-muted-foreground text-xs">Awaiting decision</div>
		</div>
		<div class="mt-2 flex items-baseline gap-2">
			<div class="text-2xl font-semibold tabular-nums">{data.totals.awaitingDecision}</div>
		</div>
		<div class="text-muted-foreground mt-1 text-xs">In <span class="font-mono text-[11px]">READY_FOR_DECISION</span>.</div>
	</Card.Root>

	<Card.Root class="p-4">
		<div class="flex items-center justify-between">
			<div class="text-muted-foreground text-xs">Active staff</div>
			<Users class="text-muted-foreground/70 size-3.5" />
		</div>
		<div class="mt-2 flex items-baseline gap-2">
			<div class="text-2xl font-semibold tabular-nums">{data.totals.activeStaff}</div>
		</div>
		<div class="text-muted-foreground mt-1 text-xs">
			{data.staffBreakdown.reviewer} reviewer · {data.staffBreakdown.approver} approver · {data
				.staffBreakdown.admin} admin
		</div>
	</Card.Root>

	<Card.Root class="p-4">
		<div class="flex items-center justify-between">
			<div class="text-muted-foreground text-xs">Audit chain</div>
			{#if data.auditChain.kind === 'ok'}
				<span class="inline-flex size-2 rounded-full bg-emerald-500"></span>
			{:else if data.auditChain.kind === 'bad'}
				<span class="inline-flex size-2 rounded-full bg-rose-500"></span>
			{:else}
				<span class="inline-flex size-2 rounded-full bg-slate-400"></span>
			{/if}
		</div>
		<div class="mt-2 flex items-baseline gap-2">
			{#if data.auditChain.kind === 'ok'}
				<div class="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">OK</div>
				<span class="text-muted-foreground text-xs">{data.auditChain.rowsChecked} rows</span>
			{:else if data.auditChain.kind === 'bad'}
				<div class="text-2xl font-semibold text-rose-600 dark:text-rose-400">Tampered</div>
				<span class="text-muted-foreground text-xs">row #{data.auditChain.firstBadId}</span>
			{:else}
				<div class="text-muted-foreground/60 text-2xl font-semibold">—</div>
				<span class="text-muted-foreground text-xs">unavailable</span>
			{/if}
		</div>
		<div class="text-muted-foreground mt-1 text-xs">
			{#if data.auditChain.kind === 'bad'}
				Reason: {data.auditChain.reason}
			{:else}
				SHA-256 chain over <code class="text-[11px]">audit_log</code>.
			{/if}
		</div>
	</Card.Root>
</section>

<!-- Two-column content -->
<section class="mt-6 grid grid-cols-12 gap-5">
	<!-- Workflow funnel -->
	<Card.Root class="col-span-12 lg:col-span-7">
		<Card.Header>
			<div class="flex items-start justify-between gap-2">
				<div>
					<Card.Title class="text-base">Workflow at a glance</Card.Title>
					<Card.Description>Counts per status across every application.</Card.Description>
				</div>
				<Button href="/admin/applications" variant="ghost" size="sm" class="gap-1.5">
					See all
					<ArrowRight class="size-3.5" />
				</Button>
			</div>
		</Card.Header>
		<Card.Content>
			{#if totalApplications === 0}
				<div class="text-muted-foreground flex flex-col items-center justify-center gap-2 py-10 text-sm">
					<CircleHelp class="size-5 opacity-60" />
					<p>No applications yet.</p>
				</div>
			{:else}
				<ul class="space-y-3 text-sm">
					{#each data.statusCounts as row (row.status)}
						{@const tone = statusTone[row.status]}
						{@const pct = Math.round((row.count / maxCount) * 100)}
						<li>
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-2">
									<span class="inline-block size-1.5 rounded-full {tone.dot}"></span>
									<span class="font-mono text-xs tracking-tight">{tone.label}</span>
								</div>
								<div class="text-muted-foreground tabular-nums">{row.count}</div>
							</div>
							<div class="bg-muted mt-1 h-2 overflow-hidden rounded">
								<div class="h-full {tone.bar}" style="width: {pct}%"></div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Audit chain detail -->
	<Card.Root class="col-span-12 lg:col-span-5">
		<Card.Header>
			<div class="flex items-start justify-between gap-2">
				<div>
					<Card.Title class="text-base">Audit chain health</Card.Title>
					<Card.Description>Verifier walks <code class="text-[11px]">audit_log</code> hashes.</Card.Description>
				</div>
				{#if data.auditChain.kind === 'ok'}
					<Badge class="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">OK</Badge>
				{:else if data.auditChain.kind === 'bad'}
					<Badge variant="destructive">Tampered</Badge>
				{:else}
					<Badge variant="secondary">Unavailable</Badge>
				{/if}
			</div>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="grid grid-cols-3 gap-3 text-sm">
				<div>
					<div class="text-muted-foreground text-[11px] tracking-wide uppercase">Rows</div>
					<div class="mt-0.5 font-semibold tabular-nums">
						{data.auditChain.kind === 'unavailable' ? '—' : data.auditChain.rowsChecked}
					</div>
				</div>
				<div>
					<div class="text-muted-foreground text-[11px] tracking-wide uppercase">Last good id</div>
					<div class="mt-0.5 truncate font-mono text-xs">
						{#if data.auditChain.kind === 'ok'}
							{data.auditChain.lastVerifiedId ?? '—'}
						{:else}
							—
						{/if}
					</div>
				</div>
				<div>
					<div class="text-muted-foreground text-[11px] tracking-wide uppercase">First bad id</div>
					<div class="mt-0.5 truncate font-mono text-xs">
						{#if data.auditChain.kind === 'bad'}
							{data.auditChain.firstBadId ?? '—'}
						{:else}
							—
						{/if}
					</div>
				</div>
			</div>

			{#if data.auditChain.kind === 'bad'}
				<Alert.Root variant="destructive">
					<TriangleAlert class="size-4" />
					<Alert.Title>Chain mismatch detected</Alert.Title>
					<Alert.Description>
						{data.auditChain.reason}. Open the verifier for the full trail.
					</Alert.Description>
				</Alert.Root>
			{/if}

			<Button href="/admin/audit/verify" variant="outline" size="sm" class="w-full">
				Open verifier
			</Button>
		</Card.Content>
	</Card.Root>
</section>

<Separator class="my-8" />

<!-- Map of what's coming -->
<section aria-label="Admin tools">
	<div class="mb-4">
		<h2 class="text-lg font-semibold tracking-tight">Tools</h2>
		<p class="text-muted-foreground text-sm">Quick links into each admin surface.</p>
	</div>

	<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
		{#each tiles as tile (tile.href)}
			<Card.Root class="hover:border-brand/40 group transition-colors">
				<Card.Header>
					<div class="flex items-center gap-2.5">
						<div class="bg-brand/10 text-brand grid size-9 place-items-center rounded-md">
							<tile.icon class="size-4" />
						</div>
						<Card.Title class="text-base">{tile.title}</Card.Title>
					</div>
				</Card.Header>
				<Card.Content class="text-muted-foreground text-sm">{tile.body}</Card.Content>
				<Card.Footer>
					<Button href={tile.href} variant="ghost" size="sm" class="gap-1.5">
						Open
						<ArrowRight class="size-3.5 transition-transform group-hover:translate-x-0.5" />
					</Button>
				</Card.Footer>
			</Card.Root>
		{/each}
	</div>
</section>
