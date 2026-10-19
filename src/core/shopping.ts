import {
  deleteShopping,
  findOpenShoppingByName,
  getShopping,
  insertShopping,
  listShopping,
  updateShopping,
} from '../db/repos/misc.js';
import { getIngredient } from '../db/repos/ingredients.js';
import { diff, mutate, nowIso, ShakyError, type Ctx } from './context.js';
import { shoppingInputSchema, type ShoppingInput } from './schemas.js';

export { listShopping };

/** Adds an item. An open item with the same name is updated instead of duplicated. */
export function addShopping(ctx: Ctx, input: ShoppingInput) {
  const data = shoppingInputSchema.parse(input);
  return mutate(ctx, (cs) => {
    if (data.ingredient_id && !getIngredient(ctx.db, data.ingredient_id)) {
      throw new ShakyError('not_found', `No ingredient with id ${data.ingredient_id}.`);
    }
    const ts = nowIso(ctx);
    const existing = findOpenShoppingByName(ctx.db, data.name);
    if (existing) {
      updateShopping(ctx.db, existing.id, { ...data, done: undefined, updated_at: ts });
      cs.record({
        entity: 'shopping',
        entity_id: existing.id,
        action: 'updated',
        summary: `${data.name} was already on the shopping list, updated it.`,
        data: { name: data.name },
      });
      return { item: getShopping(ctx.db, existing.id)!, duplicate: true };
    }
    const id = insertShopping(ctx.db, {
      ...data,
      priority: data.priority ?? 'normal',
      done: data.done ?? false,
      created_at: ts,
      updated_at: ts,
    });
    cs.record({
      entity: 'shopping',
      entity_id: id,
      action: 'created',
      summary: `Put ${data.name} on the shopping list${data.reason ? ` (${data.reason})` : ''}.`,
      data: { name: data.name },
    });
    return { item: getShopping(ctx.db, id)!, duplicate: false };
  });
}

export function updateShoppingItem(
  ctx: Ctx,
  id: number,
  input: Partial<ShoppingInput> & { remove?: boolean },
) {
  const { remove, ...rest } = input;
  const patch = shoppingInputSchema.partial().parse(rest);
  return mutate(ctx, (cs) => {
    const cur = getShopping(ctx.db, id);
    if (!cur) throw new ShakyError('not_found', `No shopping list item with id ${id}.`);
    if (remove) {
      deleteShopping(ctx.db, id);
      cs.record({
        entity: 'shopping',
        entity_id: id,
        action: 'deleted',
        summary: `Removed ${cur.name} from the shopping list.`,
        data: { name: cur.name },
      });
      return { removed: cur };
    }
    updateShopping(ctx.db, id, { ...patch, updated_at: nowIso(ctx) });
    const next = getShopping(ctx.db, id)!;
    const changes = diff(
      cur as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>,
      ['name', 'quantity', 'reason', 'priority', 'done', 'ingredient_id'],
    );
    if (Object.keys(changes).length) {
      cs.record({
        entity: 'shopping',
        entity_id: id,
        action: changes.done && next.done ? 'done' : 'updated',
        summary:
          changes.done && next.done
            ? `Bought ${next.name}.`
            : `Updated ${next.name} on the shopping list.`,
        data: { name: next.name, changes },
      });
    }
    return { item: next };
  });
}
