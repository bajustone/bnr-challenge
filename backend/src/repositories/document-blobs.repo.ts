/**
 * Content-addressed blob registry. INSERT-on-conflict is the dedup path —
 * two applicants uploading byte-identical files share the row.
 */

import { eq } from 'drizzle-orm';

import { documentBlobs, type DocumentBlob } from '../db/schema.ts';
import type { DbOrTx } from './types.ts';

export type UpsertBlobInput = {
  sha256: Uint8Array;
  sizeBytes: number;
  storagePath: string;
};

export type UpsertBlobResult = {
  blob: DocumentBlob;
  inserted: boolean;
};

export function makeDocumentBlobsRepo(h: DbOrTx) {
  return {
    async getBySha256(sha256: Uint8Array): Promise<DocumentBlob | undefined> {
      const [row] = await h
        .select()
        .from(documentBlobs)
        .where(eq(documentBlobs.sha256, sha256))
        .limit(1);
      return row;
    },

    /**
     * Insert when new, no-op when already present. Returns `inserted: false`
     * to let the caller delete its temp file instead of renaming.
     */
    async upsert(input: UpsertBlobInput): Promise<UpsertBlobResult> {
      const [inserted] = await h
        .insert(documentBlobs)
        .values({
          sha256: input.sha256,
          sizeBytes: input.sizeBytes,
          storagePath: input.storagePath,
        })
        .onConflictDoNothing({ target: documentBlobs.sha256 })
        .returning();

      if (inserted) return { blob: inserted, inserted: true };

      const [existing] = await h
        .select()
        .from(documentBlobs)
        .where(eq(documentBlobs.sha256, input.sha256))
        .limit(1);
      if (!existing) throw new Error('upsert conflict but no existing row');
      return { blob: existing, inserted: false };
    },
  };
}

export type DocumentBlobsRepo = ReturnType<typeof makeDocumentBlobsRepo>;
