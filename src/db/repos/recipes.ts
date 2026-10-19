import type { Db } from '../connection.js';
import { insertRow, parseJson, updateRow } from '../sql.js';
import type { RecipeIngredient, Step } from '../../core/schemas.js';

export interface Recipe {
  id: number;
  name: string;
  description: string | null;
  tags: string[];
  glass: string | null;
  method: string | null;
  source: 'user' | 'ai';
  favorite: boolean;
  rating: number | null;
  notes: string | null;
  color: string | null;
  ingredients: RecipeIngredient[];
  steps: Step[];
  created_at: string;
  updated_at: string;
}

type Row = Omit<Recipe, 'tags' | 'favorite' | 'ingredients' | 'steps'> & {
  tags: string;
  favorite: number;
  ingredients: string;
  steps: string;
};

const map = (r: Row): Recipe => ({
  ...r,
  tags: parseJson<string[]>(r.tags, []),
  favorite: r.favorite === 1,
  ingredients: parseJson<RecipeIngredient[]>(r.ingredients, []),
  steps: parseJson<Step[]>(r.steps, []),
});

export function listRecipes(db: Db): Recipe[] {
  return (db.prepare('SELECT * FROM recipes ORDER BY name COLLATE NOCASE').all() as Row[]).map(map);
}
export function getRecipe(db: Db, id: number): Recipe | undefined {
  const r = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as Row | undefined;
  return r && map(r);
}
export function findRecipeByName(db: Db, name: string): Recipe | undefined {
  const r = db.prepare('SELECT * FROM recipes WHERE name = ? COLLATE NOCASE').get(name.trim()) as
    Row | undefined;
  return r && map(r);
}
export const insertRecipe = (db: Db, data: Record<string, unknown>) =>
  insertRow(db, 'recipes', data);
export const updateRecipe = (db: Db, id: number, data: Record<string, unknown>) =>
  updateRow(db, 'recipes', id, data);
export const deleteRecipe = (db: Db, id: number) =>
  db.prepare('DELETE FROM recipes WHERE id = ?').run(id).changes > 0;

export interface Deduction {
  ingredient_id: number;
  name: string;
  amount: number;
  unit: string;
  before: { fill_level: string; amount_ml: number | null; quantity: number };
  after: { fill_level: string; amount_ml: number | null; quantity: number };
}

export interface MixLogEntry {
  id: number;
  recipe_id: number | null;
  name: string;
  made_at: string;
  servings: number;
  rating: number | null;
  notes: string | null;
  deducted: Deduction[];
}

export function insertMixLog(db: Db, data: Record<string, unknown>): number {
  return insertRow(db, 'mix_log', data);
}

export function listMixLog(db: Db, limit = 50): MixLogEntry[] {
  return (
    db.prepare('SELECT * FROM mix_log ORDER BY made_at DESC, id DESC LIMIT ?').all(limit) as (Omit<
      MixLogEntry,
      'deducted'
    > & { deducted: string })[]
  ).map((r) => ({ ...r, deducted: parseJson<Deduction[]>(r.deducted, []) }));
}
