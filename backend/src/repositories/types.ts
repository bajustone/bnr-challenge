/**
 * `DbOrTx` lets repos run against the pool or a tx with the same surface.
 * `import type` keeps env.ts out of modules that only need the typings.
 */

import type { db } from '../db/index.ts';

export type DbHandle = typeof db;
export type Tx = Parameters<Parameters<DbHandle['transaction']>[0]>[0];
export type DbOrTx = DbHandle | Tx;
