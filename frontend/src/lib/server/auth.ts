import type { Cookies } from '@sveltejs/kit';
import { BACKEND_URL } from './backend.ts';

export type AuthUser = {
	id: string;
	email: string;
	name: string;
	emailVerified: boolean;
};

export type AuthSession = {
	id: string;
	userId: string;
	expiresAt: string;
};

export type SessionPayload = {
	user: AuthUser;
	session: AuthSession;
};

/* ───────────────── Set-Cookie passthrough ───────────────── */

type CookieOpts = Parameters<Cookies['set']>[2];

/**
 * Minimal RFC-6265 Set-Cookie parser, just enough for better-auth's output
 * (Path, HttpOnly, Secure, SameSite, Max-Age, Expires, Domain).
 */
function parseSetCookie(header: string): { name: string; value: string; opts: CookieOpts } {
	const parts = header.split(/;\s*/);
	const first = parts.shift() ?? '';
	const eq = first.indexOf('=');
	const name = eq === -1 ? first : first.slice(0, eq);
	const value = eq === -1 ? '' : decodeURIComponent(first.slice(eq + 1));
	const opts: CookieOpts = { path: '/' };
	for (const attr of parts) {
		const [rawKey, ...rest] = attr.split('=');
		const key = rawKey.toLowerCase();
		const v = rest.join('=');
		if (key === 'path') opts.path = v;
		else if (key === 'max-age') opts.maxAge = Number(v);
		else if (key === 'expires') opts.expires = new Date(v);
		else if (key === 'domain') opts.domain = v;
		else if (key === 'samesite') {
			const lc = v?.toLowerCase();
			if (lc === 'strict' || lc === 'lax' || lc === 'none') opts.sameSite = lc;
		} else if (key === 'httponly') opts.httpOnly = true;
		else if (key === 'secure') opts.secure = true;
	}
	return { name, value, opts };
}

function forwardSetCookies(res: Response, cookies: Cookies): void {
	// Node 20+ / Bun: Headers.getSetCookie() returns string[].
	const list =
		typeof res.headers.getSetCookie === 'function'
			? res.headers.getSetCookie()
			: // Fallback: a single combined header.
				([res.headers.get('set-cookie')].filter(Boolean) as string[]);
	for (const raw of list) {
		const { name, value, opts } = parseSetCookie(raw);
		cookies.set(name, value, opts);
	}
}

/**
 * Headers every backend call sends. better-auth's CSRF guard rejects mutating
 * POSTs lacking an `Origin` (code: MISSING_OR_NULL_ORIGIN → 403). Node/Bun
 * native fetch doesn't set Origin on its own, so we thread the SvelteKit
 * request's origin through every helper.
 */
function authHeaders(origin: string, extra?: Record<string, string>): Record<string, string> {
	return { accept: 'application/json', origin, ...extra };
}

/* ───────────────── Backend calls ───────────────── */

export async function fetchSession(
	cookieHeader: string,
	origin: string
): Promise<SessionPayload | null> {
	if (!cookieHeader) return null;
	let res: Response;
	try {
		res = await fetch(`${BACKEND_URL}/auth/get-session`, {
			headers: authHeaders(origin, { cookie: cookieHeader })
		});
	} catch {
		return null;
	}
	if (!res.ok) return null;
	const body = (await res.json()) as SessionPayload | null;
	return body ?? null;
}

export type SignInResult =
	| { ok: true; payload: SessionPayload }
	| { ok: false; status: 401 | 503 | number };

export async function signIn(
	input: { email: string; password: string },
	cookies: Cookies,
	origin: string
): Promise<SignInResult> {
	let res: Response;
	try {
		res = await fetch(`${BACKEND_URL}/auth/sign-in/email`, {
			method: 'POST',
			headers: authHeaders(origin, { 'content-type': 'application/json' }),
			body: JSON.stringify(input)
		});
	} catch {
		return { ok: false, status: 503 };
	}
	if (res.status === 401) return { ok: false, status: 401 };
	if (!res.ok) return { ok: false, status: res.status };
	forwardSetCookies(res, cookies);
	const payload = (await res.json()) as SessionPayload;
	return { ok: true, payload };
}

export async function signOut(
	cookieHeader: string,
	cookies: Cookies,
	origin: string
): Promise<void> {
	let res: Response;
	try {
		res = await fetch(`${BACKEND_URL}/auth/sign-out`, {
			method: 'POST',
			headers: authHeaders(origin, { cookie: cookieHeader })
		});
	} catch {
		return;
	}
	forwardSetCookies(res, cookies);
}
