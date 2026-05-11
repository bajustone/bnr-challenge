import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createApplication } from '$lib/server/applications';
import { InstitutionType } from 'bnr-shared/domain/institution-type';

const INSTITUTION_TYPES = InstitutionType.options;
const INSTITUTION_TYPE_SET = new Set<string>(INSTITUTION_TYPES);

// Very loose email check — server doesn't need to be RFC-perfect, the backend
// or downstream notifications will catch bad addresses. We just want to nudge
// applicants who typo'd before submission.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pickStr(form: FormData, key: string, max = 300): string {
	return String(form.get(key) ?? '')
		.trim()
		.slice(0, max);
}

function emptyToUndef<T extends string>(v: T): T | undefined {
	return v.length === 0 ? undefined : v;
}

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

		// Core fields
		const institutionName = pickStr(form, 'institutionName', 200);
		const institutionType = pickStr(form, 'institutionType', 100);

		// Structured fields (all optional unless marked otherwise)
		const tradingName = pickStr(form, 'tradingName', 200);
		const registrationNumber = pickStr(form, 'registrationNumber', 40);
		const tin = pickStr(form, 'tin', 40);
		const contactName = pickStr(form, 'contactName', 200);
		const contactEmail = pickStr(form, 'contactEmail', 200);
		const contactPhone = pickStr(form, 'contactPhone', 40);
		const address = pickStr(form, 'address', 300);
		const website = pickStr(form, 'website', 300);
		const yearEstablishedRaw = pickStr(form, 'yearEstablished', 10);
		const estimatedAssetsRaw = pickStr(form, 'estimatedAssetsRwf', 40);
		const payloadRaw = pickStr(form, 'payload', 20_000);

		const fieldErrors: Record<string, string> = {};

		if (!institutionName) fieldErrors.institutionName = 'Required';
		else if (institutionName.length > 200) fieldErrors.institutionName = 'Max 200 characters';

		if (!institutionType) fieldErrors.institutionType = 'Required';
		else if (!INSTITUTION_TYPE_SET.has(institutionType))
			fieldErrors.institutionType = 'Pick a listed type';

		if (!contactName) fieldErrors.contactName = 'Required';
		if (!contactEmail) fieldErrors.contactEmail = 'Required';
		else if (!EMAIL_RE.test(contactEmail)) fieldErrors.contactEmail = 'Enter a valid email';

		// Numeric: strip commas/spaces before parsing.
		let estimatedAssetsRwf: number | undefined;
		if (estimatedAssetsRaw) {
			const digits = estimatedAssetsRaw.replace(/[^\d]/g, '');
			if (!digits) fieldErrors.estimatedAssetsRwf = 'Enter a whole number';
			else {
				const n = Number(digits);
				if (!Number.isFinite(n) || n < 0) fieldErrors.estimatedAssetsRwf = 'Must be ≥ 0';
				else estimatedAssetsRwf = n;
			}
		}

		let yearEstablished: number | undefined;
		if (yearEstablishedRaw) {
			const y = Number(yearEstablishedRaw);
			const now = new Date().getFullYear();
			if (!Number.isInteger(y) || y < 1900 || y > now)
				fieldErrors.yearEstablished = `Use a year between 1900 and ${now}`;
			else yearEstablished = y;
		}

		// Advanced JSON escape hatch — optional, must be an object if provided.
		let advanced: Record<string, unknown> | undefined;
		if (payloadRaw) {
			try {
				const parsed = JSON.parse(payloadRaw);
				if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
					fieldErrors.payload = 'Must be a JSON object';
				} else {
					advanced = parsed as Record<string, unknown>;
				}
			} catch (e) {
				fieldErrors.payload = `Invalid JSON: ${(e as Error).message}`;
			}
		}

		const values = {
			institutionName,
			tradingName,
			institutionType,
			registrationNumber,
			tin,
			contactName,
			contactEmail,
			contactPhone,
			address,
			website,
			yearEstablished: yearEstablishedRaw,
			estimatedAssetsRwf: estimatedAssetsRaw,
			payload: payloadRaw
		};

		if (Object.keys(fieldErrors).length > 0) {
			return fail(400, {
				code: 'invalid' as const,
				fieldErrors,
				values
			});
		}

		// Compose the structured payload, then layer the advanced JSON on top of
		// the structured fields would let admins overwrite — instead let
		// structured fields win. This protects against accidental key collisions.
		const structured: Record<string, unknown> = {
			tradingName: emptyToUndef(tradingName),
			registrationNumber: emptyToUndef(registrationNumber),
			tin: emptyToUndef(tin),
			contact: {
				name: contactName,
				email: contactEmail,
				phone: emptyToUndef(contactPhone)
			},
			address: emptyToUndef(address),
			website: emptyToUndef(website),
			yearEstablished,
			estimatedAssetsRwf
		};

		// Drop undefined keys for a clean payload.
		for (const k of Object.keys(structured)) {
			if (structured[k] === undefined) delete structured[k];
		}

		const mergedPayload: Record<string, unknown> = { ...(advanced ?? {}), ...structured };
		const payload = Object.keys(mergedPayload).length > 0 ? mergedPayload : undefined;

		const res = await createApplication(cookie, url.origin, {
			institutionName,
			institutionType,
			payload
		});
		if (!res.ok) {
			return fail(res.error.kind === 'unreachable' ? 503 : 500, {
				code: 'backend' as const,
				error: res.error.kind,
				values
			});
		}

		throw redirect(303, `/applications/${res.data.id}`);
	}
};
