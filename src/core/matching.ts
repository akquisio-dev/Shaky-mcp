import type { Equipment } from '../db/repos/catalog.js';
import type { Recipe } from '../db/repos/recipes.js';
import type { RecipeIngredient, Step, StepAction } from './schemas.js';
import type { IngredientView } from './inventory.js';

// Fuzzy matching between recipe ingredients and the bottles in the bar.
// Rule of thumb: every word the recipe asks for must be present on the
// bottle (name, brand, subcategory, tags, category). "rum" therefore matches
// any rum, while "dark rum" does not match a white rum.

const SYNONYMS: Record<string, string> = {
  brown: 'dark',
  black: 'dark',
  dunkel: 'dark',
  dunkler: 'dark',
  brauner: 'dark',
  silver: 'white',
  light: 'white',
  blanco: 'white',
  plata: 'white',
  weiss: 'white',
  weisser: 'white',
  limette: 'lime',
  limetten: 'lime',
  zitrone: 'lemon',
  zitronen: 'lemon',
  ananas: 'pineapple',
  saft: 'juice',
  sirup: 'syrup',
  likor: 'liqueur',
  likoer: 'liqueur',
  wodka: 'vodka',
};

const STOPWORDS = new Set(['fresh', 'freshly', 'squeezed', 'of', 'the', 'a', 'and', 'or', 'some']);

