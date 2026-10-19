import { listIngredients } from '../db/repos/ingredients.js';
import { findRecipeByName, listRecipes } from '../db/repos/recipes.js';
import { mutate, ShakyError, type Ctx } from './context.js';
import { addIngredientIn, resolveIngredient, updateIngredientFields } from './inventory.js';
import { saveRecipe } from './recipes.js';
import { findIngredientsByName } from '../db/repos/ingredients.js';

// CSV for spreadsheets: one row per ingredient, and one row per recipe line.
// Lists inside a cell (tags) are separated by "|". Comma or semicolon both
// work on import (German Excel writes semicolons).

export const INGREDIENT_COLUMNS = [
  'name',
  'brand',
  'category',
  'subcategory',
  'tags',
  'provides',
  'location',
  'container',
  'fill_level',
  'amount_ml',
  'bottle_size_ml',
  'quantity',
  'abv',
  'price',
  'opened_at',
  'best_before',
  'shelf_life_days',
  'yield_ml',
  'color',
  'notes',
] as const;

export const RECIPE_COLUMNS = [
  'recipe',
  'tags',
  'glass',
  'method',
  'ingredient',
  'amount',
  'unit',
  'category',
  'subcategory',
  'optional',
  'garnish',
] as const;

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('|') : typeof v === 'boolean' ? (v ? 'yes' : '') : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns: readonly string[], rows: Record<string, unknown>[]): string {
  return (
    [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n') +
    '\r\n'
  );
}

export function exportIngredientsCsv(ctx: Ctx): string {
  return toCsv(
    INGREDIENT_COLUMNS,
    listIngredients(ctx.db).map((i) => ({
      ...i,
      amount_ml: i.amount_is_estimate ? null : i.amount_ml,
      opened_at: i.opened_at?.slice(0, 10),
      best_before: i.best_before?.slice(0, 10),
    })),
  );
}

export function exportRecipesCsv(ctx: Ctx): string {
  return toCsv(
    RECIPE_COLUMNS,
    listRecipes(ctx.db).flatMap((r) =>
      r.ingredients.map((l) => ({
        recipe: r.name,
        tags: r.tags,
        glass: r.glass,
        method: r.method,
        ingredient: l.name,
        amount: l.amount,
        unit: l.unit,
        category: l.category,
        subcategory: l.subcategory,
        optional: l.optional,
        garnish: l.garnish,
      })),
    ),
  );
}

/** Small RFC 4180 parser; the delimiter is guessed from the header line. */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, '');
  const header = clean.split(/\r?\n/, 1)[0] ?? '';
  const delim = (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const num = (s: string | undefined) => {
  if (s === undefined || s === '') return undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};
const list = (s: string | undefined) =>
  s
    ? s
        .split('|')
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined;
const text = (s: string | undefined) => (s === undefined || s === '' ? undefined : s);
const yes = (s: string | undefined) =>
  ['yes', 'ja', 'true', '1', 'x'].includes((s ?? '').toLowerCase());

/**
 * Imports ingredients: a known name updates the filled-in columns only, a new
 * name is added. All rows succeed or none (errors name the row).
 */
export function importIngredientsCsv(ctx: Ctx, csv: string) {
  const rows = parseCsv(csv);
  if (!rows.length) throw new ShakyError('invalid', 'The CSV has no rows.');
  if (!('name' in rows[0]!)) throw new ShakyError('invalid', 'The CSV needs a "name" column.');
  return mutate(ctx, () => {
    const added: string[] = [];
    const updated: string[] = [];
    rows.forEach((r, n) => {
      const fields = Object.fromEntries(
        Object.entries({
          name: text(r.name),
          brand: text(r.brand),
          category: text(r.category),
          subcategory: text(r.subcategory),
          tags: list(r.tags),
          provides: list(r.provides),
          location: text(r.location),
          container: text(r.container),
          fill_level: text(r.fill_level),
          amount_ml: num(r.amount_ml),
          bottle_size_ml: num(r.bottle_size_ml),
          quantity: num(r.quantity),
          abv: num(r.abv),
          price: num(r.price),
          opened_at: text(r.opened_at),
          best_before: text(r.best_before),
          shelf_life_days: num(r.shelf_life_days),
          yield_ml: num(r.yield_ml),
          color: text(r.color),
          notes: text(r.notes),
        }).filter(([, v]) => v !== undefined),
      );
      if (!fields.name) return;
      try {
        if (findIngredientsByName(ctx.db, String(fields.name)).length) {
          const cur = resolveIngredient(ctx, String(fields.name));
          updateIngredientFields(ctx, cur.id, fields as never);
          updated.push(String(fields.name));
        } else {
          if (!fields.category) throw new Error('category is required for new items');
          addIngredientInCurrent(ctx, fields);
          added.push(String(fields.name));
        }
      } catch (e) {
        throw new ShakyError(
          'invalid',
          `Row ${n + 2} (${String(fields.name)}): ${(e as Error).message}`,
        );
      }
    });
    return { added, updated };
  });
}

function addIngredientInCurrent(ctx: Ctx, fields: Record<string, unknown>) {
  // Joins the open transaction (mutate nests), so the whole import is one undo step.
  mutate(ctx, (cs) => addIngredientIn(ctx, cs, fields as never));
}

/** Imports recipes from one-row-per-line CSV. Known recipes keep their steps. */
export function importRecipesCsv(ctx: Ctx, csv: string) {
  const rows = parseCsv(csv);
  if (!rows.length) throw new ShakyError('invalid', 'The CSV has no rows.');
  if (!('recipe' in rows[0]!) || !('ingredient' in rows[0]!)) {
    throw new ShakyError('invalid', 'The CSV needs "recipe" and "ingredient" columns.');
  }
  const groups = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    if (!r.recipe || !r.ingredient) continue;
    groups.set(r.recipe, [...(groups.get(r.recipe) ?? []), r]);
  }
  return mutate(ctx, () => {
    const saved: string[] = [];
    for (const [name, lines] of groups) {
      const first = lines[0]!;
      const existing = findRecipeByName(ctx.db, name);
      try {
        saveRecipe(ctx, {
          ...(existing && { id: existing.id }),
          name,
          tags: list(first.tags) ?? existing?.tags,
          glass: text(first.glass) ?? existing?.glass,
          method: text(first.method) ?? existing?.method,
          description: existing?.description,
          color: existing?.color,
          steps: (existing?.steps ?? []) as never,
          ingredients: lines.map((l) => ({
            name: l.ingredient!,
            ...(num(l.amount) !== undefined && { amount: num(l.amount) }),
            unit: (text(l.unit) ?? 'cl') as never,
            ...(text(l.category) && { category: text(l.category) }),
            ...(text(l.subcategory) && { subcategory: text(l.subcategory) }),
            optional: yes(l.optional),
            garnish: yes(l.garnish),
          })),
        });
        saved.push(name);
      } catch (e) {
        throw new ShakyError('invalid', `Recipe ${name}: ${(e as Error).message}`);
      }
    }
    return { saved };
  });
}
