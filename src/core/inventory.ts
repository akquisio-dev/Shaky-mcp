import {
  ensureLocation,
  getCategoryDefaults,
  listCategoryDefaults,
  type CategoryDefaults,
} from '../db/repos/catalog.js';
import {
  findIngredientsByName,
  getIngredient,
  insertIngredient,
  listIngredients as listRows,
  updateIngredient,
  type Ingredient,
} from '../db/repos/ingredients.js';
import { getSetting } from '../db/repos/misc.js';
import { diff, mutate, nowIso, ShakyError, type ChangeSet, type Ctx } from './context.js';
import { LEVEL_FRACTION, levelFromFraction } from './fillLevel.js';
import {
  ingredientInputSchema,
  ingredientPatchSchema,
  type FillLevel,
  type IngredientInput,
  type IngredientPatch,
} from './schemas.js';
import { expiryInfo, type ExpiryInfo } from './shelfLife.js';

/** An ingredient plus everything derived from it (expiry, availability ...). */
export interface IngredientView extends Ingredient, ExpiryInfo {
  fill_fraction: number;
  /** Usable volume in ml across all bottles (or juice from all pieces), null if unknown. */
  stock_ml: number | null;
  display_color: string;
  low: boolean;
  available: boolean;
}

export function warnDays(ctx: Ctx): number {
  return getSetting<number>(ctx.db, 'expiry_warning_days', 7);
}

export function viewIngredient(
  ctx: Ctx,
  i: Ingredient,
  defaults?: Map<string, CategoryDefaults>,
): IngredientView {
  const d = defaults ? defaults.get(i.category) : getCategoryDefaults(ctx.db, i.category);
  const exp = expiryInfo(i, d?.shelf_life_days, ctx.now(), warnDays(ctx));
  const size = i.bottle_size_ml ?? d?.bottle_size_ml ?? null;
  const fill_fraction =
    i.amount_ml !== null && size ? Math.min(1, i.amount_ml / size) : LEVEL_FRACTION[i.fill_level];
  const empty = i.fill_level === 'empty' || i.quantity <= 0;
  let stock_ml: number | null = null;
  if (empty) stock_ml = 0;
  else if (i.yield_ml) stock_ml = i.quantity * i.yield_ml;
  else if (i.amount_ml !== null) stock_ml = i.amount_ml + Math.max(0, i.quantity - 1) * (size ?? 0);
  else if (size) stock_ml = fill_fraction * size + Math.max(0, i.quantity - 1) * size;
  return {
    ...i,
    ...exp,
    // Empty things no longer warn about expiring.
    expiring_soon: exp.expiring_soon && !empty,
    stock_ml: stock_ml === null ? null : Math.round(stock_ml),
    fill_fraction: Math.round(fill_fraction * 100) / 100,
    display_color: i.color ?? d?.color ?? '#c9a66b',
    low:
      !empty && i.quantity <= 1 && (i.fill_level === 'almost_empty' || i.fill_level === 'quarter'),
    available: !i.archived && !empty && !exp.expired,
  };
}

function defaultsMap(ctx: Ctx) {
  return new Map(listCategoryDefaults(ctx.db).map((d) => [d.category, d]));
}

export interface IngredientFilter {
  category?: string;
  location?: string;
  tag?: string;
  search?: string;
  include_empty?: boolean;
  include_archived?: boolean;
  only_available?: boolean;
}

