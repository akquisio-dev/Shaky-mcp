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
    ...words(i.category.replace(/_/g, ' ')),
  ]);
}

/** Does this bottle satisfy the recipe line (ignoring whether it is in stock)? */
export function matchesSpec(spec: RecipeIngredient, i: IngredientView): boolean {
  if (spec.ingredient_id !== undefined) return spec.ingredient_id === i.id;
  if (spec.category && spec.category !== i.category) return false;
  const query =
    spec.subcategory || spec.tags?.length
      ? [...words(spec.subcategory), ...(spec.tags ?? []).flatMap(words)]
      : spec.category
        ? []
        : words(spec.name);
  if (query.length === 0) return Boolean(spec.category);
  const b = bag(i);
  return query.every((w) => b.has(w));
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
  };
}

const IMPLIED_EQUIPMENT: Partial<Record<StepAction, string>> = {
  shake: 'shaker',
  blend: 'blender',
  muddle: 'muddler',
  strain: 'strainer',
};

export function requiredEquipment(steps: Step[]): string[] {
  const types = new Set<string>();
  for (const s of steps) {
    const t = s.equipment ?? IMPLIED_EQUIPMENT[s.action];
    if (t) types.add(t);
  }
  return [...types];
}

/** Available equipment that covers a type, directly or as a substitute. */
export function equipmentFor(type: string, equipment: Equipment[]): Equipment | undefined {
  const avail = equipment.filter((e) => e.available);
  return avail.find((e) => e.type === type) ?? avail.find((e) => e.substitutes_for.includes(type));
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
  lines: LineCheck[];
}

export function checkRecipe(
  recipe: Recipe,
  stock: IngredientView[],
  equipment: Equipment[],
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
    const e = equipmentFor(type, equipment);
    if (!e) missing_equipment.push(type);
    else if (e.type !== type) substitutes_used.push({ type, using: e.name });
  }
  const status: RecipeStatus =
    missing.length === 0 ? 'makeable' : missing.length === 1 ? 'missing_one' : 'missing_more';
  return {
    recipe_id: recipe.id,
    name: recipe.name,
    status,
    missing,
    missing_optional,
    missing_equipment,
    substitutes_used,
    lines,
  };
}
