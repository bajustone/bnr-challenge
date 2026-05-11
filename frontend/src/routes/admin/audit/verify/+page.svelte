<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import ShieldOff from '@lucide/svelte/icons/shield-off';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';

	let { data } = $props();

	let running = $state(false);

	async function rerun() {
		if (running) return;
		running = true;
		try {
			await invalidateAll();
			toast.success('Verifier finished');
		} catch (e) {
			toast.error('Verifier failed', { description: (e as Error)?.message ?? 'unknown' });
		} finally {
			running = false;
		}
	}

	const errorCopy: Record<string, string> = {
		unauthorized: 'You are signed out. Refresh to retry.',
		forbidden: 'Your role no longer permits running the verifier.',
		not_found: 'Verifier endpoint not found.',
		unreachable: 'Backend unreachable. Try again in a moment.',
		unknown: 'Unexpected error from backend.'
	};

	function formatRanAt(iso: string): string {
		return iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
	}
</script>

<svelte:head>
	<title>Chain verifier · BNR Admin</title>
</svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Chain verifier</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			Walks <code class="bg-muted rounded px-1 py-0.5 text-xs">audit_log</code> in order,
			recomputing
			<code class="bg-muted rounded px-1 py-0.5 text-xs">sha256(prev || row || pepper)</code> per
			row. First mismatch wins.
		</p>
	</div>
	<div class="flex items-center gap-2">
		<Badge variant="outline" class="gap-1.5">
			<ScrollText class="size-3.5" />
			ran {formatRanAt(data.ranAt)}
		</Badge>
		<Button onclick={rerun} disabled={running} class="gap-1.5">
			{#if running}
				<Loader2 class="size-4 animate-spin" />
				Verifying…
			{:else}
				<RotateCcw class="size-4" />
				Run verifier
			{/if}
		</Button>
	</div>
</div>

<!-- Hero -->
<section class="mt-6">
	{#if data.outcome.kind === 'ok'}
		<Card.Root class="border-emerald-500/40 bg-emerald-500/5">
			<Card.Content class="flex flex-col items-start gap-4 py-6 sm:flex-row sm:items-center">
				<div class="grid size-12 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
					<ShieldCheck class="size-6" />
				</div>
				<div class="flex-1">
					<div class="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
						Chain verified
					</div>
					<p class="text-muted-foreground mt-0.5 text-sm">
						All <span class="text-foreground font-medium tabular-nums">{data.outcome.rowsChecked}</span>
						rows hashed-link cleanly end to end.
					</p>
				</div>
				<Badge class="bg-emerald-500 text-white">OK</Badge>
			</Card.Content>
		</Card.Root>
	{:else if data.outcome.kind === 'bad'}
		<Card.Root class="border-rose-500/40 bg-rose-500/5">
			<Card.Content class="flex flex-col items-start gap-4 py-6 sm:flex-row sm:items-center">
				<div class="grid size-12 shrink-0 place-items-center rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300">
					<ShieldAlert class="size-6" />
				</div>
				<div class="flex-1">
					<div class="text-lg font-semibold text-rose-900 dark:text-rose-100">
						Chain tampered
					</div>
					<p class="text-muted-foreground mt-0.5 text-sm">
						Mismatch at row
						<span class="text-foreground font-mono text-xs">{data.outcome.firstBadId ?? '—'}</span>
						after
						<span class="text-foreground font-medium tabular-nums">{data.outcome.rowsChecked}</span>
						good rows. Reason: <span class="text-foreground">{data.outcome.reason}</span>.
					</p>
				</div>
				<Badge variant="destructive">Tampered</Badge>
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root class="border-slate-400/40 bg-slate-500/5">
			<Card.Content class="flex flex-col items-start gap-4 py-6 sm:flex-row sm:items-center">
				<div class="grid size-12 shrink-0 place-items-center rounded-full bg-slate-500/15 text-slate-700 dark:text-slate-300">
					<ShieldOff class="size-6" />
				</div>
				<div class="flex-1">
					<div class="text-lg font-semibold">Verifier unavailable</div>
					<p class="text-muted-foreground mt-0.5 text-sm">
						{errorCopy[data.outcome.reason] ?? data.outcome.reason}
					</p>
				</div>
				<Badge variant="secondary">Unavailable</Badge>
			</Card.Content>
		</Card.Root>
	{/if}
</section>

<!-- Stats -->
<section class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
	<Card.Root class="p-4">
		<div class="text-muted-foreground text-xs">Rows checked</div>
		<div class="mt-1 text-2xl font-semibold tabular-nums">
			{data.outcome.kind === 'unavailable' ? '—' : data.outcome.rowsChecked}
		</div>
	</Card.Root>
	<Card.Root class="p-4">
		<div class="text-muted-foreground text-xs">Last verified id</div>
		<div class="mt-1 truncate font-mono text-sm">
			{data.outcome.kind === 'ok' ? (data.outcome.lastVerifiedId ?? '—') : '—'}
		</div>
	</Card.Root>
	<Card.Root class="p-4">
		<div class="text-muted-foreground text-xs">First bad id</div>
		<div class="mt-1 truncate font-mono text-sm">
			{data.outcome.kind === 'bad' ? (data.outcome.firstBadId ?? '—') : '—'}
		</div>
	</Card.Root>
</section>

{#if data.outcome.kind === 'bad'}
	<Alert.Root variant="destructive" class="mt-6">
		<ShieldAlert class="size-4" />
		<Alert.Title>Investigate immediately</Alert.Title>
		<Alert.Description class="space-y-2">
			<p>
				The audit chain has diverged — at least one row's hash no longer matches its
				recomputation from the previous row.
			</p>
			<div class="flex flex-wrap gap-2 pt-1">
				{#if data.outcome.firstBadId}
					<Button
						href={`/admin/audit?resourceId=${encodeURIComponent(data.outcome.firstBadId)}`}
						size="sm"
						variant="outline"
						class="gap-1.5"
					>
						Open bad row in audit log
						<ArrowRight class="size-3.5" />
					</Button>
				{/if}
				<Button href="/admin/audit" size="sm" variant="ghost">All audit rows</Button>
			</div>
		</Alert.Description>
	</Alert.Root>
{/if}

<Separator class="my-8" />

<!-- How it works -->
<Card.Root>
	<Card.Header>
		<Card.Title class="text-base">How verification works</Card.Title>
	</Card.Header>
	<Card.Content class="text-muted-foreground space-y-2 text-sm">
		<p>
			Every <code class="bg-muted rounded px-1 py-0.5 text-xs">audit_log</code> row carries a
			<code class="bg-muted rounded px-1 py-0.5 text-xs">row_hash</code> computed as
			<code class="bg-muted rounded px-1 py-0.5 text-xs">sha256(prev_hash || canonical_json(row) || pepper)</code>.
		</p>
		<p>
			The verifier walks the table in insertion order, recomputing each hash. The first row whose
			stored hash differs from the recomputed value is the <em>first bad id</em>; the row just
			before it is the <em>last verified id</em>.
		</p>
		<p>
			This is one of three defences: <span class="text-foreground">grants</span> (no UPDATE/DELETE
			on <code class="bg-muted rounded px-1 py-0.5 text-xs">audit_log</code> for
			<code class="bg-muted rounded px-1 py-0.5 text-xs">app_user</code>),
			<span class="text-foreground">trigger</span> (<code class="bg-muted rounded px-1 py-0.5 text-xs">BEFORE UPDATE OR DELETE</code>
			raises), and this <span class="text-foreground">hash chain</span>. All three would have to
			fail simultaneously for tampering to go undetected.
		</p>
	</Card.Content>
</Card.Root>
