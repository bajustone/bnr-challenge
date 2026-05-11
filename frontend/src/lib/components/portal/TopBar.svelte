<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { toggleMode } from 'mode-watcher';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import ShieldUser from '@lucide/svelte/icons/shield-user';
	import type { Role } from 'bnr-shared/domain/state-machine';

	type Props = {
		user: { name: string; email: string } | null;
		roles: Role[];
	};
	let { user, roles }: Props = $props();

	type NavItem = { href: string; label: string; match?: 'exact' | 'prefix' };
	const navItems: NavItem[] = [
		{ href: '/', label: 'Home', match: 'exact' },
		{ href: '/applications', label: 'Applications' }
	];

	function isActive(item: NavItem): boolean {
		const path = page.url.pathname;
		if (item.match === 'exact') return path === item.href;
		return path === item.href || path.startsWith(item.href + '/');
	}

	const isAdmin = $derived(roles.includes('admin'));
	const primaryRole = $derived<Role | null>(
		roles.includes('admin')
			? 'admin'
			: roles.includes('approver')
				? 'approver'
				: roles.includes('reviewer')
					? 'reviewer'
					: roles.includes('applicant')
						? 'applicant'
						: null
	);
</script>

<header class="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
	<div class="mx-auto flex h-14 max-w-6xl items-center gap-4 px-6">
		<a href="/" class="flex items-center gap-2.5">
			<div class="bg-brand text-brand-foreground grid size-7 place-items-center rounded-md">
				<ShieldCheck class="size-4" />
			</div>
			<span class="text-sm font-semibold tracking-tight">BNR Licensing</span>
		</a>

		<nav class="ml-2 hidden items-center gap-1 sm:flex" aria-label="Primary">
			{#each navItems as item (item.href)}
				{@const active = isActive(item)}
				<a
					href={item.href}
					aria-current={active ? 'page' : undefined}
					class="rounded-md px-2.5 py-1.5 text-sm transition-colors {active
						? 'bg-muted text-foreground font-medium'
						: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
				>
					{item.label}
				</a>
			{/each}
		</nav>

		<div class="ml-auto flex items-center gap-2">
			{#if primaryRole}
				<Badge variant="secondary" class="hidden text-[10px] uppercase tracking-wide sm:inline-flex">
					{primaryRole}
				</Badge>
			{/if}
			{#if isAdmin}
				<Button href="/admin" variant="ghost" size="sm" class="gap-1.5">
					<ShieldUser class="size-4" />
					<span class="hidden sm:inline">Admin</span>
				</Button>
			{/if}
			<Button variant="ghost" size="icon" onclick={toggleMode} aria-label="Toggle theme">
				<Sun class="size-4 dark:hidden" />
				<Moon class="hidden size-4 dark:block" />
			</Button>
			<form method="POST" action="/logout">
				<Button type="submit" variant="outline" size="sm" class="gap-1.5">
					<LogOut class="size-4" />
					<span class="hidden sm:inline">Sign out</span>
				</Button>
			</form>
		</div>
	</div>

	{#if user}
		<div class="text-muted-foreground mx-auto flex max-w-6xl items-center gap-2 px-6 pb-2 text-xs sm:hidden">
			<span>{user.name || user.email}</span>
			{#if primaryRole}<Badge variant="secondary" class="text-[10px] uppercase">{primaryRole}</Badge>{/if}
		</div>
	{/if}
</header>
