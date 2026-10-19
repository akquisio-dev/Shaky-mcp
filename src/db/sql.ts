import type { Db } from './connection.js';

type Value = string | number | null;

/** Turns JS values into SQLite-friendly ones (booleans to 0/1, arrays/objects to JSON). */
export function toSql(v: unknown): Value {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  return JSON.stringify(v);
}

export function insertRow(db: Db, table: string, fields: Record<string, unknown>): number {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const info = db.prepare(sql).run(...keys.map((k) => toSql(fields[k])));
  return Number(info.lastInsertRowid);
}

/** Updates only the given (defined) fields. Returns false if the row does not exist. */
export function updateRow(
  db: Db,
  table: string,
  id: number,
  fields: Record<string, unknown>,
): boolean {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (keys.length === 0) return true;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  return db.prepare(sql).run(...keys.map((k) => toSql(fields[k])), id).changes > 0;
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
