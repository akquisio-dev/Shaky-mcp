import { openDb, type Db } from '../src/db/connection.js';
import { createCtx, type Ctx } from '../src/core/context.js';
import { readSeedFile, seed } from '../src/core/seed.js';
import type { Source } from '../src/core/schemas.js';

export const NOW = new Date('2026-10-19T12:00:00.000Z');

export function freshDb(): Db {
  return openDb(':memory:');
}

export function ctxFor(db: Db, source: Source = 'web', now = NOW): Ctx {
  return createCtx(db, source, () => now);
}

export function seededCtx(source: Source = 'web'): Ctx {
  const db = freshDb();
  seed(ctxFor(db, 'cli'), readSeedFile(), { origin: 'example' });
  return ctxFor(db, source);
}
