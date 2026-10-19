import {
  deleteEquipment,
  deleteGlass,
  findEquipmentByName,
  findGlassByName,
  getEquipment,
  getGlass,
  insertEquipment,
  insertGlass,
  listCategoryDefaults,
  listEquipment,
  listGlassware,
  listLocations,
  updateEquipment,
  updateGlass,
  upsertCategoryDefaults,
  upsertLocation,
  type Equipment,
  type Glass,
} from '../db/repos/catalog.js';
import { diff, mutate, nowIso, ShakyError, type Ctx } from './context.js';
import {
  categoryDefaultsInputSchema,
  equipmentInputSchema,
  glassInputSchema,
  locationInputSchema,
} from './schemas.js';
import { z } from 'zod';

export { listEquipment, listGlassware, listLocations, listCategoryDefaults };

export const equipmentUpsertSchema = equipmentInputSchema.partial().extend({
  id: z.number().int().positive().optional(),
  remove: z.boolean().optional(),
});

/**
 * Adds, changes or removes equipment. Without id the item is matched by name;
 * an unknown name creates a new item (type is then required).
 */
export function setEquipment(ctx: Ctx, input: z.input<typeof equipmentUpsertSchema>) {
  const p = equipmentUpsertSchema.parse(input);
  return mutate(ctx, (cs) => {
    const cur =
      p.id !== undefined
        ? getEquipment(ctx.db, p.id)
        : p.name
          ? findEquipmentByName(ctx.db, p.name)
          : undefined;
    if (p.id !== undefined && !cur)
      throw new ShakyError('not_found', `No equipment with id ${p.id}.`);
    if (p.remove) {
      if (!cur) throw new ShakyError('not_found', `No equipment named "${p.name}".`);
      deleteEquipment(ctx.db, cur.id);
      cs.record({
        entity: 'equipment',
        entity_id: cur.id,
        action: 'deleted',
        summary: `Removed ${cur.name}.`,
        data: { name: cur.name },
      });
      return { removed: cur as Equipment };
    }
    const ts = nowIso(ctx);
    const { id: _id, remove: _remove, ...fields } = p;
    if (!cur) {
      const full = equipmentInputSchema.parse(fields);
      const id = insertEquipment(ctx.db, {
        ...full,
        available: full.available ?? true,
        substitutes_for: full.substitutes_for ?? [],
        created_at: ts,
        updated_at: ts,
      });
      cs.record({
        entity: 'equipment',
        entity_id: id,
        action: 'created',
        summary: `Added ${full.name} (${full.type})${
          full.substitutes_for?.length ? `, usable as ${full.substitutes_for.join(', ')}` : ''
        }.`,
        data: { name: full.name, type: full.type },
      });
      return { item: getEquipment(ctx.db, id)! };
    }
    updateEquipment(ctx.db, cur.id, { ...fields, updated_at: ts });
    const next = getEquipment(ctx.db, cur.id)!;
    const changes = diff(
      cur as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>,
      ['name', 'type', 'available', 'substitutes_for', 'notes'],
    );
    if (Object.keys(changes).length) {
      cs.record({
        entity: 'equipment',
        entity_id: cur.id,
        action: 'updated',
        summary:
          changes.available && Object.keys(changes).length === 1
            ? `${next.name} is now ${next.available ? 'available' : 'unavailable'}.`
            : `Updated ${next.name}.`,
        data: { name: next.name, changes },
      });
    }
    return { item: next };
  });
}

export const glassUpsertSchema = glassInputSchema.partial().extend({
  id: z.number().int().positive().optional(),
  remove: z.boolean().optional(),
});

export function setGlassware(ctx: Ctx, input: z.input<typeof glassUpsertSchema>) {
  const p = glassUpsertSchema.parse(input);
  return mutate(ctx, (cs) => {
    const cur =
      p.id !== undefined
        ? getGlass(ctx.db, p.id)
        : p.name
          ? findGlassByName(ctx.db, p.name)
          : undefined;
    if (p.id !== undefined && !cur) throw new ShakyError('not_found', `No glass with id ${p.id}.`);
    if (p.remove) {
      if (!cur) throw new ShakyError('not_found', `No glass named "${p.name}".`);
      deleteGlass(ctx.db, cur.id);
      cs.record({
        entity: 'glass',
        entity_id: cur.id,
        action: 'deleted',
        summary: `Removed ${cur.name} glasses.`,
        data: { name: cur.name },
      });
      return { removed: cur as Glass };
    }
    const ts = nowIso(ctx);
    const { id: _id, remove: _remove, ...fields } = p;
    if (!cur) {
      const full = glassInputSchema.parse(fields);
      const id = insertGlass(ctx.db, {
        ...full,
        count: full.count ?? 1,
        created_at: ts,
        updated_at: ts,
      });
      cs.record({
        entity: 'glass',
        entity_id: id,
        action: 'created',
        summary: `Added ${full.count ?? 1}x ${full.name}.`,
        data: { name: full.name, type: full.type },
      });
      return { item: getGlass(ctx.db, id)! };
    }
    updateGlass(ctx.db, cur.id, { ...fields, updated_at: ts });
    const next = getGlass(ctx.db, cur.id)!;
    const changes = diff(
      cur as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>,
      ['name', 'type', 'count', 'notes'],
    );
    if (Object.keys(changes).length) {
      cs.record({
        entity: 'glass',
        entity_id: cur.id,
        action: 'updated',
        summary: `Updated ${next.name} glasses${changes.count ? ` (count ${String(changes.count.from)} -> ${String(changes.count.to)})` : ''}.`,
        data: { name: next.name, changes },
      });
    }
    return { item: next };
  });
}

export function setLocation(ctx: Ctx, input: z.input<typeof locationInputSchema>) {
  const loc = locationInputSchema.parse(input);
  return mutate(ctx, (cs) => {
    upsertLocation(ctx.db, loc);
    cs.record({
      entity: 'location',
      entity_id: null,
      action: 'updated',
      summary: `Storage location "${loc.key}" saved.`,
      data: { ...loc },
    });
    return listLocations(ctx.db).find((l) => l.key === loc.key)!;
  });
}

export function setCategoryDefaults(ctx: Ctx, input: z.input<typeof categoryDefaultsInputSchema>) {
  const d = categoryDefaultsInputSchema.parse(input);
  return mutate(ctx, (cs) => {
    const saved = upsertCategoryDefaults(ctx.db, d);
    cs.record({
      entity: 'category',
      entity_id: null,
      action: 'updated',
      summary: `Defaults for ${d.category} saved.`,
      data: { ...saved },
    });
    return saved;
  });
}
