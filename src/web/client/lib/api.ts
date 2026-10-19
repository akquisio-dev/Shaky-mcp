import type { Activity } from '../../../db/repos/misc.js';
import type { Equipment, Glass, Location, CategoryDefaults } from '../../../db/repos/catalog.js';
import type { MixLogEntry } from '../../../db/repos/recipes.js';
import type { ShoppingItem } from '../../../db/repos/misc.js';
import type { IngredientView } from '../../../core/inventory.js';
import type { RecipeWithCheck, MakeableResult } from '../../../core/recipes.js';
import type { BarOverview } from '../../../core/overview.js';
import type { Training } from '../../../core/training.js';
import type { TrashItem, UndoGroup } from '../../../core/undo.js';
import type { Substitution } from '../../../core/matching.js';
import type { Preference } from '../../../core/preferences.js';
import type { Template } from '../../../core/prep.js';
import type { batchCalculator } from '../../../core/batch.js';

export type {
  Substitution,
  Training,
  TrashItem,
  UndoGroup,
  Preference,
  Template,
  Activity,
  Equipment,
  Glass,
  Location,
  CategoryDefaults,
  ShoppingItem,
  IngredientView,
  RecipeWithCheck,
  MixLogEntry,
  BarOverview,
  MakeableResult,
};

export interface Meta {
  version: string;
  categories: CategoryDefaults[];
  suggested_categories: string[];
  locations: Location[];
  fill_levels: string[];
  units: string[];
  step_actions: string[];
  equipment_types: string[];
  glass_types: string[];
  priorities: string[];
  settings: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new ApiError(res.status, data.message ?? res.statusText);
  return data as T;
}

type Mut<T> = { result: T; changes: unknown[] };

export const api = {
  meta: () => req<Meta>('GET', '/meta'),
  ingredients: () =>
    req<IngredientView[]>('GET', '/ingredients?include_empty=true&include_archived=true'),
  addIngredient: (b: object) => req<Mut<IngredientView>>('POST', '/ingredients', b),
  updateIngredient: (id: number, b: object) =>
    req<Mut<IngredientView>>('PATCH', `/ingredients/${id}`, b),
  setFill: (id: number, fill_level: string) =>
    req<Mut<IngredientView>>('POST', `/ingredients/${id}/fill-level`, { fill_level }),
  open: (id: number) => req<Mut<IngredientView>>('POST', `/ingredients/${id}/open`, {}),
  archive: (id: number, restore = false) =>
    req<Mut<IngredientView>>('POST', `/ingredients/${id}/archive`, { restore }),
  equipment: () => req<Equipment[]>('GET', '/equipment'),
  saveEquipment: (b: object) => req<Mut<unknown>>('POST', '/equipment', b),
  deleteEquipment: (id: number) => req<Mut<unknown>>('DELETE', `/equipment/${id}`),
  glassware: () => req<Glass[]>('GET', '/glassware'),
  saveGlass: (b: object) => req<Mut<unknown>>('POST', '/glassware', b),
  deleteGlass: (id: number) => req<Mut<unknown>>('DELETE', `/glassware/${id}`),
  recipes: () => req<RecipeWithCheck[]>('GET', '/recipes'),
  recipe: (id: number) => req<RecipeWithCheck>('GET', `/recipes/${id}`),
  addRecipe: (b: object) => req<Mut<RecipeWithCheck>>('POST', '/recipes', b),
  updateRecipe: (id: number, b: object) => req<Mut<RecipeWithCheck>>('PUT', `/recipes/${id}`, b),
  recipeFlags: (id: number, b: object) => req<Mut<RecipeWithCheck>>('PATCH', `/recipes/${id}`, b),
  deleteRecipe: (id: number) => req<Mut<unknown>>('DELETE', `/recipes/${id}`),
  mix: (b: object) =>
    req<Mut<{ deducted: unknown[]; skipped: { name: string; reason: string }[] }>>(
      'POST',
      '/mix',
      b,
    ),
  shopping: () => req<ShoppingItem[]>('GET', '/shopping?include_done=true'),
  addShopping: (b: object) => req<Mut<unknown>>('POST', '/shopping', b),
  updateShopping: (id: number, b: object) => req<Mut<unknown>>('PATCH', `/shopping/${id}`, b),
  deleteShopping: (id: number) => req<Mut<unknown>>('DELETE', `/shopping/${id}`),
  activity: (limit = 100) => req<Activity[]>('GET', `/activity?limit=${limit}`),
  mixLog: () => req<MixLogEntry[]>('GET', '/mix?limit=30'),
  importBar: (data: unknown, mode: 'merge' | 'replace') =>
    req<Mut<unknown>>('POST', '/import', { data, mode }),
  trainings: (open = false) => req<Training[]>('GET', `/trainings${open ? '?open=true' : ''}`),
  startTraining: (id: number) => req<Mut<Training>>('POST', `/trainings/${id}/start`, {}),
  submitTraining: (id: number, actions: unknown[]) =>
    req<Mut<Training>>('POST', `/trainings/${id}/submit`, { actions }),
  examples: () => req<{ count: number }>('GET', '/examples'),
  removeExamples: () => req<Mut<{ total: number }>>('DELETE', '/examples'),
  preferences: () => req<Preference[]>('GET', '/preferences'),
  addPreference: (b: object) => req<Mut<Preference>>('POST', '/preferences', b),
  removePreference: (id: number) => req<Mut<Preference>>('DELETE', `/preferences/${id}`),
  preparations: () => req<Template[]>('GET', '/preparations'),
  makePreparation: (b: object) =>
    req<Mut<{ made_ml: number; template: string }>>('POST', '/preparations/make', b),
  batch: (b: object) => req<ReturnType<typeof batchCalculator>>('POST', '/batch', b),
  undoable: () => req<UndoGroup[]>('GET', '/undo'),
  undo: (b: { group?: number; force?: boolean } = {}) =>
    req<Mut<{ label: string | null }>>('POST', '/undo', b),
  trash: () => req<TrashItem[]>('GET', '/trash'),
  restore: (id: number) => req<Mut<{ name: string }>>('POST', `/trash/${id}/restore`, {}),
  importCsv: (what: 'ingredients' | 'recipes', csv: string, dry_run: boolean) =>
    req<Mut<unknown> & { dry_run?: boolean }>('POST', '/import-csv', { what, csv, dry_run }),
  substitutions: () => req<Substitution[]>('GET', '/substitutions'),
  addSubstitution: (b: object) => req<Mut<Substitution>>('POST', '/substitutions', b),
  removeSubstitution: (id: number) => req<Mut<Substitution>>('DELETE', `/substitutions/${id}`),
  settings: (b: object) => req<Record<string, unknown>>('PATCH', '/settings', b),
};
