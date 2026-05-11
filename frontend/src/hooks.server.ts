import { redirect, type Handle } from '@sveltejs/kit';
import { fetchRoles, fetchSession } from '$lib/server/auth';

const LOGIN_ROUTE_ID = '/login';

/**
 * On every request:
 *   1. Resolve the session + role grants from the backend (cookie
 *      passthrough). The two are independent calls, so we fan out in
 *      parallel. Outages are treated as "no session / no roles" so the
 *      gate fails closed rather than 500ing the world.
 *   2. Populate event.locals so layout + page loads can render identity
 *      and role-aware navigation without a second round-trip.
 *   3. Gate page routes: signed-out users see only /login; signed-in
 *      users hitting /login are bounced home. Static assets
 *      (route.id === null) are skipped — no backend hit per favicon.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const cookieHeader = event.request.headers.get('cookie') ?? '';
	const [payload, roles] = await Promise.all([
		fetchSession(cookieHeader, event.url.origin),
		fetchRoles(cookieHeader, event.url.origin)
	]);
	event.locals.user = payload?.user ?? null;
	event.locals.session = payload?.session ?? null;
	event.locals.roles = payload?.user ? roles : [];

	const isPageRoute = event.route.id !== null;
	const isLoginRoute = event.route.id === LOGIN_ROUTE_ID;

	if (isPageRoute && !isLoginRoute && !event.locals.user) {
		throw redirect(303, '/login');
	}
	if (isLoginRoute && event.locals.user) {
		throw redirect(303, '/');
	}

	return resolve(event);
};
