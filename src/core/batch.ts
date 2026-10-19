import { z } from 'zod';
import { listEquipment } from '../db/repos/catalog.js';
import { getSetting } from '../db/repos/misc.js';
import { ShakyError, type Ctx } from './context.js';
import { getRecipeWithCheck } from './recipes.js';

// Batch calculator, e.g. for a slush machine: scale a recipe to N glasses,
// check the machine's fill range and whether it is too strong to freeze.

const ML: Record<string, number> = {
  ml: 1,
  cl: 10,
  oz: 29.5735,
  dash: 0.9,
  barspoon: 5,
  tsp: 5,
  tbsp: 15,
};

export const batchSchema = z.object({
  recipe: z.union([z.number().int().positive(), z.string().trim().min(1)]),
  glasses: z.number().int().positive().max(500).optional(),
  target_ml: z.number().positive().max(100000).optional(),
  serving_ml: z
    .number()
    .positive()
    .max(2000)
    .optional()
    .describe('Volume per glass; default the recipe volume.'),
  machine: z
    .union([z.number().int().positive(), z.string()])
    .optional()
    .describe('Equipment id or name; default the first slush machine.'),
});

export function batchCalculator(ctx: Ctx, input: z.input<typeof batchSchema>) {
  const p = batchSchema.parse(input);
  const r = getRecipeWithCheck(ctx, p.recipe);
  const lines = r.personal.ingredients.filter((l) => !l.garnish);
  const volumeLines = lines.filter((l) => l.amount !== undefined && ML[l.unit] !== undefined);
  const base = volumeLines.reduce((s, l) => s + l.amount! * ML[l.unit]!, 0);
  if (base <= 0) throw new ShakyError('invalid', `${r.name} has no measurable liquid amounts.`);
  const serving = p.serving_ml ?? base;

  const machines = listEquipment(ctx.db).filter((e) => e.type === 'slush_machine' && e.available);
  const machine =
    p.machine !== undefined
      ? listEquipment(ctx.db).find((e) =>
          typeof p.machine === 'number'
            ? e.id === p.machine
            : e.name.toLowerCase() === String(p.machine).toLowerCase(),
        )
      : machines[0];
  const min = machine?.specs.min_ml;
  const max = machine?.specs.max_ml;

  const total = p.target_ml ?? (p.glasses ?? (min ? Math.ceil(min / serving) : 1)) * serving;
  const factor = total / base;

  // Strength of the batch itself: no melt water in a slush machine.
  const perUnitAlcohol =
    r.strength.volume_ml > 0 ? (r.strength.abv / 100) * r.strength.volume_ml : 0;
  const batchAbv = Math.round(((perUnitAlcohol * factor) / total) * 1000) / 10;
  const maxAbv = getSetting<number>(ctx.db, 'slush_max_abv', 8);

  const warnings: string[] = [];
  if (min && total < min)
    warnings.push(
      `Below the machine minimum of ${min} ml: make at least ${Math.ceil(min / serving)} glasses.`,
    );
  if (max && total > max)
    warnings.push(
      `Above the machine maximum of ${max} ml: at most ${Math.floor(max / serving)} glasses per batch.`,
    );
  let topUpMl: number | null = null;
  if (batchAbv > maxAbv) {
    topUpMl = Math.ceil((perUnitAlcohol * factor) / (maxAbv / 100) - total);
    warnings.push(
      `About ${batchAbv} % alcohol is too strong to freeze well (keep it under ${maxAbv} %). Add about ${topUpMl} ml of the non-alcoholic parts (juice, syrup, water) or less spirit.`,
    );
  }
  if (r.strength.energy)
    warnings.push('Contains an energy drink: caffeine hides how much alcohol you have had.');

  const round = (x: number) => Math.round(x);
  return {
    recipe: r.name,
    glasses: Math.round((total / serving) * 10) / 10,
    serving_ml: round(serving),
    total_ml: round(total),
    abv: batchAbv,
    ...(machine && { machine: { name: machine.name, min_ml: min ?? null, max_ml: max ?? null } }),
    amounts: lines.map((l) => {
      if (l.amount === undefined) return { name: l.name, amount: null, unit: l.unit };
      const per = ML[l.unit];
      return per !== undefined
        ? {
            name: l.name,
            ml: round(l.amount * per * factor),
            cl: Math.round(l.amount * per * factor) / 10,
          }
        : { name: l.name, amount: Math.round(l.amount * factor * 10) / 10, unit: l.unit };
    }),
    warnings,
    top_up_ml: topUpMl,
    /** The same warnings as data, for translated UIs. */
    flags: {
      ...(min && total < min && { min_glasses: Math.ceil(min / serving), min_ml: min }),
      ...(max && total > max && { max_glasses: Math.floor(max / serving), max_ml: max }),
      ...(batchAbv > maxAbv && { too_strong: { max_abv: maxAbv, top_up_ml: topUpMl } }),
      ...(r.strength.energy && { energy: true }),
    },
  };
}
