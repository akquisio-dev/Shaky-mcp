import type { Db } from './connection.js';

/** Tables whose changes can be undone. Activity and trainings are history, not state. */
export const JOURNALED = [
  'ingredients',
  'equipment',
  'glassware',
  'recipes',
  'mix_log',
  'shopping_list',
  'settings',
  'locations',
  'category_defaults',
  'preferences',
  'prep_templates',
] as const;

const exists = (db: Db, name: string) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

/**
 * (Re)creates the journal triggers from the current columns, so columns added
 * by later migrations are covered automatically. Rows are only logged while a
 * group is active (undo_state.group_id set by mutate()).
 */
export function installJournal(db: Db): void {
  if (!exists(db, 'undo_state')) return;
  for (const t of JOURNALED) {
    if (!exists(db, t)) continue;
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    const obj = (prefix: string) =>
      `json_object(${cols.map((c) => `'${c}', ${prefix}.${c}`).join(', ')})`;
    const active = '(SELECT group_id FROM undo_state WHERE id = 1)';
    db.exec(`
      DROP TRIGGER IF EXISTS journal_${t}_ins;
      DROP TRIGGER IF EXISTS journal_${t}_upd;
      DROP TRIGGER IF EXISTS journal_${t}_del;
      CREATE TRIGGER journal_${t}_ins AFTER INSERT ON ${t} WHEN ${active} IS NOT NULL BEGIN
        INSERT INTO undo_log (group_id, tbl, op, row_id, new) VALUES (${active}, '${t}', 'insert', NEW.rowid, ${obj('NEW')});
      END;
      CREATE TRIGGER journal_${t}_upd AFTER UPDATE ON ${t} WHEN ${active} IS NOT NULL BEGIN
        INSERT INTO undo_log (group_id, tbl, op, row_id, old, new) VALUES (${active}, '${t}', 'update', NEW.rowid, ${obj('OLD')}, ${obj('NEW')});
      END;
      CREATE TRIGGER journal_${t}_del AFTER DELETE ON ${t} WHEN ${active} IS NOT NULL BEGIN
        INSERT INTO undo_log (group_id, tbl, op, row_id, old) VALUES (${active}, '${t}', 'delete', OLD.rowid, ${obj('OLD')});
      END;
    `);
  }
}

/** Forgets journal entries older than `days` (default 30). */
export function pruneJournal(db: Db, days = 30): void {
  if (!exists(db, 'undo_groups')) return;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  db.transaction(() => {
    db.prepare(
      'DELETE FROM undo_log WHERE group_id IN (SELECT id FROM undo_groups WHERE at < ?)',
    ).run(cutoff);
    db.prepare('DELETE FROM undo_groups WHERE at < ?').run(cutoff);
  })();
}
