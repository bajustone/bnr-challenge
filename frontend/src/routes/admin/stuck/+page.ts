import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * Stuck items are a thin lens over the applications oversight table — the
 * filter already exists, so we redirect rather than duplicate the view.
 * 308 (permanent) so browser history collapses cleanly on back/forward.
 */
export const load: PageLoad = () => {
	throw redirect(308, '/admin/applications?stuck=1');
};
