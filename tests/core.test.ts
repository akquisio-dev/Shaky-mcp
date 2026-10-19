import { describe, expect, it } from 'vitest';
import { expiryInfo } from '../src/core/shelfLife.js';
import { deductCount, deductVolume, levelFromFraction, toMl } from '../src/core/fillLevel.js';
import { matchesSpec, words } from '../src/core/matching.js';
import {
  addIngredient,
  archiveIngredient,
  getExpiring,
  getIngredientView,
  listIngredientViews,
  markOpened,
  setFillLevel,
} from '../src/core/inventory.js';
import { findMakeable, getRecipeWithCheck, saveRecipe } from '../src/core/recipes.js';
import { logMix } from '../src/core/mixing.js';
import { setEquipment } from '../src/core/catalog.js';
import { barOverview } from '../src/core/overview.js';
import { addShopping, updateShoppingItem } from '../src/core/shopping.js';
import { listActivity } from '../src/db/repos/misc.js';
import { ShakyError } from '../src/core/context.js';
import { ctxFor, freshDb, NOW, seededCtx } from './helpers.js';
import type { IngredientView } from '../src/core/inventory.js';
import { recipeIngredientSchema } from '../src/core/schemas.js';

const day = 86_400_000;

describe('shelf life', () => {
  const opened = new Date(NOW.getTime() - 30 * day).toISOString();

  it('uses the category default and warns before expiry', () => {
    const e = expiryInfo({ opened_at: opened, shelf_life_days: null, expires_at: null }, 35, NOW);
    expect(e.days_left).toBe(5);
    expect(e.expiring_soon).toBe(true);
    expect(e.expired).toBe(false);
  });

  it('lets the item override the category and marks expired', () => {
    const e = expiryInfo({ opened_at: opened, shelf_life_days: 7, expires_at: null }, 35, NOW);
    expect(e.expired).toBe(true);
  });

  it('never expires unopened or indefinite items', () => {
    expect(
      expiryInfo({ opened_at: null, shelf_life_days: null, expires_at: null }, 5, NOW).expires_on,
    ).toBeNull();
    expect(
      expiryInfo({ opened_at: opened, shelf_life_days: null, expires_at: null }, null, NOW).expired,
    ).toBe(false);
  });

  it('prefers a manual expiry date', () => {
    const e = expiryInfo(
      { opened_at: opened, shelf_life_days: null, expires_at: '2026-10-20' },
      365,
      NOW,
    );
    expect(e.days_left).toBe(1);
  });
});

describe('fill levels and deduction', () => {
  it('maps fractions to levels without calling leftovers empty', () => {
    expect(levelFromFraction(0.01)).toBe('almost_empty');
    expect(levelFromFraction(0.5)).toBe('half');
    expect(levelFromFraction(0.9)).toBe('full');
    expect(levelFromFraction(0)).toBe('empty');
  });

  it('converts units', () => {
    expect(toMl(4, 'cl')).toBe(40);
    expect(toMl(1, 'wedge')).toBeNull();
  });

  const base = {
    fill_level: 'half' as const,
    amount_ml: null,
    amount_is_estimate: false,
    bottle_size_ml: 700,
    quantity: 1,
    opened_at: null,
  };

  it('estimates from the level and stores the estimate', () => {
    const r = deductVolume(base, 50, null, NOW.toISOString());
    expect(r.next.amount_ml).toBe(300);
    expect(r.next.amount_is_estimate).toBe(true);
    expect(r.next.fill_level).toBe('half');
    // repeated small pours add up
    const r2 = deductVolume(r.next, 200, null, NOW.toISOString());
    expect(r2.next.fill_level).toBe('almost_empty');
  });

  it('is exact with ml and opens the next bottle when one runs out', () => {
    const r = deductVolume({ ...base, amount_ml: 30, quantity: 2 }, 50, null, NOW.toISOString());
    expect(r.openedNext).toBe(true);
    expect(r.next.quantity).toBe(1);
    expect(r.next.amount_ml).toBe(680);
    expect(r.next.amount_is_estimate).toBe(false);
  });

  it('marks the last bottle empty', () => {
    const r = deductVolume({ ...base, amount_ml: 30 }, 50, null, NOW.toISOString());
    expect(r.next.fill_level).toBe('empty');
    expect(r.next.amount_ml).toBe(0);
  });

  it('counts pieces', () => {
    const r = deductCount({ ...base, quantity: 1 }, 1);
    expect(r.next.fill_level).toBe('empty');
  });
});

