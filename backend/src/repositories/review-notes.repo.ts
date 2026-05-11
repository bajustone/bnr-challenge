/**
 * Append-only — no update / delete / supersede here, matching the
 * SELECT, INSERT-only grant on app_user. Visibility is a caller-supplied
 * filter, not a role; policy lives in the service.
 */

import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  reviewNotes,
  type NewReviewNote,
  type ReviewNote,
  type ReviewNoteVisibility,
} from '../db/schema.ts';
import type { DbOrTx } from './types.ts';

export type CreateReviewNoteInput = {
  applicationId: string;
  authorId: string;
  authorRole: NewReviewNote['authorRole'];
  visibility: ReviewNoteVisibility;
  body: string;
};

export type ListReviewNotesOptions = {
  /** If provided, restricts to these visibilities; otherwise all are returned. */
  visibilities?: ReviewNoteVisibility[];
};

export function makeReviewNotesRepo(h: DbOrTx) {
  return {
    listForApplication(
      applicationId: string,
      opts: ListReviewNotesOptions = {},
    ): Promise<ReviewNote[]> {
      const conditions = [eq(reviewNotes.applicationId, applicationId)];
      if (opts.visibilities && opts.visibilities.length > 0) {
        conditions.push(inArray(reviewNotes.visibility, opts.visibilities));
      }
      return h
        .select()
        .from(reviewNotes)
        .where(and(...conditions))
        .orderBy(asc(reviewNotes.createdAt));
    },

    /** Body length CHECK is at the DB; service validates earlier for a friendly 422. */
    async create(input: CreateReviewNoteInput): Promise<ReviewNote> {
      const [row] = await h.insert(reviewNotes).values(input).returning();
      if (!row) throw new Error('review_notes insert returned no row');
      return row;
    },
  };
}

export type ReviewNotesRepo = ReturnType<typeof makeReviewNotesRepo>;
