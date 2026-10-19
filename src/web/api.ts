import { Hono, type Context } from 'hono';
import { z, ZodError } from 'zod';
import type { Db } from '../db/connection.js';
import { getAllSettings, listActivity, listShopping, setSetting } from '../db/repos/misc.js';
import { listMixLog } from '../db/repos/recipes.js';
import {
  equipmentUpsertSchema,
  glassUpsertSchema,
  listCategoryDefaults,
  listEquipment,
  listGlassware,
  listLocations,
  setCategoryDefaults,
  setEquipment,
  setGlassware,
  setLocation,
} from '../core/catalog.js';
import { createCtx, ShakyError } from '../core/context.js';
import {
  addIngredient,
  archiveIngredient,
  getExpiring,
  getIngredientView,
  listIngredientViews,
  markOpened,
  setFillLevel,
  updateIngredientFields,
} from '../core/inventory.js';
import { logMix } from '../core/mixing.js';
import { barOverview } from '../core/overview.js';
import {
  deleteRecipe,
  findMakeable,
  getRecipeWithCheck,
  listRecipesWithCheck,
  saveRecipe,
  setRecipeFlags,
} from '../core/recipes.js';
import {
  CATEGORIES,
  EQUIPMENT_TYPES,
  FILL_LEVELS,
  fillLevelSchema,
  GLASS_TYPES,
  PRIORITIES,
  STEP_ACTIONS,
  UNITS,
} from '../core/schemas.js';
import { addShopping, updateShoppingItem } from '../core/shopping.js';
import { VERSION } from '../version.js';

const STATUS = { not_found: 404, invalid: 400, ambiguous: 409, conflict: 409 } as const;

const bool = (v: string | undefined) => (v === undefined ? undefined : v === 'true' || v === '1');
const id = (c: Context) => {
  const n = Number(c.req.param('id'));
  if (!Number.isInteger(n) || n <= 0) throw new ShakyError('invalid', 'Bad id.');
  return n;
};
async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const b: unknown = await c.req.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const settingsSchema = z
  .object({
    language: z.enum(['auto', 'en', 'de']),
    units: z.enum(['cl', 'oz']),
    web_autostart: z.boolean(),
    expiry_warning_days: z.number().int().min(0).max(60),
    theme: z.enum(['auto', 'light', 'dark']),
  })
  .partial();