describe('matching', () => {
  const ing = (p: Partial<IngredientView>): IngredientView =>
    ({
      id: 1,
      name: 'x',
      brand: null,
      category: 'spirit',
      subcategory: null,
      tags: [],
      archived: false,
      ...p,
    }) as IngredientView;
  const spec = (p: object) => recipeIngredientSchema.parse({ name: 'x', ...p });

  it('normalizes words', () => {
    expect(words('Brauner Rum')).toEqual(['dark', 'rum']);
    expect(words('Limes')).toEqual(['lime']);
  });

  it('lets generic rum match white rum, but not dark rum', () => {
    const white = ing({ name: 'White Rum', subcategory: 'white rum' });
    expect(matchesSpec(spec({ subcategory: 'rum' }), white)).toBe(true);
    expect(matchesSpec(spec({ subcategory: 'dark rum' }), white)).toBe(false);
    expect(matchesSpec(spec({ subcategory: 'brown rum' }), ing({ subcategory: 'dark rum' }))).toBe(
      true,
    );
  });

  it('does not confuse gin with ginger beer', () => {
    const gb = ing({ name: 'Ginger Beer', category: 'mixer', subcategory: 'ginger beer' });
    expect(matchesSpec(spec({ subcategory: 'gin' }), gb)).toBe(false);
  });

  it('uses tags, so limes can stand in for lime juice', () => {
    const limes = ing({ name: 'Limes', category: 'fruit', tags: ['lime juice'] });
    expect(matchesSpec(spec({ subcategory: 'lime juice' }), limes)).toBe(true);
  });

  it('respects category and pinned ids', () => {
    expect(
      matchesSpec(
        spec({ category: 'liqueur', subcategory: 'orange' }),
        ing({ subcategory: 'orange' }),
      ),
    ).toBe(false);
    expect(matchesSpec(spec({ ingredient_id: 2 }), ing({ id: 1 }))).toBe(false);
  });
});

describe('seeded bar', () => {
  it('splits the example recipes into makeable / missing one / missing more', () => {
    const ctx = seededCtx();
    const r = findMakeable(ctx, { include_missing_more: true });
    expect(r.makeable.map((c) => c.name).sort()).toEqual([
      'Gin & Tonic',
      'Lillet Tonic',
      'Moscow Mule',
    ]);
    expect(Object.fromEntries(r.missing_one.map((c) => [c.name, c.missing[0]]))).toEqual({
      "Dark 'n' Stormy": 'Dark rum',
      'Lillet Wild Berry': 'Wild berry tonic',
      Paloma: 'Grapefruit soda',
      'Piña Colada': 'Cream of coconut',
    });
    expect(r.missing_more?.map((c) => c.name).sort()).toEqual([
      'Mai Tai',
      'Mojito',
      'Painkiller',
      'Strawberry Daiquiri',
      'Tequila Sunrise',
    ]);
  });

  it('flags the open Lillet as expiring soon', () => {
    const ctx = seededCtx();
    const lillet = getIngredientView(ctx, 'Lillet Blanc');
    expect(lillet.expiring_soon).toBe(true);
    expect(
      barOverview(ctx).warnings.some(
        (w) => w.name === 'Lillet Blanc' && w.kind === 'expiring_soon',
      ),
    ).toBe(true);
    expect(getExpiring(ctx, 7).map((i) => i.name)).toContain('Lillet Blanc');
  });

  it('treats empty and expired bottles as unavailable', () => {
    const ctx = seededCtx();
    setFillLevel(ctx, 'Vodka', 'empty');
    const mule = getRecipeWithCheck(ctx, 'Moscow Mule').availability;
    expect(mule.status).toBe('missing_one');
    expect(mule.lines[0]?.status).toBe('unavailable');
    markOpened(ctx, 'Lillet Blanc', new Date(NOW.getTime() - 60 * day).toISOString());
    expect(getRecipeWithCheck(ctx, 'Lillet Tonic').availability.missing).toEqual(['Lillet Blanc']);
  });
});

