import type { PageServerLoad } from './$types';
import { listApplications } from '$lib/server/applications';
import { APPLICATION_STATUSES, type ApplicationStatus } from 'bnr-shared/domain/state-machine';

const STATUS_SET = new Set<string>(APPLICATION_STATUSES);

function parseStatus(raw: string | null): ApplicationStatus | undefined {
	return raw && STATUS_SET.has(raw) ? (raw as ApplicationStatus) : undefined;
}

export const load: PageServerLoad = async ({ request, url, locals }) => {
	const cookie = request.headers.get('cookie') ?? '';
	const status = parseStatus(url.searchParams.get('status'));
	const onlyMine = url.searchParams.get('mine') === '1';
	const onlyAssigned = url.searchParams.get('assigned') === '1';

	const res = await listApplications(cookie, url.origin, { status, limit: 200 });
	return {
		applications: res.ok ? res.data : [],
		loadError: res.ok ? null : res.error.kind,
		filter: { status: status ?? null, onlyMine, onlyAssigned },
		userId: locals.user?.id ?? null
	};
};
