import { mutate, type Ctx } from './context.js';
import { readSeedFile } from './seed.js';

const TABLES = ['ingredients', 'equipment', 'glassware', 'recipes', 'shopping_list'] as const;

/**
 * Example rows: marked with origin 'example', or (bars seeded before 1.1)
 * carrying a name from the example file and never changed since.
 */
function exampleIds(ctx: Ctx): Record<(typeof TABLES)[number], number[]> {
  const file = readSeedFile();
  const names: Record<(typeof TABLES)[number], string[]> = {
    ingredients: (file.ingredients ?? []).map((x) => x.name),
    equipment: (file.equipment ?? []).map((x) => x.name),
    glassware: (file.glassware ?? []).map((x) => x.name),
    recipes: (file.recipes ?? []).map((x) => x.name),
    shopping_list: (file.shopping_list ?? []).map((x) => x.name),
  };
  const out = {} as Record<(typeof TABLES)[number], number[]>;
  for (const t of TABLES) {
    const list = names[t];
    const placeholders = list.map(() => '?').join(', ') || "''";
    out[t] = (
      ctx.db
        .prepare(
          `SELECT id FROM ${t} WHERE origin = 'example'
             OR (origin IS NULL AND created_at = updated_at AND name COLLATE NOCASE IN (${placeholders}))`,
        )
        .all(...list) as { id: number }[]
    ).map((r) => r.id);
  }
  return out;
}

export function countExampleData(ctx: Ctx): number {
  return Object.values(exampleIds(ctx)).reduce((s, ids) => s + ids.length, 0);
}

/** Removes the example bar. Anything you added or changed yourself stays. */
export function removeExampleData(ctx: Ctx) {
  return mutate(ctx, (cs) => {
    const ids = exampleIds(ctx);
    const removed: Record<string, number> = {};
    for (const t of TABLES) {
      const list = ids[t];
      if (!list.length) {
        removed[t] = 0;
        continue;
      }
      ctx.db
        .prepare(`DELETE FROM ${t} WHERE id IN (${list.map(() => '?').join(', ')})`)
        .run(...list);
      removed[t] = list.length;
    }
    const total = Object.values(removed).reduce((a, b) => a + b, 0);
    if (total) {
      cs.record({
        entity: 'bar',
        entity_id: null,
        action: 'examples_removed',
        summary: `Removed the example data: ${Object.entries(removed)
          .map(([k, v]) => `${v} ${k.replace('_', ' ')}`)
          .join(', ')}.`,
        data: {
          ingredients: removed.ingredients,
          recipes: removed.recipes,
          equipment: removed.equipment,
          glassware: removed.glassware,
        },
      });
    }
    return { removed, total };
  });
}
