import type { LineCheck } from './matching.js';
import type { IngredientView } from './inventory.js';
import type { RecipeIngredient } from './schemas.js';

const ML: Record<string, number> = {
  ml: 1,
  cl: 10,
  oz: 29.5735,
  dash: 0.9,
  barspoon: 5,
  tsp: 5,
  tbsp: 15,
};

export interface Cost {
  /** Sum of the lines with a known price, rounded to cents. */
  amount: number;
  currency: string;
  /** False when a required line has no price; amount is then a lower bound. */
  complete: boolean;
  missing_prices: string[];
}

/** What one line costs from the bottle it is poured from, or null if unknown. */
export function lineCost(
  spec: RecipeIngredient,
  bottle: IngredientView | undefined,
  ratio = 1,
): number | null {
  if (!bottle || bottle.price === null || bottle.price === undefined || spec.amount === undefined)
    return null;
  const amount = spec.amount * ratio;
  const per = ML[spec.unit];
  if (per !== undefined) {
    const ml = amount * per;
    if (bottle.yield_ml) return (ml / bottle.yield_ml) * bottle.price;
    const size = bottle.bottle_size_ml;
    return size ? (ml / size) * bottle.price : null;
  }
  // Pieces, slices, wedges: price per piece; a wedge is about an eighth of a fruit.
  const share: Record<string, number> = {
    piece: 1,
    scoop: 1,
    slice: 0.125,
    wedge: 0.125,
    leaf: 0.02,
    sprig: 0.1,
  };
  return share[spec.unit] !== undefined ? amount * share[spec.unit]! * bottle.price : null;
}

export function drinkCost(
  ingredients: RecipeIngredient[],
  lines: LineCheck[],
  stock: Map<number, IngredientView>,
  currency: string,
): Cost {
  let amount = 0;
  const missing: string[] = [];
  for (const spec of ingredients) {
    const check = lines.find((l) => l.name === spec.name);
    const bottle = check?.match ? stock.get(check.match.id) : undefined;
    const c = lineCost(spec, bottle, check?.substitute?.ratio ?? 1);
    if (c === null) {
      if (!spec.optional && !spec.garnish && spec.unit !== 'to_taste' && spec.unit !== 'top')
        missing.push(spec.name);
      continue;
    }
    amount += c;
  }
  return {
    amount: Math.round(amount * 100) / 100,
    currency,
    complete: missing.length === 0,
    missing_prices: missing,
  };
}
