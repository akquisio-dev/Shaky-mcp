import type { Db } from '../db/connection.js';
import { insertActivity, type Activity } from '../db/repos/misc.js';
import type { Source } from './schemas.js';

/** Everything a core operation needs: the database, who is acting and a clock. */
export interface Ctx {
  db: Db;
  source: Source;
  now: () => Date;
  /** When set, mutations run, report what they would change and roll back. */
  dryRun?: boolean;
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
      group_id: currentGroup(this.ctx),
    };
    insertActivity(this.ctx.db, row);
    this.changes.push(change);
  }
}

class DryRun extends Error {}

function currentGroup(ctx: Ctx): number | null {
  const r = ctx.db.prepare('SELECT group_id FROM undo_state WHERE id = 1').get() as
    { group_id: number | null } | undefined;
  return r?.group_id ?? null;
}

/**
 * Runs a write and its activity rows in one IMMEDIATE transaction, so the
 * live feed never shows a change that was rolled back. Each top-level call is
 * one undo group (nested calls join it). With ctx.dryRun everything is rolled
 * back and the reply says what would have changed.
 */
export function mutate<T>(
  ctx: Ctx,
  fn: (cs: ChangeSet) => T,
  opts: { undoes?: number } = {},
): { result: T; changes: Change[]; dry_run?: boolean } {
  const cs = new ChangeSet(ctx);
  const nested = ctx.db.inTransaction;
  let out: T | undefined;
  const run = () => {
    if (!nested) {
      const group = Number(
        ctx.db
          .prepare('INSERT INTO undo_groups (at, source, undoes) VALUES (?, ?, ?)')
          .run(ctx.now().toISOString(), ctx.source, opts.undoes ?? null).lastInsertRowid,
      );
      ctx.db.prepare('UPDATE undo_state SET group_id = ? WHERE id = 1').run(group);
    }
    try {
      out = fn(cs);
      if (!nested) {
        const label =
          cs.changes
            .map((c) => c.summary)
            .join(' ')
            .slice(0, 300) || null;
        ctx.db
          .prepare(
            'UPDATE undo_groups SET label = ? WHERE id = (SELECT group_id FROM undo_state WHERE id = 1)',
          )
          .run(label);
      }
    } finally {
      if (!nested) ctx.db.prepare('UPDATE undo_state SET group_id = NULL WHERE id = 1').run();
    }
    if (ctx.dryRun && !nested) throw new DryRun();
    return out as T;
  };
  try {
    const result = ctx.db.transaction(run).immediate();
    return { result, changes: cs.changes };
  } catch (e) {
    if (e instanceof DryRun) return { result: out as T, changes: cs.changes, dry_run: true };
    throw e;
  }
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
