import { describe, expect, it } from 'vitest';
import {
  addIngredient,
  getIngredientView,
  listIngredientViews,
  setFillLevel,
  updateIngredientFields,
} from '../src/core/inventory.js';
import { findMakeable, getRecipeWithCheck } from '../src/core/recipes.js';
import { logMix } from '../src/core/mixing.js';
import { addSubstitution } from '../src/core/substitutions.js';
import { readSeedFile, seed } from '../src/core/seed.js';
import {
  exportIngredientsCsv,
  exportRecipesCsv,
  importIngredientsCsv,
  importRecipesCsv,
  parseCsv,
} from '../src/core/csv.js';
import { barOverview } from '../src/core/overview.js';
import { recipeInputSchema } from '../src/core/schemas.js';
import { scoreMix, stepsToActions, type GameRecipe } from '../src/game/index.js';
import { ctxFor, freshDb, NOW, seededCtx } from './helpers.js';

const mocktails = () => readSeedFile(new URL('../examples/mocktails.json', import.meta.url));

describe('substitutions', () => {
  it('makes a recipe makeable with a stand-in and notes how it changes', () => {
    const ctx = seededCtx();
    setFillLevel(ctx, 'Ginger Beer', 'empty');
    expect(getRecipeWithCheck(ctx, 'Moscow Mule').availability.status).toBe('missing_one');
    addIngredient(ctx, {
      name: 'Ginger Ale',
      category: 'mixer',
      subcategory: 'ginger ale',
      bottle_size_ml: 200,
      quantity: 2,
    });
    const mule = getRecipeWithCheck(ctx, 'Moscow Mule').availability;
    expect(mule.status).toBe('with_substitute');
    expect(mule.substitutions).toEqual([
      { line: 'Ginger beer', using: 'Ginger Ale', note: 'milder, less spicy' },
    ]);
    expect(findMakeable(ctx).with_substitute.map((c) => c.name)).toContain('Moscow Mule');
    // 2 x 200 ml ginger ale / 120 ml = 3 drinks
    expect(mule.servings_possible).toBe(3);
    // Mixing takes it from the stand-in.
    const { result } = logMix(ctx, { recipe: 'Moscow Mule' });
    expect(result.deducted.map((d) => d.name)).toContain('Ginger Ale');
  });

  it('works both ways for two_way rules and applies the ratio', () => {
    const ctx = seededCtx();
    // Limes gone, lemons there: lime juice -> lemon juice (two way).
    updateIngredientFields(ctx, 'Limes', { quantity: 0 });
    addIngredient(ctx, {
      name: 'Lemons',
      category: 'fruit',
      provides: ['lemon juice'],
      quantity: 4,
      yield_ml: 35,
    });
    expect(getRecipeWithCheck(ctx, 'Moscow Mule').availability.status).toBe('with_substitute');
    addSubstitution(ctx, {
      for_words: 'vodka',
      use_words: 'gin',
      ratio: 0.8,
      note: 'more botanical',
    });
    setFillLevel(ctx, 'Vodka', 'empty');
    const { result } = logMix(ctx, { recipe: 'Moscow Mule' });
    expect(result.deducted.find((d) => d.name === 'London Dry Gin')?.amount).toBe(4);
  });
});

describe('use up first', () => {
  it('lists drinks that use soon-expiring bottles first', () => {
    const ctx = seededCtx();
    const r = findMakeable(ctx, { use_up: true });
    expect(r.makeable[0]?.name).toBe('Lillet Tonic');
    expect(r.makeable[0]?.uses_expiring[0]).toMatchObject({ bottle: 'Lillet Blanc', days_left: 5 });
    expect(barOverview(ctx).use_up_first[0]?.name).toBe('Lillet Tonic');
  });
});

