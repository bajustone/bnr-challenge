import type { PageServerLoad } from './$types';
import { listApplications, type Application } from '$lib/server/applications';

/**
 * Home page is role-aware. We always fetch the caller's applications view
 * (the backend already filters: applicants see their own, staff see all)
 * and bucket them on the page. One call, multiple lenses.
 */
export const load: PageServerLoad = async ({ request, url, locals }) => {
	const cookie = request.headers.get('cookie') ?? '';
	const res = await listApplications(cookie, url.origin, { limit: 100 });
	const applications: Application[] = res.ok ? res.data : [];
	return {
		applications,
		loadError: res.ok ? null : res.error.kind,
		userId: locals.user?.id ?? null
	};
};
