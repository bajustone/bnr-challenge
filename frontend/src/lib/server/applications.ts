/**
 * Server-side wrapper around the backend's /applications + per-application
 * sub-resources (history, notes, documents). The browser never calls these
 * directly — every helper runs from a +page.server.ts load or action with
 * the request's cookie + origin threaded through.
 */

import type { ApplicationStatus, Role } from 'bnr-shared/domain/state-machine';
import { BACKEND_URL } from './backend.ts';
import type { AdminError, AdminResult, Application } from './admin.ts';

export type { Application } from './admin.ts';

export type ReviewNote = {
	id: string;
	applicationId: string;
	authorId: string;
	authorRole: Role;
	visibility: 'staff' | 'applicant';
	body: string;
	createdAt: string;
};

export type AppDocument = {
	id: string;
	applicationId: string;
	slot: string;
	version: number;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	sha256: string;
	uploadedBy: string;
	uploadedAt: string;
	supersededAt: string | null;
};

export type ApplicationHistoryRow = {
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

export type ApplicationsQuery = {
	status?: ApplicationStatus | ApplicationStatus[];
	limit?: number;
	offset?: number;
};

/* ───────────────── plumbing ───────────────── */

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
	init: RequestInit & { method?: string; jsonBody?: unknown; rawBody?: BodyInit; rawHeaders?: Record<string, string> } = {}
): Promise<AdminResult<T>> {
	const { jsonBody, rawBody, rawHeaders, ...rest } = init;
	let body: BodyInit | undefined;
	let contentHeader: Record<string, string> | undefined;
	if (jsonBody !== undefined) {
		body = JSON.stringify(jsonBody);
		contentHeader = { 'content-type': 'application/json' };
	} else if (rawBody !== undefined) {
		body = rawBody;
	}
	let res: Response;
	try {
		res = await fetch(`${BACKEND_URL}${path}`, {
			...rest,
			headers: headers(cookieHeader, origin, { ...contentHeader, ...rawHeaders }),
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

export type { AdminError, AdminResult } from './admin.ts';

/* ───────────────── Applications ───────────────── */

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
	return request<Application[]>(cookieHeader, origin, `/applications${qs ? `?${qs}` : ''}`);
}

export function getApplication(cookieHeader: string, origin: string, id: string) {
	return request<Application>(cookieHeader, origin, `/applications/${encodeURIComponent(id)}`);
}

export function getHistory(cookieHeader: string, origin: string, id: string) {
	return request<ApplicationHistoryRow[]>(
		cookieHeader,
		origin,
		`/applications/${encodeURIComponent(id)}/history`
	);
}

export function createApplication(
	cookieHeader: string,
	origin: string,
	input: { institutionName: string; institutionType: string; payload?: Record<string, unknown> }
) {
	return request<Application>(cookieHeader, origin, '/applications', {
		method: 'POST',
		jsonBody: input
	});
}

export function updateDraft(
	cookieHeader: string,
	origin: string,
	id: string,
	input: { institutionName?: string; institutionType?: string; payload?: Record<string, unknown> }
) {
	return request<Application>(cookieHeader, origin, `/applications/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		jsonBody: input
	});
}

export function applyTransition(
	cookieHeader: string,
	origin: string,
	id: string,
	input: { event: string; message?: string; reason?: string }
) {
	return request<Application>(
		cookieHeader,
		origin,
		`/applications/${encodeURIComponent(id)}/transitions`,
		{ method: 'POST', jsonBody: input }
	);
}

/* ───────────────── Notes ───────────────── */

export function listNotes(cookieHeader: string, origin: string, applicationId: string) {
	return request<ReviewNote[]>(
		cookieHeader,
		origin,
		`/applications/${encodeURIComponent(applicationId)}/notes`
	);
}

export function createNote(
	cookieHeader: string,
	origin: string,
	applicationId: string,
	input: { visibility: 'staff' | 'applicant'; body: string }
) {
	return request<ReviewNote>(
		cookieHeader,
		origin,
		`/applications/${encodeURIComponent(applicationId)}/notes`,
		{ method: 'POST', jsonBody: input }
	);
}

/* ───────────────── Documents ───────────────── */

export function listDocuments(
	cookieHeader: string,
	origin: string,
	applicationId: string,
	scope: 'current' | 'all' = 'current'
) {
	return request<AppDocument[]>(
		cookieHeader,
		origin,
		`/applications/${encodeURIComponent(applicationId)}/documents?include=${scope}`
	);
}

export async function uploadDocument(
	cookieHeader: string,
	origin: string,
	applicationId: string,
	slot: string,
	file: File
): Promise<AdminResult<AppDocument>> {
	const form = new FormData();
	form.set('slot', slot);
	form.set('file', file, file.name);
	return request<AppDocument>(
		cookieHeader,
		origin,
		`/applications/${encodeURIComponent(applicationId)}/documents`,
		{ method: 'POST', rawBody: form }
	);
}
