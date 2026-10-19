import { z } from 'zod';
import { getSetting } from '../db/repos/misc.js';
import { mutate, ShakyError, type Ctx } from './context.js';
import { applyDiets, listDietRules } from './diets.js';
import { listIngredientViews, type IngredientView } from './inventory.js';
import { checkLine, words } from './matching.js';
import { getRecipeWithCheck } from './recipes.js';
import { addShopping } from './shopping.js';
import { listSubstitutions } from './substitutions.js';
import type { Step } from './schemas.js';

// Party planner: a few drinks for N guests -> how much of everything, what to
// buy, how much ice (and when to start freezing it), what it costs.

const ML: Record<string, number> = {
  ml: 1,
  cl: 10,
  oz: 29.5735,
  dash: 0.9,
  barspoon: 5,
  tsp: 5,
  tbsp: 15,
};
const CUBES_PER_ICE_STEP = 6;

export const partySchema = z.object({
  guests: z.number().int().min(1).max(500),
  drinks_per_guest: z.number().min(0.5).max(20).default(2),
  recipes: z
    .array(
      z.union([
        z.number().int().positive(),
        z.string().trim().min(1),
        z.object({
          recipe: z.union([z.number().int().positive(), z.string()]),
          servings: z.number().int().min(0).max(5000).optional(),
        }),
      ]),
    )
    .min(1)
    .max(20)
    .describe(
      'Recipe ids or names, optionally with servings; otherwise guests x drinks_per_guest are spread evenly.',
    ),
  diets: z
    .array(z.string().trim().min(1))
    .max(10)
    .optional()
    .describe('Guest diets, e.g. ["vegan", "nut allergy"].'),
  party_at: z
    .string()
    .optional()
    .describe('When the party starts (ISO time), to say when to start freezing ice.'),
});

type IceKind = 'cubes' | 'crushed' | 'large';

function iceKind(i: IngredientView): IceKind {
  const w = new Set([...words(i.name), ...words(i.subcategory), ...i.tags.flatMap(words)]);
  if (w.has('crushed') || w.has('crush')) return 'crushed';
  if (['large', 'big', 'hexagon', 'sphere', 'block', 'gross', 'grosse'].some((x) => w.has(x)))
    return 'large';
  return 'cubes';
}

/** Ice one drink needs, from its steps: shaking ice plus ice in the glass. */
export function iceForDrink(steps: Step[]): { cubes: number; crushed: number } {
  let cubes = 0;
  let crushed = 0;
  for (const s of steps) {
    if (s.action !== 'add_ice') continue;
    if (/crush/i.test(s.note ?? '')) crushed += 1;
    else cubes += CUBES_PER_ICE_STEP;
  }
  return { cubes, crushed };
}

