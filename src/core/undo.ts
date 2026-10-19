import { JOURNALED } from '../db/journal.js';
import { parseJson } from '../db/sql.js';
import { mutate, ShakyError, type Ctx } from './context.js';

// Undo and trash, built on the journal (src/db/journal.ts): every mutation is
// one group of row changes that can be reversed as a whole.

interface LogRow {
  id: number;
  group_id: number;
  tbl: string;
  op: 'insert' | 'update' | 'delete';
  row_id: number;
  old: string | null;
  new: string | null;
}

export interface UndoGroup {
  id: number;
  at: string;
  source: string;
  label: string | null;
  changes: number;
  /** The group's main activity row, so UIs can describe it in their own language. */
  first: { entity: string; action: string; data: Record<string, unknown>; source: string } | null;
}

function firstActivity(ctx: Ctx, group: number): UndoGroup['first'] {
  // The most telling row: the summary row of a mix or bulk action if there is one.
  const rows = ctx.db
    .prepare('SELECT entity, action, data, source FROM activity WHERE group_id = ? ORDER BY id')
    .all(group) as { entity: string; action: string; data: string; source: string }[];
  const pick =
    rows.find((r) => ['mix', 'bar', 'prep', 'undo'].includes(r.entity)) ??
    rows.find((r) => r.entity !== 'location') ??
    rows[0];
  return pick ? { ...pick, data: parseJson<Record<string, unknown>>(pick.data, {}) } : null;
}

const TABLES = new Set<string>(JOURNALED);

/** Recent changes that can still be undone, newest first. */
export function listUndoable(ctx: Ctx, limit = 20): UndoGroup[] {
  return (
    ctx.db
      .prepare(
        `SELECT g.id, g.at, g.source, g.label, COUNT(l.id) AS changes
         FROM undo_groups g JOIN undo_log l ON l.group_id = g.id
        WHERE g.undone_by IS NULL AND g.undoes IS NULL
        GROUP BY g.id ORDER BY g.id DESC LIMIT ?`,
      )
      .all(limit) as Omit<UndoGroup, 'first'>[]
  ).map((g) => ({ ...g, first: firstActivity(ctx, g.id) }));
}

const current = (ctx: Ctx, tbl: string, rowId: number) =>
  ctx.db.prepare(`SELECT * FROM ${tbl} WHERE rowid = ?`).get(rowId) as
    Record<string, unknown> | undefined;

const same = (a: Record<string, unknown> | undefined, b: Record<string, unknown> | null) =>
  Boolean(a) && Boolean(b) && Object.keys(b!).every((k) => (a![k] ?? null) === (b![k] ?? null));

