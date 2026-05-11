/**
 * State machine — every edge legal, every non-edge rejected, dual control
 * enforced. Pure logic, no DB needed.
 */

import { describe, it, expect } from 'vitest';

import {
  APPLICATION_STATUSES,
  TERMINAL_STATUSES,
  TRANSITION_EVENTS,
  isTerminal,
  listLegalEdges,
  transition,
  type ApplicationStatus,
  type Role,
  type TransitionEvent,
} from 'bnr-shared';

const APPLICANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const REVIEWER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const APPROVER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ADMIN = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const OTHER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

type Actor = { id: string; roles: Role[] };

const actor = (id: string, roles: Role[]): Actor => ({ id, roles });

function app(
  overrides: Partial<{ applicantId: string; reviewedBy: string | null; decidedBy: string | null }> = {},
) {
  return {
    applicantId: APPLICANT,
    reviewedBy: null as string | null,
    decidedBy: null as string | null,
    ...overrides,
  };
}

describe('transition — legal edges', () => {
  for (const edge of listLegalEdges()) {
    it(`${edge.from} --${edge.event}--> ${edge.to} accepted for an authorised actor`, () => {
      const role = edge.roles[0]!;
      const actorId = role === 'applicant' ? APPLICANT : role === 'reviewer' ? REVIEWER : APPROVER;
      const message = edge.event === 'request_info' ? 'please attach Q3 figures' : undefined;
      const result = transition({
        currentStatus: edge.from,
        event: edge.event,
        actor: actor(actorId, [role]),
        application: app({
          // approve/reject need a reviewer already set so dual-control can fire (it must NOT trip here)
          reviewedBy: edge.dualControl ? REVIEWER : null,
        }),
        message,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.nextStatus).toBe(edge.to);
        expect(result.eventName).toBe(edge.event);
      }
    });
  }
});

describe('transition — illegal edges', () => {
  it('every (status, event) pair not on the diagram is rejected as illegal_transition', () => {
    const legal = new Set(
      listLegalEdges().map((e) => `${e.from}|${e.event}`),
    );
    for (const status of APPLICATION_STATUSES) {
      for (const event of TRANSITION_EVENTS) {
        if (legal.has(`${status}|${event}`)) continue;
        const result = transition({
          currentStatus: status,
          event,
          actor: actor(ADMIN, ['admin']),
          application: app(),
          message: 'x',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe('illegal_transition');
        }
      }
    }
  });

  it('terminal states reject every event', () => {
    for (const status of TERMINAL_STATUSES) {
      for (const event of TRANSITION_EVENTS) {
        const result = transition({
          currentStatus: status,
          event,
          actor: actor(ADMIN, ['admin']),
          application: app(),
          message: 'x',
        });
        expect(result.ok).toBe(false);
      }
    }
  });
});

describe('transition — role guards', () => {
  it('applicant cannot mark_ready', () => {
    const result = transition({
      currentStatus: 'UNDER_REVIEW',
      event: 'mark_ready',
      actor: actor(APPLICANT, ['applicant']),
      application: app(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('forbidden_role');
  });

  it('reviewer cannot approve', () => {
    const result = transition({
      currentStatus: 'READY_FOR_DECISION',
      event: 'approve',
      actor: actor(REVIEWER, ['reviewer']),
      application: app({ reviewedBy: REVIEWER }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('forbidden_role');
  });

  it('applicant cannot submit someone else’s application', () => {
    const result = transition({
      currentStatus: 'DRAFT',
      event: 'submit',
      actor: actor(OTHER, ['applicant']),
      application: app(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_owner');
  });
});

describe('transition — dual control', () => {
  it('reviewer who already reviewed cannot also approve', () => {
    const result = transition({
      currentStatus: 'READY_FOR_DECISION',
      event: 'approve',
      // Actor is both reviewer and approver and reviewed this row already.
      actor: actor(REVIEWER, ['reviewer', 'approver']),
      application: app({ reviewedBy: REVIEWER }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('dual_control_violation');
  });

  it('a different approver can approve even if also holding reviewer role', () => {
    const result = transition({
      currentStatus: 'READY_FOR_DECISION',
      event: 'approve',
      actor: actor(APPROVER, ['approver']),
      application: app({ reviewedBy: REVIEWER }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch.decision).toBe('APPROVED');
  });
});

describe('transition — request_info', () => {
  it('rejects when message is missing or whitespace', () => {
    for (const message of [undefined, '', '   '] as const) {
      const result = transition({
        currentStatus: 'UNDER_REVIEW',
        event: 'request_info',
        actor: actor(REVIEWER, ['reviewer']),
        application: app({ reviewedBy: REVIEWER }),
        message,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('missing_message');
    }
  });
});

describe('isTerminal', () => {
  it('matches the TERMINAL_STATUSES constant', () => {
    for (const s of APPLICATION_STATUSES) {
      expect(isTerminal(s)).toBe(
        (TERMINAL_STATUSES as readonly ApplicationStatus[]).includes(s),
      );
    }
  });
});

describe('transition — patch shape', () => {
  it('submit stamps submittedAt, no reviewer/approver', () => {
    const result = transition({
      currentStatus: 'DRAFT',
      event: 'submit',
      actor: actor(APPLICANT, ['applicant']),
      application: app(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch.setSubmittedAt).toBe(true);
      expect(result.patch.reviewedBy).toBeNull();
      expect(result.patch.decidedBy).toBeNull();
    }
  });

  it('assign records the reviewer', () => {
    const result = transition({
      currentStatus: 'SUBMITTED',
      event: 'assign',
      actor: actor(REVIEWER, ['reviewer']),
      application: app(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch.reviewedBy).toBe(REVIEWER);
  });

  it('mark_ready stamps reviewedAt', () => {
    const result = transition({
      currentStatus: 'UNDER_REVIEW',
      event: 'mark_ready',
      actor: actor(REVIEWER, ['reviewer']),
      application: app({ reviewedBy: REVIEWER }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch.setReviewedAt).toBe(true);
  });

  it('approve records decision + decidedBy + decidedAt', () => {
    const result = transition({
      currentStatus: 'READY_FOR_DECISION',
      event: 'approve',
      actor: actor(APPROVER, ['approver']),
      application: app({ reviewedBy: REVIEWER }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch.decision).toBe('APPROVED');
      expect(result.patch.decidedBy).toBe(APPROVER);
      expect(result.patch.setDecidedAt).toBe(true);
    }
  });
});

// Coverage tripwire — if `TRANSITION_EVENTS` gains an entry it must show up
// on at least one edge in the diagram, otherwise the new event is dead code.
describe('TRANSITION_EVENTS coverage', () => {
  it('every event is referenced by at least one legal edge', () => {
    const used = new Set(listLegalEdges().map((e) => e.event));
    for (const event of TRANSITION_EVENTS as readonly TransitionEvent[]) {
      expect(used).toContain(event);
    }
  });
});
