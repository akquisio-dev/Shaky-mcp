import { z } from 'zod';
import { listCategoryDefaults, listEquipment } from '../db/repos/catalog.js';
import {
  deleteRecipe as deleteRow,
  findRecipeByName,
  getRecipe,
  insertRecipe,
  listRecipes,
  updateRecipe,
  type Recipe,
} from '../db/repos/recipes.js';
import { mutate, nowIso, ShakyError, type Ctx } from './context.js';
import { listIngredientViews } from './inventory.js';
import { checkRecipe, type Household, type RecipeCheck } from './matching.js';
import { listPreferences, personalize, type Personalized } from './preferences.js';
import { drinkStrength, type Strength } from './strength.js';
import { getSetting } from '../db/repos/misc.js';
import { recipeInputSchema, type RecipeInput } from './schemas.js';

export function resolveRecipe(ctx: Ctx, ref: number | string): Recipe {
  if (typeof ref === 'number' || /^\d+$/.test(ref)) {
    const r = getRecipe(ctx.db, Number(ref));
    if (!r) throw new ShakyError('not_found', `No recipe with id ${ref}.`);
    return r;
  }
  const r = findRecipeByName(ctx.db, ref);
  if (!r) {
    const q = ref.toLowerCase();
    const near = listRecipes(ctx.db)
      .filter((x) => x.name.toLowerCase().includes(q))
      .slice(0, 5);
    const hint = near.length ? ` Did you mean: ${near.map((x) => x.name).join(', ')}?` : '';
    throw new ShakyError('not_found', `No recipe named "${ref}".${hint}`);
  }
  return r;
}

export interface RecipeFilter {
  tag?: string;
  search?: string;
  favorite?: boolean;
  status?: RecipeCheck['status'];
}

export interface RecipeWithCheck extends Recipe {
  /** Checked against the personal version (preferences applied). */
  availability: RecipeCheck;
  /** How this user makes it: amounts after preferences, and what they avoid. */
  personal: Personalized;
  strength: Strength;
}

function checker(ctx: Ctx) {
  const stock = listIngredientViews(ctx, { include_empty: true });
  const byId = new Map(stock.map((i) => [i.id, i]));
  const categories = new Map(listCategoryDefaults(ctx.db).map((c) => [c.category, c]));
  const equipment = listEquipment(ctx.db);
  const household = getSetting<Household>(ctx.db, 'household_substitutes', {});
  const prefs = listPreferences(ctx);
  const drinkG = getSetting<number>(ctx.db, 'standard_drink_g', 10);
  return (r: Recipe): Omit<RecipeWithCheck, keyof Recipe> => {
    const personal = personalize(r, prefs);
    const availability = checkRecipe(
      { ...r, ingredients: personal.ingredients, steps: personal.steps },
      stock,
      equipment,
      household,
    );
    const strength = drinkStrength(
      personal.ingredients,
      personal.steps,
      availability.lines,
      byId,
      categories,
      drinkG,
    );
    return { availability, personal, strength };
  };
}

