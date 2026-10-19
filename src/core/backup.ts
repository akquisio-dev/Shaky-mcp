import {
  listCategoryDefaults,
  listEquipment,
  listGlassware,
  listLocations,
} from '../db/repos/catalog.js';
import { listIngredients } from '../db/repos/ingredients.js';
import { listShopping } from '../db/repos/misc.js';
import { listRecipes } from '../db/repos/recipes.js';
import { VERSION } from '../version.js';
import type { Ctx } from './context.js';
import { seed, seedFileSchema, type SeedFile } from './seed.js';

const strip = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<T>;

/**
 * The whole bar as a portable JSON document. Same format as the seed file,
 * so `shaky import` and `shaky seed --file` read it alike. Mix log and
 * activity history are not included.
 */
export function exportBar(ctx: Ctx) {
  const doc = {
    shaky_export: 1,
    version: VERSION,
    exported_at: ctx.now().toISOString(),
    locations: listLocations(ctx.db).map((l) => ({
      key: l.key,
      label_en: l.label_en,
      label_de: l.label_de,
      sort: l.sort,
    })),
    category_defaults: listCategoryDefaults(ctx.db),
    ingredients: listIngredients(ctx.db, { includeArchived: true }).map((i) =>
      strip({
        name: i.name,
        brand: i.brand,
        category: i.category,
        subcategory: i.subcategory,
        tags: i.tags.length ? i.tags : null,
        abv: i.abv,
        color: i.color,
        flavor_notes: i.flavor_notes,
        location: i.location,
        fill_level: i.fill_level,
        amount_ml: i.amount_is_estimate ? null : i.amount_ml,
        bottle_size_ml: i.bottle_size_ml,
        yield_ml: i.yield_ml,
        opened_at: i.opened_at,
        shelf_life_days: i.shelf_life_days,
        expires_at: i.expires_at,
        quantity: i.quantity,
        notes: i.notes,
        archived: i.archived || null,
      }),
    ),
    equipment: listEquipment(ctx.db).map((e) =>
      strip({
        name: e.name,
        type: e.type,
        available: e.available,
        substitutes_for: e.substitutes_for.length ? e.substitutes_for : null,
        notes: e.notes,
      }),
    ),
    glassware: listGlassware(ctx.db).map((g) =>
      strip({ name: g.name, type: g.type, count: g.count, notes: g.notes }),
    ),
    recipes: listRecipes(ctx.db).map((r) =>
      strip({
        name: r.name,
        description: r.description,
        tags: r.tags,
        glass: r.glass,
        method: r.method,
        source: r.source,
        favorite: r.favorite || null,
        rating: r.rating,
        notes: r.notes,
        color: r.color,
        ingredients: r.ingredients,
        steps: r.steps,
      }),
    ),
    shopping_list: listShopping(ctx.db).map((s) =>
      strip({ name: s.name, quantity: s.quantity, reason: s.reason, priority: s.priority }),
    ),
  };
  return doc;
}

/** Validates first, then merges (keeps existing names) or replaces the bar. */
export function importBar(ctx: Ctx, doc: unknown, mode: 'merge' | 'replace' = 'merge') {
  const data = seedFileSchema.parse(doc) as SeedFile;
  return seed(ctx, data, { reset: mode === 'replace' });
}
