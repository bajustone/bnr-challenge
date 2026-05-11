import { redirect, type RequestHandler } from '@sveltejs/kit';
import { signOut } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	await signOut(request.headers.get('cookie') ?? '', cookies, url.origin);
	throw redirect(303, '/login');
};
