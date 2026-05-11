/** Slot versioning: old rows stamped `superseded_at`, new row at version+1. */

import { and, asc, desc, eq, isNull, max, sql } from 'drizzle-orm';

import { documents, type Document } from '../db/schema.ts';
import type { DbOrTx } from './types.ts';

export type InsertDocumentInput = {
  id?: string;
  applicationId: string;
  slot: string;
  version: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: Uint8Array;
  uploadedBy: string;
};

export type ListDocumentsOptions = {
  /** 'current' filters supersededAt IS NULL; 'all' returns history. */
  scope?: 'current' | 'all';
};

export function makeDocumentsRepo(h: DbOrTx) {
  return {
    async findById(id: string): Promise<Document | undefined> {
      const [row] = await h.select().from(documents).where(eq(documents.id, id)).limit(1);
      return row;
    },

    async nextVersionForSlot(applicationId: string, slot: string): Promise<number> {
      const [row] = await h
        .select({ v: max(documents.version) })
        .from(documents)
        .where(and(eq(documents.applicationId, applicationId), eq(documents.slot, slot)));
      return (row?.v ?? 0) + 1;
    },

    async supersedeCurrentSlot(applicationId: string, slot: string): Promise<number> {
      const result = await h
        .update(documents)
        .set({ supersededAt: sql`now()` })
        .where(
          and(
            eq(documents.applicationId, applicationId),
            eq(documents.slot, slot),
            isNull(documents.supersededAt),
          ),
        )
        .returning({ id: documents.id });
      return result.length;
    },

    async insert(input: InsertDocumentInput): Promise<Document> {
      const [row] = await h.insert(documents).values(input).returning();
      if (!row) throw new Error('documents insert returned no row');
      return row;
    },

    async listForApplication(
      applicationId: string,
      opts: ListDocumentsOptions = {},
    ): Promise<Document[]> {
      const conds = [eq(documents.applicationId, applicationId)];
      if ((opts.scope ?? 'current') === 'current') {
        conds.push(isNull(documents.supersededAt));
      }
      return h
        .select()
        .from(documents)
        .where(and(...conds))
        .orderBy(asc(documents.slot), desc(documents.version));
    },
  };
}

export type DocumentsRepo = ReturnType<typeof makeDocumentsRepo>;

export function snapshotDocument(doc: Document): Record<string, unknown> {
  return {
    id: doc.id,
    application_id: doc.applicationId,
    slot: doc.slot,
    version: doc.version,
    filename: doc.filename,
    mime_type: doc.mimeType,
    size_bytes: doc.sizeBytes,
    content_sha256: Buffer.from(doc.contentSha256).toString('hex'),
    uploaded_by: doc.uploadedBy,
    uploaded_at: doc.uploadedAt.toISOString(),
    superseded_at: doc.supersededAt?.toISOString() ?? null,
  };
}
