import { z } from 'zod';
import { getCategoryDefaults } from '../db/repos/catalog.js';
import { getIngredient, type Ingredient } from '../db/repos/ingredients.js';
import { insertRow, parseJson } from '../db/sql.js';
import { mutate, nowIso, ShakyError, type Ctx } from './context.js';
import { deductCount, deductVolume, isCountUnit, levelFromFraction, toMl } from './fillLevel.js';
import { addIngredientIn, listIngredientViews, writeStock } from './inventory.js';
import { matchesSpec } from './matching.js';
import { hexColorSchema, recipeIngredientSchema, UNITS, type Unit } from './schemas.js';

// Homemade ingredients: "make simple syrup" turns sugar from stock into a
// bottle of syrup with its own shelf life.

const inputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  match: z
    .string()
    .trim()
    .max(60)
    .optional()
    .describe('Words to find it in stock, default the name.'),
  amount: z.number().positive(),
  unit: z.enum(UNITS).default('ml'),
  from_stock: z.boolean().default(true).describe('false for tap water and the like.'),
});

const outputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.string().default('syrup'),
  subcategory: z.string().optional(),
  tags: z.array(z.string()).optional(),
  ml: z.number().positive().describe('Volume one batch yields.'),
  shelf_life_days: z.number().int().positive().max(3650).optional(),
  location: z.string().optional(),
  container: z.string().optional(),
  color: hexColorSchema.optional(),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  inputs: z.array(inputSchema).min(1).max(10),
  output: outputSchema,
  notes: z.string().max(1000).nullish(),
});

export type Template = z.output<typeof templateSchema> & { id: number };

export function listTemplates(ctx: Ctx): Template[] {
  return (
    ctx.db.prepare('SELECT * FROM prep_templates ORDER BY name').all() as {
      id: number;
      name: string;
      inputs: string;
      output: string;
      notes: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    notes: r.notes,
    inputs: z.array(inputSchema).parse(parseJson(r.inputs, [])),
    output: outputSchema.parse(parseJson(r.output, {})),
  }));
}

export function saveTemplate(ctx: Ctx, input: z.input<typeof templateSchema>) {
  const t = templateSchema.parse(input);
  return mutate(ctx, (cs) => {
    ctx.db.prepare('DELETE FROM prep_templates WHERE name = ? COLLATE NOCASE').run(t.name);
    const id = insertRow(ctx.db, 'prep_templates', { ...t, created_at: nowIso(ctx) });
    cs.record({
      entity: 'prep',
      entity_id: id,
      action: 'updated',
      summary: `Saved preparation ${t.name}.`,
      data: { name: t.name },
    });
    return listTemplates(ctx).find((x) => x.id === id)!;
  });
}

export const makeSchema = z.object({
  template: z.union([z.number().int().positive(), z.string().trim().min(1)]).optional(),
  custom: templateSchema.optional().describe('A one-off preparation instead of a saved template.'),
  batches: z.number().positive().max(20).optional().describe('How many batches, default 1.'),
  output_ml: z.number().positive().max(20000).optional().describe('Or: how much to end up with.'),
});

/**
 * Makes a preparation: takes the inputs out of stock and adds (or refills)
 * the output with today as its opening date, so its shelf life starts now.
 */