describe('cost per drink', () => {
  it('adds up bottle prices, lime pieces included, and flags missing prices', () => {
    const ctx = seededCtx();
    updateIngredientFields(ctx, 'Vodka', { price: 14 }); // 700 ml
    updateIngredientFields(ctx, 'Ginger Beer', { price: 1.2 }); // 200 ml
    const partial = getRecipeWithCheck(ctx, 'Moscow Mule').cost;
    expect(partial).toMatchObject({ complete: false, missing_prices: ['Lime juice'] });
    updateIngredientFields(ctx, 'Limes', { price: 0.4 }); // per piece, 30 ml each
    const cost = getRecipeWithCheck(ctx, 'Moscow Mule').cost;
    // 50/700*14 = 1.00, 120/200*1.2 = 0.72, 15/30*0.4 = 0.20, wedge 1/8*0.4 = 0.05
    expect(cost).toMatchObject({ amount: 1.97, currency: 'EUR', complete: true });
  });
});

describe('alcohol free and mocktails', () => {
  it('marks mocktails and filters them; every mocktail plays perfectly', () => {
    const ctx = seededCtx();
    seed(ctx, mocktails(), { origin: 'example' });
    const free = findMakeable(ctx, { alcohol_free: true, include_missing_more: true });
    const names = [
      ...free.makeable,
      ...free.with_substitute,
      ...free.missing_one,
      ...(free.missing_more ?? []),
    ].map((c) => c.name);
    expect(names).toContain('Pineapple Ginger Cooler');
    expect(names).not.toContain('Moscow Mule');
    expect(getRecipeWithCheck(ctx, 'Pineapple Ginger Cooler')).toMatchObject({
      alcohol_free: true,
      availability: { status: 'makeable' },
    });
    for (const r of mocktails().recipes ?? []) {
      const g = recipeInputSchema.parse(r) as GameRecipe;
      const score = scoreMix(
        g,
        stepsToActions(g, (line) => ({ label: line, color: '#fff', line })),
      ).score;
      expect(score, g.name).toBeGreaterThanOrEqual(95);
    }
  });
});

describe('CSV', () => {
  it('round-trips ingredients and recipes', () => {
    const src = seededCtx();
    updateIngredientFields(src, 'Lillet Blanc', {
      price: 15.99,
      notes: 'opened, "the good one"; fridge',
    });
    const ing = exportIngredientsCsv(src);
    const rec = exportRecipesCsv(src);
    const dst = ctxFor(freshDb());
    expect(importIngredientsCsv(dst, ing).result.added).toHaveLength(13);
    expect(importRecipesCsv(dst, rec).result.saved).toHaveLength(12);
    expect(getIngredientView(dst, 'Lillet Blanc')).toMatchObject({
      price: 15.99,
      notes: 'opened, "the good one"; fridge',
      fill_level: 'half',
    });
    expect(
      findMakeable(dst)
        .makeable.map((c) => c.name)
        .sort(),
    ).toEqual(
      findMakeable(src)
        .makeable.map((c) => c.name)
        .sort(),
    );
  });

  it('reads German Excel files (semicolon, decimal comma) and updates known names', () => {
    const ctx = seededCtx();
    const csv =
      '\uFEFFname;category;quantity;price;tags\r\nVodka;spirit;2;12,50;\r\nMango Nektar;juice;1;1,99;mango|nectar\r\n';
    expect(parseCsv(csv)[1]).toMatchObject({ name: 'Mango Nektar', price: '1,99' });
    const r = importIngredientsCsv(ctx, csv).result;
    expect(r).toEqual({ added: ['Mango Nektar'], updated: ['Vodka'] });
    expect(getIngredientView(ctx, 'Vodka')).toMatchObject({
      quantity: 2,
      price: 12.5,
      fill_level: 'half',
    });
    expect(getIngredientView(ctx, 'Mango Nektar').tags).toEqual(['mango', 'nectar']);
  });

  it('names the bad row and changes nothing', () => {
    const ctx = seededCtx();
    const before = listIngredientViews(ctx, { include_empty: true }).length;
    expect(() => importIngredientsCsv(ctx, 'name,category\nGood,spirit\nNo category,\n')).toThrow(
      /Row 3 \(No category\)/,
    );
    expect(listIngredientViews(ctx, { include_empty: true }).length).toBe(before);
  });
});

void NOW;
