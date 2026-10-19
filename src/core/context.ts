import type { Db } from '../db/connection.js';
import { insertActivity, type Activity } from '../db/repos/misc.js';
import type { Source } from './schemas.js';

/** Everything a core operation needs: the database, who is acting and a clock. */
export interface Ctx {
  db: Db;
  source: Source;
  now: () => Date;
}

export function createCtx(db: Db, source: Source, now: () => Date = () => new Date()): Ctx {
  return { db, source, now };
}

export type ErrorCode = 'not_found' | 'invalid' | 'ambiguous' | 'conflict';

export class ShakyError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ShakyError';
  }
}

export interface Change {
  entity: string;
  entity_id: number | null;
  action: string;
  summary: string;
  data: Record<string, unknown>;
}

/** Collects the activity rows written during one mutation. */
export class ChangeSet {
  readonly changes: Change[] = [];
  constructor(private readonly ctx: Ctx) {}

  record(c: Omit<Change, 'data'> & { data?: Record<string, unknown> }): void {
    const change: Change = { ...c, data: c.data ?? {} };
    const row: Omit<Activity, 'id'> = {
      ...change,
      at: this.ctx.now().toISOString(),
      source: this.ctx.source,
    };
    insertActivity(this.ctx.db, row);
    this.changes.push(change);
  }
}

/**
 * Runs a write and its activity rows in one IMMEDIATE transaction, so the
 * live feed never shows a change that was rolled back.
 */
export function mutate<T>(ctx: Ctx, fn: (cs: ChangeSet) => T): { result: T; changes: Change[] } {
  const cs = new ChangeSet(ctx);
  const result = ctx.db.transaction(() => fn(cs)).immediate();
  return { result, changes: cs.changes };
}

export const nowIso = (ctx: Ctx) => ctx.now().toISOString();

/** Lists what changed between two objects, for activity data and tool replies. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[],
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) {
      out[k] = { from: before[k] ?? null, to: after[k] ?? null };
    }
  }
  return out;
}
