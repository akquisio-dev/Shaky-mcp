import { z } from 'zod';
import { listCategoryDefaults, listEquipment } from '../db/repos/catalog.js';
import { getSetting } from '../db/repos/misc.js';
import { listMixLog, type MixLogEntry } from '../db/repos/recipes.js';
import { mutate, ShakyError, type Ctx } from './context.js';
import { drinkCost } from './cost.js';
import { listIngredientViews } from './inventory.js';
import { checkRecipe, matchesSpec, words, type Household } from './matching.js';
import { listRecipesWithCheck, type RecipeWithCheck } from './recipes.js';
import { recipeIngredientSchema, stepSchema } from './schemas.js';
import { drinkStrength } from './strength.js';
import { listSubstitutions } from './substitutions.js';

// Read-mostly helpers that let the AI advise: check an unsaved recipe, search
// by ingredient, what to buy next, a surprise drink, history and statistics.

const ML: Record<string, number> = {
  ml: 1,
  cl: 10,
  oz: 29.5735,
  dash: 0.9,
  barspoon: 5,
  tsp: 5,
  tbsp: 15,
};
const DAY = 86_400_000;

// ---------- check a recipe that is not saved ----------

export const checkLinesSchema = z.object({
  name: z.string().trim().max(80).optional(),
  ingredients: z.array(recipeIngredientSchema).min(1).max(30),
  steps: z.array(stepSchema).max(40).default([]),
});

/** The full stock check of a saved recipe, for one the AI only knows. */
export function checkRecipeLines(ctx: Ctx, input: z.input<typeof checkLinesSchema>) {
  const p = checkLinesSchema.parse(input);
  const stock = listIngredientViews(ctx, { include_empty: true });
  const byId = new Map(stock.map((i) => [i.id, i]));
  const recipe = {
    id: 0,
    name: p.name ?? 'Unsaved drink',
    ingredients: p.ingredients,
    steps: p.steps,
  } as unknown as Parameters<typeof checkRecipe>[0];
  const availability = checkRecipe(
    recipe,
    stock,
    listEquipment(ctx.db),
    getSetting<Household>(ctx.db, 'household_substitutes', {}),
    listSubstitutions(ctx),
  );
  const categories = new Map(listCategoryDefaults(ctx.db).map((c) => [c.category, c]));
  return {
    availability,
    strength: drinkStrength(
      p.ingredients,
      p.steps,
      availability.lines,
      byId,
      categories,
      getSetting(ctx.db, 'standard_drink_g', 10),
    ),
    cost: drinkCost(p.ingredients, availability.lines, byId, getSetting(ctx.db, 'currency', 'EUR')),
  };
}

// ---------- search by ingredient ----------

/** Saved recipes that use an ingredient: by stock item (id/name) or by words ("tequila"). */
export function findRecipesByIngredient(ctx: Ctx, query: string | number) {
  const stock = listIngredientViews(ctx, { include_empty: true, include_archived: true });
  const item =
    typeof query === 'number'
      ? stock.find((i) => i.id === query)
      : stock.find((i) => i.name.toLowerCase() === String(query).trim().toLowerCase());
  if (typeof query === 'number' && !item)
    throw new ShakyError('not_found', `No ingredient with id ${query}.`);
  const q = item ? [] : words(String(query));
  const hits: { recipe: RecipeWithCheck; lines: string[] }[] = [];
  for (const r of listRecipesWithCheck(ctx)) {
    const lines = r.personal.ingredients
      .filter((l) => {
        if (item) {
          const check = r.availability.lines.find((x) => x.name === l.name);
          return check?.match?.id === item.id || matchesSpec(l, item);
        }
        const lw = new Set([
          ...words(l.name),
          ...words(l.subcategory),
          ...(l.tags ?? []).flatMap(words),
          ...words(l.category),
        ]);
        return q.length > 0 && q.every((w) => lw.has(w));
      })
      .map((l) => l.name);
    if (lines.length) hits.push({ recipe: r, lines });
  }
  const order = { makeable: 0, with_substitute: 1, missing_one: 2, missing_more: 3 } as const;
  hits.sort((a, b) => order[a.recipe.availability.status] - order[b.recipe.availability.status]);
  return {
    ingredient: item ? { id: item.id, name: item.name } : null,
    recipes: hits.map((h) => ({
      id: h.recipe.id,
      name: h.recipe.name,
      status: h.recipe.availability.status,
      uses: h.lines,
      ...(h.recipe.availability.missing.length && { missing: h.recipe.availability.missing }),
      ...(h.recipe.personal.avoided.length && { avoided: h.recipe.personal.avoided }),
    })),
  };
}

