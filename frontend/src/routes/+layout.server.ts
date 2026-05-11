import type { LayoutServerLoad } from './$types';

/**
 * Threads the identity + role grants loaded by hooks.server.ts down to
 * every page so the SSR shell can render the signed-in user and role-aware
 * navigation without a second round-trip.
 */
export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user,
	roles: locals.roles
});
