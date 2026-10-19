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
import { ingredientInputSchema, shoppingInputSchema, type ShoppingInput } from './schemas.js';
import { z } from 'zod';
import { findIngredientsByName } from '../db/repos/ingredients.js';
import { addIngredientIn, resolveIngredient, writeStock } from './inventory.js';

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

export const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().positive().describe('Shopping list item id.'),
        add_quantity: z
          .number()
          .positive()
          .max(1000)
          .default(1)
          .describe('Bottles, packs or pieces bought.'),
        ingredient: z
          .union([z.number().int().positive(), z.string().trim().min(1)])
          .optional()
          .describe('Stock item to refill; default the linked item or the same name.'),
        new_ingredient: ingredientInputSchema
          .optional()
          .describe('If nothing matches: the new stock item to create (category required).'),
      }),
    )
    .min(1)
    .max(100),
});

/**
 * "Bought it": ticks off shopping items and puts them into stock. An empty
 * bottle is replaced by a full one, otherwise the count goes up.
 */
export function checkoutShopping(ctx: Ctx, input: z.input<typeof checkoutSchema>) {
  const p = checkoutSchema.parse(input);
  return mutate(ctx, (cs) => {
    const done: { item: string; stock: string; quantity: number; created: boolean }[] = [];
    for (const it of p.items) {
      const s = getShopping(ctx.db, it.id);
      if (!s) throw new ShakyError('not_found', `No shopping list item with id ${it.id}.`);
      let target = it.ingredient !== undefined ? resolveIngredient(ctx, it.ingredient) : undefined;
      if (!target && s.ingredient_id) target = getIngredient(ctx.db, s.ingredient_id);
      if (!target) {
        const byName = findIngredientsByName(ctx.db, s.name);
        if (byName.length === 1) target = byName[0];
      }
      let created = false;
      if (target) {
        const empty = target.fill_level === 'empty' || target.quantity <= 0;
        writeStock(
          ctx,
          cs,
          target,
          empty
            ? {
                quantity: it.add_quantity,
                fill_level: 'full',
                amount_ml: null,
                amount_is_estimate: false,
                opened_at: null,
                expires_at: null,
                archived: false,
              }
            : { quantity: target.quantity + it.add_quantity, archived: false },
          'restocked',
        );
      } else {
        if (!it.new_ingredient) {
          throw new ShakyError(
            'invalid',
            `"${s.name}" is not in the bar yet. Pass new_ingredient with at least a category for item ${it.id}.`,
          );
        }
        target = getIngredient(
          ctx.db,
          addIngredientIn(ctx, cs, { ...it.new_ingredient, quantity: it.add_quantity }).id,
        )!;
        created = true;
      }
      updateShopping(ctx.db, s.id, {
        done: true,
        ingredient_id: target.id,
        updated_at: nowIso(ctx),
      });
      cs.record({
        entity: 'shopping',
        entity_id: s.id,
        action: 'done',
        summary: `Bought ${s.name}, ${created ? 'added to the bar' : `${target.name} restocked`}.`,
        data: { name: s.name },
      });
      done.push({
        item: s.name,
        stock: target.name,
        quantity: getIngredient(ctx.db, target.id)!.quantity,
        created,
      });
    }
    return done;
  });
}
