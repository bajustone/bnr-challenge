<script lang="ts">
	import TopBar from '$lib/components/portal/TopBar.svelte';
	let { data, children } = $props();
</script>

<div class="bg-background text-foreground min-h-svh">
	<TopBar user={data.user} roles={data.roles} />
	<main class="mx-auto max-w-6xl px-6 py-8">
		{@render children()}
	</main>
</div>
