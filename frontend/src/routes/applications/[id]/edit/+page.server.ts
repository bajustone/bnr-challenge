import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getApplication, updateDraft } from '$lib/server/applications';
import { InstitutionType } from 'bnr-shared/domain/institution-type';

const INSTITUTION_TYPES = InstitutionType.options;
const INSTITUTION_TYPE_SET = new Set<string>(INSTITUTION_TYPES);

const EDITABLE_STATUSES = new Set(['DRAFT', 'RFI_REQUESTED']);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Keys we surface as structured form fields. Anything else in the payload is
// preserved by sending it back through the "Advanced" JSON textarea.
const STRUCTURED_KEYS = new Set([
	'tradingName',
	'registrationNumber',
	'tin',
	'contact',
	'address',
	'website',
	'yearEstablished',
	'estimatedAssetsRwf'
]);

type Initial = {
	tradingName: string;
	registrationNumber: string;
	tin: string;
	contactName: string;
	contactEmail: string;
	contactPhone: string;
	address: string;
	website: string;
	yearEstablished: number | null;
	estimatedAssetsRwf: number | null;
	advancedPayload: string;
};

function splitInitial(payload: Record<string, unknown>): Initial {
	const contact = (payload.contact && typeof payload.contact === 'object'
		? payload.contact
		: {}) as Record<string, unknown>;

	const advanced: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(payload)) {
		if (!STRUCTURED_KEYS.has(k)) advanced[k] = v;
	}

	const asStr = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
	const asNum = (v: unknown): number | null =>
		typeof v === 'number' && Number.isFinite(v) ? v : null;

	return {
		tradingName: asStr(payload.tradingName),
		registrationNumber: asStr(payload.registrationNumber),
		tin: asStr(payload.tin),
		contactName: asStr(contact.name),
		contactEmail: asStr(contact.email),
		contactPhone: asStr(contact.phone),
		address: asStr(payload.address),
		website: asStr(payload.website),
		yearEstablished: asNum(payload.yearEstablished),
		estimatedAssetsRwf: asNum(payload.estimatedAssetsRwf),
		advancedPayload:
			Object.keys(advanced).length === 0 ? '' : JSON.stringify(advanced, null, 2)
	};
}

function pickStr(form: FormData, key: string, max = 300): string {
	return String(form.get(key) ?? '')
		.trim()
		.slice(0, max);
}

function emptyToUndef<T extends string>(v: T): T | undefined {
	return v.length === 0 ? undefined : v;
}

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

	return {
		application: app,
		institutionTypes: INSTITUTION_TYPES,
		initial: splitInitial(app.payload as Record<string, unknown>)
	};
};

export const actions: Actions = {
	default: async ({ request, url, params, locals }) => {
		const cookie = request.headers.get('cookie') ?? '';
		const form = await request.formData();

		const institutionName = pickStr(form, 'institutionName', 200);
		const institutionType = pickStr(form, 'institutionType', 100);

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
			institutionType,
			tradingName,
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
			return fail(400, { code: 'invalid' as const, fieldErrors, values });
		}

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
		for (const k of Object.keys(structured)) {
			if (structured[k] === undefined) delete structured[k];
		}

		const mergedPayload: Record<string, unknown> = { ...(advanced ?? {}), ...structured };
		const payload = Object.keys(mergedPayload).length > 0 ? mergedPayload : undefined;

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
				values
			});
		}

		void locals;
		throw redirect(303, `/applications/${params.id!}`);
	}
};
