<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { toggleMode } from 'mode-watcher';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import FileText from '@lucide/svelte/icons/file-text';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Users from '@lucide/svelte/icons/users';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import Settings from '@lucide/svelte/icons/settings';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	let { data, children } = $props();

	// All lucide icons share the same component signature, so we lean on one
	// of them for the type instead of pulling in lucide's internal props.
	type Icon = typeof Users;
	type NavItem = {
		href: string;
		label: string;
		icon: Icon;
		match?: 'exact' | 'prefix';
	};
	type NavGroup = { label: string; items: NavItem[] };

	const groups: NavGroup[] = [
		{
			label: 'Oversight',
			items: [
				{ href: '/admin', label: 'Dashboard', icon: LayoutDashboard, match: 'exact' },
				{ href: '/admin/applications', label: 'Applications', icon: FileText },
				{ href: '/admin/stuck', label: 'Stuck items', icon: TriangleAlert }
			]
		},
		{
			label: 'Access',
			items: [{ href: '/admin/users', label: 'Users & roles', icon: Users }]
		},
		{
			label: 'Audit',
			items: [
				{ href: '/admin/audit', label: 'Audit log', icon: ScrollText },
				{ href: '/admin/audit/verify', label: 'Chain verifier', icon: CheckCheck }
			]
		}
	];

	function isActive(item: NavItem): boolean {
		const path = page.url.pathname;
		if (item.match === 'exact') return path === item.href;
		return path === item.href || path.startsWith(item.href + '/');
	}

	const initials = $derived(
		(data.user?.name ?? data.user?.email ?? '?')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p: string) => p[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);
</script>

<svelte:head>
	<title>Admin · BNR Licensing Portal</title>
</svelte:head>

<div class="bg-background text-foreground flex min-h-svh">
	<!-- Sidebar -->
	<aside
		class="bg-sidebar text-sidebar-foreground sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r md:flex"
	>
		<div class="flex items-center gap-2.5 px-4 py-4">
			<div class="bg-brand text-brand-foreground grid size-8 place-items-center rounded-md">
				<ShieldCheck class="size-4" />
			</div>
			<div class="leading-tight">
				<div class="text-sm font-semibold tracking-tight">BNR Admin</div>
				<div class="text-muted-foreground text-[11px]">Licensing Portal</div>
			</div>
		</div>

		<Separator />

		<nav class="flex-1 overflow-y-auto px-2 py-3">
			{#each groups as group (group.label)}
				<div class="text-muted-foreground px-2.5 pt-3 pb-1 text-[10px] font-semibold tracking-wider uppercase">
					{group.label}
				</div>
				<ul class="space-y-0.5">
					{#each group.items as item (item.href)}
						{@const active = isActive(item)}
						<li>
							<a
								href={item.href}
								aria-current={active ? 'page' : undefined}
								class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors {active
									? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
									: 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}"
							>
								<item.icon class="size-4 {active ? 'text-brand' : 'opacity-80'}" />
								<span>{item.label}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/each}

			<div class="text-muted-foreground px-2.5 pt-4 pb-1 text-[10px] font-semibold tracking-wider uppercase">
				Account
			</div>
			<ul class="space-y-0.5">
				<li>
					<a
						href="/admin/settings"
						class="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm"
					>
						<Settings class="size-4 opacity-80" />
						<span>Settings</span>
					</a>
				</li>
			</ul>
		</nav>

		<Separator />

		<div class="p-3">
			<div class="flex items-center gap-2.5 rounded-md px-2 py-1.5">
				<div
					class="bg-brand text-brand-foreground grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold"
				>
					{initials}
				</div>
				<div class="min-w-0 flex-1 leading-tight">
					<div class="truncate text-sm font-medium">{data.user?.name ?? '—'}</div>
					<div class="text-muted-foreground truncate text-[11px]">{data.user?.email ?? ''}</div>
				</div>
			</div>
			<div class="mt-2 flex flex-wrap gap-1 px-1">
				{#each data.roles as role (role)}
					<Badge variant="secondary" class="text-[10px] uppercase tracking-wide">{role}</Badge>
				{/each}
			</div>
		</div>
	</aside>

	<!-- Main column -->
	<div class="flex min-w-0 flex-1 flex-col">
		<header class="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
			<div class="flex h-14 items-center justify-between gap-3 px-6">
				<!-- Mobile brand (sidebar is hidden < md) -->
				<div class="flex items-center gap-2 md:hidden">
					<div class="bg-brand text-brand-foreground grid size-7 place-items-center rounded-md">
						<ShieldCheck class="size-4" />
					</div>
					<span class="text-sm font-semibold tracking-tight">BNR Admin</span>
				</div>

				<!-- Breadcrumb placeholder. Pages can override later via a slot/context. -->
				<div class="hidden text-sm md:block">
					<span class="text-muted-foreground">Admin</span>
				</div>

				<div class="ml-auto flex items-center gap-2">
					<Button variant="ghost" size="icon" onclick={toggleMode} aria-label="Toggle theme">
						<Sun class="size-4 dark:hidden" />
						<Moon class="hidden size-4 dark:block" />
					</Button>
					<form method="POST" action="/logout">
						<Button type="submit" variant="outline" size="sm">
							<LogOut class="size-4" />
							Sign out
						</Button>
					</form>
				</div>
			</div>
		</header>

		<main class="flex-1 px-6 py-6">
			<div class="mx-auto max-w-7xl">
				{@render children()}
			</div>
		</main>
	</div>
</div>
