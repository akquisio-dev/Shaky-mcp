import type { Db } from '../connection.js';
import { insertRow, parseJson, updateRow } from '../sql.js';
import type { Source } from '../../core/schemas.js';

export interface ShoppingItem {
  id: number;
  name: string;
  ingredient_id: number | null;
  quantity: string | null;
  reason: string | null;
  priority: 'low' | 'normal' | 'high';
  done: boolean;
  created_at: string;
  updated_at: string;
}

type ShoppingRow = Omit<ShoppingItem, 'done'> & { done: number };
const mapShopping = (r: ShoppingRow): ShoppingItem => ({ ...r, done: r.done === 1 });

export function listShopping(db: Db, opts: { includeDone?: boolean } = {}): ShoppingItem[] {
  const where = opts.includeDone ? '' : 'WHERE done = 0';
  return (
    db
      .prepare(
        `SELECT * FROM shopping_list ${where}
         ORDER BY done, CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, id`,
      )
      .all() as ShoppingRow[]
  ).map(mapShopping);
}
export function getShopping(db: Db, id: number): ShoppingItem | undefined {
  const r = db.prepare('SELECT * FROM shopping_list WHERE id = ?').get(id) as
    ShoppingRow | undefined;
  return r && mapShopping(r);
}
export function findOpenShoppingByName(db: Db, name: string): ShoppingItem | undefined {
  const r = db
    .prepare('SELECT * FROM shopping_list WHERE done = 0 AND name = ? COLLATE NOCASE LIMIT 1')
    .get(name.trim()) as ShoppingRow | undefined;
  return r && mapShopping(r);
}
export const insertShopping = (db: Db, data: Record<string, unknown>) =>
  insertRow(db, 'shopping_list', data);
export const updateShopping = (db: Db, id: number, data: Record<string, unknown>) =>
  updateRow(db, 'shopping_list', id, data);
export const deleteShopping = (db: Db, id: number) =>
  db.prepare('DELETE FROM shopping_list WHERE id = ?').run(id).changes > 0;

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined;
  return r ? parseJson<T>(r.value, fallback) : fallback;
}
export function getAllSettings(db: Db): Record<string, unknown> {
  const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all() as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, parseJson<unknown>(r.value, null)]));
}
export function setSetting(db: Db, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

export interface Activity {
  id: number;
  at: string;
  source: Source;
  entity: string;
  entity_id: number | null;
  action: string;
  summary: string;
  data: Record<string, unknown>;
  group_id?: number | null;
}

type ActivityRow = Omit<Activity, 'data'> & { data: string };
const mapActivity = (r: ActivityRow): Activity => ({
  ...r,
  data: parseJson<Record<string, unknown>>(r.data, {}),
});

export function insertActivity(db: Db, a: Omit<Activity, 'id'>): number {
  return insertRow(db, 'activity', a);
}
export function listActivity(db: Db, opts: { limit?: number; afterId?: number } = {}): Activity[] {
  if (opts.afterId !== undefined) {
    return (
      db
        .prepare('SELECT * FROM activity WHERE id > ? ORDER BY id LIMIT ?')
        .all(opts.afterId, opts.limit ?? 500) as ActivityRow[]
    ).map(mapActivity);
  }
  return (
    db
      .prepare('SELECT * FROM activity ORDER BY id DESC LIMIT ?')
      .all(opts.limit ?? 50) as ActivityRow[]
  ).map(mapActivity);
}
export function lastActivityId(db: Db): number {
  return (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM activity').get() as { id: number }).id;
}
