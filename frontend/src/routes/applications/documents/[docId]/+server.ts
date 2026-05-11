import { error, type RequestHandler } from '@sveltejs/kit';
import { BACKEND_URL } from '$lib/server/backend';

/**
 * Streams a document from the backend through SvelteKit so the HttpOnly
 * session cookie stays server-side. The browser never sees the backend
 * origin — same-origin URLs all the way.
 *
 * We pipe `body` straight through to keep memory flat for the 5 MiB cap.
 */
export const GET: RequestHandler = async ({ params, request, url }) => {
	const docId = params.docId;
	if (!docId) throw error(400, 'Missing document id');

	const upstream = await fetch(
		`${BACKEND_URL}/documents/${encodeURIComponent(docId)}/content`,
		{
			headers: {
				accept: '*/*',
				cookie: request.headers.get('cookie') ?? '',
				origin: url.origin
			}
		}
	).catch(() => null);

	if (!upstream) throw error(503, 'Backend unreachable');
	if (upstream.status === 401) throw error(401, 'Not authenticated');
	if (upstream.status === 403) throw error(403, 'Not authorised');
	if (upstream.status === 404) throw error(404, 'Document not found');
	if (!upstream.ok) throw error(upstream.status, `Backend returned ${upstream.status}`);

	const headers = new Headers();
	for (const h of ['content-type', 'content-length', 'content-disposition']) {
		const v = upstream.headers.get(h);
		if (v) headers.set(h, v);
	}
	return new Response(upstream.body, { status: 200, headers });
};