export function planParty(ctx: Ctx, input: z.input<typeof partySchema>) {
  const p = partySchema.parse(input);
  const total = Math.round(p.guests * p.drinks_per_guest);
  const picks = p.recipes.map((x) =>
    typeof x === 'object' ? x : { recipe: x, servings: undefined },
  );
  const fixed = picks.reduce((s, x) => s + (x.servings ?? 0), 0);
  const open = picks.filter((x) => x.servings === undefined);
  const each = open.length ? Math.floor(Math.max(0, total - fixed) / open.length) : 0;
  let rest = open.length ? Math.max(0, total - fixed) - each * open.length : 0;

  const stock = listIngredientViews(ctx).filter((i) => i.available);
  const subs = listSubstitutions(ctx);
  const rules = listDietRules(ctx);
  const currency = getSetting<string>(ctx.db, 'currency', 'EUR');

  type Need = {
    key: string;
    name: string;
    bottle?: IngredientView;
    ml: number;
    pieces: number;
    unit?: string;
  };
  const needs = new Map<string, Need>();
  const ice = { cubes: 0, crushed: 0 };
  let cost = 0;
  let costComplete = true;

  const drinks = picks.map((pick) => {
    const r = getRecipeWithCheck(ctx, pick.recipe);
    const servings = pick.servings ?? each + (rest-- > 0 ? 1 : 0);
    const diet = applyDiets(r.personal, p.diets ?? [], rules, r.alcohol_free);
    const drinkIce = iceForDrink(diet.steps);
    ice.cubes += drinkIce.cubes * servings;
    ice.crushed += drinkIce.crushed * servings;
    cost += r.cost.amount * servings;
    if (!r.cost.complete) costComplete = false;
    for (const spec of diet.ingredients) {
      if (spec.amount === undefined || servings === 0) continue;
      const line = checkLine(spec, stock, subs);
      const bottle = line.match ? stock.find((i) => i.id === line.match!.id) : undefined;
      // Juice and wedges of the same limes are counted separately (ml vs pieces).
      const key = `${bottle ? `b${bottle.id}` : `n:${spec.name.toLowerCase()}`}:${ML[spec.unit] !== undefined ? 'ml' : 'pcs'}`;
      const n = needs.get(key) ?? {
        key,
        name: bottle?.name ?? spec.name,
        bottle,
        ml: 0,
        pieces: 0,
      };
      const per = ML[spec.unit];
      const ratio = line.substitute?.ratio ?? 1;
      if (per !== undefined) n.ml += spec.amount * per * servings * ratio;
      else {
        n.pieces += spec.amount * servings;
        n.unit = spec.unit;
      }
      needs.set(key, n);
    }
    return {
      id: r.id,
      name: r.name,
      servings,
      abv: r.strength.abv,
      alcohol_free: r.alcohol_free,
      glass: r.glass,
      description: r.description,
      color: r.color,
      status: r.availability.status,
      replaced: diet.replaced,
      not_for: diet.blocked,
    };
  });

  const shopping: { name: string; quantity: string; ml?: number; pieces?: number }[] = [];
  const ingredients = [...needs.values()].map((n) => {
    const b = n.bottle;
    let have: number | null = null;
    let short = 0;
    if (n.ml > 0) {
      have = b?.stock_ml ?? (b ? null : 0);
      if (have !== null) short = Math.max(0, n.ml - have);
    } else if (n.pieces > 0) {
      // Juice-yielding fruit is counted in ml above; wedges, slices etc. in pieces of fruit.
      const share: Record<string, number> = {
        piece: 1,
        scoop: 1,
        slice: 0.125,
        wedge: 0.125,
        leaf: 0.02,
        sprig: 0.1,
      };
      const fruit = n.pieces * (share[n.unit ?? 'piece'] ?? 1);
      have = b ? b.quantity : 0;
      short = Math.max(0, fruit - have);
    }
    if (short > 0.01) {
      const size = b?.bottle_size_ml ?? null;
      const quantity =
        n.ml > 0
          ? size
            ? `${Math.ceil(short / size)} x ${size} ml`
            : b?.yield_ml
              ? `${Math.ceil(short / b.yield_ml)} pcs`
              : `${Math.ceil(short / 10) / 100} l`
          : `${Math.ceil(short)} pcs`;
      shopping.push({
        name: n.name,
        quantity,
        ...(n.ml > 0 ? { ml: Math.round(short) } : { pieces: Math.ceil(short) }),
      });
    }
    return {
      name: n.name,
      ...(n.ml > 0 && {
        need_ml: Math.round(n.ml),
        have_ml: have === null ? null : Math.round(have),
      }),
      ...(n.pieces > 0 && { need_pieces: Math.ceil(n.pieces), unit: n.unit }),
      enough: short <= 0.01,
    };
  });

  // Ice: what is in the freezer vs what the drinks need, and when to start.
  const iceStock = listIngredientViews(ctx).filter((i) => i.category === 'ice' && i.available);
  const have = { cubes: 0, crushed: 0, large: 0 };
  let freezeHours = 0;
  for (const i of iceStock) {
    const kind = iceKind(i);
    have[kind] += i.quantity;
    // What runs short is cubes (crushed is made from cubes), so their freezing time counts.
    if (kind !== 'large') freezeHours = Math.max(freezeHours, i.freeze_hours ?? 0);
  }
  // Crushed ice can be made from cubes (about 6 cubes a portion).
  const cubeShort = Math.max(0, ice.cubes - have.cubes);
  const crushedShort = Math.max(0, ice.crushed - have.crushed);
  const shortCubes =
    cubeShort + Math.max(0, crushedShort * 6 - Math.max(0, have.cubes - ice.cubes));
  const hours = freezeHours || 4;
  const partyAt = p.party_at ? Date.parse(p.party_at) : NaN;
  const startBy =
    shortCubes > 0 && !Number.isNaN(partyAt)
      ? new Date(partyAt - hours * 3_600_000).toISOString()
      : null;
  const tooLate = startBy !== null && Date.parse(startBy) < ctx.now().getTime();

  return {
    guests: p.guests,
    total_drinks: drinks.reduce((s, d) => s + d.servings, 0),
    diets: p.diets ?? [],
    drinks,
    ingredients,
    shopping,
    ice: {
      cubes_needed: ice.cubes,
      crushed_portions_needed: ice.crushed,
      cubes_in_stock: have.cubes,
      crushed_in_stock: have.crushed,
      large_in_stock: have.large,
      cubes_short: shortCubes,
      freeze_hours: hours,
      ...(startBy && { start_freezing_by: startBy, too_late: tooLate }),
      tracked: iceStock.length > 0,
    },
    cost: { amount: Math.round(cost * 100) / 100, currency, complete: costComplete },
  };
}

export type PartyPlan = ReturnType<typeof planParty>;

/** Puts what is missing for the party on the shopping list. */
export function applyPartyShopping(ctx: Ctx, input: z.input<typeof partySchema>, reason = 'Party') {
  const plan = planParty(ctx, input);
  if (!plan.shopping.length && plan.ice.cubes_short <= 0)
    throw new ShakyError('invalid', 'Nothing is missing for this party.');
  return mutate(ctx, () => {
    for (const s of plan.shopping)
      addShopping(ctx, { name: s.name, quantity: s.quantity, reason, priority: 'high' });
    if (plan.ice.cubes_short > 0 && !plan.ice.tracked) {
      addShopping(ctx, {
        name: 'Ice cubes',
        quantity: `${plan.ice.cubes_short} cubes`,
        reason,
        priority: 'high',
      });
    }
    return plan;
  });
}
