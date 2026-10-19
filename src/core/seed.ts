import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { insertEquipment, insertGlass } from '../db/repos/catalog.js';
import { findIngredientsByName, insertIngredient } from '../db/repos/ingredients.js';
import { findRecipeByName, insertRecipe } from '../db/repos/recipes.js';
import { findOpenShoppingByName, insertShopping } from '../db/repos/misc.js';
import { findEquipmentByName, findGlassByName, getCategoryDefaults } from '../db/repos/catalog.js';
import { mutate, nowIso, type Ctx } from './context.js';
import {
  equipmentInputSchema,
  glassInputSchema,
  ingredientInputSchema,
  recipeInputSchema,
  shoppingInputSchema,
} from './schemas.js';

const DAY = 86_400_000;

export const seedFileSchema = z.object({
  ingredients: z
    .array(ingredientInputSchema.extend({ opened_days_ago: z.number().int().min(0).optional() }))
    .default([]),
  equipment: z.array(equipmentInputSchema).default([]),
  glassware: z.array(glassInputSchema).default([]),
  recipes: z.array(recipeInputSchema).default([]),
  shopping_list: z.array(shoppingInputSchema).default([]),
});
export type SeedFile = z.input<typeof seedFileSchema>;

export const DEFAULT_SEED_FILE = new URL('../../examples/seed.json', import.meta.url);

export function readSeedFile(path: string | URL = DEFAULT_SEED_FILE): SeedFile {
  return JSON.parse(readFileSync(path, 'utf8')) as SeedFile;
}

const DATA_TABLES = [
  'mix_log',
  'shopping_list',
  'recipes',
  'ingredients',
  'equipment',
  'glassware',
];

/**
 * Loads example data. Existing items (same name) are left alone, so running
 * it twice is harmless. With reset, all bar data is wiped first.
 */
export function seed(ctx: Ctx, file: SeedFile, opts: { reset?: boolean } = {}) {
  const data = seedFileSchema.parse(file);
  return mutate(ctx, (cs) => {
    if (opts.reset) for (const t of DATA_TABLES) ctx.db.prepare(`DELETE FROM ${t}`).run();
    const ts = nowIso(ctx);
    const now = ctx.now().getTime();
    const added = { ingredients: 0, equipment: 0, glassware: 0, recipes: 0, shopping_list: 0 };

    for (const { opened_days_ago, ...i } of data.ingredients) {
      if (findIngredientsByName(ctx.db, i.name).length) continue;
      const d = getCategoryDefaults(ctx.db, i.category);
      insertIngredient(ctx.db, {
        ...i,
        tags: i.tags ?? [],
        location: i.location ?? d?.default_location ?? 'shelf',
        fill_level: i.fill_level ?? 'full',
        quantity: i.quantity ?? 1,
        opened_at:
          opened_days_ago !== undefined
            ? new Date(now - opened_days_ago * DAY).toISOString()
            : null,
        created_at: ts,
        updated_at: ts,
      });
      added.ingredients++;
    }
    for (const e of data.equipment) {
      if (findEquipmentByName(ctx.db, e.name)) continue;
      insertEquipment(ctx.db, {
        ...e,
        available: e.available ?? true,
        substitutes_for: e.substitutes_for ?? [],
        created_at: ts,
        updated_at: ts,
      });
      added.equipment++;
    }
    for (const g of data.glassware) {
      if (findGlassByName(ctx.db, g.name)) continue;
      insertGlass(ctx.db, { ...g, count: g.count ?? 1, created_at: ts, updated_at: ts });
      added.glassware++;
    }
    for (const r of data.recipes) {
      if (findRecipeByName(ctx.db, r.name)) continue;
      insertRecipe(ctx.db, {
        ...r,
        tags: r.tags ?? [],
        source: r.source ?? 'user',
        created_at: ts,
        updated_at: ts,
      });
      added.recipes++;
    }
    for (const s of data.shopping_list) {
      if (findOpenShoppingByName(ctx.db, s.name)) continue;
      insertShopping(ctx.db, {
        ...s,
        priority: s.priority ?? 'normal',
        done: false,
        created_at: ts,
        updated_at: ts,
      });
      added.shopping_list++;
    }
    cs.record({
      entity: 'bar',
      entity_id: null,
      action: opts.reset ? 'reset' : 'seeded',
      summary: `${opts.reset ? 'Reset the bar and loaded' : 'Loaded'} example data: ${Object.entries(
        added,
      )
        .map(([k, v]) => `${v} ${k.replace('_', ' ')}`)
        .join(', ')}.`,
      data: added,
    });
    return added;
  });
}
