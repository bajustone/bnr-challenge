/**
 * Upload: stream-to-tmp with sha256 + byte cap → tx (authz → upsert blob
 * → atomic rename / discard tmp → supersede + insert document → audit).
 * Read: single-row find + visibility check + stream; no tx.
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { db } from '../db/index.ts';
import { env } from '../env.ts';
import {
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '../errors.ts';
import { makeRepos } from '../repositories/index.ts';
import { snapshotDocument } from '../repositories/documents.repo.ts';
import { canViewApplication } from '../auth/policy.ts';
import {
  commitTempToFinal,
  discardTemp,
  makeStorageLayout,
  type StorageLayout,
} from '../storage/index.ts';
import { dominantRole, type Role } from 'bnr-shared';
import type { Document, DocumentBlob } from '../db/schema.ts';

export type Actor = {
  id: string;
  roles: Role[];
  requestId?: string;
};

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export type UploadInput = {
  applicationId: string;
  slot: string;
  filename: string;
  mimeType: string;
  body: ReadableStream<Uint8Array> | Readable;
  /** Hard cap surfaced for tests; defaults to env.MAX_DOCUMENT_BYTES. */
  maxBytes?: number;
};

export type UploadResult = {
  document: Document;
  blob: DocumentBlob;
  blobInserted: boolean;
};

type StreamResult = {
  tempPath: string;
  sha256Hex: string;
  sha256Bytes: Uint8Array;
  sizeBytes: number;
};

/** Pipeline body → [meter: count + hash + cap] → disk. */
async function streamToTemp(
  layout: StorageLayout,
  body: UploadInput['body'],
  maxBytes: number,
): Promise<StreamResult> {
  const tempPath = layout.newTempPath();
  // Idempotent; cheaper than asserting initStorage() ran at boot.
  await mkdir(path.dirname(tempPath), { recursive: true, mode: 0o700 });
  const out = createWriteStream(tempPath, { mode: 0o600 });
  const hasher = createHash('sha256');
  let size = 0;

  const nodeStream =
    body instanceof Readable
      ? body
      : (Readable.fromWeb(body as unknown as never) as Readable);

  // Short-circuits the pipeline at the cap, so a lying Content-Length
  // can't smuggle bytes past us.
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > maxBytes) {
        cb(new PayloadTooLargeError(maxBytes));
        return;
      }
      hasher.update(chunk);
      cb(null, chunk);
    },
  });

  try {
    await pipeline(nodeStream, meter, out);
  } catch (err) {
    await discardTemp(tempPath);
    throw err;
  }

  // Re-stat: belt + braces against a stream that misreports.
  const fileStat = await stat(tempPath);
  if (fileStat.size > maxBytes || fileStat.size !== size) {
    await discardTemp(tempPath);
    throw new PayloadTooLargeError(maxBytes);
  }

  if (size === 0) {
    await discardTemp(tempPath);
    throw new ValidationError('empty upload');
  }

  const sha256Bytes = new Uint8Array(hasher.digest());
  const sha256Hex = Buffer.from(sha256Bytes).toString('hex');
  return { tempPath, sha256Hex, sha256Bytes, sizeBytes: size };
}

