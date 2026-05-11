import type { ApplicationStatus, Role } from 'bnr-shared/domain/state-machine';
import { BACKEND_URL } from './backend.ts';

/**
 * Thin server-side wrapper around the backend's /admin/* surface.
 *
 * The browser never calls these directly — every helper is invoked from a
 * +page.server.ts load or action, with the request's cookie + origin
 * threaded through so better-auth's CSRF/origin guard is satisfied.
 *
 * Errors are surfaced as a tagged result rather than thrown so callers can
 * map 401/403/404/409 → the right `fail()` or status code without a
 * try/catch dance.
 */

export type AdminUser = {
	id: string;
	email: string;
	name: string;
	roles: Role[];
	disabledAt: string | null;
};

export type AuditRow = {
	id: string;
	occurredAt: string;
	actorId: string;
	actorRole: Role;
	action: string;
	resourceType: string;
	resourceId: string;
	beforeState: unknown;
	afterState: unknown;
	metadata: Record<string, unknown>;
};

export type Application = {
	id: string;
	applicantId: string;
	institutionName: string;
	institutionType: string;
	payload: Record<string, unknown>;
	status: ApplicationStatus;
	version: number;
	submittedAt: string | null;
	reviewedBy: string | null;
	reviewedAt: string | null;
	decidedBy: string | null;
	decidedAt: string | null;
	decision: 'APPROVED' | 'REJECTED' | null;
	decisionReason: string | null;
	createdAt: string;
	updatedAt: string;
};

export type ApplicationsQuery = {
	status?: ApplicationStatus | ApplicationStatus[];
	limit?: number;
	offset?: number;
};

export type AuditQuery = {
	actorId?: string;
	resourceType?: string;
	resourceId?: string;
	limit?: number;
	offset?: number;
};

export type VerifyResult = {
	ok: boolean;
	lastVerifiedId: string | null;
	firstBadId: string | null;
	reason?: string;
	rowsChecked: number;
};

export type AdminError =
	| { kind: 'unauthorized' }
	| { kind: 'forbidden' }
	| { kind: 'not_found' }
	| { kind: 'conflict'; message: string }
	| { kind: 'unreachable' }
	| { kind: 'unknown'; status: number };

export type AdminResult<T> = { ok: true; data: T } | { ok: false; error: AdminError };

/* ───────────────── HTTP plumbing ───────────────── */

function headers(cookieHeader: string, origin: string, extra?: Record<string, string>) {
	return {
		accept: 'application/json',
		cookie: cookieHeader,
		origin,
		...extra
	};
}

async function request<T>(
	cookieHeader: string,
	origin: string,
	path: string,
	init: RequestInit & { method?: string; jsonBody?: unknown } = {}
): Promise<AdminResult<T>> {
	const { jsonBody, ...rest } = init;
	const body = jsonBody === undefined ? undefined : JSON.stringify(jsonBody);
	let res: Response;
	try {
		res = await fetch(`${BACKEND_URL}${path}`, {
			...rest,
			headers: headers(
				cookieHeader,
				origin,
				jsonBody === undefined ? undefined : { 'content-type': 'application/json' }
			),
			body
		});
	} catch {
		return { ok: false, error: { kind: 'unreachable' } };
	}
	if (res.status === 401) return { ok: false, error: { kind: 'unauthorized' } };
	if (res.status === 403) return { ok: false, error: { kind: 'forbidden' } };
	if (res.status === 404) return { ok: false, error: { kind: 'not_found' } };
	if (res.status === 409) {
		const text = await res.text().catch(() => '');
		return { ok: false, error: { kind: 'conflict', message: text } };
	}
	if (!res.ok) return { ok: false, error: { kind: 'unknown', status: res.status } };
	if (res.status === 204) return { ok: true, data: undefined as T };
	const data = (await res.json()) as T;
	return { ok: true, data };
}

/* ───────────────── Users & roles ───────────────── */

export function listUsers(cookieHeader: string, origin: string) {
	return request<AdminUser[]>(cookieHeader, origin, '/admin/users');
}

export function grantRole(
	cookieHeader: string,
	origin: string,
	userId: string,
	role: Role
) {
	return request<void>(cookieHeader, origin, `/admin/users/${encodeURIComponent(userId)}/roles`, {
		method: 'POST',
		jsonBody: { role }
	});
}

export function revokeRole(
	cookieHeader: string,
	origin: string,
	userId: string,
	role: Role
) {
	return request<void>(
		cookieHeader,
		origin,
		`/admin/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(role)}`,
		{ method: 'DELETE' }
	);
}

/* ───────────────── Applications (read-only oversight) ───────────────── */

export function listApplications(
	cookieHeader: string,
	origin: string,
	q: ApplicationsQuery = {}
) {
	const params = new URLSearchParams();
	if (q.status !== undefined) {
		const arr = Array.isArray(q.status) ? q.status : [q.status];
		for (const s of arr) params.append('status', s);
	}
	if (q.limit !== undefined) params.set('limit', String(q.limit));
	if (q.offset !== undefined) params.set('offset', String(q.offset));
	const qs = params.toString();
	return request<Application[]>(
		cookieHeader,
		origin,
		`/applications${qs ? `?${qs}` : ''}`
	);
}

/* ───────────────── Audit ───────────────── */

export function queryAudit(cookieHeader: string, origin: string, q: AuditQuery = {}) {
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(q)) {
		if (v !== undefined && v !== '') params.set(k, String(v));
	}
	const qs = params.toString();
	return request<AuditRow[]>(
		cookieHeader,
		origin,
		`/admin/audit${qs ? `?${qs}` : ''}`
	);
}

export function verifyChain(cookieHeader: string, origin: string) {
	return request<VerifyResult>(cookieHeader, origin, '/admin/audit/verify');
}
