/**
 * Application workflow — pure function, no I/O. Same module imported by
 * the backend service (to authorise + compute the UPDATE patch) and the
 * frontend (to render only the buttons the backend would accept).
 *
 * Three checks, in order:
 *   1. legal edge   — (currentStatus, event) on the diagram
 *   2. role guard   — actor holds a role that owns the edge
 *   3. dual control — approver != reviewer on the same application
 *
 * Adding an edge means: add a row to TRANSITIONS, add tests, run the
 * migration if a new status is introduced.
 */

export const APPLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'RFI_REQUESTED',
  'READY_FOR_DECISION',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const TERMINAL_STATUSES = ['APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export const TRANSITION_EVENTS = [
  'submit',
  'withdraw',
  'assign',
  'request_info',
  'resubmit',
  'mark_ready',
  'approve',
  'reject',
] as const;
export type TransitionEvent = (typeof TRANSITION_EVENTS)[number];

export const ROLES = ['applicant', 'reviewer', 'approver', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export type DecisionKind = 'APPROVED' | 'REJECTED';

export type TransitionActor = {
  id: string;
  roles: readonly Role[];
};

export type TransitionApplication = {
  applicantId: string;
  reviewedBy: string | null;
  decidedBy: string | null;
};

export type TransitionInput = {
  currentStatus: ApplicationStatus;
  event: TransitionEvent;
  actor: TransitionActor;
  application: TransitionApplication;
  /** Required for `request_info`. Becomes the body of the applicant-visible note. */
  message?: string;
};

/**
 * Patch the service applies to the `applications` row. `null` means "do
 * not touch"; the repo coalesces against the existing column. The patch
 * never modifies `applicantId` or `version` (the repo bumps `version`).
 */
export type TransitionPatch = {
  nextStatus: ApplicationStatus;
  reviewedBy: string | null;
  decidedBy: string | null;
  decision: DecisionKind | null;
  setSubmittedAt: boolean;
  setReviewedAt: boolean;
  setDecidedAt: boolean;
};

export type TransitionFailureReason =
  | 'illegal_transition'
  | 'forbidden_role'
  | 'dual_control_violation'
  | 'not_owner'
  | 'missing_message';

export type TransitionResult =
  | {
      ok: true;
      nextStatus: ApplicationStatus;
      patch: TransitionPatch;
      eventName: TransitionEvent;
      /** Role under which the actor is acting for this transition (audit attribution). */
      actorRole: Role;
    }
  | { ok: false; reason: TransitionFailureReason };

type EdgeRule = {
  from: ApplicationStatus;
  event: TransitionEvent;
  to: ApplicationStatus;
  /** Any of these roles is sufficient. */
  roles: readonly Role[];
  /** `applicant` edges additionally require the actor to own the application. */
  ownerOnly?: boolean;
  /** `request_info` requires a non-empty message. */
  requiresMessage?: boolean;
  /** `approve` / `reject` — actor must not be the reviewer. */
  dualControl?: boolean;
  decision?: DecisionKind;
  setSubmittedAt?: boolean;
  setReviewedAt?: boolean;
  setDecidedAt?: boolean;
  /** When true, the edge assigns the actor as reviewer. */
  assignsReviewer?: boolean;
  /** When true, the edge stamps decidedBy = actor.id. */
  assignsApprover?: boolean;
};

const TRANSITIONS: readonly EdgeRule[] = [
  {
    from: 'DRAFT',
    event: 'submit',
    to: 'SUBMITTED',
    roles: ['applicant'],
    ownerOnly: true,
    setSubmittedAt: true,
  },
  { from: 'DRAFT', event: 'withdraw', to: 'WITHDRAWN', roles: ['applicant'], ownerOnly: true },
  {
    from: 'SUBMITTED',
    event: 'assign',
    to: 'UNDER_REVIEW',
    roles: ['reviewer', 'admin'],
    assignsReviewer: true,
  },
  {
    from: 'SUBMITTED',
    event: 'withdraw',
    to: 'WITHDRAWN',
    roles: ['applicant'],
    ownerOnly: true,
  },
  {
    from: 'UNDER_REVIEW',
    event: 'request_info',
    to: 'RFI_REQUESTED',
    roles: ['reviewer', 'admin'],
    requiresMessage: true,
  },
  {
    from: 'UNDER_REVIEW',
    event: 'mark_ready',
    to: 'READY_FOR_DECISION',
    roles: ['reviewer', 'admin'],
    setReviewedAt: true,
  },
  {
    from: 'RFI_REQUESTED',
    event: 'resubmit',
    to: 'SUBMITTED',
    roles: ['applicant'],
    ownerOnly: true,
    setSubmittedAt: true,
  },
  {
    from: 'RFI_REQUESTED',
    event: 'withdraw',
    to: 'WITHDRAWN',
    roles: ['applicant'],
    ownerOnly: true,
  },
  {
    from: 'READY_FOR_DECISION',
    event: 'approve',
    to: 'APPROVED',
    roles: ['approver', 'admin'],
    dualControl: true,
    decision: 'APPROVED',
    assignsApprover: true,
    setDecidedAt: true,
  },
  {
    from: 'READY_FOR_DECISION',
    event: 'reject',
    to: 'REJECTED',
    roles: ['approver', 'admin'],
    dualControl: true,
    decision: 'REJECTED',
    assignsApprover: true,
    setDecidedAt: true,
  },
];

function findEdge(from: ApplicationStatus, event: TransitionEvent): EdgeRule | undefined {
  return TRANSITIONS.find((e) => e.from === from && e.event === event);
}

/** Role the actor is exercising for this transition. Prefers the edge's primary role. */
function pickActorRole(actor: TransitionActor, edge: EdgeRule): Role | null {
  for (const r of edge.roles) {
    if (actor.roles.includes(r)) return r;
  }
  if (actor.roles.includes('admin')) return 'admin';
  return null;
}

export function transition(input: TransitionInput): TransitionResult {
  const edge = findEdge(input.currentStatus, input.event);
  if (!edge) return { ok: false, reason: 'illegal_transition' };

  const actorRole = pickActorRole(input.actor, edge);
  if (!actorRole) return { ok: false, reason: 'forbidden_role' };

  if (edge.ownerOnly && input.actor.id !== input.application.applicantId) {
    return { ok: false, reason: 'not_owner' };
  }

  if (edge.dualControl && input.application.reviewedBy === input.actor.id) {
    return { ok: false, reason: 'dual_control_violation' };
  }

  if (edge.requiresMessage && (!input.message || input.message.trim().length === 0)) {
    return { ok: false, reason: 'missing_message' };
  }

  const patch: TransitionPatch = {
    nextStatus: edge.to,
    reviewedBy: edge.assignsReviewer ? input.actor.id : null,
    decidedBy: edge.assignsApprover ? input.actor.id : null,
    decision: edge.decision ?? null,
    setSubmittedAt: !!edge.setSubmittedAt,
    setReviewedAt: !!edge.setReviewedAt,
    setDecidedAt: !!edge.setDecidedAt,
  };

  return {
    ok: true,
    nextStatus: edge.to,
    patch,
    eventName: input.event,
    actorRole,
  };
}

/** All legal `(from, event)` pairs. Used by tests and by the OpenAPI surface. */
export function listLegalEdges(): readonly EdgeRule[] {
  return TRANSITIONS;
}

export function isTerminal(status: ApplicationStatus): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}