export async function upload(actor: Actor, input: UploadInput): Promise<UploadResult> {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new UnsupportedMediaTypeError(ALLOWED_MIME_TYPES);
  }
  if (!input.slot || input.slot.length > 64) {
    throw new ValidationError('slot must be 1..64 chars', { slot: input.slot });
  }

  const layout = makeStorageLayout();
  const maxBytes = input.maxBytes ?? env.MAX_DOCUMENT_BYTES;
  const streamed = await streamToTemp(layout, input.body, maxBytes);

  try {
    return await db.transaction(async (tx) => {
      const repos = makeRepos(tx);
      const app = await repos.applications.findById(input.applicationId);
      if (!app) throw new NotFoundError('application not found');
      if (app.applicantId !== actor.id) {
        throw new ForbiddenError('only the applicant can upload documents');
      }
      if (app.status !== 'DRAFT' && app.status !== 'RFI_REQUESTED') {
        throw new ValidationError('uploads only allowed in DRAFT or RFI_REQUESTED', {
          status: app.status,
        });
      }

      const finalPath = layout.pathFor(streamed.sha256Hex);
      const upserted = await repos.documentBlobs.upsert({
        sha256: streamed.sha256Bytes,
        sizeBytes: streamed.sizeBytes,
        storagePath: finalPath,
      });

      if (upserted.inserted) {
        await commitTempToFinal(streamed.tempPath, finalPath);
      } else {
        await discardTemp(streamed.tempPath);
      }

      await repos.documents.supersedeCurrentSlot(input.applicationId, input.slot);
      const version = await repos.documents.nextVersionForSlot(input.applicationId, input.slot);
      const doc = await repos.documents.insert({
        applicationId: input.applicationId,
        slot: input.slot,
        version,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: streamed.sizeBytes,
        contentSha256: streamed.sha256Bytes,
        uploadedBy: actor.id,
      });

      await repos.audit.append({
        actorId: actor.id,
        actorRole: 'applicant',
        action: 'document.uploaded',
        resourceType: 'document',
        resourceId: doc.id,
        afterState: snapshotDocument(doc),
        metadata: {
          request_id: actor.requestId ?? null,
          application_id: input.applicationId,
          slot: input.slot,
          version,
          sha256: streamed.sha256Hex,
        },
      });

      return { document: doc, blob: upserted.blob, blobInserted: upserted.inserted };
    });
  } catch (err) {
    await discardTemp(streamed.tempPath);
    throw err;
  }
}

export async function getMetadata(actor: Actor, documentId: string): Promise<Document> {
  const repos = makeRepos(db);
  const doc = await repos.documents.findById(documentId);
  if (!doc) throw new NotFoundError('document not found');
  const app = await repos.applications.findById(doc.applicationId);
  if (!app) throw new NotFoundError('document not found');
  if (!canViewApplication({ userId: actor.id, roles: actor.roles }, app)) {
    throw new ForbiddenError('actor cannot view this document');
  }
  return doc;
}

export async function listForApplication(
  actor: Actor,
  applicationId: string,
  scope: 'current' | 'all' = 'current',
): Promise<Document[]> {
  const repos = makeRepos(db);
  const app = await repos.applications.findById(applicationId);
  if (!app) throw new NotFoundError('application not found');
  if (!canViewApplication({ userId: actor.id, roles: actor.roles }, app)) {
    throw new ForbiddenError('actor cannot view this application');
  }
  return repos.documents.listForApplication(applicationId, { scope });
}

export type DownloadHandle = {
  document: Document;
  blob: DocumentBlob;
  /** Absolute path on disk. Stream this. */
  storagePath: string;
};

export async function openDownload(actor: Actor, documentId: string): Promise<DownloadHandle> {
  return db.transaction(async (tx) => {
    const repos = makeRepos(tx);
    const doc = await repos.documents.findById(documentId);
    if (!doc) throw new NotFoundError('document not found');
    const app = await repos.applications.findById(doc.applicationId);
    if (!app) throw new NotFoundError('document not found');
    if (!canViewApplication({ userId: actor.id, roles: actor.roles }, app)) {
      throw new ForbiddenError('actor cannot view this document');
    }
    const blob = await repos.documentBlobs.getBySha256(doc.contentSha256);
    if (!blob) throw new NotFoundError('document blob missing');

    await repos.audit.append({
      actorId: actor.id,
      actorRole: dominantRole(actor.roles),
      action: 'document.downloaded',
      resourceType: 'document',
      resourceId: doc.id,
      metadata: {
        request_id: actor.requestId ?? null,
        application_id: doc.applicationId,
      },
    });

    return { document: doc, blob, storagePath: blob.storagePath };
  });
}
