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
  updateIngredientFields,
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
      provides: [],
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

describe('backup', () => {
  it('round-trips the bar through export and import', async () => {
    const { exportBar, importBar } = await import('../src/core/backup.js');
    const src = seededCtx();
    addIngredient(src, { name: 'Falernum', category: 'liqueur', location: 'bar_cart' });
    archiveIngredient(src, 'Bourbon');
    const doc = JSON.parse(JSON.stringify(exportBar(src)));

    const dst = ctxFor(freshDb());
    const { result } = importBar(dst, doc, 'replace');
    expect(result.ingredients).toBe(14);
    expect(result.recipes).toBe(12);
    const lillet = getIngredientView(dst, 'Lillet Blanc');
    expect(lillet.opened_at).toBe(getIngredientView(src, 'Lillet Blanc').opened_at);
    expect(
      listIngredientViews(dst, { include_archived: true }).find((i) => i.name === 'Bourbon')
        ?.archived,
    ).toBe(true);
    expect(listIngredientViews(dst, { location: 'bar_cart' }).map((i) => i.name)).toEqual([
      'Falernum',
    ]);
    expect(findMakeable(dst).makeable.length).toBe(findMakeable(src).makeable.length);
  });

  it('merges without duplicating and rejects invalid files', async () => {
    const { exportBar, importBar } = await import('../src/core/backup.js');
    const ctx = seededCtx();
    const { result } = importBar(ctx, exportBar(ctx), 'merge');
    expect(result.ingredients).toBe(0);
    expect(() => importBar(ctx, { recipes: [{ name: 'x' }] })).toThrow();
  });
});

describe('setup feedback (v1.1)', () => {
  const ing = (p: Partial<IngredientView>): IngredientView =>
    ({
      id: 1,
      name: 'x',
      brand: null,
      category: 'spirit',
      subcategory: null,
      tags: [],
      provides: [],
      archived: false,
      ...p,
    }) as IngredientView;
  const spec = (p: object) => recipeIngredientSchema.parse({ name: 'x', ...p });

  it('lets a tag or provided phrase beat the recipe category (limes for lime juice)', () => {
    const limes = ing({ name: 'Limes', category: 'fruit', tags: ['lime juice'] });
    expect(matchesSpec(spec({ category: 'juice', subcategory: 'lime juice' }), limes)).toBe(true);
    const lemons = ing({
      name: 'Lemons',
      category: 'fruit',
      provides: ['lemon juice', 'lemon zest'],
    });
    expect(matchesSpec(spec({ category: 'juice', subcategory: 'lemon juice' }), lemons)).toBe(true);
    expect(matchesSpec(spec({ category: 'garnish', subcategory: 'lemon zest' }), lemons)).toBe(
      true,
    );
    // A partial tag is not enough to override the category.
    expect(
      matchesSpec(
        spec({ category: 'juice', subcategory: 'lime' }),
        ing({ category: 'fruit', tags: ['lime juice'] }),
      ),
    ).toBe(false);
  });

  it('can keep flavored variants out with exact or exclude', () => {
    const wild = ing({
      name: 'Schweppes Wild Berry',
      category: 'mixer',
      subcategory: 'wild berry tonic water',
    });
    const plain = ing({ name: 'Tonic Water', category: 'mixer', subcategory: 'tonic water' });
    expect(matchesSpec(spec({ subcategory: 'tonic' }), wild)).toBe(true);
    expect(matchesSpec(spec({ subcategory: 'tonic water', exact: true }), wild)).toBe(false);
    expect(matchesSpec(spec({ subcategory: 'tonic water', exact: true }), plain)).toBe(true);
    expect(matchesSpec(spec({ subcategory: 'tonic', exclude: ['wild berry'] }), wild)).toBe(false);
    expect(matchesSpec(spec({ subcategory: 'tonic', exclude: ['wild berry'] }), plain)).toBe(true);
  });

  it('says how many times a drink can be made', () => {
    const ctx = seededCtx();
    // Vodka half of 700 = 350 ml / 50 = 7; ginger beer 4 x 200 / 120 = 6; limes 6 x 30 / 15 = 12.
    expect(getRecipeWithCheck(ctx, 'Moscow Mule').availability.servings_possible).toBe(6);
    updateIngredientFields(ctx, 'Limes', { quantity: 1 });
    expect(getRecipeWithCheck(ctx, 'Moscow Mule').availability.servings_possible).toBe(2);
    expect(getRecipeWithCheck(ctx, 'Paloma').availability.servings_possible).toBe(0);
  });

  it('does not warn that empty things expire', () => {
    const ctx = seededCtx();
    setFillLevel(ctx, 'Pineapple Juice', 'empty');
    const w = barOverview(ctx).warnings.filter((x) => x.name === 'Pineapple Juice');
    expect(w.map((x) => x.kind)).toEqual(['empty']);
    expect(getExpiring(ctx, 30).map((i) => i.name)).not.toContain('Pineapple Juice');
  });

  it('stirs with a household spoon when there is no bar spoon', () => {
    const ctx = seededCtx();
    setEquipment(ctx, { name: 'Bar Spoon', remove: true });
    const mule = getRecipeWithCheck(ctx, 'Moscow Mule').availability;
    expect(mule.missing_equipment).toEqual([]);
    expect(mule.substitutes_used).toEqual([{ type: 'bar_spoon', using: 'spoon' }]);
  });
});

describe('example data from older bars', () => {
  it('finds unchanged example rows even without the origin mark', async () => {
    const { countExampleData, removeExampleData } = await import('../src/core/examples.js');
    const ctx = ctxFor(freshDb());
    const { seed: load, readSeedFile } = await import('../src/core/seed.js');
    load(ctx, readSeedFile()); // like a 1.0 bar: no origin
    const later = ctxFor(ctx.db, 'web', new Date(NOW.getTime() + 60_000));
    updateIngredientFields(later, 'Bourbon', { notes: 'my favourite' });
    const n = countExampleData(ctx);
    removeExampleData(ctx);
    expect(n).toBeGreaterThan(30);
    expect(listIngredientViews(ctx, { include_empty: true }).map((i) => i.name)).toEqual([
      'Bourbon',
    ]);
  });
});

describe('containers', () => {
  it('uses the category default and treats cans and fruit as counted', () => {
    const ctx = ctxFor(freshDb());
    const juice = addIngredient(ctx, { name: 'Mango', category: 'juice' }).result;
    expect(juice.display_container).toBe('tetra_pak');
    expect(juice.counted).toBe(false);
    const can = addIngredient(ctx, {
      name: 'Red Bull',
      category: 'mixer',
      container: 'can',
      label_color: '#2a52be',
      bottle_size_ml: 250,
      quantity: 4,
    }).result;
    expect(can).toMatchObject({ display_container: 'can', counted: true, label_color: '#2a52be' });
    expect(can.stock_ml).toBe(1000);
    const lemon = addIngredient(ctx, { name: 'Lemon', category: 'fruit' }).result;
    expect(lemon.display_container).toBe('fruit');
  });
});
