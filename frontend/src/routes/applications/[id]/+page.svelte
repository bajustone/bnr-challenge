<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import FileText from '@lucide/svelte/icons/file-text';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import History from '@lucide/svelte/icons/history';
	import Download from '@lucide/svelte/icons/download';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Upload from '@lucide/svelte/icons/upload';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Send from '@lucide/svelte/icons/send';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import MailQuestion from '@lucide/svelte/icons/mail-question';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import X from '@lucide/svelte/icons/x';
	import {
		TRANSITION_EVENTS,
		transition,
		type ApplicationStatus,
		type Role,
		type TransitionEvent
	} from 'bnr-shared/domain/state-machine';

	let { data, form } = $props();

	// ── Roles ─────────────────────────────────────────────────────
	const isOwner = $derived(data.user?.id === data.application.applicantId);
	const isStaff = $derived(
		data.roles.includes('reviewer') ||
			data.roles.includes('approver') ||
			data.roles.includes('admin')
	);
	const isEditable = $derived(
		isOwner && (data.application.status === 'DRAFT' || data.application.status === 'RFI_REQUESTED')
	);

	// ── Allowed transitions (computed client-side via the same pure
	//    function the backend uses) ──────────────────────────────────
	type Spec = {
		label: string;
		variant: 'default' | 'outline' | 'destructive' | 'secondary';
		icon: typeof Send;
		needs?: 'message' | 'reason';
		description?: string;
	};

	const EVENT_SPECS: Record<TransitionEvent, Spec> = {
		submit: {
			label: 'Submit for review',
			variant: 'default',
			icon: Send,
			description: 'Hands the draft to reviewers. You can still withdraw after.'
		},
		withdraw: {
			label: 'Withdraw',
			variant: 'destructive',
			icon: X,
			description: 'Terminal — the application closes and cannot be reopened.'
		},
		assign: {
			label: 'Assign to me',
			variant: 'default',
			icon: UserCheck,
			description: 'Claims this submission for your review.'
		},
		request_info: {
			label: 'Request more information',
			variant: 'outline',
			icon: MailQuestion,
			needs: 'message',
			description: 'Sends an applicant-visible note and pauses for their reply.'
		},
		mark_ready: {
			label: 'Mark ready for decision',
			variant: 'default',
			icon: ListChecks,
			description: 'Hands the application to an approver.'
		},
		resubmit: {
			label: 'Resubmit',
			variant: 'default',
			icon: RotateCcw,
			description: 'Re-enters the review queue with your updates.'
		},
		approve: {
			label: 'Approve',
			variant: 'default',
			icon: CircleCheck,
			needs: 'reason',
			description: 'Final approval. Dual control prevents you from approving applications you reviewed.'
		},
		reject: {
			label: 'Reject',
			variant: 'destructive',
			icon: CircleX,
			needs: 'reason',
			description: 'Final rejection. A reason is strongly recommended.'
		}
	};

	const allowedEvents = $derived.by(() => {
		if (!data.user) return [] as TransitionEvent[];
		const allowed: TransitionEvent[] = [];
		for (const ev of TRANSITION_EVENTS) {
			const r = transition({
				currentStatus: data.application.status,
				event: ev,
				actor: { id: data.user.id, roles: data.roles },
				application: {
					applicantId: data.application.applicantId,
					reviewedBy: data.application.reviewedBy,
					decidedBy: data.application.decidedBy
				},
				// placeholder so the `requiresMessage` guard doesn't kill the
				// eligibility check — the real message comes from the form.
				message: '_check_'
			});
			if (r.ok) allowed.push(ev);
		}
		return allowed;
	});

	// Dual-control hint for approver: when the applicaton is READY_FOR_DECISION
	// but the actor is the reviewer, `approve`/`reject` get filtered out.
	// Surface a banner so the user understands why.
	const dualControlBlocks = $derived(
		data.application.status === 'READY_FOR_DECISION' &&
			data.application.reviewedBy === data.user?.id &&
			(data.roles.includes('approver') || data.roles.includes('admin'))
	);

	// ── Local UI state ────────────────────────────────────────────
	let composing = $state<TransitionEvent | null>(null);
	let composeText = $state('');
	let transitioning = $state<TransitionEvent | null>(null);
	let postingNote = $state(false);
	let uploading = $state(false);

	function startCompose(event: TransitionEvent) {
		composing = event;
		composeText = '';
	}
	function cancelCompose() {
		composing = null;
		composeText = '';
	}

	const transitionErrorCopy: Record<string, string> = {
		conflict: 'The application moved since you loaded it — refresh.',
		forbidden: 'Your role does not allow this transition.',
		unreachable: 'Backend unreachable. Try again in a moment.',
		not_found: 'Application not found.',
		unauthorized: 'You are signed out.'
	};

	// ── Presentation helpers ──────────────────────────────────────
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

	const roleTone: Record<Role, string> = {
		applicant: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
		reviewer: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300',
		approver: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300',
		admin: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300'
	};

	function short(id: string | null | undefined): string {
		return id ? id.slice(0, 8) : '—';
	}
	function fmt(iso: string | null | undefined): string {
		return iso ? new Date(iso).toLocaleString() : '—';
	}
	function fmtBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / 1024 / 1024).toFixed(2)} MB`;
	}
	function instType(raw: string): string {
		return raw.replaceAll('_', ' ');
	}
	function prettyJson(v: unknown): string {
		try {
			return JSON.stringify(v, null, 2);
		} catch {
			return String(v);
		}
	}
	function downloadHref(docId: string): string {
		return `/applications/documents/${encodeURIComponent(docId)}`;
	}
</script>

<svelte:head>
	<title>{data.application.institutionName} · Application</title>
</svelte:head>

<div class="mb-2">
	<Button href="/applications" variant="ghost" size="sm" class="gap-1.5">
		<ChevronLeft class="size-4" />
		Applications
	</Button>
</div>

<div class="flex flex-wrap items-start justify-between gap-3">
	<div class="min-w-0">
		<div class="flex items-center gap-2">
			<h1 class="truncate text-2xl font-semibold tracking-tight">
				{data.application.institutionName}
			</h1>
			<span
				class="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] tracking-tight {statusTone[
					data.application.status
				]}"
			>
				{data.application.status}
			</span>
		</div>
		<p class="text-muted-foreground mt-1 text-sm">
			{instType(data.application.institutionType)} ·
			<span class="font-mono text-xs">{data.application.id}</span>
		</p>
	</div>
	<div class="flex items-center gap-2">
		{#if isOwner}
			<Badge variant="outline" class="text-[10px]">you own this</Badge>
		{/if}
		<Badge variant="outline" class="text-[10px]">v{data.application.version}</Badge>
		{#if isEditable}
			<Button href={`/applications/${data.application.id}/edit`} size="sm" class="gap-1.5">
				<Pencil class="size-3.5" />
				Edit
			</Button>
		{/if}
	</div>
</div>

<div class="mt-6 grid grid-cols-12 gap-6">
	<!-- Main column -->
	<div class="col-span-12 space-y-6 lg:col-span-8">
		<!-- Actions -->
		{#if allowedEvents.length > 0 || dualControlBlocks}
			<Card.Root class="border-brand/30">
				<Card.Header>
					<div class="flex items-center gap-2">
						<ListChecks class="text-brand size-4" />
						<Card.Title class="text-base">What you can do</Card.Title>
					</div>
					<Card.Description>
						Buttons are filtered by the workflow state machine — only legal transitions appear.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if dualControlBlocks}
						<Alert.Root class="mb-4">
							<TriangleAlert class="size-4" />
							<Alert.Title>Dual control blocks you</Alert.Title>
							<Alert.Description>
								You reviewed this application, so you cannot approve or reject it. Another
								approver must take the decision.
							</Alert.Description>
						</Alert.Root>
					{/if}

					{#if allowedEvents.length === 0}
						<p class="text-muted-foreground text-sm">No actions available to you in this state.</p>
					{:else}
						<div class="flex flex-wrap gap-2">
							{#each allowedEvents as ev (ev)}
								{@const spec = EVENT_SPECS[ev]}
								{#if !spec.needs}
									<form
										method="POST"
										action="?/transition"
										use:enhance={() => {
											transitioning = ev;
											return async ({ result }) => {
												transitioning = null;
												if (result.type === 'success') {
													toast.success(`${spec.label} done`);
													await invalidateAll();
												} else if (result.type === 'failure') {
													const d = result.data as
														| { error?: string; detail?: string }
														| undefined;
													toast.error('Action failed', {
														description:
															transitionErrorCopy[d?.error ?? 'unknown'] ??
															d?.detail ??
															(d?.error ?? 'unknown')
													});
												} else if (result.type === 'error') {
													toast.error('Action failed', {
														description: result.error?.message ?? 'unknown'
													});
												}
											};
										}}
									>
										<input type="hidden" name="event" value={ev} />
										<Button
											type="submit"
											variant={spec.variant}
											disabled={transitioning !== null}
											class="gap-1.5"
										>
											{#if transitioning === ev}
												<Loader2 class="size-4 animate-spin" />
											{:else}
												<spec.icon class="size-4" />
											{/if}
											{spec.label}
										</Button>
									</form>
								{:else}
									<Button
										variant={spec.variant}
										onclick={() => startCompose(ev)}
										class="gap-1.5"
										disabled={transitioning !== null}
									>
										<spec.icon class="size-4" />
										{spec.label}
									</Button>
								{/if}
							{/each}
						</div>

						{#if composing}
							{@const spec = EVENT_SPECS[composing]}
							{@const needsMessage = spec.needs === 'message'}
							<form
								method="POST"
								action="?/transition"
								class="mt-5 space-y-3 rounded-md border p-4"
								use:enhance={() => {
									transitioning = composing;
									return async ({ result }) => {
										transitioning = null;
										if (result.type === 'success') {
											toast.success(`${spec.label} done`);
											cancelCompose();
											await invalidateAll();
										} else if (result.type === 'failure') {
											const d = result.data as
												| { error?: string; detail?: string }
												| undefined;
											toast.error('Action failed', {
												description:
													transitionErrorCopy[d?.error ?? 'unknown'] ??
													d?.detail ??
													(d?.error ?? 'unknown')
											});
										} else if (result.type === 'error') {
											toast.error('Action failed', {
												description: result.error?.message ?? 'unknown'
											});
										}
									};
								}}
							>
								<input type="hidden" name="event" value={composing} />
								<div>
									<h3 class="text-sm font-semibold">{spec.label}</h3>
									{#if spec.description}
										<p class="text-muted-foreground mt-0.5 text-xs">{spec.description}</p>
									{/if}
								</div>
								<div class="space-y-1.5">
									<Label for="compose-text" class="text-xs">
										{needsMessage ? 'Message for applicant' : 'Reason'}
										{#if needsMessage}<span class="text-destructive">*</span>{/if}
									</Label>
									<textarea
										id="compose-text"
										name={needsMessage ? 'message' : 'reason'}
										bind:value={composeText}
										rows="4"
										placeholder={needsMessage
											? 'Explain what the applicant needs to provide…'
											: 'Optional rationale visible in the audit trail'}
										required={needsMessage}
										class="border-input bg-background ring-offset-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
									></textarea>
								</div>
								<div class="flex items-center gap-2">
									<Button
										type="submit"
										variant={spec.variant}
										disabled={transitioning !== null || (needsMessage && !composeText.trim())}
										class="gap-1.5"
									>
										{#if transitioning === composing}
											<Loader2 class="size-4 animate-spin" />
										{:else}
											<spec.icon class="size-4" />
										{/if}
										Confirm
									</Button>
									<Button type="button" variant="ghost" onclick={cancelCompose}>Cancel</Button>
								</div>
							</form>
						{/if}
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}

		<!-- Payload -->
		<Card.Root>
			<Card.Header>
				<div class="flex items-center gap-2">
					<FileText class="text-brand size-4" />
					<Card.Title class="text-base">Application data</Card.Title>
				</div>
				<Card.Description>
					Free-form payload captured at submission. {#if isEditable}Use Edit to
						update.{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if Object.keys(data.application.payload).length === 0}
					<p class="text-muted-foreground text-sm">Payload is empty.</p>
				{:else}
					<pre class="bg-muted/40 overflow-auto rounded-md border p-3 text-[12px] leading-snug font-mono">{prettyJson(
							data.application.payload
						)}</pre>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- Documents -->
		<Card.Root>
			<Card.Header>
				<div class="flex items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<Paperclip class="text-brand size-4" />
						<Card.Title class="text-base">Documents</Card.Title>
					</div>
					<Badge variant="outline">{data.documents.length}</Badge>
				</div>
			</Card.Header>
			<Card.Content class="p-0">
				{#if data.errors.documents}
					<div class="px-6 py-4">
						<Alert.Root variant="destructive">
							<TriangleAlert class="size-4" />
							<Alert.Title>Couldn't load documents</Alert.Title>
						</Alert.Root>
					</div>
				{:else if data.documents.length === 0}
					<p class="text-muted-foreground px-6 py-8 text-center text-sm">
						No documents uploaded.
					</p>
				{:else}
					<ul class="divide-y">
						{#each data.documents as d (d.id)}
							<li class="flex items-center gap-3 px-6 py-3">
								<div class="min-w-0 flex-1">
									<div class="truncate font-medium">{d.filename}</div>
									<div class="text-muted-foreground text-xs">
										slot <span class="font-mono">{d.slot}</span> · v{d.version} · {fmtBytes(
											d.sizeBytes
										)} · {d.mimeType}
									</div>
								</div>
								<Button
									href={downloadHref(d.id)}
									variant="ghost"
									size="sm"
									class="gap-1.5"
									target="_blank"
									rel="noopener"
								>
									<Download class="size-3.5" />
									Download
								</Button>
							</li>
						{/each}
					</ul>
				{/if}

				{#if isEditable}
					<Separator />
					<form
						method="POST"
						action="?/upload"
						enctype="multipart/form-data"
						class="space-y-3 px-6 py-4"
						use:enhance={() => {
							uploading = true;
							return async ({ result, formElement }) => {
								uploading = false;
								if (result.type === 'success') {
									toast.success('Document uploaded');
									formElement.reset();
									await invalidateAll();
								} else if (result.type === 'failure') {
									const d = result.data as
										| { fieldErrors?: Record<string, string>; error?: string }
										| undefined;
									const msg =
										d?.fieldErrors?.file ??
										d?.fieldErrors?.slot ??
										transitionErrorCopy[d?.error ?? 'unknown'] ??
										(d?.error ?? 'unknown');
									toast.error('Upload failed', { description: msg });
								} else if (result.type === 'error') {
									toast.error('Upload failed', {
										description: result.error?.message ?? 'unknown'
									});
								}
							};
						}}
					>
						<div class="flex items-center gap-2">
							<Upload class="text-brand size-4" />
							<h3 class="text-sm font-semibold">Upload a document</h3>
						</div>
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div class="space-y-1.5">
								<Label for="slot" class="text-xs">Slot</Label>
								<Input
									id="slot"
									name="slot"
									placeholder="e.g. business_plan"
									maxlength={64}
									required
								/>
							</div>
							<div class="space-y-1.5">
								<Label for="file" class="text-xs">File (≤ 5 MiB)</Label>
								<input
									id="file"
									name="file"
									type="file"
									required
									class="file:bg-muted file:text-foreground hover:file:bg-muted/80 border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm file:mr-3 file:h-7 file:rounded-sm file:border-0 file:px-3 file:text-xs"
								/>
							</div>
						</div>
						<Button type="submit" disabled={uploading} class="gap-1.5">
							{#if uploading}
								<Loader2 class="size-4 animate-spin" />
							{:else}
								<Upload class="size-4" />
							{/if}
							Upload
						</Button>
					</form>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- Notes -->
		<Card.Root>
			<Card.Header>
				<div class="flex items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<MessageSquare class="text-brand size-4" />
						<Card.Title class="text-base">Review notes</Card.Title>
					</div>
					<Badge variant="outline">{data.notes.length}</Badge>
				</div>
				<Card.Description>
					Applicants see only notes marked <span class="font-medium">applicant</span>.
				</Card.Description>
			</Card.Header>
			<Card.Content class="p-0">
				{#if data.errors.notes}
					<div class="px-6 py-4">
						<Alert.Root variant="destructive">
							<TriangleAlert class="size-4" />
							<Alert.Title>Couldn't load notes</Alert.Title>
						</Alert.Root>
					</div>
				{:else if data.notes.length === 0}
					<p class="text-muted-foreground px-6 py-8 text-center text-sm">No notes yet.</p>
				{:else}
					<ul class="divide-y">
						{#each data.notes as n (n.id)}
							<li class="px-6 py-4">
								<div class="flex items-center gap-2">
									<span
										class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide {roleTone[
											n.authorRole
										]}"
									>
										{n.authorRole}
									</span>
									<span class="font-mono text-xs">{short(n.authorId)}</span>
									{#if n.visibility === 'staff'}
										<Badge variant="secondary" class="text-[10px]">staff-only</Badge>
									{:else}
										<Badge variant="outline" class="text-[10px]">applicant-visible</Badge>
									{/if}
									<span class="text-muted-foreground ml-auto text-xs">{fmt(n.createdAt)}</span>
								</div>
								<p class="text-foreground/90 mt-2 whitespace-pre-wrap text-sm">{n.body}</p>
							</li>
						{/each}
					</ul>
				{/if}

				{#if isStaff}
					<Separator />
					<form
						method="POST"
						action="?/note"
						class="space-y-3 px-6 py-4"
						use:enhance={() => {
							postingNote = true;
							return async ({ result, formElement }) => {
								postingNote = false;
								if (result.type === 'success') {
									toast.success('Note posted');
									formElement.reset();
									await invalidateAll();
								} else if (result.type === 'failure') {
									const d = result.data as
										| { fieldErrors?: Record<string, string>; error?: string }
										| undefined;
									const msg =
										d?.fieldErrors?.body ??
										transitionErrorCopy[d?.error ?? 'unknown'] ??
										(d?.error ?? 'unknown');
									toast.error('Couldn\'t post note', { description: msg });
								} else if (result.type === 'error') {
									toast.error('Couldn\'t post note', {
										description: result.error?.message ?? 'unknown'
									});
								}
							};
						}}
					>
						<div class="space-y-1.5">
							<Label for="note-body" class="text-xs">Add a note</Label>
							<textarea
								id="note-body"
								name="body"
								rows="3"
								required
								maxlength={10000}
								placeholder="Visible to staff by default. Toggle below to share with the applicant."
								class="border-input bg-background ring-offset-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
							></textarea>
						</div>
						<div class="flex flex-wrap items-center gap-3">
							<fieldset class="flex items-center gap-3 text-sm">
								<legend class="sr-only">Visibility</legend>
								<label class="flex items-center gap-1.5">
									<input type="radio" name="visibility" value="staff" checked class="size-3.5" />
									<span>Staff-only</span>
								</label>
								<label class="flex items-center gap-1.5">
									<input type="radio" name="visibility" value="applicant" class="size-3.5" />
									<span>Applicant-visible</span>
								</label>
							</fieldset>
							<Button type="submit" disabled={postingNote} class="ml-auto gap-1.5">
								{#if postingNote}
									<Loader2 class="size-4 animate-spin" />
								{:else}
									<Send class="size-4" />
								{/if}
								Post note
							</Button>
						</div>
					</form>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Side column -->
	<aside class="col-span-12 space-y-6 lg:col-span-4">
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Details</Card.Title>
			</Card.Header>
			<Card.Content class="text-sm">
				<dl class="space-y-2">
					<div class="flex items-baseline justify-between gap-2">
						<dt class="text-muted-foreground text-xs">Applicant</dt>
						<dd class="font-mono text-xs">{short(data.application.applicantId)}</dd>
					</div>
					<div class="flex items-baseline justify-between gap-2">
						<dt class="text-muted-foreground text-xs">Created</dt>
						<dd class="text-xs">{fmt(data.application.createdAt)}</dd>
					</div>
					<div class="flex items-baseline justify-between gap-2">
						<dt class="text-muted-foreground text-xs">Updated</dt>
						<dd class="text-xs">{fmt(data.application.updatedAt)}</dd>
					</div>
					<Separator />
					<div class="flex items-baseline justify-between gap-2">
						<dt class="text-muted-foreground text-xs">Submitted</dt>
						<dd class="text-xs">{fmt(data.application.submittedAt)}</dd>
					</div>
					<div class="flex items-baseline justify-between gap-2">
						<dt class="text-muted-foreground text-xs">Reviewer</dt>
						<dd class="font-mono text-xs">{short(data.application.reviewedBy)}</dd>
					</div>
					<div class="flex items-baseline justify-between gap-2">
						<dt class="text-muted-foreground text-xs">Reviewed</dt>
						<dd class="text-xs">{fmt(data.application.reviewedAt)}</dd>
					</div>
					<Separator />
					<div class="flex items-baseline justify-between gap-2">
						<dt class="text-muted-foreground text-xs">Decided by</dt>
						<dd class="font-mono text-xs">{short(data.application.decidedBy)}</dd>
					</div>
					<div class="flex items-baseline justify-between gap-2">
						<dt class="text-muted-foreground text-xs">Decided</dt>
						<dd class="text-xs">{fmt(data.application.decidedAt)}</dd>
					</div>
					{#if data.application.decision}
						<div class="flex items-baseline justify-between gap-2">
							<dt class="text-muted-foreground text-xs">Decision</dt>
							<dd>
								<Badge
									class={data.application.decision === 'APPROVED'
										? 'bg-emerald-500/15 text-[10px] text-emerald-700 dark:text-emerald-300'
										: 'bg-rose-500/15 text-[10px] text-rose-700 dark:text-rose-300'}
								>
									{data.application.decision}
								</Badge>
							</dd>
						</div>
					{/if}
					{#if data.application.decisionReason}
						<div class="text-muted-foreground mt-1 text-xs italic">
							"{data.application.decisionReason}"
						</div>
					{/if}
				</dl>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<div class="flex items-center gap-2">
					<History class="text-brand size-4" />
					<Card.Title class="text-base">History</Card.Title>
				</div>
				<Card.Description>Every audited event for this application.</Card.Description>
			</Card.Header>
			<Card.Content class="p-0">
				{#if data.errors.history}
					<div class="px-6 py-4">
						<Alert.Root variant="destructive">
							<TriangleAlert class="size-4" />
							<Alert.Title>Couldn't load history</Alert.Title>
						</Alert.Root>
					</div>
				{:else if data.history.length === 0}
					<p class="text-muted-foreground px-6 py-6 text-center text-sm">No events yet.</p>
				{:else}
					<ol class="border-border/60 relative ml-6 border-l py-4">
						{#each data.history as h (h.id)}
							<li class="mb-4 ml-4 last:mb-0">
								<span
									class="bg-brand border-background absolute -left-[5px] mt-1 size-2.5 rounded-full border-2"
								></span>
								<div class="flex flex-wrap items-baseline gap-2 text-xs">
									<span class="font-mono">{h.action}</span>
									<span class="text-muted-foreground">·</span>
									<span
										class="inline-flex items-center rounded-full px-1.5 py-0 text-[10px] uppercase tracking-wide {roleTone[
											h.actorRole
										]}"
									>
										{h.actorRole}
									</span>
									<span class="font-mono">{short(h.actorId)}</span>
								</div>
								<div class="text-muted-foreground mt-0.5 text-[11px]">{fmt(h.occurredAt)}</div>
							</li>
						{/each}
					</ol>
				{/if}
			</Card.Content>
		</Card.Root>
	</aside>
</div>
