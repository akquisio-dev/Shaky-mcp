import type { CategoryDefaults } from '../db/repos/catalog.js';
import { words } from './matching.js';
import type { LineCheck } from './matching.js';
import type { IngredientView } from './inventory.js';
import type { RecipeIngredient, Step } from './schemas.js';

const ML: Record<string, number> = {
  ml: 1,
  cl: 10,
  oz: 29.5735,
  dash: 0.9,
  barspoon: 5,
  tsp: 5,
  tbsp: 15,
};

// When neither the bottle nor its category says how strong it is.
const GUESS: [RegExp, number][] = [
  [
    /\b(rum|gin|vodka|tequila|mezcal|whisk(e)?y|bourbon|rye|scotch|brandy|cognac|pisco|cacha[cç]a|absinth)\b/,
    40,
  ],
  [/\b(liqueur|triple|curacao|amaretto|schnapps|cr[eè]me|aperol|campari)\b/, 25],
  [/\b(vermouth|lillet|aperitif|sherry|port|wine|prosecco|champagne|sekt)\b/, 15],
  [/\b(bitters|angostura)\b/, 44],
];

export interface Strength {
  /** Final volume in the glass, after melt water. */
  volume_ml: number;
  abv: number;
  alcohol_g: number;
  standard_drinks: number;
  /** Melt water share that was assumed from the method. */
  dilution: number;
  /** Contains an energy drink: caffeine hides how drunk you are. */
  energy: boolean;
}

/** Melt water by technique: shaking dilutes most, a built drink on ice a little. */
export function dilutionFor(steps: Step[]): number {
  const acts = new Set(steps.map((s) => s.action));
  if (acts.has('blend')) return 0.3;
  if (acts.has('shake')) return 0.25;
  if (acts.has('stir') && acts.has('strain')) return 0.15;
  if (acts.has('add_ice')) return 0.1;
  return 0;
}

export function drinkStrength(
  ingredients: RecipeIngredient[],
  steps: Step[],
  lines: LineCheck[],
  stock: Map<number, IngredientView>,
  categories: Map<string, CategoryDefaults>,
  standardDrinkG = 10,
): Strength {
  let liquid = 0;
  let pure = 0;
  let energy = false;
  for (const l of ingredients) {
    if (l.garnish) continue;
    const check = lines.find((x) => x.name === l.name);
    const bottle = check?.match ? stock.get(check.match.id) : undefined;
    const text = [
      l.name,
      l.subcategory,
      bottle?.name,
      bottle?.subcategory,
      ...(bottle?.tags ?? []),
    ].join(' ');
    if (/energy/i.test(text)) energy = true;
    const per = ML[l.unit];
    if (per === undefined || l.amount === undefined) continue;
    const ml = l.amount * per;
    liquid += ml;
    const abv =
      bottle?.abv ??
      (l.category ? categories.get(l.category)?.abv : undefined) ??
      (bottle ? categories.get(bottle.category)?.abv : undefined) ??
      GUESS.find(([re]) => re.test(words(text).join(' ')))?.[1] ??
      0;
    pure += (ml * abv) / 100;
  }
  const dilution = dilutionFor(steps);
  const volume = liquid * (1 + dilution);
  const grams = pure * 0.789;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    volume_ml: Math.round(volume),
    abv: volume > 0 ? r1((pure / volume) * 100) : 0,
    alcohol_g: r1(grams),
    standard_drinks: r1(grams / standardDrinkG),
    dilution,
    energy,
  };
}
