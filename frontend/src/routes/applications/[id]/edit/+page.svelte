<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	let { data, form } = $props();
	let submitting = $state(false);
	let advancedOpen = $state(false);

	const TYPE_META: Record<string, { label: string; blurb: string }> = {
		commercial_bank: {
			label: 'Commercial Bank',
			blurb: 'Deposit-taking, full banking licence.'
		},
		microfinance_bank: {
			label: 'Microfinance Bank',
			blurb: 'Tiered MFI licensed to take deposits.'
		},
		microfinance_institution: {
			label: 'Microfinance Institution',
			blurb: 'Non-deposit-taking MFI.'
		},
		sacco: { label: 'SACCO', blurb: 'Savings and credit cooperative.' },
		payment_service_provider: {
			label: 'Payment Service Provider',
			blurb: 'Issuer, acquirer, aggregator or remittance.'
		},
		forex_bureau: { label: 'Forex Bureau', blurb: 'Foreign-currency exchange outlet(s).' },
		insurance_company: {
			label: 'Insurance Company',
			blurb: 'Life, non-life or composite insurer.'
		},
		pension_fund: {
			label: 'Pension Fund',
			blurb: 'Occupational or personal pension scheme.'
		}
	};

	function instLabel(raw: string): string {
		return TYPE_META[raw]?.label ?? raw.replaceAll('_', ' ');
	}

	const errorCopy: Record<string, string> = {
		forbidden: 'You do not own this application.',
		conflict: 'Another change landed first — refresh and retry.',
		unreachable: 'Backend unreachable. Try again in a moment.',
		unknown: 'Unexpected error.'
	};

	const fieldErrors = $derived(form?.code === 'invalid' ? form.fieldErrors : {});

	// On first render (and when form failed), prefer the user's submitted
	// values. Otherwise, derive defaults from the application payload — the
	// server already split known structured keys into `data.initial` so we
	// just read them.
	const values = $derived(
		form?.code === 'invalid' || form?.code === 'backend'
			? form.values
			: {
					institutionName: data.application.institutionName,
					institutionType: data.application.institutionType,
					tradingName: data.initial.tradingName ?? '',
					registrationNumber: data.initial.registrationNumber ?? '',
					tin: data.initial.tin ?? '',
					contactName: data.initial.contactName ?? '',
					contactEmail: data.initial.contactEmail ?? '',
					contactPhone: data.initial.contactPhone ?? '',
					address: data.initial.address ?? '',
					website: data.initial.website ?? '',
					yearEstablished:
						data.initial.yearEstablished != null ? String(data.initial.yearEstablished) : '',
					estimatedAssetsRwf:
						data.initial.estimatedAssetsRwf != null
							? String(data.initial.estimatedAssetsRwf)
							: '',
					payload: data.initial.advancedPayload
				}
	);

	let selectedType = $state(values.institutionType ?? '');
	let assetsDisplay = $state(
		values.estimatedAssetsRwf
			? Number(String(values.estimatedAssetsRwf).replace(/[^\d]/g, '')).toLocaleString('en-RW')
			: ''
	);

	function onAssetsInput(e: Event) {
		const raw = (e.target as HTMLInputElement).value.replace(/[^\d]/g, '');
		assetsDisplay = raw ? Number(raw).toLocaleString('en-RW') : '';
	}

	// If the advanced JSON is non-empty on first render, surface it so the
	// editor can see they have residual keys that weren't pulled into fields.
	$effect(() => {
		if (values.payload && values.payload.trim().length > 0) advancedOpen = true;
	});
</script>

