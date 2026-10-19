import { listEquipment, listGlassware, listLocations } from '../db/repos/catalog.js';
import { listShopping } from '../db/repos/misc.js';
import type { Ctx } from './context.js';
import { listIngredientViews, type IngredientView } from './inventory.js';
import { findMakeable } from './recipes.js';

export interface Warning {
  id: number;
  name: string;
  kind: 'expired' | 'expiring_soon' | 'low' | 'empty';
  detail: string;
}

export function warningsFor(items: IngredientView[]): Warning[] {
  const out: Warning[] = [];
  for (const i of items) {
    if (i.archived) continue;
    const empty = i.fill_level === 'empty' || i.quantity <= 0;
    // Empty things only warn that they are empty, not that they expire.
    if (empty) {
      out.push({ id: i.id, name: i.name, kind: 'empty', detail: 'empty' });
      continue;
    }
    if (i.expired)
      out.push({ id: i.id, name: i.name, kind: 'expired', detail: `expired on ${i.expires_on}` });
    else if (i.expiring_soon)
      out.push({
        id: i.id,
        name: i.name,
        kind: 'expiring_soon',
        detail:
          i.days_left === 0 ? 'use today' : `use within ${i.days_left} day(s), by ${i.expires_on}`,
      });
    if (i.low)
      out.push({ id: i.id, name: i.name, kind: 'low', detail: i.fill_level.replace('_', ' ') });
  }
  return out;
}

const compact = (i: IngredientView) => ({
  id: i.id,
  name: i.name,
  ...(i.subcategory && { subcategory: i.subcategory }),
  fill_level: i.fill_level,
  ...(i.quantity !== 1 && { quantity: i.quantity }),
  location: i.location,
  ...(i.opened_at && { opened: i.opened_at.slice(0, 10) }),
  ...(i.expires_on && { expires_on: i.expires_on }),
});

/** The one-call summary the AI should read first. */
export function barOverview(ctx: Ctx) {
  const all = listIngredientViews(ctx, { include_empty: true });
  const inStock = all.filter((i) => i.available);
  const byCategory: Record<string, ReturnType<typeof compact>[]> = {};
  for (const i of inStock) (byCategory[i.category] ??= []).push(compact(i));
  const equipment = listEquipment(ctx.db);
  const makeable = findMakeable(ctx);
  return {
    today: ctx.now().toISOString().slice(0, 10),
    counts: {
      ingredients_in_stock: inStock.length,
      unavailable: all.length - inStock.length,
      recipes_makeable: makeable.makeable.length,
      recipes_missing_one: makeable.missing_one.length,
      shopping_open: listShopping(ctx.db).length,
    },
    in_stock: byCategory,
    warnings: warningsFor(all),
    equipment: equipment
      .filter((e) => e.available)
      .map((e) => ({
        name: e.name,
        type: e.type,
        ...(e.substitutes_for.length && { substitutes_for: e.substitutes_for }),
      })),
    equipment_unavailable: equipment.filter((e) => !e.available).map((e) => e.name),
    glassware: listGlassware(ctx.db).map((g) => ({ name: g.name, type: g.type, count: g.count })),
    locations: listLocations(ctx.db).map((l) => l.key),
    makeable_now: makeable.makeable.map((c) => ({
      name: c.name,
      servings_possible: c.servings_possible,
    })),
    missing_one: makeable.missing_one.map((c) => ({ name: c.name, missing: c.missing[0] })),
    with_substitute: makeable.with_substitute.map((c) => ({
      name: c.name,
      substitutions: c.substitutions,
    })),
    use_up_first: [...makeable.makeable, ...makeable.with_substitute]
      .filter((c) => c.uses_expiring.length)
      .sort((x, y) => x.uses_expiring[0]!.days_left - y.uses_expiring[0]!.days_left)
      .slice(0, 5)
      .map((c) => ({
        name: c.name,
        uses: c.uses_expiring.map((u) => `${u.bottle} (${u.days_left} d)`),
      })),
  };
}

export type BarOverview = ReturnType<typeof barOverview>;

export function overviewText(o: BarOverview): string {
  const lines = [`Bar on ${o.today}: ${o.counts.ingredients_in_stock} ingredients in stock.`];
  for (const [cat, items] of Object.entries(o.in_stock)) {
    lines.push(
      `${cat}: ${items
        .map(
          (i) =>
            `${i.name}${i.fill_level !== 'full' ? ` (${i.fill_level.replace('_', ' ')})` : ''}`,
        )
        .join(', ')}`,
    );
  }
  if (o.warnings.length) {
    lines.push(`Warnings: ${o.warnings.map((w) => `${w.name} ${w.detail}`).join('; ')}`);
  }
  lines.push(`Equipment: ${o.equipment.map((e) => e.name).join(', ') || 'none'}`);
  lines.push(`Glasses: ${o.glassware.map((g) => `${g.count}x ${g.name}`).join(', ') || 'none'}`);
  lines.push(
    `Saved recipes makeable now: ${o.makeable_now.map((m) => (m.servings_possible !== null ? `${m.name} (${m.servings_possible}x)` : m.name)).join(', ') || 'none'}`,
  );
  if (o.use_up_first.length) {
    lines.push(
      `Use up first: ${o.use_up_first.map((u) => `${u.name} (${u.uses.join(', ')})`).join('; ')}`,
    );
  }
  if (o.with_substitute.length) {
    lines.push(
      `Makeable with a stand-in: ${o.with_substitute.map((w) => `${w.name} (${w.substitutions.map((s) => `${s.using} for ${s.line}`).join(', ')})`).join('; ')}`,
    );
  }
  if (o.missing_one.length) {
    lines.push(
      `Missing one ingredient: ${o.missing_one.map((m) => `${m.name} (needs ${m.missing})`).join(', ')}`,
    );
  }
  return lines.join('\n');
}