export function listRecipesWithCheck(ctx: Ctx, f: RecipeFilter = {}): RecipeWithCheck[] {
  const check = checker(ctx);
  const q = f.search?.trim().toLowerCase();
  return listRecipes(ctx.db)
    .map((r) => ({ ...r, ...check(r) }))
    .filter((r) => {
      if (f.tag && !r.tags.includes(f.tag.toLowerCase())) return false;
      if (f.favorite !== undefined && r.favorite !== f.favorite) return false;
      if (f.status && r.availability.status !== f.status) return false;
      if (q) {
        const hay = [r.name, r.description, ...r.tags, ...r.ingredients.map((i) => i.name)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
}

export function getRecipeWithCheck(ctx: Ctx, ref: number | string): RecipeWithCheck {
  const r = resolveRecipe(ctx, ref);
  return { ...r, ...checker(ctx)(r) };
}

export interface MakeableResult {
  makeable: RecipeCheck[];
  /** Makeable but with something the user avoids; left out of the lists above. */
  avoided: { name: string; because: string[] }[];
  missing_one: RecipeCheck[];
  missing_more_count: number;
  /** Only filled with include_missing_more. */
  missing_more?: RecipeCheck[];
}

export function findMakeable(
  ctx: Ctx,
  opts: { tag?: string; include_missing_more?: boolean; include_avoided?: boolean } = {},
): MakeableResult {
  const recipes = listRecipesWithCheck(ctx, { tag: opts.tag });
  const avoidedIds = new Set(recipes.filter((r) => r.personal.avoided.length).map((r) => r.id));
  const all = recipes
    .filter((r) => opts.include_avoided || !avoidedIds.has(r.id))
    .map((r) => r.availability);
  const more = all.filter((c) => c.status === 'missing_more');
  return {
    avoided: recipes
      .filter((r) => avoidedIds.has(r.id) && !opts.include_avoided)
      .map((r) => ({ name: r.name, because: r.personal.avoided })),
    makeable: all.filter((c) => c.status === 'makeable'),
    missing_one: all.filter((c) => c.status === 'missing_one'),
    missing_more_count: more.length,
    ...(opts.include_missing_more && { missing_more: more }),
  };
}

/** Creates a recipe, or replaces the one with the same id / name. */
export function saveRecipe(ctx: Ctx, input: RecipeInput & { id?: number }) {
  const data = recipeInputSchema.parse(input);
  return mutate(ctx, (cs) => {
    const existing =
      input.id !== undefined ? resolveRecipe(ctx, input.id) : findRecipeByName(ctx.db, data.name);
    const ts = nowIso(ctx);
    const row = {
      ...data,
      source: data.source ?? (ctx.source === 'mcp' ? 'ai' : 'user'),
      tags: data.tags ?? [],
    };
    let id: number;
    if (existing) {
      const clash = findRecipeByName(ctx.db, data.name);
      if (clash && clash.id !== existing.id) {
        throw new ShakyError('conflict', `Another recipe is already called "${data.name}".`);
      }
      updateRecipe(ctx.db, existing.id, { ...row, updated_at: ts });
      id = existing.id;
    } else {
      id = insertRecipe(ctx.db, { ...row, created_at: ts, updated_at: ts });
    }
    cs.record({
      entity: 'recipe',
      entity_id: id,
      action: existing ? 'updated' : 'created',
      summary: `${existing ? 'Updated' : 'Saved'} recipe ${data.name}.`,
      data: { name: data.name },
    });
    return getRecipeWithCheck(ctx, id);
  });
}

export function setRecipeFlags(
  ctx: Ctx,
  ref: number | string,
  flags: { favorite?: boolean; rating?: number | null; notes?: string | null },
) {
  return mutate(ctx, (cs) => {
    const r = resolveRecipe(ctx, ref);
    updateRecipe(ctx.db, r.id, { ...flags, updated_at: nowIso(ctx) });
    cs.record({
      entity: 'recipe',
      entity_id: r.id,
      action: 'updated',
      summary: `Updated recipe ${r.name}.`,
      data: { name: r.name, ...flags },
    });
    return getRecipeWithCheck(ctx, r.id);
  });
}

export function deleteRecipe(ctx: Ctx, ref: number | string) {
  return mutate(ctx, (cs) => {
    const r = resolveRecipe(ctx, ref);
    deleteRow(ctx.db, r.id);
    cs.record({
      entity: 'recipe',
      entity_id: r.id,
      action: 'deleted',
      summary: `Deleted recipe ${r.name}.`,
      data: { name: r.name },
    });
    return { id: r.id, name: r.name };
  });
}

export const recipePatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(1000).nullish(),
  tags: z.array(z.string()).max(30).optional(),
  glass: z.string().nullish(),
  method: z.string().nullish(),
  color: z.string().nullish(),
  notes: z.string().max(2000).nullish(),
  favorite: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).nullish(),
  update_lines: z
    .array(
      z.object({
        name: z.string().describe('Current name of the ingredient line.'),
        set: z
          .record(z.string(), z.unknown())
          .describe(
            'Fields to change on that line, e.g. {"amount": 2} or {"exclude": ["wild berry"]}.',
          ),
      }),
    )
    .optional(),
  add_lines: z.array(z.record(z.string(), z.unknown())).optional(),
  remove_lines: z.array(z.string()).optional(),
  steps: z.array(z.record(z.string(), z.unknown())).optional().describe('Replaces all steps.'),
});

/** Changes parts of a recipe without resending all of it. */
export function patchRecipe(
  ctx: Ctx,
  ref: number | string,
  input: z.input<typeof recipePatchSchema>,
) {
  const p = recipePatchSchema.parse(input);
  const cur = resolveRecipe(ctx, ref);
  let lines: Record<string, unknown>[] = cur.ingredients.map((l) => ({ ...l }));
  const find = (name: string) => {
    const i = lines.findIndex((l) => String(l.name).toLowerCase() === name.trim().toLowerCase());
    if (i < 0)
      throw new ShakyError(
        'not_found',
        `${cur.name} has no ingredient line "${name}". Lines: ${lines.map((l) => l.name).join(', ')}.`,
      );
    return i;
  };
  for (const u of p.update_lines ?? []) {
    const i = find(u.name);
    lines[i] = { ...lines[i], ...u.set };
  }
  for (const name of p.remove_lines ?? []) lines.splice(find(name), 1);
  lines = [...lines, ...(p.add_lines ?? [])];
  const { update_lines: _u, add_lines: _a, remove_lines: _r, steps, ...fields } = p;
  const merged = {
    name: cur.name,
    description: cur.description,
    tags: cur.tags,
    glass: cur.glass,
    method: cur.method,
    source: cur.source,
    favorite: cur.favorite,
    rating: cur.rating,
    notes: cur.notes,
    color: cur.color,
    ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
    ingredients: lines,
    steps: steps ?? cur.steps,
    id: cur.id,
  };
  return saveRecipe(ctx, merged as RecipeInput & { id: number });
}
