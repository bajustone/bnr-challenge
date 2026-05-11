import { redirect, type Handle } from '@sveltejs/kit';
import { fetchSession } from '$lib/server/auth';

const LOGIN_ROUTE_ID = '/login';

/**
 * On every request:
 *   1. Resolve the session from the backend (cookie passthrough). Outages
 *      are treated as "no session" so the gate falls back to /login rather
 *      than 500ing the world.
 *   2. Populate event.locals so layout + page loads can render
 *      identity without a second round-trip.
 *   3. Gate page routes: signed-out users see only /login; signed-in users
 *      hitting /login are bounced home. Static assets (route.id === null)
 *      are skipped — no backend hit per favicon.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const cookieHeader = event.request.headers.get('cookie') ?? '';
	const payload = await fetchSession(cookieHeader, event.url.origin);
	event.locals.user = payload?.user ?? null;
	event.locals.session = payload?.session ?? null;

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