function writeRow(ctx: Ctx, tbl: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  ctx.db
    .prepare(
      `INSERT OR REPLACE INTO ${tbl} (rowid, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
    )
    .run(row.id ?? row.rowid ?? null, ...cols.map((c) => row[c] as never));
}

/**
 * Reverses one group (default: the latest one). Refuses when something
 * changed the same rows afterwards, unless force is set.
 */
export function undo(ctx: Ctx, opts: { group?: number; force?: boolean } = {}) {
  const target = opts.group ?? listUndoable(ctx, 1)[0]?.id;
  if (!target) throw new ShakyError('not_found', 'Nothing to undo.');
  const g = ctx.db.prepare('SELECT * FROM undo_groups WHERE id = ?').get(target) as
    (UndoGroup & { undone_by: number | null; undoes: number | null }) | undefined;
  if (!g)
    throw new ShakyError('not_found', `No change group ${target} (it may be older than 30 days).`);
  if (g.undone_by) throw new ShakyError('conflict', 'That change was already undone.');
  if (g.undoes) throw new ShakyError('invalid', 'That entry is itself an undo.');
  const rows = (
    ctx.db
      .prepare('SELECT * FROM undo_log WHERE group_id = ? ORDER BY id DESC')
      .all(target) as LogRow[]
  ).filter((r) => TABLES.has(r.tbl));
  if (!rows.length)
    throw new ShakyError('not_found', 'That change touched nothing that can be undone.');

  // Each row must still look like this group left it.
  const lastState = new Map<string, LogRow>();
  for (const r of [...rows].reverse()) lastState.set(`${r.tbl}:${r.row_id}`, r);
  const conflicts: string[] = [];
  for (const [key, r] of lastState) {
    const now = current(ctx, r.tbl, r.row_id);
    const expected = r.op === 'delete' ? null : parseJson<Record<string, unknown>>(r.new, {});
    const ok = r.op === 'delete' ? !now : same(now, expected);
    if (!ok) conflicts.push(`${r.tbl} ${String(now?.name ?? expected?.name ?? key)}`);
  }
  if (conflicts.length && !opts.force) {
    throw new ShakyError(
      'conflict',
      `Changed again since then: ${conflicts.join(', ')}. Undo later changes first, or force.`,
    );
  }

  return mutate(
    ctx,
    (cs) => {
      for (const r of rows) {
        if (r.op === 'insert') ctx.db.prepare(`DELETE FROM ${r.tbl} WHERE rowid = ?`).run(r.row_id);
        else writeRow(ctx, r.tbl, parseJson<Record<string, unknown>>(r.old, {}));
      }
      const me = ctx.db.prepare('SELECT group_id FROM undo_state WHERE id = 1').get() as {
        group_id: number;
      };
      ctx.db.prepare('UPDATE undo_groups SET undone_by = ? WHERE id = ?').run(me.group_id, target);
      cs.record({
        entity: 'undo',
        entity_id: target,
        action: 'undone',
        summary: `Undid: ${g.label ?? `change ${target}`}`,
        data: {
          name: g.label ?? '',
          group: target,
          rows: rows.length,
          of: firstActivity(ctx, target),
        },
      });
      return { undone: target, label: g.label, rows: rows.length, forced: conflicts.length > 0 };
    },
    { undoes: target },
  );
}

export interface TrashItem {
  id: number;
  kind: string;
  name: string;
  deleted_at: string;
  group: number;
}

const TRASH_TABLES: Record<string, string> = {
  ingredients: 'ingredient',
  equipment: 'equipment',
  glassware: 'glass',
  recipes: 'recipe',
  shopping_list: 'shopping',
  preferences: 'preference',
};

/** Deleted items that are not back yet, newest first. */
export function listTrash(ctx: Ctx, limit = 100): TrashItem[] {
  const rows = ctx.db
    .prepare(
      `SELECT l.id, l.tbl, l.row_id, l.old, g.at, g.id AS grp FROM undo_log l
         JOIN undo_groups g ON g.id = l.group_id
        WHERE l.op = 'delete' AND l.tbl IN (${Object.keys(TRASH_TABLES)
          .map(() => '?')
          .join(', ')})
        ORDER BY l.id DESC LIMIT ?`,
    )
    .all(...Object.keys(TRASH_TABLES), limit * 3) as {
    id: number;
    tbl: string;
    row_id: number;
    old: string;
    at: string;
    grp: number;
  }[];
  const seen = new Set<string>();
  const out: TrashItem[] = [];
  for (const r of rows) {
    const key = `${r.tbl}:${r.row_id}`;
    if (seen.has(key) || current(ctx, r.tbl, r.row_id)) continue;
    seen.add(key);
    const old = parseJson<Record<string, unknown>>(r.old, {});
    out.push({
      id: r.id,
      kind: TRASH_TABLES[r.tbl]!,
      name: String(old.name ?? old.ingredient ?? `#${r.row_id}`),
      deleted_at: r.at,
      group: r.grp,
    });
  }
  return out.slice(0, limit);
}

/** Puts one deleted item back with its old id. */
export function restoreFromTrash(ctx: Ctx, trashId: number) {
  const r = ctx.db
    .prepare('SELECT * FROM undo_log WHERE id = ? AND op = ?')
    .get(trashId, 'delete') as LogRow | undefined;
  if (!r || !TRASH_TABLES[r.tbl])
    throw new ShakyError('not_found', `Nothing in the trash with id ${trashId}.`);
  if (current(ctx, r.tbl, r.row_id)) throw new ShakyError('conflict', 'That item is already back.');
  const old = parseJson<Record<string, unknown>>(r.old, {});
  if (r.tbl === 'recipes') {
    const clash = ctx.db
      .prepare('SELECT id FROM recipes WHERE name = ? COLLATE NOCASE')
      .get(String(old.name));
    if (clash)
      throw new ShakyError(
        'conflict',
        `A recipe called "${String(old.name)}" exists again. Rename it first.`,
      );
  }
  return mutate(ctx, (cs) => {
    writeRow(ctx, r.tbl, old);
    cs.record({
      entity: TRASH_TABLES[r.tbl]!,
      entity_id: r.row_id,
      action: 'restored',
      summary: `Restored ${String(old.name ?? '')} from the trash.`,
      data: { name: String(old.name ?? '') },
    });
    return { kind: TRASH_TABLES[r.tbl]!, id: r.row_id, name: String(old.name ?? '') };
  });
}
