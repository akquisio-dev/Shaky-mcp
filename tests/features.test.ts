import { describe, expect, it } from 'vitest';
import { addIngredient, getIngredientView, updateIngredientFields } from '../src/core/inventory.js';
import { findMakeable, getRecipeWithCheck, saveRecipe } from '../src/core/recipes.js';
import { logMix } from '../src/core/mixing.js';
import { addPreference } from '../src/core/preferences.js';
import { makePreparation } from '../src/core/prep.js';
import { batchCalculator } from '../src/core/batch.js';
import { setEquipment } from '../src/core/catalog.js';
import { ctxFor, freshDb, NOW, seededCtx } from './helpers.js';

const day = 86_400_000;

describe('variants', () => {
  it('keeps several variants under one entry and deducts from them', () => {
    const ctx = ctxFor(freshDb());
    const rb = addIngredient(ctx, {
      name: 'Red Bull',
      category: 'mixer',
      subcategory: 'energy drink',
      container: 'can',
      bottle_size_ml: 250,
      variants: [
        { name: 'Original', quantity: 4 },
        { name: 'Sugarfree', quantity: 2, label_color: '#9ec8f0' },
      ],
    }).result;
    expect(rb.quantity).toBe(6);
    expect(getIngredientView(ctx, 'Red Bull (Sugarfree)').id).toBe(rb.id);
    saveRecipe(ctx, {
      name: 'Wings',
      ingredients: [{ name: 'Sugarfree energy', subcategory: 'sugarfree energy', amount: 25 }],
    });
    expect(getRecipeWithCheck(ctx, 'Wings').availability.status).toBe('makeable');
    logMix(ctx, { recipe: 'Wings' });
    const after = getIngredientView(ctx, rb.id);
    expect(after.quantity).toBe(5);
    expect(after.variants.map((v) => v.quantity)).toEqual([3, 2]);
  });
});

describe('best before', () => {
  it('warns about unopened juice by its best before date', () => {
    const ctx = ctxFor(freshDb());
    const juice = addIngredient(ctx, {
      name: 'Cranberry',
      category: 'juice',
      best_before: new Date(NOW.getTime() + 3 * day).toISOString().slice(0, 10),
    }).result;
    expect(juice.expiring_soon).toBe(true);
    expect(juice.days_left).toBe(3);
    // Once opened, the shelf life after opening counts (juice: 5 days).
    const opened = updateIngredientFields(ctx, juice.id, { opened_at: NOW.toISOString() }).result;
    expect(opened.days_left).toBe(5);
  });
});

describe('drink strength', () => {
  it('computes ABV with melt water and standard drinks', () => {
    const ctx = seededCtx();
    const mule = getRecipeWithCheck(ctx, 'Moscow Mule').strength;
    // 5 cl vodka at 40 % = 20 ml alcohol; 18.5 cl + 10 % melt water = 203.5 ml
    expect(mule.abv).toBeCloseTo(9.8, 1);
    expect(mule.standard_drinks).toBeCloseTo(1.6, 1);
    expect(mule.energy).toBe(false);
  });

  it('flags energy drink mixes', () => {
    const ctx = seededCtx();
    addIngredient(ctx, { name: 'Red Bull', category: 'mixer', subcategory: 'energy drink' });
    const r = saveRecipe(ctx, {
      name: 'Vodka Energy',
      ingredients: [
        { name: 'Vodka', subcategory: 'vodka', amount: 4 },
        { name: 'Energy drink', subcategory: 'energy drink', amount: 16 },
      ],
    }).result;
    expect(r.strength.energy).toBe(true);
  });
});

