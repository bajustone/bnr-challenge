/**
 * Domain errors → HTTP. Throw anywhere; onError in index.ts serialises.
 * 403 fires before 404 — NotFoundError only after the actor is authorised
 * to know the resource exists (brief N11).
 */

import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { TransitionFailureReason } from 'bnr-shared';

export type ErrorBody = {
  error: string;
  requestId?: string;
  [k: string]: unknown;
};

export abstract class AppError extends Error {
  abstract readonly status: ContentfulStatusCode;
  abstract readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }

  toBody(requestId?: string): ErrorBody {
    return { error: this.code, requestId, ...this.details };
  }
}

export class UnauthorizedError extends AppError {
  readonly status = 401 as const;
  readonly code = 'unauthenticated';
}

export class ForbiddenError extends AppError {
  readonly status = 403 as const;
  readonly code = 'forbidden';
}

export class NotFoundError extends AppError {
  readonly status = 404 as const;
  readonly code = 'not_found';
}

export class ValidationError extends AppError {
  readonly status = 422 as const;
  readonly code = 'invalid';
}

export class IllegalTransitionError extends AppError {
  readonly status = 409 as const;
  readonly code = 'illegal_transition';
  constructor(details: { from: string; event: string; reason: TransitionFailureReason }) {
    super(`illegal transition: ${details.from} --${details.event}--> ?`, details);
  }
}

export class ConcurrentUpdateError extends AppError {
  readonly status = 409 as const;
  readonly code = 'conflict';
  constructor() {
    super('concurrent update; refresh and retry', { hint: 'refresh and retry' });
  }
}

export class PayloadTooLargeError extends AppError {
  readonly status = 413 as const;
  readonly code = 'too_large';
  constructor(maxBytes: number) {
    super(`payload too large; max ${maxBytes} bytes`, { maxBytes });
  }
}

export class UnsupportedMediaTypeError extends AppError {
  readonly status = 415 as const;
  readonly code = 'unsupported_media_type';
  constructor(allowed: readonly string[]) {
    super(`unsupported media type; allowed ${allowed.join(', ')}`, { allowed });
  }
}

export class ConflictError extends AppError {
  readonly status = 409 as const;
  readonly code = 'conflict';
}

/** Translate a state-machine failure reason into the right HTTP status. */
export function mapStateMachineError(args: {
  from: string;
  event: string;
  reason: TransitionFailureReason;
}): AppError {
  switch (args.reason) {
    case 'forbidden_role':
    case 'not_owner':
      return new ForbiddenError('actor not permitted to perform this transition', args);
    case 'dual_control_violation':
      return new ForbiddenError('dual control: approver must differ from reviewer', args);
    case 'missing_message':
      return new ValidationError('message is required for this transition', args);
    case 'illegal_transition':
    default:
      return new IllegalTransitionError(args);
  }
}
