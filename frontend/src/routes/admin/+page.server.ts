import type { PageServerLoad } from './$types';
import { listApplications, listUsers, verifyChain } from '$lib/server/admin';
import { APPLICATION_STATUSES, TERMINAL_STATUSES, type ApplicationStatus, type Role } from 'bnr-shared/domain/state-machine';

const STAFF_ROLES: ReadonlySet<Role> = new Set(['reviewer', 'approver', 'admin']);
const TERMINAL_SET: ReadonlySet<ApplicationStatus> = new Set(TERMINAL_STATUSES);

type StatusCount = { status: ApplicationStatus; count: number };

export type AdminDashboardData = {
	totals: {
		openApplications: number;
		awaitingDecision: number;
		activeStaff: number;
	};
	staffBreakdown: { reviewer: number; approver: number; admin: number };
	statusCounts: StatusCount[];
	auditChain:
		| { kind: 'ok'; rowsChecked: number; lastVerifiedId: string | null }
		| { kind: 'bad'; firstBadId: string | null; reason: string; rowsChecked: number }
		| { kind: 'unavailable' };
	errors: { users: boolean; applications: boolean; audit: boolean };
};

/**
 * Three independent backend calls. Each one's failure is contained so the
 * dashboard can still render the others — admins should never lose audit
 * visibility because applications happens to be slow.
 */
export const load: PageServerLoad = async ({ request, url }): Promise<AdminDashboardData> => {
	const cookie = request.headers.get('cookie') ?? '';
	const origin = url.origin;

	const [usersR, appsR, verifyR] = await Promise.all([
		listUsers(cookie, origin),
		listApplications(cookie, origin, { limit: 200 }),
		verifyChain(cookie, origin)
	]);

	// ── Staff totals ─────────────────────────────────────────────
	const staffBreakdown = { reviewer: 0, approver: 0, admin: 0 };
	let activeStaff = 0;
	if (usersR.ok) {
		for (const u of usersR.data) {
			if (u.disabledAt) continue;
			let isStaff = false;
			for (const r of u.roles) {
				if (r === 'reviewer' || r === 'approver' || r === 'admin') {
					staffBreakdown[r]++;
					isStaff = true;
				}
			}
			if (isStaff) activeStaff++;
		}
	}

	// ── Application counts ───────────────────────────────────────
	const statusCountMap = new Map<ApplicationStatus, number>();
	for (const s of APPLICATION_STATUSES) statusCountMap.set(s, 0);
	let openApplications = 0;
	let awaitingDecision = 0;
	if (appsR.ok) {
		for (const app of appsR.data) {
			statusCountMap.set(app.status, (statusCountMap.get(app.status) ?? 0) + 1);
			if (!TERMINAL_SET.has(app.status)) openApplications++;
			if (app.status === 'READY_FOR_DECISION') awaitingDecision++;
		}
	}
	const statusCounts: StatusCount[] = APPLICATION_STATUSES.map((status) => ({
		status,
		count: statusCountMap.get(status) ?? 0
	}));

	// ── Audit chain ──────────────────────────────────────────────
	let auditChain: AdminDashboardData['auditChain'];
	if (!verifyR.ok) {
		auditChain = { kind: 'unavailable' };
	} else if (verifyR.data.ok) {
		auditChain = {
			kind: 'ok',
			rowsChecked: verifyR.data.rowsChecked,
			lastVerifiedId: verifyR.data.lastVerifiedId
		};
	} else {
		auditChain = {
			kind: 'bad',
			firstBadId: verifyR.data.firstBadId,
			reason: verifyR.data.reason ?? 'mismatch',
			rowsChecked: verifyR.data.rowsChecked
		};
	}

	return {
		totals: { openApplications, awaitingDecision, activeStaff },
		staffBreakdown,
		statusCounts,
		auditChain,
		errors: {
			users: !usersR.ok,
			applications: !appsR.ok,
			audit: !verifyR.ok
		}
	};
};
