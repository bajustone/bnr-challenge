import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { grantRole, listUsers, revokeRole, type AdminError } from '$lib/server/admin';
import { ROLES, type Role } from 'bnr-shared/domain/state-machine';

const ROLE_SET = new Set<string>(ROLES);
function isRole(value: string): value is Role {
	return ROLE_SET.has(value);
}

export const load: PageServerLoad = async ({ request, url }) => {
	const cookie = request.headers.get('cookie') ?? '';
	const res = await listUsers(cookie, url.origin);
	if (!res.ok) {
		return { users: [], loadError: res.error.kind };
	}
	return { users: res.data, loadError: null };
};

/**
 * Map an AdminError surfaced by the typed client back into a SvelteKit
 * `fail(...)` so `use:enhance` can render a toast / inline message.
 */
function errorBody(op: 'grant' | 'revoke', userId: string, role: Role, error: AdminError) {
	const base = { op, userId, role };
	switch (error.kind) {
		case 'unauthorized':
			return { ...base, status: 401, code: 'unauthorized' as const };
		case 'forbidden':
			return { ...base, status: 403, code: 'forbidden' as const };
		case 'not_found':
			return { ...base, status: 404, code: 'not_found' as const };
		case 'conflict':
			return { ...base, status: 409, code: 'conflict' as const, detail: error.message };
		case 'unreachable':
			return { ...base, status: 503, code: 'unreachable' as const };
		default:
			return { ...base, status: error.status, code: 'unknown' as const };
	}
}

export const actions: Actions = {
	grant: async ({ request, url }) => {
		const cookie = request.headers.get('cookie') ?? '';
		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const roleRaw = String(form.get('role') ?? '');
		if (!userId || !isRole(roleRaw)) {
			return fail(400, { op: 'grant', userId, role: roleRaw, code: 'invalid_input' as const });
		}
		const res = await grantRole(cookie, url.origin, userId, roleRaw);
		if (!res.ok) {
			const body = errorBody('grant', userId, roleRaw, res.error);
			return fail(body.status >= 400 && body.status < 600 ? body.status : 500, body);
		}
		return { op: 'grant', userId, role: roleRaw, ok: true as const };
	},

	revoke: async ({ request, url }) => {
		const cookie = request.headers.get('cookie') ?? '';
		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const roleRaw = String(form.get('role') ?? '');
		if (!userId || !isRole(roleRaw)) {
			return fail(400, { op: 'revoke', userId, role: roleRaw, code: 'invalid_input' as const });
		}
		const res = await revokeRole(cookie, url.origin, userId, roleRaw);
		if (!res.ok) {
			const body = errorBody('revoke', userId, roleRaw, res.error);
			return fail(body.status >= 400 && body.status < 600 ? body.status : 500, body);
		}
		return { op: 'revoke', userId, role: roleRaw, ok: true as const };
	}
};
