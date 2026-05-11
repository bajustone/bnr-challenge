import type { Application } from '$lib/server/admin';
import type { ApplicationStatus } from 'bnr-shared/domain/state-machine';

/**
 * Thresholds in days for "this application has been sitting too long in this
 * status". Pure heuristic — flags an item, never blocks a workflow event.
 *
 * Tuned from the design notes:
 *   RFI_REQUESTED        → 7d  (applicant hasn't replied)
 *   READY_FOR_DECISION   → 5d  (approver hasn't moved)
 *   UNDER_REVIEW         → 10d (reviewer hasn't progressed)
 *
 * Statuses not listed below are never flagged. Terminal statuses are
 * inherently never stuck.
 */
const STUCK_THRESHOLDS: Partial<Record<ApplicationStatus, { days: number; reason: string }>> = {
	RFI_REQUESTED: { days: 7, reason: 'RFI sent, awaiting applicant reply' },
	READY_FOR_DECISION: { days: 5, reason: 'Awaiting approver decision' },
	UNDER_REVIEW: { days: 10, reason: 'Under review with no recent activity' }
};

const MS_PER_DAY = 86_400_000;

export type StuckVerdict =
	| { stuck: false }
	| { stuck: true; reason: string; thresholdDays: number; idleDays: number };

export function classifyStuck(app: Application, now: Date = new Date()): StuckVerdict {
	const rule = STUCK_THRESHOLDS[app.status];
	if (!rule) return { stuck: false };
	const updated = Date.parse(app.updatedAt);
	if (!Number.isFinite(updated)) return { stuck: false };
	const idleDays = Math.floor((now.getTime() - updated) / MS_PER_DAY);
	if (idleDays < rule.days) return { stuck: false };
	return { stuck: true, reason: rule.reason, thresholdDays: rule.days, idleDays };
}

export function idleDays(app: Application, now: Date = new Date()): number {
	const updated = Date.parse(app.updatedAt);
	if (!Number.isFinite(updated)) return 0;
	return Math.max(0, Math.floor((now.getTime() - updated) / MS_PER_DAY));
}
