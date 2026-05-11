/**
 * Layout:
 *   $STORAGE_DIR/tmp/<uuid>.part   in-flight; atomic-renamed on success
 *   $STORAGE_DIR/<ab>/<sha256>     final, fan-out by first hex byte
 */

import { mkdir, access, rename, unlink } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { env } from '../env.ts';

export type StorageLayout = {
  root: string;
  tmpDir: string;
  pathFor(sha256Hex: string): string;
  newTempPath(): string;
};

export function makeStorageLayout(root = env.STORAGE_DIR): StorageLayout {
  const tmpDir = path.join(root, 'tmp');
  return {
    root,
    tmpDir,
    pathFor(sha256Hex: string): string {
      if (!/^[0-9a-f]{64}$/.test(sha256Hex)) {
        throw new Error(`invalid sha256 hex: ${sha256Hex}`);
      }
      return path.join(root, sha256Hex.slice(0, 2), sha256Hex);
    },
    newTempPath(): string {
      return path.join(tmpDir, `${randomUUID()}.part`);
    },
  };
}

/** mkdir + writability probe at boot; fails loud rather than on first upload. */
export async function initStorage(layout: StorageLayout = makeStorageLayout()): Promise<void> {
  await mkdir(layout.root, { recursive: true, mode: 0o700 });
  await mkdir(layout.tmpDir, { recursive: true, mode: 0o700 });
  await access(layout.root, fsConstants.W_OK | fsConstants.R_OK);
  await access(layout.tmpDir, fsConstants.W_OK | fsConstants.R_OK);
}

/** Atomic on POSIX rename(2) when source + dest share a filesystem. */
export async function commitTempToFinal(tempPath: string, finalPath: string): Promise<void> {
  await mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });
  await rename(tempPath, finalPath);
}

/** Best-effort cleanup; callers swallow ENOENT. */
export async function discardTemp(tempPath: string): Promise<void> {
  try {
    await unlink(tempPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
