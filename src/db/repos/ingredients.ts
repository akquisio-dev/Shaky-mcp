import type { Db } from '../connection.js';
import { insertRow, parseJson, updateRow } from '../sql.js';
import type { FillLevel } from '../../core/schemas.js';

export interface Ingredient {
  id: number;
  name: string;
  brand: string | null;
  category: string;
  subcategory: string | null;
  tags: string[];
  abv: number | null;
  color: string | null;
  flavor_notes: string | null;
  location: string;
  fill_level: FillLevel;
  amount_ml: number | null;
  amount_is_estimate: boolean;
  bottle_size_ml: number | null;
  yield_ml: number | null;
  opened_at: string | null;
  shelf_life_days: number | null;
  expires_at: string | null;
  quantity: number;
  notes: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

type Row = Omit<Ingredient, 'tags' | 'archived' | 'amount_is_estimate'> & {
  tags: string;
  archived: number;
  amount_is_estimate: number;
};

function map(r: Row): Ingredient {
  return {
    ...r,
    tags: parseJson<string[]>(r.tags, []),
    archived: r.archived === 1,
    amount_is_estimate: r.amount_is_estimate === 1,
  };
}

export function getIngredient(db: Db, id: number): Ingredient | undefined {
  const r = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id) as Row | undefined;
  return r && map(r);
}

export function listIngredients(db: Db, opts: { includeArchived?: boolean } = {}): Ingredient[] {
  const where = opts.includeArchived ? '' : 'WHERE archived = 0';
  return (
    db.prepare(`SELECT * FROM ingredients ${where} ORDER BY name COLLATE NOCASE`).all() as Row[]
  ).map(map);
}

export function findIngredientsByName(db: Db, name: string): Ingredient[] {
  return (
    db
      .prepare(
        'SELECT * FROM ingredients WHERE archived = 0 AND name = ? COLLATE NOCASE ORDER BY id',
      )
      .all(name.trim()) as Row[]
  ).map(map);
}

export function insertIngredient(
  db: Db,
  data: Partial<Omit<Ingredient, 'id'>> & { name: string; category: string },
): number {
  return insertRow(db, 'ingredients', data);
}

export function updateIngredient(
  db: Db,
  id: number,
  data: Partial<Omit<Ingredient, 'id' | 'created_at'>>,
): boolean {
  return updateRow(db, 'ingredients', id, data);
}