export function listIngredientViews(ctx: Ctx, f: IngredientFilter = {}): IngredientView[] {
  const defaults = defaultsMap(ctx);
  const q = f.search?.trim().toLowerCase();
  return listRows(ctx.db, { includeArchived: f.include_archived })
    .map((i) => viewIngredient(ctx, i, defaults))
    .filter((i) => {
      if (f.category && i.category !== f.category.toLowerCase()) return false;
      if (f.location && i.location !== f.location.toLowerCase()) return false;
      if (f.tag && !i.tags.includes(f.tag.toLowerCase())) return false;
      if (!f.include_empty && (i.fill_level === 'empty' || i.quantity <= 0)) return false;
      if (f.only_available && !i.available) return false;
      if (q) {
        const hay = [i.name, i.brand, i.subcategory, i.flavor_notes, i.notes, ...i.tags]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
}

/** Resolves an id or an exact (case-insensitive) name to one ingredient. */
export function resolveIngredient(ctx: Ctx, ref: number | string): Ingredient {
  if (typeof ref === 'number' || /^\d+$/.test(ref)) {
    const i = getIngredient(ctx.db, Number(ref));
    if (!i) throw new ShakyError('not_found', `No ingredient with id ${ref}.`);
    return i;
  }
  const hits = findIngredientsByName(ctx.db, ref);
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) {
    throw new ShakyError(
      'ambiguous',
      `Several ingredients are called "${ref}" (ids ${hits.map((h) => h.id).join(', ')}). Use the id.`,
    );
  }
  const loose = listIngredientViews(ctx, { search: ref, include_empty: true });
  const hint = loose.length
    ? ` Did you mean: ${loose
        .slice(0, 5)
        .map((i) => `${i.name} (id ${i.id})`)
        .join(', ')}?`
    : '';
  throw new ShakyError('not_found', `No ingredient named "${ref}".${hint}`);
}

export function getIngredientView(ctx: Ctx, ref: number | string): IngredientView {
  return viewIngredient(ctx, resolveIngredient(ctx, ref));
}

/** Keeps fill_level and amount_ml consistent after a change. */
function reconcileLevel(
  cur: Pick<Ingredient, 'fill_level' | 'amount_ml' | 'bottle_size_ml'>,
  patch: IngredientPatchOut,
  defaultSize: number | null,
): Partial<Ingredient> {
  const out: Partial<Ingredient> = {};
  if (patch.amount_ml !== undefined && patch.amount_ml !== null) {
    out.amount_is_estimate = false;
    const size = patch.bottle_size_ml ?? cur.bottle_size_ml ?? defaultSize;
    if (patch.fill_level === undefined) {
      out.fill_level =
        patch.amount_ml === 0
          ? 'empty'
          : size
            ? levelFromFraction(patch.amount_ml / size)
            : cur.fill_level;
    }
  } else if (patch.fill_level !== undefined && patch.amount_ml === undefined) {
    // A level set by hand replaces any earlier ml figure.
    out.amount_ml = null;
    out.amount_is_estimate = false;
  }
  return out;
}

type IngredientPatchOut = ReturnType<typeof ingredientPatchSchema.parse>;

const TRACKED = [
  'name',
  'brand',
  'category',
  'subcategory',
  'tags',
  'provides',
  'abv',
  'color',
  'flavor_notes',
  'location',
  'fill_level',
  'amount_ml',
  'bottle_size_ml',
  'yield_ml',
  'opened_at',
  'shelf_life_days',
  'expires_at',
  'quantity',
  'notes',
  'archived',
];

function normalizeDate(v: string | null | undefined): string | null | undefined {
  if (v === undefined || v === null) return v;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : new Date(v).toISOString();
}

export function addIngredient(ctx: Ctx, input: IngredientInput) {
  const data = ingredientInputSchema.parse(input);
  return mutate(ctx, (cs) => insertOne(ctx, cs, data));
}

/** Adds many ingredients in one transaction: all or nothing. */
export function addIngredients(ctx: Ctx, inputs: IngredientInput[]) {
  const items = inputs.map((x, n) => {
    const r = ingredientInputSchema.safeParse(x);
    if (!r.success) {
      throw new ShakyError(
        'invalid',
        `Item ${n + 1} (${String((x as { name?: unknown }).name ?? '?')}): ${r.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    return r.data;
  });
  return mutate(ctx, (cs) => items.map((data) => insertOne(ctx, cs, data)));
}

function insertOne(ctx: Ctx, cs: ChangeSet, data: ReturnType<typeof ingredientInputSchema.parse>) {
  {
    const d = getCategoryDefaults(ctx.db, data.category);
    const location = data.location ?? d?.default_location ?? 'shelf';
    if (ensureLocation(ctx.db, location)) {
      cs.record({
        entity: 'location',
        entity_id: null,
        action: 'created',
        summary: `Added storage location "${location}".`,
        data: { key: location },
      });
    }
    const ts = nowIso(ctx);
    const base = {
      fill_level: data.fill_level ?? ('full' as FillLevel),
      amount_ml: null,
      bottle_size_ml: data.bottle_size_ml ?? null,
    };
    const level = reconcileLevel(base, data, d?.bottle_size_ml ?? null);
    const id = insertIngredient(ctx.db, {
      ...data,
      opened_at: normalizeDate(data.opened_at),
      expires_at: normalizeDate(data.expires_at),
      tags: data.tags ?? [],
      provides: data.provides ?? [],
      location,
      fill_level: data.fill_level ?? 'full',
      quantity: data.quantity ?? 1,
      ...level,
      created_at: ts,
      updated_at: ts,
    });
    const view = viewIngredient(ctx, getIngredient(ctx.db, id)!);
    cs.record({
      entity: 'ingredient',
      entity_id: id,
      action: 'created',
      summary: `Added ${view.name} (${view.category}) to the ${view.location}.`,
      data: { name: view.name, category: view.category, location: view.location },
    });
    return view;
  }
}

function applyPatch(
  ctx: Ctx,
  cs: ChangeSet,
  cur: Ingredient,
  patch: Partial<Ingredient>,
  action: string,
): IngredientView {
  if (patch.location && ensureLocation(ctx.db, patch.location)) {
    cs.record({
      entity: 'location',
      entity_id: null,
      action: 'created',
      summary: `Added storage location "${patch.location}".`,
      data: { key: patch.location },
    });
  }
  updateIngredient(ctx.db, cur.id, { ...patch, updated_at: nowIso(ctx) });
  const next = getIngredient(ctx.db, cur.id)!;
  const changes = diff(
    cur as unknown as Record<string, unknown>,
    next as unknown as Record<string, unknown>,
    TRACKED,
  );
  if (Object.keys(changes).length) {
    cs.record({
      entity: 'ingredient',
      entity_id: cur.id,
      action,
      summary: describeIngredientChange(next.name, changes),
      data: { name: next.name, changes },
    });
  }
  return viewIngredient(ctx, next);
}

const LEVEL_TEXT: Record<FillLevel, string> = {
  full: 'full',
  three_quarters: 'three quarters',
  half: 'half',
  quarter: 'a quarter',
  almost_empty: 'almost empty',
  empty: 'empty',
};

export function describeIngredientChange(
  name: string,
  changes: Record<string, { from: unknown; to: unknown }>,
): string {
  const parts = Object.entries(changes).map(([k, { from, to }]) => {
    if (k === 'fill_level')
      return `fill level ${LEVEL_TEXT[from as FillLevel]} -> ${LEVEL_TEXT[to as FillLevel]}`;
    if (k === 'archived') return to ? 'archived' : 'restored';
    if (k === 'opened_at') return to ? `opened on ${String(to).slice(0, 10)}` : 'marked unopened';
    if (k === 'amount_ml') return `amount ${from ?? '?'} ml -> ${to ?? '?'} ml`;
    return `${k} ${JSON.stringify(from)} -> ${JSON.stringify(to)}`;
  });
  return `${name}: ${parts.join(', ')}.`;
}

export function updateIngredientFields(ctx: Ctx, ref: number | string, input: IngredientPatch) {
  const patch = ingredientPatchSchema.parse(input);
  return mutate(ctx, (cs) => {
    const cur = resolveIngredient(ctx, ref);
    const category = patch.category ?? cur.category;
    const d = getCategoryDefaults(ctx.db, category);
    const level = reconcileLevel(cur, patch, d?.bottle_size_ml ?? null);
    return applyPatch(
      ctx,
      cs,
      cur,
      {
        ...patch,
        opened_at: normalizeDate(patch.opened_at),
        expires_at: normalizeDate(patch.expires_at),
        ...level,
      } as Partial<Ingredient>,
      'updated',
    );
  });
}

export function setFillLevel(
  ctx: Ctx,
  ref: number | string,
  level: FillLevel,
  amount_ml?: number | null,
) {
  return updateIngredientFields(ctx, ref, {
    fill_level: level,
    ...(amount_ml !== undefined && { amount_ml }),
  });
}

export function markOpened(ctx: Ctx, ref: number | string, date?: string) {
  return updateIngredientFields(ctx, ref, { opened_at: date ?? nowIso(ctx), expires_at: null });
}

export function archiveIngredient(ctx: Ctx, ref: number | string, archived = true) {
  return mutate(ctx, (cs) => {
    const cur = resolveIngredient(ctx, ref);
    return applyPatch(ctx, cs, cur, { archived }, archived ? 'archived' : 'restored');
  });
}

/** Internal: write a stock change computed elsewhere (log_mix). */
export function writeStock(
  ctx: Ctx,
  cs: ChangeSet,
  cur: Ingredient,
  patch: Partial<Ingredient>,
  action: string,
) {
  return applyPatch(ctx, cs, cur, patch, action);
}

export function getExpiring(ctx: Ctx, days: number, includeExpired = true) {
  return listIngredientViews(ctx)
    .filter(
      (i) =>
        i.days_left !== null &&
        i.days_left <= days &&
        i.fill_level !== 'empty' &&
        i.quantity > 0 &&
        (includeExpired || !i.expired),
    )
    .sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0));
}