export function makePreparation(ctx: Ctx, input: z.input<typeof makeSchema>) {
  const p = makeSchema.parse(input);
  const t =
    p.custom ??
    listTemplates(ctx).find((x) =>
      typeof p.template === 'number'
        ? x.id === p.template
        : x.name.toLowerCase() === String(p.template ?? '').toLowerCase(),
    );
  if (!t) {
    throw new ShakyError(
      'not_found',
      `No preparation "${p.template ?? ''}". Known: ${listTemplates(ctx)
        .map((x) => x.name)
        .join(', ')}.`,
    );
  }
  const scale = p.output_ml ? p.output_ml / t.output.ml : (p.batches ?? 1);
  return mutate(ctx, (cs) => {
    const stock = listIngredientViews(ctx).filter((i) => i.available);
    const used: { name: string; from: string; amount: number; unit: string }[] = [];
    const missing: string[] = [];
    for (const inp of t.inputs) {
      if (!inp.from_stock) continue;
      const spec = recipeIngredientSchema.parse({
        name: inp.name,
        subcategory: inp.match ?? inp.name,
      });
      // Never use the output as its own input, and prefer an exact name match.
      const want = (inp.match ?? inp.name).toLowerCase();
      const candidates = stock.filter(
        (i) => matchesSpec(spec, i) && i.name.toLowerCase() !== t.output.name.toLowerCase(),
      );
      const hit = candidates.find((i) => i.name.toLowerCase() === want) ?? candidates[0];
      if (!hit) {
        missing.push(inp.name);
        continue;
      }
      const amount = Math.round(inp.amount * scale * 100) / 100;
      const cur = getIngredient(ctx.db, hit.id)!;
      const state = {
        fill_level: cur.fill_level,
        amount_ml: cur.amount_ml,
        amount_is_estimate: cur.amount_is_estimate,
        bottle_size_ml: cur.bottle_size_ml,
        quantity: cur.quantity,
        opened_at: cur.opened_at,
      };
      const ml = toMl(amount, inp.unit as Unit);
      const res =
        ml !== null
          ? deductVolume(
              state,
              ml,
              getCategoryDefaults(ctx.db, cur.category)?.bottle_size_ml ?? null,
              nowIso(ctx),
            )
          : isCountUnit(inp.unit as Unit)
            ? deductCount(state, amount)
            : { next: state, openedNext: false, skipped: 'unit not tracked' };
      if (!res.skipped) writeStock(ctx, cs, cur, { ...res.next }, 'used');
      used.push({ name: inp.name, from: cur.name, amount, unit: inp.unit });
    }
    if (missing.length) {
      throw new ShakyError('invalid', `Not in stock for ${t.name}: ${missing.join(', ')}.`);
    }
    const ml = Math.round(t.output.ml * scale);
    const existing = listIngredientViews(ctx, { include_empty: true }).find(
      (i) => i.name.toLowerCase() === t.output.name.toLowerCase(),
    );
    let out: Ingredient;
    if (existing) {
      // Refill: what is left plus the fresh batch, and the clock starts again.
      const left = existing.fill_level === 'empty' ? 0 : (existing.stock_ml ?? 0);
      const total = left + ml;
      const size = Math.max(existing.bottle_size_ml ?? 0, total);
      writeStock(
        ctx,
        cs,
        getIngredient(ctx.db, existing.id)!,
        {
          amount_ml: total,
          amount_is_estimate: false,
          bottle_size_ml: size,
          fill_level: levelFromFraction(total / size),
          quantity: Math.max(1, existing.quantity),
          opened_at: nowIso(ctx),
          ...(t.output.shelf_life_days && { shelf_life_days: t.output.shelf_life_days }),
        },
        'prepared',
      );
      out = getIngredient(ctx.db, existing.id)!;
    } else {
      const v = addIngredientIn(ctx, cs, {
        name: t.output.name,
        category: t.output.category,
        subcategory: t.output.subcategory,
        tags: t.output.tags,
        amount_ml: ml,
        bottle_size_ml: ml,
        opened_at: nowIso(ctx),
        shelf_life_days: t.output.shelf_life_days,
        location: t.output.location,
        container: t.output.container as never,
        color: t.output.color,
      });
      out = getIngredient(ctx.db, v.id)!;
    }
    cs.record({
      entity: 'prep',
      entity_id: out.id,
      action: 'made',
      summary: `Made ${ml} ml ${t.name}${used.length ? ` from ${used.map((u) => `${u.amount} ${u.unit} ${u.from}`).join(', ')}` : ''}.`,
      data: { name: out.name, ml },
    });
    return {
      template: t.name,
      made_ml: ml,
      ingredient: { id: out.id, name: out.name },
      used,
      notes: t.notes ?? null,
    };
  });
}
