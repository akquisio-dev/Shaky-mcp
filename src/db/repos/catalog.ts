import type { Db } from '../connection.js';
import { insertRow, parseJson, updateRow } from '../sql.js';

// Equipment, glassware, locations and category defaults: the small,
// data-driven tables the AI may reshape without code changes.

export interface Equipment {
  id: number;
  name: string;
  type: string;
  available: boolean;
  substitutes_for: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

type EquipmentRow = Omit<Equipment, 'available' | 'substitutes_for'> & {
  available: number;
  substitutes_for: string;
};

const mapEquipment = (r: EquipmentRow): Equipment => ({
  ...r,
  available: r.available === 1,
  substitutes_for: parseJson<string[]>(r.substitutes_for, []),
});

export function listEquipment(db: Db): Equipment[] {
  return (
    db.prepare('SELECT * FROM equipment ORDER BY type, name COLLATE NOCASE').all() as EquipmentRow[]
  ).map(mapEquipment);
}

export function getEquipment(db: Db, id: number): Equipment | undefined {
  const r = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id) as EquipmentRow | undefined;
  return r && mapEquipment(r);
}

export function findEquipmentByName(db: Db, name: string): Equipment | undefined {
  const r = db
    .prepare('SELECT * FROM equipment WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1')
    .get(name.trim()) as EquipmentRow | undefined;
  return r && mapEquipment(r);
}

export const insertEquipment = (db: Db, data: Record<string, unknown>) =>
  insertRow(db, 'equipment', data);
export const updateEquipment = (db: Db, id: number, data: Record<string, unknown>) =>
  updateRow(db, 'equipment', id, data);
export const deleteEquipment = (db: Db, id: number) =>
  db.prepare('DELETE FROM equipment WHERE id = ?').run(id).changes > 0;

export interface Glass {
  id: number;
  name: string;
  type: string;
  count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function listGlassware(db: Db): Glass[] {
  return db.prepare('SELECT * FROM glassware ORDER BY type, name COLLATE NOCASE').all() as Glass[];
}
export function getGlass(db: Db, id: number): Glass | undefined {
  return db.prepare('SELECT * FROM glassware WHERE id = ?').get(id) as Glass | undefined;
}
export function findGlassByName(db: Db, name: string): Glass | undefined {
  return db
    .prepare('SELECT * FROM glassware WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1')
    .get(name.trim()) as Glass | undefined;
}
export const insertGlass = (db: Db, data: Record<string, unknown>) =>
  insertRow(db, 'glassware', data);
export const updateGlass = (db: Db, id: number, data: Record<string, unknown>) =>
  updateRow(db, 'glassware', id, data);
export const deleteGlass = (db: Db, id: number) =>
  db.prepare('DELETE FROM glassware WHERE id = ?').run(id).changes > 0;

export interface Location {
  key: string;
  label_en: string;
  label_de: string;
  kind: string;
  game_zone: string | null;
  sort: number;
}

export function listLocations(db: Db): Location[] {
  return db
    .prepare(
      'SELECT key, label_en, label_de, kind, game_zone, sort FROM locations ORDER BY sort, key',
    )
    .all() as Location[];
}

export function upsertLocation(
  db: Db,
  loc: { key: string; label_en: string; label_de?: string; sort?: number },
): void {
  db.prepare(
    `INSERT INTO locations (key, label_en, label_de, sort) VALUES (@key, @label_en, @label_de, @sort)
     ON CONFLICT (key) DO UPDATE SET label_en = excluded.label_en, label_de = excluded.label_de,
       sort = excluded.sort`,
  ).run({
    key: loc.key,
    label_en: loc.label_en,
    label_de: loc.label_de ?? loc.label_en,
    sort: loc.sort ?? 100,
  });
}

/** Makes sure a location key exists, creating a plain one if needed. */
export function ensureLocation(db: Db, key: string): boolean {
  const label = key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return (
    db
      .prepare('INSERT OR IGNORE INTO locations (key, label_en, label_de) VALUES (?, ?, ?)')
      .run(key, label, label).changes > 0
  );
}

export interface CategoryDefaults {
  category: string;
  shelf_life_days: number | null;
  default_location: string;
  bottle_size_ml: number | null;
  color: string;
}

export function listCategoryDefaults(db: Db): CategoryDefaults[] {
  return db
    .prepare('SELECT * FROM category_defaults ORDER BY category')
    .all() as CategoryDefaults[];
}

export function getCategoryDefaults(db: Db, category: string): CategoryDefaults | undefined {
  return db.prepare('SELECT * FROM category_defaults WHERE category = ?').get(category) as
    CategoryDefaults | undefined;
}

export function upsertCategoryDefaults(
  db: Db,
  d: Partial<CategoryDefaults> & { category: string },
) {
  const cur = getCategoryDefaults(db, d.category) ?? getCategoryDefaults(db, 'other')!;
  const next = {
    ...cur,
    ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)),
  };
  db.prepare(
    `INSERT INTO category_defaults (category, shelf_life_days, default_location, bottle_size_ml, color)
     VALUES (@category, @shelf_life_days, @default_location, @bottle_size_ml, @color)
     ON CONFLICT (category) DO UPDATE SET shelf_life_days = excluded.shelf_life_days,
       default_location = excluded.default_location, bottle_size_ml = excluded.bottle_size_ml,
       color = excluded.color`,
  ).run({ ...next, category: d.category });
  return getCategoryDefaults(db, d.category)!;
}
