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
    ...i.variants.flatMap((v) => words(v.name)),
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

export type LineStatus = 'available' | 'substituted' | 'unavailable' | 'missing';

/** "Ginger ale for ginger beer, milder." */
export interface Substitution {
  id: number;
  for_words: string;
  use_words: string;
  ratio: number;
  note: string | null;
  two_way: boolean;
}

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
  /** Set when a substitution rule covers the line. */
  substitute?: { using: string; for: string; ratio: number; note: string | null };
}

function rank(i: IngredientView): number {
  // Prefer bottles that expire soonest (use them up), then the fullest.
  const expiry = i.days_left ?? 100_000;
  return expiry * 10 - i.fill_fraction;
}

/** Rules that could stand in for this line, in both directions where allowed. */
function rulesFor(spec: RecipeIngredient, subs: Substitution[]) {
  const asked = new Set([...queryOf(spec), ...words(spec.name)]);
  const out: { use: string; ratio: number; note: string | null; for: string }[] = [];
  for (const r of subs) {
    const f = words(r.for_words);
    const u = words(r.use_words);
    if (f.length && f.every((w) => asked.has(w)))
      out.push({ use: r.use_words, ratio: r.ratio, note: r.note, for: r.for_words });
    else if (r.two_way && u.length && u.every((w) => asked.has(w)))
      out.push({
        use: r.for_words,
        ratio: r.ratio ? 1 / r.ratio : 1,
        note: r.note,
        for: r.use_words,
      });
  }
  return out;
}

export function checkLine(
  spec: RecipeIngredient,
  stock: IngredientView[],
  subs: Substitution[] = [],
): LineCheck {
  const direct = checkLineDirect(spec, stock);
  if (direct.status === 'available' || !subs.length) return direct;
  for (const rule of rulesFor(spec, subs)) {
    const alt = checkLineDirect(
      {
        ...spec,
        ingredient_id: undefined,
        category: undefined,
        subcategory: rule.use,
        tags: undefined,
        exact: false,
        exclude: spec.exclude,
        amount: spec.amount ? spec.amount * rule.ratio : spec.amount,
      },
      stock,
    );
    if (alt.status === 'available') {
      return {
        ...alt,
        name: spec.name,
        amount: spec.amount,
        status: 'substituted',
        substitute: { using: alt.match!.name, for: rule.for, ratio: rule.ratio, note: rule.note },
        ...(direct.unusable && { unusable: direct.unusable }),
      };
    }
  }
  return direct;
}

function checkLineDirect(spec: RecipeIngredient, stock: IngredientView[]): LineCheck {
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

export type RecipeStatus = 'makeable' | 'with_substitute' | 'missing_one' | 'missing_more';

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
  /** In-stock bottles this drink would use up that expire soon, soonest first. */
  uses_expiring: { line: string; bottle: string; days_left: number }[];
  /** Lines covered by a stand-in, with the rule's note ("milder"). */
  substitutions: { line: string; using: string; note: string | null }[];
  /** How many times the drink can be made from stock; null when amounts are unknown. */
  servings_possible: number | null;
  lines: LineCheck[];
}

export function checkRecipe(
  recipe: Recipe,
  stock: IngredientView[],
  equipment: Equipment[],
  household: Household = {},
  subs: Substitution[] = [],
): RecipeCheck {
  const lines = recipe.ingredients.map((spec) => checkLine(spec, stock, subs));
  const ok = (l: LineCheck) => l.status === 'available' || l.status === 'substituted';
  const missing = lines.filter((l) => !ok(l) && !l.optional && !l.garnish).map((l) => l.name);
  const missing_optional = lines
    .filter((l) => !ok(l) && (l.optional || l.garnish))
    .map((l) => l.name);
  const substituted = lines.filter((l) => l.status === 'substituted' && !l.optional && !l.garnish);
  const missing_equipment: string[] = [];
  const substitutes_used: { type: string; using: string }[] = [];
  for (const type of requiredEquipment(recipe.steps)) {
    const e = equipmentFor(type, equipment, household);
    if (!e) missing_equipment.push(type);
    else if (e.type !== type) substitutes_used.push({ type, using: e.name });
  }
  const status: RecipeStatus =
    missing.length === 0
      ? substituted.length
        ? 'with_substitute'
        : 'makeable'
      : missing.length === 1
        ? 'missing_one'
        : 'missing_more';
  const measured = lines.filter((l) => !l.optional && !l.garnish && l.servings !== undefined);
  const servings_possible =
    status !== 'makeable' && status !== 'with_substitute'
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
    uses_expiring: lines
      .flatMap((l) => {
        const b = l.match ? stock.find((i) => i.id === l.match!.id) : undefined;
        return b && b.expiring_soon && b.days_left !== null
          ? [{ line: l.name, bottle: b.name, days_left: b.days_left }]
          : [];
      })
      .sort((a, b) => a.days_left - b.days_left),
    substitutions: substituted.map((l) => ({
      line: l.name,
      using: l.substitute!.using,
      note: l.substitute!.note,
    })),
    servings_possible,
    lines,
  };
}