// ---------- what to buy next ----------

/**
 * Which single purchase unlocks the most saved recipes: a missing line that is
 * the only gap counts fully, a line among several gaps counts as "helps".
 */
export function suggestPurchases(ctx: Ctx, limit = 5) {
  const recipes = listRecipesWithCheck(ctx).filter((r) => !r.personal.avoided.length);
  const map = new Map<string, { buy: string; unlocks: string[]; helps: string[] }>();
  for (const r of recipes) {
    const missing = r.availability.missing;
    if (!missing.length) continue;
    for (const name of missing) {
      const spec = r.personal.ingredients.find((l) => l.name === name);
      const key = words(spec?.subcategory || name).join(' ') || name.toLowerCase();
      const e = map.get(key) ?? { buy: spec?.subcategory || name, unlocks: [], helps: [] };
      if (missing.length === 1) e.unlocks.push(r.name);
      else e.helps.push(r.name);
      map.set(key, e);
    }
  }
  return [...map.values()]
    .sort((a, b) => b.unlocks.length - a.unlocks.length || b.helps.length - a.helps.length)
    .slice(0, limit);
}

// ---------- surprise ----------

export const surpriseSchema = z.object({
  tag: z.string().optional(),
  alcohol_free: z.boolean().optional(),
  max_abv: z.number().min(0).max(100).optional(),
  not_mixed_for_days: z.number().int().min(0).max(365).default(3),
});

/** A random makeable drink, weighted towards favorites, good ratings and use-up. */
export function surpriseMe(
  ctx: Ctx,
  input: z.input<typeof surpriseSchema> = {},
  random = Math.random,
) {
  const p = surpriseSchema.parse(input);
  const since = ctx.now().getTime() - p.not_mixed_for_days * DAY;
  const recent = new Set(
    listMixLog(ctx.db, 500)
      .filter((m) => Date.parse(m.made_at) >= since)
      .map((m) => m.recipe_id),
  );
  const pool = listRecipesWithCheck(ctx, {
    tag: p.tag,
    alcohol_free: p.alcohol_free || undefined,
  }).filter(
    (r) =>
      (r.availability.status === 'makeable' || r.availability.status === 'with_substitute') &&
      !r.personal.avoided.length &&
      (p.max_abv === undefined || r.strength.abv <= p.max_abv) &&
      !recent.has(r.id),
  );
  if (!pool.length) return null;
  const weight = (r: RecipeWithCheck) =>
    1 +
    (r.favorite ? 2 : 0) +
    (r.rating ?? 0) * 0.5 +
    (r.availability.uses_expiring.length ? 3 : 0);
  const total = pool.reduce((s, r) => s + weight(r), 0);
  let x = random() * total;
  const pick = pool.find((r) => (x -= weight(r)) <= 0) ?? pool[pool.length - 1]!;
  return { recipe: pick, from: pool.length };
}

// ---------- history & statistics ----------

export function mixHistory(
  ctx: Ctx,
  opts: { days?: number; recipe?: string; limit?: number } = {},
) {
  const since = opts.days ? ctx.now().getTime() - opts.days * DAY : 0;
  const q = opts.recipe?.toLowerCase();
  return listMixLog(ctx.db, 2000)
    .filter((m) => Date.parse(m.made_at) >= since && (!q || m.name.toLowerCase().includes(q)))
    .slice(0, opts.limit ?? 50);
}

