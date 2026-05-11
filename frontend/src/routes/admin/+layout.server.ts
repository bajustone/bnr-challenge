import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/**
 * Defence-in-depth role gate. The backend will already reject non-admins
 * on every /admin/* call with 403, but rendering a sidebar shell for
 * someone who can't see anything inside it is a user-hostile dead end —
 * so we 404 the route group entirely instead.
 *
 * Using `error(404)` rather than `redirect(303, '/')` is deliberate: a
 * 404 leaks no information about whether /admin exists. (A `forbidden`
 * status would leak the inverse.)
 */
export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');
	if (!locals.roles.includes('admin')) throw error(404, 'Not found');
	return {
		user: locals.user,
		roles: locals.roles
	};
};
