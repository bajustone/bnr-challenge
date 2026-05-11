<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	let { data, form } = $props();

	let submitting = $state(false);

	function instLabel(raw: string): string {
		return raw.replaceAll('_', ' ');
	}

	const errorCopy: Record<string, string> = {
		forbidden: 'You do not own this application.',
		conflict: 'Another change landed first — refresh and retry.',
		unreachable: 'Backend unreachable. Try again in a moment.',
		unknown: 'Unexpected error.'
	};

	const fieldErrors = $derived(form?.code === 'invalid' ? form.fieldErrors : {});

	const initialPayload = $derived(
		Object.keys(data.application.payload).length === 0
			? ''
			: JSON.stringify(data.application.payload, null, 2)
	);

	const values = $derived(
		form?.code === 'invalid' || form?.code === 'backend'
			? form.values
			: {
					institutionName: data.application.institutionName,
					institutionType: data.application.institutionType,
					payload: initialPayload
				}
	);
</script>

<svelte:head>
	<title>Edit · {data.application.institutionName}</title>
</svelte:head>

<div class="mb-2">
	<Button href={`/applications/${data.application.id}`} variant="ghost" size="sm" class="gap-1.5">
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
			class="space-y-5"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
			novalidate
		>
			<div class="space-y-1.5">
				<Label for="institutionName">Institution name</Label>
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
				<Label for="institutionType">Institution type</Label>
				<select
					id="institutionType"
					name="institutionType"
					class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
					required
					aria-invalid={fieldErrors.institutionType ? 'true' : undefined}
				>
					{#each data.institutionTypes as t (t)}
						<option value={t} selected={values.institutionType === t}>{instLabel(t)}</option>
					{/each}
				</select>
				{#if fieldErrors.institutionType}
					<p class="text-destructive text-xs">{fieldErrors.institutionType}</p>
				{/if}
			</div>

			<div class="space-y-1.5">
				<Label for="payload">Payload (JSON)</Label>
				<textarea
					id="payload"
					name="payload"
					rows="10"
					class="border-input bg-background ring-offset-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 font-mono text-xs leading-snug shadow-sm focus-visible:outline-none focus-visible:ring-1"
					aria-invalid={fieldErrors.payload ? 'true' : undefined}>{values.payload}</textarea>
				{#if fieldErrors.payload}
					<p class="text-destructive text-xs">{fieldErrors.payload}</p>
				{/if}
			</div>

			<div class="flex items-center gap-2">
				<Button type="submit" disabled={submitting} class="gap-1.5">
					{#if submitting}<Loader2 class="size-4 animate-spin" />{/if}
					Save changes
				</Button>
				<Button href={`/applications/${data.application.id}`} variant="ghost" type="button">
					Cancel
				</Button>
			</div>
		</form>
	</Card.Content>
</Card.Root>
