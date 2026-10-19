import { z } from 'zod';
import { insertRow } from '../db/sql.js';
import { mutate, ShakyError, type Ctx } from './context.js';
import { words } from './matching.js';
import type { RecipeIngredient, Step } from './schemas.js';

// Guest diets as data: "vegan: egg white -> aquafaba", "nut allergy: no orgeat".

export interface DietRule {
  id: number;
  diet: string;
  match_words: string;
  action: 'replace' | 'exclude';
  replacement: string | null;
  ratio: number;
  note: string | null;
}

export const dietRuleInputSchema = z.object({
  diet: z.string().trim().min(1).max(40).describe('e.g. vegan, nut allergy, lactose free.'),
  match_words: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .describe('Ingredient words it applies to, e.g. "egg white".'),
  action: z.enum(['replace', 'exclude']),
  replacement: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .describe('For replace: what to use instead, e.g. "aquafaba".'),
  ratio: z.number().positive().max(5).optional(),
  note: z.string().trim().max(200).nullish(),
});

export function listDietRules(ctx: Ctx): DietRule[] {
  return ctx.db.prepare('SELECT * FROM diet_rules ORDER BY diet, id').all() as DietRule[];
}

export function listDiets(ctx: Ctx): string[] {
  return [...new Set(listDietRules(ctx).map((r) => r.diet))];
}

export function addDietRule(ctx: Ctx, input: z.input<typeof dietRuleInputSchema>) {
  const p = dietRuleInputSchema.parse(input);
  if (p.action === 'replace' && !p.replacement)
    throw new ShakyError('invalid', 'A replace rule needs a replacement.');
  return mutate(ctx, (cs) => {
    const id = insertRow(ctx.db, 'diet_rules', {
      ...p,
      diet: p.diet.toLowerCase(),
      ratio: p.ratio ?? 1,
    });
    cs.record({
      entity: 'diet',
      entity_id: id,
      action: 'created',
      summary: `Diet ${p.diet}: ${p.action === 'replace' ? `${p.match_words} becomes ${p.replacement}` : `no ${p.match_words}`}.`,
      data: { name: p.diet },
    });
    return listDietRules(ctx).find((r) => r.id === id)!;
  });
}

export function removeDietRule(ctx: Ctx, id: number) {
  return mutate(ctx, (cs) => {
    const r = listDietRules(ctx).find((x) => x.id === id);
    if (!r) throw new ShakyError('not_found', `No diet rule with id ${id}.`);
    ctx.db.prepare('DELETE FROM diet_rules WHERE id = ?').run(id);
    cs.record({
      entity: 'diet',
      entity_id: id,
      action: 'deleted',
      summary: `Removed a ${r.diet} rule.`,
      data: { name: r.diet },
    });
    return r;
  });
}

export interface DietResult {
  ingredients: RecipeIngredient[];
  steps: Step[];
  replaced: { diet: string; line: string; with: string; note: string | null }[];
  /** Why the drink does not work for a diet at all (excluded ingredient that is required). */
  blocked: { diet: string; line: string; note: string | null }[];
}

const lineWords = (l: RecipeIngredient) =>
  new Set([
    ...words(l.name),
    ...words(l.subcategory),
    ...(l.tags ?? []).flatMap(words),
    ...words(l.category?.replace(/_/g, ' ')),
  ]);

/** Adapts a recipe to guest diets; "alcohol free" blocks every drink with alcohol. */
export function applyDiets(
  r: { ingredients: RecipeIngredient[]; steps: Step[] },
  diets: string[],
  rules: DietRule[],
  alcoholFree?: boolean,
): DietResult {
  const wanted = new Set(diets.map((d) => d.toLowerCase()));
  const active = rules.filter((x) => wanted.has(x.diet.toLowerCase()));
  const replaced: DietResult['replaced'] = [];
  const blocked: DietResult['blocked'] = [];
  const renames = new Map<string, string>();
  const ingredients: RecipeIngredient[] = [];
  for (const l of r.ingredients) {
    const lw = lineWords(l);
    const rule = active.find((x) => {
      const w = words(x.match_words);
      return w.length > 0 && w.every((y) => lw.has(y));
    });
    if (!rule) {
      ingredients.push(l);
      continue;
    }
    if (rule.action === 'exclude') {
      if (!l.optional && !l.garnish)
        blocked.push({ diet: rule.diet, line: l.name, note: rule.note });
      continue;
    }
    const name = rule.replacement!.replace(/^\w/, (c) => c.toUpperCase());
    renames.set(l.name, name);
    replaced.push({ diet: rule.diet, line: l.name, with: name, note: rule.note });
    ingredients.push({
      ...l,
      name,
      ingredient_id: undefined,
      category: undefined,
      subcategory: rule.replacement!,
      tags: undefined,
      exact: false,
      exclude: undefined,
      ...(l.amount !== undefined && { amount: Math.round(l.amount * rule.ratio * 100) / 100 }),
    });
  }
  if (wanted.has('alcohol free') && alcoholFree === false) {
    blocked.push({ diet: 'alcohol free', line: 'alcohol', note: null });
  }
  const steps = r.steps
    .filter(
      (s) =>
        !s.ingredient ||
        ingredients.some((l) => l.name === s.ingredient) ||
        renames.has(s.ingredient),
    )
    .map((s) =>
      s.ingredient && renames.has(s.ingredient)
        ? { ...s, ingredient: renames.get(s.ingredient) }
        : s,
    );
  return { ingredients, steps, replaced, blocked };
}
