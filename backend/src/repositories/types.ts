/**
 * Repository handle types. Repos accept either the pool (`db`) or a
 * transaction handle (the `tx` passed by `db.transaction(cb)`); both expose
 * the same method surface for query / mutation purposes, so a repo built
 * over `tx` participates in the surrounding transaction transparently.
 *
 * Importing `db` as a type only (`import type`) avoids dragging env.ts
 * validation into modules that only need the typings.
 */

import type { db } from '../db/index.ts';

export type DbHandle = typeof db;

/** Tx handle yielded inside `db.transaction(async (tx) => {…})`. */
export type Tx = Parameters<Parameters<DbHandle['transaction']>[0]>[0];

/** Either pool or tx; repo factories accept whichever the caller has. */
export type DbOrTx = DbHandle | Tx;