export function words(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map((w) => SYNONYMS[w] ?? w)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

function bag(i: IngredientView): Set<string> {
  return new Set([
    ...words(i.name),
    ...words(i.brand),
    ...words(i.subcategory),
    ...i.tags.flatMap(words),
    ...i.provides.flatMap(words),
    ...words(i.category.replace(/_/g, ' ')),
  ]);
}

const sameWords = (a: string[], b: string[]) =>
  a.length === b.length && a.every((w) => b.includes(w));

/** The words a recipe line asks for. */
function queryOf(spec: RecipeIngredient): string[] {
  if (spec.subcategory || spec.tags?.length)
    return [...words(spec.subcategory), ...(spec.tags ?? []).flatMap(words)];
  return spec.category ? [] : words(spec.name);
}

/**
 * Does this bottle satisfy the recipe line (ignoring whether it is in stock)?
 * Every word the line asks for must appear on the bottle. A whole phrase the
 * bottle provides (or a tag that is exactly the phrase) beats the category, so
 * limes that provide "lime juice" serve a "lime juice" line of category juice.
 */
export function matchesSpec(spec: RecipeIngredient, i: IngredientView): boolean {
  if (spec.ingredient_id !== undefined) return spec.ingredient_id === i.id;
  const query = queryOf(spec);
  const b = bag(i);
  if (
    spec.exclude?.some((x) => {
      const w = words(x);
      return w.length > 0 && w.every((y) => b.has(y));
    })
  )
    return false;
  const provided =
    query.length > 0 &&
    (i.provides.some((p) => query.every((w) => words(p).includes(w))) ||
      i.tags.some((t) => sameWords(words(t), query)));
  if (provided) return true;
  if (spec.category && spec.category !== i.category) return false;
  if (query.length === 0) return Boolean(spec.category);
  if (!query.every((w) => b.has(w))) return false;
  if (spec.exact) {
    // No extra qualifiers: every word describing the bottle must be asked for.
    const own = words(i.subcategory ?? i.name).filter(
      (w) => !words(i.category.replace(/_/g, ' ')).includes(w),
    );
    return own.every((w) => query.includes(w));
  }
  return true;
}

export type LineStatus = 'available' | 'unavailable' | 'missing';

export interface LineCheck {
  name: string;
  amount?: number;
  unit: string;
  optional: boolean;
  garnish: boolean;
  status: LineStatus;
  /** Best bottle in stock for this line. */
  match?: { id: number; name: string; fill_level: string; location: string };
  /** Bottles that would match but are empty or expired. */
  unusable?: { id: number; name: string; reason: 'empty' | 'expired' }[];
  /** How many servings the stock covers for this line, when it can be measured. */
  servings?: number;
}

function rank(i: IngredientView): number {
  // Prefer bottles that expire soonest (use them up), then the fullest.
  const expiry = i.days_left ?? 100_000;
  return expiry * 10 - i.fill_fraction;
}

export function checkLine(spec: RecipeIngredient, stock: IngredientView[]): LineCheck {
  const candidates = stock.filter((i) => !i.archived && matchesSpec(spec, i));
  const usable = candidates.filter((i) => i.available).sort((a, b) => rank(a) - rank(b));
  const unusable = candidates
    .filter((i) => !i.available)
    .map((i) => ({
      id: i.id,
      name: i.name,
      reason: i.expired ? ('expired' as const) : ('empty' as const),
    }));
  const best = usable[0];
  const servings = servingsFor(spec, usable);
  return {
    name: spec.name,
    amount: spec.amount,
    unit: spec.unit,
    optional: spec.optional,
    garnish: spec.garnish,
    status: best ? 'available' : unusable.length ? 'unavailable' : 'missing',
    ...(best && {
      match: { id: best.id, name: best.name, fill_level: best.fill_level, location: best.location },
    }),
    ...(unusable.length && { unusable }),
    ...(servings !== undefined && { servings }),
  };
}

const ML_PER: Record<string, number> = {
  ml: 1,
  cl: 10,
  oz: 29.5735,
  dash: 0.9,
  barspoon: 5,
  tsp: 5,
  tbsp: 15,
};

/** Servings the matching stock covers, or undefined when it cannot be measured. */
function servingsFor(spec: RecipeIngredient, usable: IngredientView[]): number | undefined {
  if (!spec.amount || !usable.length) return usable.length ? undefined : 0;
  const perMl = ML_PER[spec.unit];
  if (perMl !== undefined) {
    const need = spec.amount * perMl;
    if (usable.some((i) => i.stock_ml === null)) return undefined;
    const have = usable.reduce((s, i) => s + (i.stock_ml ?? 0), 0);
    return Math.floor(have / need + 1e-9);
  }
  if (spec.unit === 'piece' || spec.unit === 'scoop') {
    const have = usable.reduce((s, i) => s + i.quantity, 0);
    return Math.floor(have / spec.amount + 1e-9);
  }
  return undefined;
}

const IMPLIED_EQUIPMENT: Partial<Record<StepAction, string>> = {
  shake: 'shaker',
  blend: 'blender',
  muddle: 'muddler',
  strain: 'strainer',
  stir: 'bar_spoon',
};

export function requiredEquipment(steps: Step[]): string[] {
  const types = new Set<string>();
  for (const s of steps) {
    const t = s.equipment ?? IMPLIED_EQUIPMENT[s.action];
    if (t) types.add(t);
  }
  return [...types];
}

/** Household things assumed to be in any kitchen, e.g. a spoon for stirring. */
export type Household = Record<string, string>;

/**
 * Available equipment that covers a type: the real tool, a registered
 * substitute, or a household item (only names it, nothing to manage).
 */
export function equipmentFor(
  type: string,
  equipment: Equipment[],
  household: Household = {},
): { name: string; type: string } | undefined {
  const avail = equipment.filter((e) => e.available);
  const real =
    avail.find((e) => e.type === type) ?? avail.find((e) => e.substitutes_for.includes(type));
  if (real) return real;
  return household[type] ? { name: household[type], type: 'household' } : undefined;
}

export type RecipeStatus = 'makeable' | 'missing_one' | 'missing_more';

export interface RecipeCheck {
  recipe_id: number;
  name: string;
  status: RecipeStatus;
  /** Required (non-optional, non-garnish) lines that are not in stock. */
  missing: string[];
  missing_optional: string[];
  missing_equipment: string[];
  /** Equipment types covered only by a substitute, e.g. shaker -> "Jam jar". */
  substitutes_used: { type: string; using: string }[];
  /** How many times the drink can be made from stock; null when amounts are unknown. */
  servings_possible: number | null;
  lines: LineCheck[];
}

export function checkRecipe(
  recipe: Recipe,
  stock: IngredientView[],
  equipment: Equipment[],
  household: Household = {},
): RecipeCheck {
  const lines = recipe.ingredients.map((spec) => checkLine(spec, stock));
  const missing = lines
    .filter((l) => l.status !== 'available' && !l.optional && !l.garnish)
    .map((l) => l.name);
  const missing_optional = lines
    .filter((l) => l.status !== 'available' && (l.optional || l.garnish))
    .map((l) => l.name);
  const missing_equipment: string[] = [];
  const substitutes_used: { type: string; using: string }[] = [];
  for (const type of requiredEquipment(recipe.steps)) {
    const e = equipmentFor(type, equipment, household);
    if (!e) missing_equipment.push(type);
    else if (e.type !== type) substitutes_used.push({ type, using: e.name });
  }
  const status: RecipeStatus =
    missing.length === 0 ? 'makeable' : missing.length === 1 ? 'missing_one' : 'missing_more';
  const measured = lines.filter((l) => !l.optional && !l.garnish && l.servings !== undefined);
  const servings_possible =
    status !== 'makeable'
      ? 0
      : measured.length
        ? Math.min(...measured.map((l) => l.servings!))
        : null;
  return {
    recipe_id: recipe.id,
    name: recipe.name,
    status,
    missing,
    missing_optional,
    missing_equipment,
    substitutes_used,
    servings_possible,
    lines,
  };
}