describe('preferences', () => {
  it('adjusts amounts in matching recipes without changing the saved recipe', () => {
    const ctx = seededCtx();
    saveRecipe(ctx, {
      name: 'Whiskey Sour',
      tags: ['sour'],
      ingredients: [
        { name: 'Bourbon', subcategory: 'bourbon', amount: 5 },
        { name: 'Lemon juice', subcategory: 'lemon juice', amount: 2.5 },
      ],
    });
    addPreference(ctx, {
      kind: 'adjust',
      ingredient: 'lemon juice',
      recipe_tag: 'sour',
      delta: -0.5,
    });
    const r = getRecipeWithCheck(ctx, 'Whiskey Sour');
    expect(r.ingredients.find((l) => l.name === 'Lemon juice')?.amount).toBe(2.5);
    expect(r.personal.ingredients.find((l) => l.name === 'Lemon juice')?.amount).toBe(2);
    expect(r.personal.adjustments[0]).toMatchObject({ line: 'Lemon juice', from: 2.5, to: 2 });
    // Not a sour: untouched.
    expect(getRecipeWithCheck(ctx, 'Moscow Mule').personal.adjustments).toEqual([]);
  });

  it('keeps avoided ingredients out of the suggestions', () => {
    const ctx = seededCtx();
    addPreference(ctx, { kind: 'avoid', ingredient: 'tequila' });
    const m = findMakeable(ctx, { include_missing_more: true });
    const names = [...m.makeable, ...m.missing_one, ...(m.missing_more ?? [])].map((c) => c.name);
    expect(names).not.toContain('Paloma');
    expect(m.avoided.map((a) => a.name).sort()).toEqual(['Paloma', 'Tequila Sunrise']);
  });

  it('deducts the personal amount when logging', () => {
    const ctx = seededCtx();
    addPreference(ctx, { kind: 'adjust', ingredient: 'vodka', recipe: 'Moscow Mule', delta: -1 });
    const { result } = logMix(ctx, { recipe: 'Moscow Mule' });
    expect(result.deducted.find((d) => d.name === 'Vodka')?.amount).toBe(4);
  });
});

describe('preparations', () => {
  it('turns sugar into simple syrup with a fresh shelf life', () => {
    const ctx = ctxFor(freshDb());
    addIngredient(ctx, {
      name: 'Sugar',
      category: 'other',
      container: 'pack',
      amount_ml: 1000,
      bottle_size_ml: 1000,
    });
    const r = makePreparation(ctx, { template: 'Simple syrup 1:1' }).result;
    expect(r.made_ml).toBe(800);
    expect(getIngredientView(ctx, 'Sugar').amount_ml).toBe(500);
    const syrup = getIngredientView(ctx, 'Simple syrup');
    expect(syrup).toMatchObject({
      category: 'syrup',
      amount_ml: 800,
      display_container: 'syrup_bottle',
    });
    expect(syrup.days_left).toBe(30);
    // A second batch refills the same bottle.
    makePreparation(ctx, { template: 'Simple syrup 1:1', output_ml: 400 });
    expect(getIngredientView(ctx, 'Simple syrup').amount_ml).toBe(1200);
    expect(getIngredientView(ctx, 'Sugar').amount_ml).toBe(250);
  });

  it('refuses when an input is missing', () => {
    const ctx = ctxFor(freshDb());
    expect(() => makePreparation(ctx, { template: 'Honey syrup' })).toThrow(/Not in stock.*Honey/);
  });
});

describe('batch calculator', () => {
  it('scales to the machine and warns when too strong to freeze', () => {
    const ctx = seededCtx();
    setEquipment(ctx, {
      name: 'Slushy',
      type: 'slush_machine',
      specs: { min_ml: 1000, max_ml: 2500 },
    });
    const strong = batchCalculator(ctx, { recipe: 'Moscow Mule', glasses: 4 });
    // 185 ml per glass x 4 = 740 ml < 1000 ml minimum
    expect(strong.total_ml).toBe(740);
    expect(strong.warnings.join(' ')).toContain('Below the machine minimum of 1000 ml');
    expect(strong.abv).toBeCloseTo(10.8, 1);
    expect(strong.warnings.join(' ')).toContain('too strong to freeze');
    expect(strong.top_up_ml).toBeGreaterThan(0);
    const auto = batchCalculator(ctx, { recipe: 'Lillet Tonic' });
    expect(auto.total_ml).toBeGreaterThanOrEqual(1000);
    expect(auto.amounts[0]).toMatchObject({ name: 'Lillet Blanc' });
  });
});
