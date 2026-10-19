import { z } from 'zod';
import { insertRow } from '../db/sql.js';
import type { Recipe } from '../db/repos/recipes.js';
import { mutate, nowIso, ShakyError, type Ctx } from './context.js';
import { words } from './matching.js';
import type { RecipeIngredient, Step } from './schemas.js';

// Personal taste, applied on top of saved recipes without changing them:
// "0.5 cl less lemon juice in sours", "I don't like tequila".

export interface Preference {
  id: number;
  kind: 'adjust' | 'avoid';
  ingredient: string;
  recipe_tag: string | null;
  recipe: string | null;
  delta: number | null;
  unit: string | null;
  factor: number | null;
  note: string | null;
  created_at: string;
}

export const preferenceInputSchema = z.object({
  kind: z.enum(['adjust', 'avoid']),
  ingredient: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .describe('Words of the ingredient line it applies to, e.g. "lemon juice" or "tequila".'),
  recipe_tag: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .describe('Only recipes with this tag or this word in their name, e.g. "sour".'),
  recipe: z.string().trim().max(80).nullish().describe('Only this recipe (by name).'),
  delta: z.number().min(-100).max(100).nullish().describe('Amount to add, negative for less.'),
  unit: z.string().max(10).nullish().describe('Unit of delta, default cl.'),
  factor: z.number().min(0).max(5).nullish().describe('Multiply the amount instead, e.g. 0.8.'),
  note: z.string().trim().max(200).nullish(),
});

export function listPreferences(ctx: Ctx): Preference[] {
  return ctx.db.prepare('SELECT * FROM preferences ORDER BY id').all() as Preference[];
}

export function addPreference(ctx: Ctx, input: z.input<typeof preferenceInputSchema>) {
  const p = preferenceInputSchema.parse(input);
  if (p.kind === 'adjust' && (p.delta ?? null) === null && (p.factor ?? null) === null) {
    throw new ShakyError('invalid', 'An adjustment needs a delta or a factor.');
  }
  return mutate(ctx, (cs) => {
    const id = insertRow(ctx.db, 'preferences', {
      ...p,
      unit: p.unit ?? (p.delta != null ? 'cl' : null),
      created_at: nowIso(ctx),
    });
    const pref = ctx.db.prepare('SELECT * FROM preferences WHERE id = ?').get(id) as Preference;
    cs.record({
      entity: 'preference',
      entity_id: id,
      action: 'created',
      summary: `Saved preference: ${describePreference(pref)}.`,
      data: { name: pref.ingredient },
    });
    return pref;
  });
}

export function removePreference(ctx: Ctx, id: number) {
  return mutate(ctx, (cs) => {
    const pref = ctx.db.prepare('SELECT * FROM preferences WHERE id = ?').get(id) as
      Preference | undefined;
    if (!pref) throw new ShakyError('not_found', `No preference with id ${id}.`);
    ctx.db.prepare('DELETE FROM preferences WHERE id = ?').run(id);
    cs.record({
      entity: 'preference',
      entity_id: id,
      action: 'deleted',
      summary: `Removed preference: ${describePreference(pref)}.`,
      data: { name: pref.ingredient },
    });
    return pref;
  });
}

export function describePreference(p: Preference): string {
  const scope = p.recipe ? ` in ${p.recipe}` : p.recipe_tag ? ` in ${p.recipe_tag} drinks` : '';
  if (p.kind === 'avoid') return `avoid ${p.ingredient}`;
  if (p.factor != null) return `${p.ingredient} x${p.factor}${scope}`;
  return `${p.delta! > 0 ? '+' : ''}${p.delta} ${p.unit ?? 'cl'} ${p.ingredient}${scope}`;
}

const ML: Record<string, number> = {
  ml: 1,
  cl: 10,
  oz: 29.5735,
  dash: 0.9,
  barspoon: 5,
  tsp: 5,
  tbsp: 15,
};

function convert(value: number, from: string, to: string): number | null {
  if (from === to) return value;
  const a = ML[from];
  const b = ML[to];
  return a !== undefined && b !== undefined ? (value * a) / b : null;
}

const lineWords = (l: { name: string; subcategory?: string; tags?: string[] }) =>
  new Set([...words(l.name), ...words(l.subcategory), ...(l.tags ?? []).flatMap(words)]);

const hits = (pref: Preference, l: { name: string; subcategory?: string; tags?: string[] }) => {
  const w = words(pref.ingredient);
  const lw = lineWords(l);
  return w.length > 0 && w.every((x) => lw.has(x));
};

function applies(pref: Preference, r: Pick<Recipe, 'name' | 'tags'>): boolean {
  if (pref.recipe && pref.recipe.toLowerCase() !== r.name.toLowerCase()) return false;
  if (pref.recipe_tag) {
    const tag = pref.recipe_tag.toLowerCase();
    if (!r.tags.includes(tag) && !words(r.name).some((w) => words(tag).includes(w))) return false;
  }
  return true;
}

export interface Adjustment {
  line: string;
  from: number;
  to: number;
  unit: string;
  note: string;
}

export interface Personalized {
  ingredients: RecipeIngredient[];
  steps: Step[];
  adjustments: Adjustment[];
  /** Lines with something the user avoids. */
  avoided: string[];
}

/** The recipe as this user makes it. Saved recipes are never changed. */
export function personalize(
  r: Pick<Recipe, 'name' | 'tags' | 'ingredients' | 'steps'>,
  prefs: Preference[],
): Personalized {
  const adjustments: Adjustment[] = [];
  const avoided = new Set<string>();
  const change = new Map<string, (amount: number, unit: string) => number>();
  for (const p of prefs) {
    if (!applies(p, r)) continue;
    for (const l of r.ingredients) {
      if (!hits(p, l)) continue;
      if (p.kind === 'avoid') {
        if (!l.optional && !l.garnish) avoided.add(l.name);
        continue;
      }
      const prev = change.get(l.name) ?? ((a: number) => a);
      change.set(l.name, (a, unit) => {
        const base = prev(a, unit);
        if (p.factor != null) return base * p.factor;
        const d = convert(p.delta ?? 0, p.unit ?? 'cl', unit);
        return d === null ? base : base + d;
      });
    }
  }
  const round = (x: number) => Math.max(0, Math.round(x * 100) / 100);
  const ingredients = r.ingredients
    .map((l) => {
      const f = change.get(l.name);
      if (!f || l.amount === undefined) return l;
      const to = round(f(l.amount, l.unit));
      if (to !== l.amount) {
        const notes = prefs
          .filter((p) => p.kind === 'adjust' && applies(p, r) && hits(p, l))
          .map(describePreference);
        adjustments.push({
          line: l.name,
          from: l.amount,
          to,
          unit: l.unit,
          note: notes.join(', '),
        });
      }
      return { ...l, amount: to };
    })
    .filter((l) => l.amount === undefined || l.amount > 0);
  const kept = new Set(ingredients.map((l) => l.name));
  const steps = r.steps
    .filter(
      (s) =>
        !s.ingredient ||
        kept.has(s.ingredient) ||
        !r.ingredients.some((l) => l.name === s.ingredient),
    )
    .map((s) => {
      const f = s.ingredient ? change.get(s.ingredient) : undefined;
      return f && s.amount !== undefined ? { ...s, amount: round(f(s.amount, s.unit ?? 'cl')) } : s;
    });
  return { ingredients, steps, adjustments, avoided: [...avoided] };
}