/** REST API. Every write goes through core/ with source "web". */
export function createApi(db: Db, opts: { onWrite?: () => void } = {}): Hono {
  const ctx = createCtx(db, 'web');
  const api = new Hono();
  const done = <T>(r: { result: T; changes: unknown[] }) => {
    opts.onWrite?.();
    return r;
  };

  api.onError((err, c) => {
    if (err instanceof ShakyError)
      return c.json({ error: err.code, message: err.message }, STATUS[err.code]);
    if (err instanceof ZodError) {
      return c.json(
        {
          error: 'invalid',
          message: err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
          issues: err.issues,
        },
        400,
      );
    }
    console.error(err);
    return c.json({ error: 'internal', message: 'Internal error' }, 500);
  });

  api.get('/health', (c) => c.json({ ok: true, name: 'shaky', version: VERSION }));

  api.get('/meta', (c) =>
    c.json({
      version: VERSION,
      categories: listCategoryDefaults(db),
      suggested_categories: CATEGORIES,
      locations: listLocations(db),
      fill_levels: FILL_LEVELS,
      units: UNITS,
      step_actions: STEP_ACTIONS,
      equipment_types: EQUIPMENT_TYPES,
      glass_types: GLASS_TYPES,
      priorities: PRIORITIES,
      settings: getAllSettings(db),
    }),
  );

  api.get('/overview', (c) => c.json(barOverview(ctx)));

  // ingredients
  api.get('/ingredients', (c) =>
    c.json(
      listIngredientViews(ctx, {
        category: c.req.query('category'),
        location: c.req.query('location'),
        tag: c.req.query('tag'),
        search: c.req.query('search'),
        include_empty: bool(c.req.query('include_empty')) ?? true,
        include_archived: bool(c.req.query('include_archived')),
      }),
    ),
  );
  api.post('/ingredients', async (c) =>
    c.json(done(addIngredient(ctx, (await body(c)) as never)), 201),
  );
  api.get('/ingredients/:id', (c) => c.json(getIngredientView(ctx, id(c))));
  api.patch('/ingredients/:id', async (c) =>
    c.json(done(updateIngredientFields(ctx, id(c), (await body(c)) as never))),
  );
  api.post('/ingredients/:id/fill-level', async (c) => {
    const b = z
      .object({ fill_level: fillLevelSchema, amount_ml: z.number().min(0).nullish() })
      .parse(await body(c));
    return c.json(done(setFillLevel(ctx, id(c), b.fill_level, b.amount_ml)));
  });
  api.post('/ingredients/:id/open', async (c) => {
    const b = z.object({ date: z.string().optional() }).parse(await body(c));
    return c.json(done(markOpened(ctx, id(c), b.date)));
  });
  api.post('/ingredients/:id/archive', async (c) => {
    const b = z.object({ restore: z.boolean().optional() }).parse(await body(c));
    return c.json(done(archiveIngredient(ctx, id(c), !b.restore)));
  });
  api.get('/expiring', (c) => c.json(getExpiring(ctx, Number(c.req.query('days') ?? 7))));

  // equipment & glassware
  api.get('/equipment', (c) => c.json(listEquipment(db)));
  api.post('/equipment', async (c) =>
    c.json(done(setEquipment(ctx, equipmentUpsertSchema.parse(await body(c))))),
  );
  api.delete('/equipment/:id', (c) => c.json(done(setEquipment(ctx, { id: id(c), remove: true }))));
  api.get('/glassware', (c) => c.json(listGlassware(db)));
  api.post('/glassware', async (c) =>
    c.json(done(setGlassware(ctx, glassUpsertSchema.parse(await body(c))))),
  );
  api.delete('/glassware/:id', (c) => c.json(done(setGlassware(ctx, { id: id(c), remove: true }))));
  api.post('/locations', async (c) => c.json(done(setLocation(ctx, (await body(c)) as never))));
  api.post('/categories', async (c) =>
    c.json(done(setCategoryDefaults(ctx, (await body(c)) as never))),
  );

  // recipes
  api.get('/recipes', (c) =>
    c.json(
      listRecipesWithCheck(ctx, {
        tag: c.req.query('tag'),
        search: c.req.query('search'),
        favorite: bool(c.req.query('favorite')),
        status: c.req.query('status') as never,
      }),
    ),
  );
  api.get('/recipes/:id', (c) => c.json(getRecipeWithCheck(ctx, id(c))));
  api.post('/recipes', async (c) => c.json(done(saveRecipe(ctx, (await body(c)) as never)), 201));
  api.put('/recipes/:id', async (c) =>
    c.json(done(saveRecipe(ctx, { ...(await body(c)), id: id(c) } as never))),
  );
  api.patch('/recipes/:id', async (c) => {
    const b = z
      .object({
        favorite: z.boolean().optional(),
        rating: z.number().int().min(1).max(5).nullish(),
        notes: z.string().max(2000).nullish(),
      })
      .parse(await body(c));
    return c.json(done(setRecipeFlags(ctx, id(c), b)));
  });
  api.delete('/recipes/:id', (c) => c.json(done(deleteRecipe(ctx, id(c)))));
  api.get('/makeable', (c) => c.json(findMakeable(ctx, { include_missing_more: true })));

  // mixing
  api.get('/mix', (c) => c.json(listMixLog(db, Number(c.req.query('limit') ?? 50))));
  api.post('/mix', async (c) => {
    const b = z
      .object({
        recipe: z.union([z.number(), z.string()]).optional(),
        name: z.string().optional(),
        servings: z.number().positive().max(20).optional(),
        rating: z.number().int().min(1).max(5).optional(),
        notes: z.string().max(1000).optional(),
        deduct: z.boolean().optional(),
      })
      .parse(await body(c));
    return c.json(done(logMix(ctx, b)), 201);
  });

  // shopping list
  api.get('/shopping', (c) =>
    c.json(listShopping(db, { includeDone: bool(c.req.query('include_done')) })),
  );
  api.post('/shopping', async (c) => c.json(done(addShopping(ctx, (await body(c)) as never)), 201));
  api.patch('/shopping/:id', async (c) =>
    c.json(done(updateShoppingItem(ctx, id(c), (await body(c)) as never))),
  );
  api.delete('/shopping/:id', (c) =>
    c.json(done(updateShoppingItem(ctx, id(c), { remove: true }))),
  );

  // activity & settings
  api.get('/activity', (c) =>
    c.json(listActivity(db, { limit: Number(c.req.query('limit') ?? 50) })),
  );
  api.get('/settings', (c) => c.json(getAllSettings(db)));
  api.patch('/settings', async (c) => {
    const b = settingsSchema.parse(await body(c));
    db.transaction(() => {
      for (const [k, v] of Object.entries(b)) if (v !== undefined) setSetting(db, k, v);
    })();
    return c.json(getAllSettings(db));
  });

  return api;
}