<svelte:head>
	<title>Edit · {data.application.institutionName}</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<div class="mb-2">
		<Button
			href={`/applications/${data.application.id}`}
			variant="ghost"
			size="sm"
			class="gap-1.5"
		>
			<ChevronLeft class="size-4" />
			Back to application
		</Button>
	</div>

	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Edit application</h1>
			<p class="text-muted-foreground mt-1 text-sm">
				Editable while in <span class="font-mono text-xs">DRAFT</span> or
				<span class="font-mono text-xs">RFI_REQUESTED</span>.
			</p>
		</div>
		<Badge variant="outline" class="font-mono text-[10px] tracking-tight">
			{data.application.status}
		</Badge>
	</div>

	{#if form?.code === 'backend'}
		<Alert.Root variant="destructive" class="mt-6">
			<TriangleAlert class="size-4" />
			<Alert.Title>Couldn't save</Alert.Title>
			<Alert.Description>{errorCopy[form.error] ?? form.error}</Alert.Description>
		</Alert.Root>
	{/if}

	<Card.Root class="mt-6">
		<Card.Content class="pt-6">
			<form
				method="POST"
				class="space-y-6"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
				novalidate
			>
				<!-- Section: Institution -->
				<section class="space-y-4">
					<h2 class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
						Institution
					</h2>

					<div class="space-y-1.5">
						<Label for="institutionName">
							Legal name <span class="text-destructive">*</span>
						</Label>
						<Input
							id="institutionName"
							name="institutionName"
							value={values.institutionName}
							aria-invalid={fieldErrors.institutionName ? 'true' : undefined}
							maxlength={200}
							required
						/>
						{#if fieldErrors.institutionName}
							<p class="text-destructive text-xs">{fieldErrors.institutionName}</p>
						{/if}
					</div>

					<div class="space-y-1.5">
						<Label for="tradingName">
							Trading name <span class="text-muted-foreground">(optional)</span>
						</Label>
						<Input
							id="tradingName"
							name="tradingName"
							value={values.tradingName}
							maxlength={200}
						/>
					</div>

					<div class="space-y-1.5">
						<Label for="institutionType">
							Institution type <span class="text-destructive">*</span>
						</Label>
						<select
							id="institutionType"
							name="institutionType"
							bind:value={selectedType}
							class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50"
							required
							aria-invalid={fieldErrors.institutionType ? 'true' : undefined}
						>
							{#each data.institutionTypes as t (t)}
								<option value={t}>{instLabel(t)}</option>
							{/each}
						</select>
						{#if selectedType && TYPE_META[selectedType]}
							<p class="text-muted-foreground text-xs">{TYPE_META[selectedType].blurb}</p>
						{/if}
						{#if fieldErrors.institutionType}
							<p class="text-destructive text-xs">{fieldErrors.institutionType}</p>
						{/if}
					</div>

					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div class="space-y-1.5">
							<Label for="registrationNumber">RDB registration no.</Label>
							<Input
								id="registrationNumber"
								name="registrationNumber"
								value={values.registrationNumber}
								placeholder="e.g. 1234567890"
								maxlength={40}
							/>
						</div>
						<div class="space-y-1.5">
							<Label for="tin">TIN</Label>
							<Input
								id="tin"
								name="tin"
								value={values.tin}
								placeholder="e.g. 101234567"
								maxlength={40}
							/>
						</div>
					</div>
				</section>

				<!-- Section: Primary contact -->
				<section class="space-y-4">
					<h2 class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
						Primary contact
					</h2>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div class="space-y-1.5">
							<Label for="contactName">
								Full name <span class="text-destructive">*</span>
							</Label>
							<Input
								id="contactName"
								name="contactName"
								value={values.contactName}
								maxlength={200}
								required
								aria-invalid={fieldErrors.contactName ? 'true' : undefined}
							/>
							{#if fieldErrors.contactName}
								<p class="text-destructive text-xs">{fieldErrors.contactName}</p>
							{/if}
						</div>
						<div class="space-y-1.5">
							<Label for="contactEmail">
								Email <span class="text-destructive">*</span>
							</Label>
							<Input
								id="contactEmail"
								name="contactEmail"
								type="email"
								value={values.contactEmail}
								maxlength={200}
								required
								aria-invalid={fieldErrors.contactEmail ? 'true' : undefined}
							/>
							{#if fieldErrors.contactEmail}
								<p class="text-destructive text-xs">{fieldErrors.contactEmail}</p>
							{/if}
						</div>
						<div class="space-y-1.5">
							<Label for="contactPhone">Phone</Label>
							<Input
								id="contactPhone"
								name="contactPhone"
								type="tel"
								placeholder="+250 7..."
								value={values.contactPhone}
								maxlength={40}
							/>
						</div>
						<div class="space-y-1.5">
							<Label for="website">Website</Label>
							<Input
								id="website"
								name="website"
								type="url"
								placeholder="https://"
								value={values.website}
								maxlength={300}
							/>
						</div>
					</div>
					<div class="space-y-1.5">
						<Label for="address">Head-office address</Label>
						<Input
							id="address"
							name="address"
							value={values.address}
							placeholder="District, Sector, Street"
							maxlength={300}
						/>
					</div>
				</section>

				<!-- Section: Financials -->
				<section class="space-y-4">
					<h2 class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
						Financials
					</h2>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div class="space-y-1.5">
							<Label for="estimatedAssetsRwf">Estimated assets</Label>
							<div class="relative">
								<span
									class="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs"
								>
									RWF
								</span>
								<Input
									id="estimatedAssetsRwf"
									name="estimatedAssetsRwf"
									inputmode="numeric"
									class="pl-12 text-right"
									value={assetsDisplay}
									oninput={onAssetsInput}
									aria-invalid={fieldErrors.estimatedAssetsRwf ? 'true' : undefined}
								/>
							</div>
							{#if fieldErrors.estimatedAssetsRwf}
								<p class="text-destructive text-xs">{fieldErrors.estimatedAssetsRwf}</p>
							{/if}
						</div>
						<div class="space-y-1.5">
							<Label for="yearEstablished">Year established</Label>
							<Input
								id="yearEstablished"
								name="yearEstablished"
								type="number"
								min="1900"
								max={new Date().getFullYear()}
								value={values.yearEstablished}
							/>
						</div>
					</div>
				</section>

				<!-- Advanced JSON escape hatch -->
				<section class="border-t pt-4">
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs"
						onclick={() => (advancedOpen = !advancedOpen)}
						aria-expanded={advancedOpen}
					>
						<ChevronDown
							class="size-3.5 transition-transform {advancedOpen ? '' : '-rotate-90'}"
						/>
						Advanced — extra JSON keys
					</button>
					{#if advancedOpen}
						<div class="mt-3 space-y-1.5">
							<Label for="payload" class="sr-only">Payload JSON</Label>
							<textarea
								id="payload"
								name="payload"
								rows="8"
								placeholder={'{\n  "internalRef": "..."\n}'}
								class="border-input bg-background ring-offset-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 font-mono text-xs leading-snug shadow-sm focus-visible:outline-none focus-visible:ring-1"
								aria-invalid={fieldErrors.payload ? 'true' : undefined}>{values.payload}</textarea>
							{#if fieldErrors.payload}
								<p class="text-destructive text-xs">{fieldErrors.payload}</p>
							{:else}
								<p class="text-muted-foreground text-xs">
									Any keys not handled by the form above. Structured fields take precedence on save.
								</p>
							{/if}
						</div>
					{/if}
				</section>

				<div class="flex items-center gap-2 border-t pt-4">
					<Button type="submit" disabled={submitting} class="gap-1.5">
						{#if submitting}<Loader2 class="size-4 animate-spin" />{/if}
						Save changes
					</Button>
					<Button
						href={`/applications/${data.application.id}`}
						variant="outline"
						type="button"
					>
						Cancel
					</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
</div>
