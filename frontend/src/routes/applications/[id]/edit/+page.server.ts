import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getApplication, updateDraft } from '$lib/server/applications';
import { InstitutionType } from 'bnr-shared/domain/institution-type';

const INSTITUTION_TYPES = InstitutionType.options;
const INSTITUTION_TYPE_SET = new Set<string>(INSTITUTION_TYPES);

const EDITABLE_STATUSES = new Set(['DRAFT', 'RFI_REQUESTED']);

export const load: PageServerLoad = async ({ request, url, params, locals }) => {
	const cookie = request.headers.get('cookie') ?? '';
	const res = await getApplication(cookie, url.origin, params.id!);
	if (!res.ok) throw error(res.error.kind === 'not_found' ? 404 : 500, 'Application not available');

	const app = res.data;
	if (locals.user?.id !== app.applicantId) {
		// Only the owner can edit — bounce to the read-only detail.
		throw redirect(303, `/applications/${app.id}`);
	}
	if (!EDITABLE_STATUSES.has(app.status)) {
		throw redirect(303, `/applications/${app.id}`);
	}

	return { application: app, institutionTypes: INSTITUTION_TYPES };
};

export const actions: Actions = {
	default: async ({ request, url, params, locals }) => {
		const cookie = request.headers.get('cookie') ?? '';
		const form = await request.formData();
		const institutionName = String(form.get('institutionName') ?? '').trim();
		const institutionType = String(form.get('institutionType') ?? '').trim();
		const payloadRaw = String(form.get('payload') ?? '').trim();

		const fieldErrors: Record<string, string> = {};
		if (!institutionName) fieldErrors.institutionName = 'Required';
		else if (institutionName.length > 200) fieldErrors.institutionName = 'Max 200 characters';
		if (!institutionType) fieldErrors.institutionType = 'Required';
		else if (!INSTITUTION_TYPE_SET.has(institutionType))
			fieldErrors.institutionType = 'Pick a listed type';

		let payload: Record<string, unknown> | undefined;
		if (payloadRaw) {
			try {
				const parsed = JSON.parse(payloadRaw);
				if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
					fieldErrors.payload = 'Must be a JSON object';
				} else {
					payload = parsed as Record<string, unknown>;
				}
			} catch (e) {
				fieldErrors.payload = `Invalid JSON: ${(e as Error).message}`;
			}
		}

		if (Object.keys(fieldErrors).length > 0) {
			return fail(400, {
				code: 'invalid' as const,
				fieldErrors,
				values: { institutionName, institutionType, payload: payloadRaw }
			});
		}

		const res = await updateDraft(cookie, url.origin, params.id!, {
			institutionName,
			institutionType,
			payload
		});
		if (!res.ok) {
			const status =
				res.error.kind === 'conflict'
					? 409
					: res.error.kind === 'unreachable'
						? 503
						: res.error.kind === 'forbidden'
							? 403
							: 500;
			return fail(status, {
				code: 'backend' as const,
				error: res.error.kind,
				values: { institutionName, institutionType, payload: payloadRaw }
			});
		}

		// Ensure locals matches the request, so it doesn't look stale on the redirect target.
		void locals;
		throw redirect(303, `/applications/${params.id!}`);
	}
};