export const rateMixSchema = z.object({
  id: z.number().int().positive().optional().describe('Mix log id; default the latest mix.'),
  rating: z.number().int().min(1).max(5).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export function rateMix(ctx: Ctx, input: z.input<typeof rateMixSchema>) {
  const p = rateMixSchema.parse(input);
  const entry: MixLogEntry | undefined =
    p.id !== undefined
      ? listMixLog(ctx.db, 5000).find((m) => m.id === p.id)
      : listMixLog(ctx.db, 1)[0];
  if (!entry)
    throw new ShakyError(
      'not_found',
      p.id ? `No mix with id ${p.id}.` : 'Nothing has been mixed yet.',
    );
  return mutate(ctx, (cs) => {
    const fields = Object.fromEntries(
      Object.entries({ rating: p.rating, notes: p.notes }).filter(([, v]) => v !== undefined),
    );
    const keys = Object.keys(fields);
    if (keys.length) {
      ctx.db
        .prepare(`UPDATE mix_log SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => fields[k] as never), entry.id);
    }
    cs.record({
      entity: 'mix',
      entity_id: entry.id,
      action: 'rated',
      summary: `${entry.name}${p.rating ? `: ${p.rating}/5` : ''}${p.notes ? `, "${p.notes}"` : ''}.`,
      data: { name: entry.name, rating: p.rating ?? null },
    });
    return { ...entry, ...fields };
  });
}

/** Mixed drinks, consumption, spend and standard drinks over a period. */
export function barStats(ctx: Ctx, days = 30) {
  const mixes = mixHistory(ctx, { days, limit: 5000 });
  const stock = new Map(
    listIngredientViews(ctx, { include_empty: true, include_archived: true }).map((i) => [i.id, i]),
  );
  const recipes = new Map(listRecipesWithCheck(ctx).map((r) => [r.id, r]));
  const drinks = new Map<string, { name: string; count: number; ratings: number[] }>();
  const used = new Map<number, { name: string; ml: number; pieces: number; cost: number }>();
  let spend = 0;
  let standard = 0;
  let servings = 0;
  for (const m of mixes) {
    servings += m.servings;
    const d = drinks.get(m.name) ?? { name: m.name, count: 0, ratings: [] };
    d.count += m.servings;
    if (m.rating) d.ratings.push(m.rating);
    drinks.set(m.name, d);
    const r = m.recipe_id ? recipes.get(m.recipe_id) : undefined;
    if (r) standard += r.strength.standard_drinks * m.servings;
    for (const x of m.deducted) {
      const b = stock.get(x.ingredient_id);
      const u = used.get(x.ingredient_id) ?? { name: x.name, ml: 0, pieces: 0, cost: 0 };
      const per = ML[x.unit];
      if (per !== undefined) {
        const ml = x.amount * per;
        u.ml += ml;
        if (b?.price && b.bottle_size_ml && !b.yield_ml)
          u.cost += (ml / b.bottle_size_ml) * b.price;
        if (b?.price && b.yield_ml) u.cost += (ml / b.yield_ml) * b.price;
      } else {
        u.pieces += x.amount;
        if (b?.price) u.cost += x.amount * b.price;
      }
      used.set(x.ingredient_id, u);
    }
  }
  for (const u of used.values()) spend += u.cost;
  const weeks = Math.max(1, days / 7);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    days,
    drinks_mixed: servings,
    top_drinks: [...drinks.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((d) => ({
        name: d.name,
        count: d.count,
        ...(d.ratings.length && {
          avg_rating: r2(d.ratings.reduce((a, b) => a + b, 0) / d.ratings.length),
        }),
      })),
    consumption: [...used.values()]
      .sort((a, b) => b.ml - a.ml)
      .map((u) => ({
        name: u.name,
        ...(u.ml && { ml: Math.round(u.ml) }),
        ...(u.pieces && { pieces: r2(u.pieces) }),
        ...(u.cost && { cost: r2(u.cost) }),
      })),
    spend: { amount: r2(spend), currency: getSetting<string>(ctx.db, 'currency', 'EUR') },
    standard_drinks: { total: r2(standard), per_week: r2(standard / weeks) },
    never_mixed: [...recipes.values()]
      .filter((r) => !mixes.some((m) => m.recipe_id === r.id))
      .map((r) => r.name),
  };
}
