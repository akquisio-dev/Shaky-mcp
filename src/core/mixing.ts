import { getCategoryDefaults } from '../db/repos/catalog.js';
import { getIngredient, type Ingredient } from '../db/repos/ingredients.js';
import { insertMixLog, type Deduction } from '../db/repos/recipes.js';
import { mutate, nowIso, ShakyError, type Ctx } from './context.js';
import { deductCount, deductVolume, isCountUnit, toMl, type StockState } from './fillLevel.js';
import { listIngredientViews, resolveIngredient, writeStock } from './inventory.js';
import { checkLine } from './matching.js';
import { resolveRecipe } from './recipes.js';
import type { Unit } from './schemas.js';

export interface MixInput {
  recipe?: number | string;
  name?: string;
  servings?: number;
  rating?: number | null;
  notes?: string | null;
  deduct?: boolean;
  /** Explicit amounts; used instead of the recipe when given. */
  used?: { ingredient: number | string; amount: number; unit: Unit }[];
  made_at?: string;
}

export interface Skipped {
  name: string;
  reason: string;
}

function stockOf(i: Ingredient): StockState {
  return {
    fill_level: i.fill_level,
    amount_ml: i.amount_ml,
    amount_is_estimate: i.amount_is_estimate,
    bottle_size_ml: i.bottle_size_ml,
    quantity: i.quantity,
    opened_at: i.opened_at,
  };
}

/**
 * Logs a drink as made and optionally takes the amounts out of stock.
 * Exact when the bottle has ml, estimated from the fill level otherwise.
 */
export function logMix(ctx: Ctx, input: MixInput) {
  const servings = input.servings ?? 1;
  return mutate(ctx, (cs) => {
    const recipe = input.recipe !== undefined ? resolveRecipe(ctx, input.recipe) : undefined;
    const name = input.name ?? recipe?.name;
    if (!name) throw new ShakyError('invalid', 'Give a recipe or a name for the drink.');

    const plan: { ing: Ingredient; amount: number; unit: Unit; garnish?: boolean }[] = [];
    const skipped: Skipped[] = [];
    if (input.deduct !== false) {
      if (input.used?.length) {
        for (const u of input.used) {
          plan.push({ ing: resolveIngredient(ctx, u.ingredient), amount: u.amount, unit: u.unit });
        }
      } else if (recipe) {
        const stock = listIngredientViews(ctx, { include_empty: true });
        for (const spec of recipe.ingredients) {
          const line = checkLine(spec, stock);
          if (!line.match) {
            if (!spec.optional && !spec.garnish)
              skipped.push({ name: spec.name, reason: 'not in stock' });
            continue;
          }
          if (!spec.amount) {
            if (!spec.garnish) skipped.push({ name: spec.name, reason: 'no amount in recipe' });
            continue;
          }
          plan.push({
            ing: getIngredient(ctx.db, line.match.id)!,
            amount: spec.amount * servings,
            unit: spec.unit,
            garnish: spec.garnish,
          });
        }
      }
    }

    const deducted: Deduction[] = [];
    for (const p of plan) {
      // Re-read: the same bottle may serve two lines.
      const cur = getIngredient(ctx.db, p.ing.id)!;
      const before = stockOf(cur);
      const ml = toMl(p.amount, p.unit);
      let res;
      if (ml !== null && cur.yield_ml) {
        // Juice from fruit counted in pieces: 3 cl lime juice = 1 lime at 30 ml yield.
        res = deductCount(before, Math.round((ml / cur.yield_ml) * 100) / 100);
      } else if (ml !== null) {
        const d = getCategoryDefaults(ctx.db, cur.category);
        res = deductVolume(before, ml, d?.bottle_size_ml ?? null, nowIso(ctx));
      } else if (isCountUnit(p.unit)) {
        res = deductCount(before, p.amount);
      } else {
        if (!p.garnish) skipped.push({ name: cur.name, reason: `unit "${p.unit}" is not tracked` });
        continue;
      }
      if (res.skipped) {
        skipped.push({ name: cur.name, reason: res.skipped });
        continue;
      }
      writeStock(ctx, cs, cur, { ...res.next }, 'used');
      deducted.push({
        ingredient_id: cur.id,
        name: cur.name,
        amount: p.amount,
        unit: p.unit,
        before: {
          fill_level: before.fill_level,
          amount_ml: before.amount_ml,
          quantity: before.quantity,
        },
        after: {
          fill_level: res.next.fill_level,
          amount_ml: res.next.amount_ml,
          quantity: res.next.quantity,
        },
      });
    }

    const made_at = input.made_at ? new Date(input.made_at).toISOString() : nowIso(ctx);
    const id = insertMixLog(ctx.db, {
      recipe_id: recipe?.id ?? null,
      name,
      made_at,
      servings,
      rating: input.rating ?? null,
      notes: input.notes ?? null,
      deducted,
    });
    cs.record({
      entity: 'mix',
      entity_id: id,
      action: 'mixed',
      summary: `Mixed ${servings === 1 ? '' : `${servings}x `}${name}${
        deducted.length
          ? `, used ${deducted.map((d) => `${d.amount} ${d.unit} ${d.name}`).join(', ')}`
          : ''
      }.`,
      data: { name, recipe_id: recipe?.id ?? null, servings, deducted: deducted.length },
    });
    return { id, name, made_at, servings, deducted, skipped, recipe_id: recipe?.id ?? null };
  });
}
