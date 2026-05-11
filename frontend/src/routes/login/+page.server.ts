import { fail, redirect, type Actions } from '@sveltejs/kit';
import { signIn } from '$lib/server/auth';

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { error: 'missing_fields' as const, email });
		}

		const result = await signIn({ email, password }, cookies, url.origin);
		if (!result.ok) {
			if (result.status === 401) {
				return fail(401, { error: 'invalid_credentials' as const, email });
			}
			if (result.status === 503) {
				return fail(503, { error: 'backend_unreachable' as const, email });
			}
			return fail(500, { error: 'unknown' as const, email });
		}

		throw redirect(303, '/');
	}
};
