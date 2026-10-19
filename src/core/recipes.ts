import { listEquipment } from '../db/repos/catalog.js';
import {
  deleteRecipe as deleteRow,
  findRecipeByName,
  getRecipe,
  insertRecipe,
  listRecipes,
  updateRecipe,
  type Recipe,
} from '../db/repos/recipes.js';
import { mutate, nowIso, ShakyError, type Ctx } from './context.js';
import { listIngredientViews } from './inventory.js';
import { checkRecipe, type RecipeCheck } from './matching.js';
import { recipeInputSchema, type RecipeInput } from './schemas.js';

export function resolveRecipe(ctx: Ctx, ref: number | string): Recipe {
  if (typeof ref === 'number' || /^\d+$/.test(ref)) {
    const r = getRecipe(ctx.db, Number(ref));
    if (!r) throw new ShakyError('not_found', `No recipe with id ${ref}.`);
    return r;
  }
  const r = findRecipeByName(ctx.db, ref);
  if (!r) {
    const q = ref.toLowerCase();
    const near = listRecipes(ctx.db)
      .filter((x) => x.name.toLowerCase().includes(q))
      .slice(0, 5);
    const hint = near.length ? ` Did you mean: ${near.map((x) => x.name).join(', ')}?` : '';
    throw new ShakyError('not_found', `No recipe named "${ref}".${hint}`);
  }
  return r;
}

export interface RecipeFilter {
  tag?: string;
  search?: string;
  favorite?: boolean;
  status?: RecipeCheck['status'];
}

export interface RecipeWithCheck extends Recipe {
  availability: RecipeCheck;
}

function checker(ctx: Ctx) {
  const stock = listIngredientViews(ctx, { include_empty: true });
  const equipment = listEquipment(ctx.db);
  return (r: Recipe) => checkRecipe(r, stock, equipment);
}

export function listRecipesWithCheck(ctx: Ctx, f: RecipeFilter = {}): RecipeWithCheck[] {
  const check = checker(ctx);
  const q = f.search?.trim().toLowerCase();
  return listRecipes(ctx.db)
    .map((r) => ({ ...r, availability: check(r) }))
    .filter((r) => {
      if (f.tag && !r.tags.includes(f.tag.toLowerCase())) return false;
      if (f.favorite !== undefined && r.favorite !== f.favorite) return false;
      if (f.status && r.availability.status !== f.status) return false;
      if (q) {
        const hay = [r.name, r.description, ...r.tags, ...r.ingredients.map((i) => i.name)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
}

export function getRecipeWithCheck(ctx: Ctx, ref: number | string): RecipeWithCheck {
  const r = resolveRecipe(ctx, ref);
  return { ...r, availability: checker(ctx)(r) };
}

export function findMakeable(
  ctx: Ctx,
  opts: { tag?: string; include_missing_more?: boolean } = {},
) {
  const all = listRecipesWithCheck(ctx, { tag: opts.tag }).map((r) => r.availability);
  return {
    makeable: all.filter((c) => c.status === 'makeable'),
    missing_one: all.filter((c) => c.status === 'missing_one'),
    ...(opts.include_missing_more
      ? { missing_more: all.filter((c) => c.status === 'missing_more') }
      : { missing_more_count: all.filter((c) => c.status === 'missing_more').length }),
  };
}

/** Creates a recipe, or replaces the one with the same id / name. */
export function saveRecipe(ctx: Ctx, input: RecipeInput & { id?: number }) {
  const data = recipeInputSchema.parse(input);
  return mutate(ctx, (cs) => {
    const existing =
      input.id !== undefined ? resolveRecipe(ctx, input.id) : findRecipeByName(ctx.db, data.name);
    const ts = nowIso(ctx);
    const row = {
      ...data,
      source: data.source ?? (ctx.source === 'mcp' ? 'ai' : 'user'),
      tags: data.tags ?? [],
    };
    let id: number;
    if (existing) {
      const clash = findRecipeByName(ctx.db, data.name);
      if (clash && clash.id !== existing.id) {
        throw new ShakyError('conflict', `Another recipe is already called "${data.name}".`);
      }
      updateRecipe(ctx.db, existing.id, { ...row, updated_at: ts });
      id = existing.id;
    } else {
      id = insertRecipe(ctx.db, { ...row, created_at: ts, updated_at: ts });
    }
    cs.record({
      entity: 'recipe',
      entity_id: id,
      action: existing ? 'updated' : 'created',
      summary: `${existing ? 'Updated' : 'Saved'} recipe ${data.name}.`,
      data: { name: data.name },
    });
    return getRecipeWithCheck(ctx, id);
  });
}

export function setRecipeFlags(
  ctx: Ctx,
  ref: number | string,
  flags: { favorite?: boolean; rating?: number | null; notes?: string | null },
) {
  return mutate(ctx, (cs) => {
    const r = resolveRecipe(ctx, ref);
    updateRecipe(ctx.db, r.id, { ...flags, updated_at: nowIso(ctx) });
    cs.record({
      entity: 'recipe',
      entity_id: r.id,
      action: 'updated',
      summary: `Updated recipe ${r.name}.`,
      data: { name: r.name, ...flags },
    });
    return getRecipeWithCheck(ctx, r.id);
  });
}

export function deleteRecipe(ctx: Ctx, ref: number | string) {
  return mutate(ctx, (cs) => {
    const r = resolveRecipe(ctx, ref);
    deleteRow(ctx.db, r.id);
    cs.record({
      entity: 'recipe',
      entity_id: r.id,
      action: 'deleted',
      summary: `Deleted recipe ${r.name}.`,
      data: { name: r.name },
    });
    return { id: r.id, name: r.name };
  });
}
