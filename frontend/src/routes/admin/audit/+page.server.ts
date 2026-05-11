import type { PageServerLoad } from './$types';
import { queryAudit, type AuditQuery } from '$lib/server/admin';

const PAGE_SIZE = 50;

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
	if (!raw) return fallback;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

function nullable(raw: string | null): string | undefined {
	const v = raw?.trim();
	return v ? v : undefined;
}

export const load: PageServerLoad = async ({ request, url }) => {
	const cookie = request.headers.get('cookie') ?? '';
	const sp = url.searchParams;

	const q: AuditQuery = {
		actorId: nullable(sp.get('actorId')),
		resourceType: nullable(sp.get('resourceType')),
		resourceId: nullable(sp.get('resourceId')),
		limit: PAGE_SIZE,
		offset: clampInt(sp.get('offset'), 0, 1_000_000, 0)
	};

	const res = await queryAudit(cookie, url.origin, q);
	if (!res.ok) {
		return {
			rows: [],
			loadError: res.error.kind,
			query: q,
			pageSize: PAGE_SIZE
		};
	}
	return {
		rows: res.data,
		loadError: null,
		query: q,
		pageSize: PAGE_SIZE
	};
};
