import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createApplication } from '$lib/server/applications';
import { InstitutionType } from 'bnr-shared/domain/institution-type';

const INSTITUTION_TYPES = InstitutionType.options;
const INSTITUTION_TYPE_SET = new Set<string>(INSTITUTION_TYPES);

export const load: PageServerLoad = ({ locals }) => {
	// Server-side gate: only applicants can land here. Non-applicants get a
	// redirect to the list page rather than a 403 — gentler dead-end.
	if (!locals.roles.includes('applicant')) {
		throw redirect(303, '/applications');
	}
	return { institutionTypes: INSTITUTION_TYPES };
};

export const actions: Actions = {
	default: async ({ request, url, locals }) => {
		if (!locals.roles.includes('applicant')) {
			return fail(403, { code: 'forbidden' as const });
		}

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

		const res = await createApplication(cookie, url.origin, {
			institutionName,
			institutionType,
			payload
		});
		if (!res.ok) {
			return fail(res.error.kind === 'unreachable' ? 503 : 500, {
				code: 'backend' as const,
				error: res.error.kind,
				values: { institutionName, institutionType, payload: payloadRaw }
			});
		}

		throw redirect(303, `/applications/${res.data.id}`);
	}
};
