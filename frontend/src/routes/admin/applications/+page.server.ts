import type { PageServerLoad } from './$types';
import { listApplications } from '$lib/server/admin';
import { APPLICATION_STATUSES, type ApplicationStatus } from 'bnr-shared/domain/state-machine';

const STATUS_SET = new Set<string>(APPLICATION_STATUSES);

function parseStatus(raw: string | null): ApplicationStatus | undefined {
	if (raw && STATUS_SET.has(raw)) return raw as ApplicationStatus;
	return undefined;
}

export const load: PageServerLoad = async ({ request, url }) => {
	const cookie = request.headers.get('cookie') ?? '';
	const status = parseStatus(url.searchParams.get('status'));
	const onlyStuck = url.searchParams.get('stuck') === '1';

	const res = await listApplications(cookie, url.origin, {
		status,
		limit: 200
	});

	if (!res.ok) {
		return {
			applications: [],
			loadError: res.error.kind,
			filter: { status: status ?? null, onlyStuck }
		};
	}
	return {
		applications: res.data,
		loadError: null,
		filter: { status: status ?? null, onlyStuck }
	};
};