describe('inventory mutations', () => {
  it('records every change with its source', () => {
    const ctx = ctxFor(freshDb(), 'mcp');
    const { result } = addIngredient(ctx, {
      name: 'Monin Passion Fruit',
      category: 'Syrup',
      subcategory: 'Monin',
    });
    expect(result.category).toBe('syrup');
    expect(result.location).toBe('fridge');
    const { changes } = setFillLevel(ctx, result.id, 'half');
    expect(changes[0]?.data).toMatchObject({
      changes: { fill_level: { from: 'full', to: 'half' } },
    });
    const acts = listActivity(ctx.db);
    expect(acts.map((a) => a.source)).toEqual(['mcp', 'mcp']);
    expect(acts[0]?.summary).toContain('fill level full -> half');
  });

  it('creates custom locations on the fly', () => {
    const ctx = ctxFor(freshDb());
    addIngredient(ctx, { name: 'Rum Punch', category: 'other', location: 'Party Cooler' });
    expect(listIngredientViews(ctx, { location: 'party_cooler' })).toHaveLength(1);
  });

  it('derives the level from exact ml', () => {
    const ctx = ctxFor(freshDb());
    const { result } = addIngredient(ctx, {
      name: 'Gin',
      category: 'spirit',
      amount_ml: 200,
      bottle_size_ml: 700,
    });
    expect(result.fill_level).toBe('quarter');
  });

  it('rejects unknown and ambiguous names', () => {
    const ctx = seededCtx();
    expect(() => setFillLevel(ctx, 'Rum', 'half')).toThrow(ShakyError);
    addIngredient(ctx, { name: 'Vodka', category: 'spirit' });
    expect(() => setFillLevel(ctx, 'Vodka', 'half')).toThrow(/Several/);
  });

  it('archives softly', () => {
    const ctx = seededCtx();
    archiveIngredient(ctx, 'Bourbon');
    expect(listIngredientViews(ctx).some((i) => i.name === 'Bourbon')).toBe(false);
    expect(
      listIngredientViews(ctx, { include_archived: true }).some((i) => i.name === 'Bourbon'),
    ).toBe(true);
  });
});

describe('log_mix', () => {
  it('deducts the recipe amounts and logs the drink', () => {
    const ctx = seededCtx('mcp');
    const { result, changes } = logMix(ctx, { recipe: 'Moscow Mule' });
    const byName = Object.fromEntries(result.deducted.map((d) => [d.name, d]));
    expect(byName.Vodka?.after.amount_ml).toBe(300); // half of 700 = 350, minus 5 cl
    expect(byName['Ginger Beer']?.after.quantity).toBe(4); // 200 ml bottle, 120 ml used
    expect(result.skipped).toEqual([]);
    expect(changes.at(-1)?.action).toBe('mixed');
  });

  it('opens the next small bottle when one is used up', () => {
    const ctx = seededCtx();
    logMix(ctx, { recipe: 'Moscow Mule', servings: 2 });
    const gb = getIngredientView(ctx, 'Ginger Beer');
    expect(gb.quantity).toBe(3);
  });

  it('can log without touching stock', () => {
    const ctx = seededCtx();
    const { result } = logMix(ctx, { recipe: 'Gin & Tonic', deduct: false });
    expect(result.deducted).toEqual([]);
    expect(getIngredientView(ctx, 'London Dry Gin').amount_ml).toBeNull();
  });
});

describe('equipment substitutes', () => {
  it('lets a jam jar stand in for a shaker', () => {
    const ctx = seededCtx();
    setEquipment(ctx, { name: 'Boston Shaker', available: false });
    saveRecipe(ctx, {
      name: 'Gin Sour',
      ingredients: [{ name: 'Gin', subcategory: 'gin', amount: 5 }],
      steps: [{ action: 'shake' }],
    });
    expect(getRecipeWithCheck(ctx, 'Gin Sour').availability.missing_equipment).toEqual(['shaker']);
    setEquipment(ctx, { name: 'Jam jar', type: 'other', substitutes_for: ['shaker'] });
    const check = getRecipeWithCheck(ctx, 'Gin Sour').availability;
    expect(check.missing_equipment).toEqual([]);
    expect(check.substitutes_used).toEqual([{ type: 'shaker', using: 'Jam jar' }]);
  });
});

describe('shopping list', () => {
  it('does not duplicate open items and marks bought', () => {
    const ctx = seededCtx();
    const a = addShopping(ctx, { name: 'dark rum' });
    expect(a.result.duplicate).toBe(true);
    const done = updateShoppingItem(ctx, a.result.item.id, { done: true });
    expect(done.changes[0]?.action).toBe('done');
  });
});

describe('fruit counted in pieces', () => {
  it('turns lime juice into limes via yield_ml', () => {
    const ctx = seededCtx();
    logMix(ctx, { recipe: 'Moscow Mule' });
    expect(getIngredientView(ctx, 'Limes').quantity).toBe(5.5); // 1.5 cl of a 3 cl lime
  });
});

describe('garnish matching', () => {
  it('does not take an orange slice from the orange liqueur', () => {
    const ctx = seededCtx();
    const sunrise = getRecipeWithCheck(ctx, 'Tequila Sunrise').availability;
    const slice = sunrise.lines.find((l) => l.name === 'Orange slice');
    expect(slice?.status).toBe('missing');
  });
});
