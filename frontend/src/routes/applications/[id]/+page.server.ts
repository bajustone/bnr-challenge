import { error, fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	applyTransition,
	createNote,
	getApplication,
	getHistory,
	listDocuments,
	listNotes,
	uploadDocument,
	type AdminError
} from '$lib/server/applications';
import { TRANSITION_EVENTS, type TransitionEvent } from 'bnr-shared/domain/state-machine';

const TRANSITION_EVENT_SET = new Set<string>(TRANSITION_EVENTS);

function statusFromError(e: AdminError): number {
	switch (e.kind) {
		case 'unauthorized':
			return 401;
		case 'forbidden':
			return 403;
		case 'not_found':
			return 404;
		case 'conflict':
			return 409;
		case 'unreachable':
			return 503;
		default:
			return e.kind === 'unknown' ? e.status : 500;
	}
}

export const load: PageServerLoad = async ({ request, url, params }) => {
	const cookie = request.headers.get('cookie') ?? '';
	const id = params.id!;

	const appRes = await getApplication(cookie, url.origin, id);
	if (!appRes.ok) {
		throw error(statusFromError(appRes.error), 'Application not available');
	}

	const [notesR, docsR, historyR] = await Promise.all([
		listNotes(cookie, url.origin, id),
		listDocuments(cookie, url.origin, id, 'current'),
		getHistory(cookie, url.origin, id)
	]);

	return {
		application: appRes.data,
		notes: notesR.ok ? notesR.data : [],
		documents: docsR.ok ? docsR.data : [],
		history: historyR.ok ? historyR.data : [],
		errors: {
			notes: !notesR.ok,
			documents: !docsR.ok,
			history: !historyR.ok
		}
	};
};

export const actions: Actions = {
	/**
	 * Single mutation surface for workflow events — submit, assign,
	 * request_info, mark_ready, approve, reject, resubmit, withdraw.
	 * The backend re-runs the same `transition()` from shared/, so we don't
	 * duplicate role/dual-control checks here; we just shape the request.
	 */
	transition: async ({ request, url, params }) => {
		const cookie = request.headers.get('cookie') ?? '';
		const form = await request.formData();
		const eventRaw = String(form.get('event') ?? '');
		if (!TRANSITION_EVENT_SET.has(eventRaw)) {
			return fail(400, { op: 'transition' as const, code: 'invalid_event' as const, eventRaw });
		}
		const event = eventRaw as TransitionEvent;
		const message = String(form.get('message') ?? '').trim() || undefined;
		const reason = String(form.get('reason') ?? '').trim() || undefined;

		const res = await applyTransition(cookie, url.origin, params.id!, {
			event,
			...(message ? { message } : {}),
			...(reason ? { reason } : {})
		});

		if (!res.ok) {
			return fail(statusFromError(res.error), {
				op: 'transition' as const,
				event,
				code: 'backend' as const,
				error: res.error.kind,
				detail: res.error.kind === 'conflict' ? res.error.message : undefined
			});
		}
		return { op: 'transition' as const, event, ok: true as const };
	},

	/**
	 * Staff-only post of a review note. Visibility "applicant" surfaces it
	 * to the applicant; "staff" keeps it internal.
	 */
	note: async ({ request, url, params, locals }) => {
		const cookie = request.headers.get('cookie') ?? '';
		const form = await request.formData();
		const body = String(form.get('body') ?? '').trim();
		const visibilityRaw = String(form.get('visibility') ?? 'staff');

		const fieldErrors: Record<string, string> = {};
		if (!body) fieldErrors.body = 'Required';
		else if (body.length > 10_000) fieldErrors.body = 'Max 10 000 characters';
		if (visibilityRaw !== 'staff' && visibilityRaw !== 'applicant')
			fieldErrors.visibility = 'Invalid visibility';

		if (Object.keys(fieldErrors).length > 0) {
			return fail(400, {
				op: 'note' as const,
				code: 'invalid' as const,
				fieldErrors,
				values: { body, visibility: visibilityRaw }
			});
		}

		void locals;
		const res = await createNote(cookie, url.origin, params.id!, {
			visibility: visibilityRaw as 'staff' | 'applicant',
			body
		});
		if (!res.ok) {
			return fail(statusFromError(res.error), {
				op: 'note' as const,
				code: 'backend' as const,
				error: res.error.kind,
				values: { body, visibility: visibilityRaw }
			});
		}
		return { op: 'note' as const, ok: true as const };
	},

	/**
	 * Multipart upload. The backend enforces the 5 MiB cap three ways; we
	 * just pass the file through. Slot is a free-form text key supplied by
	 * the applicant — convention rather than schema (the backend allows any
	 * 1–64 char slot name).
	 */
	upload: async ({ request, url, params }) => {
		const cookie = request.headers.get('cookie') ?? '';
		const form = await request.formData();
		const slot = String(form.get('slot') ?? '').trim();
		const file = form.get('file');

		const fieldErrors: Record<string, string> = {};
		if (!slot) fieldErrors.slot = 'Required';
		else if (slot.length > 64) fieldErrors.slot = 'Max 64 characters';
		if (!(file instanceof File) || file.size === 0) fieldErrors.file = 'Pick a file';

		if (Object.keys(fieldErrors).length > 0) {
			return fail(400, {
				op: 'upload' as const,
				code: 'invalid' as const,
				fieldErrors
			});
		}

		const res = await uploadDocument(cookie, url.origin, params.id!, slot, file as File);
		if (!res.ok) {
			return fail(statusFromError(res.error), {
				op: 'upload' as const,
				code: 'backend' as const,
				error: res.error.kind
			});
		}
		return { op: 'upload' as const, ok: true as const };
	}
};
