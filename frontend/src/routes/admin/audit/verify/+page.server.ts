import type { PageServerLoad } from './$types';
import { verifyChain } from '$lib/server/admin';

export type VerifyOutcome =
	| { kind: 'ok'; rowsChecked: number; lastVerifiedId: string | null }
	| { kind: 'bad'; rowsChecked: number; firstBadId: string | null; reason: string }
	| { kind: 'unavailable'; reason: string };

/**
 * The verifier returns synchronously from the backend, so we just run it
 * in the page loader and surface the result on first paint. The page
 * exposes a "Run again" button that triggers invalidateAll — no separate
 * action route needed.
 */
export const load: PageServerLoad = async ({ request, url }): Promise<{
	outcome: VerifyOutcome;
	ranAt: string;
}> => {
	const cookie = request.headers.get('cookie') ?? '';
	const ranAt = new Date().toISOString();
	const res = await verifyChain(cookie, url.origin);
	if (!res.ok) {
		return { outcome: { kind: 'unavailable', reason: res.error.kind }, ranAt };
	}
	if (res.data.ok) {
		return {
			outcome: {
				kind: 'ok',
				rowsChecked: res.data.rowsChecked,
				lastVerifiedId: res.data.lastVerifiedId
			},
			ranAt
		};
	}
	return {
		outcome: {
			kind: 'bad',
			rowsChecked: res.data.rowsChecked,
			firstBadId: res.data.firstBadId,
			reason: res.data.reason ?? 'hash mismatch'
		},
		ranAt
	};
};
