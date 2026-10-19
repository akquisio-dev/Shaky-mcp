import { describe, expect, it } from 'vitest';
import { addIngredient, updateIngredientFields } from '../src/core/inventory.js';
import { saveRecipe } from '../src/core/recipes.js';
import { applyPartyShopping, planParty } from '../src/core/party.js';
import { applyDiets, listDietRules } from '../src/core/diets.js';
import { listShopping } from '../src/db/repos/misc.js';
import { recipeInputSchema } from '../src/core/schemas.js';
import { NOW, seededCtx } from './helpers.js';

describe('guest diets', () => {
  it('replaces egg white with aquafaba for vegans and flags nut allergies', () => {
    const ctx = seededCtx();
    const sour = recipeInputSchema.parse({
      name: 'Pisco Sour',
      ingredients: [
        { name: 'Pisco', subcategory: 'pisco', amount: 6 },
        { name: 'Egg white', subcategory: 'egg white', amount: 2 },
        { name: 'Orgeat', subcategory: 'orgeat', amount: 1 },
      ],
      steps: [
        { action: 'pour', ingredient: 'Egg white', amount: 2, unit: 'cl' },
        { action: 'shake' },
      ],
    });
    const r = applyDiets(sour, ['vegan', 'nut allergy'], listDietRules(ctx));
    expect(r.ingredients.map((l) => l.name)).toEqual(['Pisco', 'Aquafaba']);
    expect(r.replaced[0]).toMatchObject({ diet: 'vegan', line: 'Egg white', with: 'Aquafaba' });
    expect(r.blocked).toEqual([{ diet: 'nut allergy', line: 'Orgeat', note: 'almond syrup' }]);
    expect(r.steps[0]).toMatchObject({ ingredient: 'Aquafaba' });
  });
});

describe('party planner', () => {
  it('spreads drinks over guests, totals ingredients and finds what to buy', () => {
    const ctx = seededCtx();
    const plan = planParty(ctx, {
      guests: 10,
      drinks_per_guest: 2,
      recipes: ['Moscow Mule', 'Gin & Tonic'],
    });
    expect(plan.drinks.map((d) => [d.name, d.servings])).toEqual([
      ['Moscow Mule', 10],
      ['Gin & Tonic', 10],
    ]);
    const vodka = plan.ingredients.find((i) => i.name === 'Vodka')!;
    expect(vodka).toMatchObject({ need_ml: 500, have_ml: 350, enough: false });
    expect(plan.shopping.find((s) => s.name === 'Vodka')).toMatchObject({
      quantity: '1 x 700 ml',
      ml: 150,
    });
    // 10 mules x 120 ml ginger beer = 1200 ml, 4 x 200 ml in stock
    expect(plan.shopping.find((s) => s.name === 'Ginger Beer')?.quantity).toBe('2 x 200 ml');
    // Lime juice 10 x 15 ml from limes at 30 ml each: 5 limes, 6 there; wedges come on top.
    expect(plan.ingredients.find((i) => i.name === 'Limes' && i.need_ml)).toMatchObject({
      need_ml: 150,
      enough: true,
    });
    // Ice: both are built drinks with one add_ice step: 20 x 6 cubes
    expect(plan.ice).toMatchObject({ cubes_needed: 120, tracked: false, cubes_short: 120 });
  });

  it('knows the ice in the freezer and when to start freezing', () => {
    const ctx = seededCtx();
    addIngredient(ctx, { name: 'Ice cubes', category: 'ice', quantity: 60, freeze_hours: 6 });
    addIngredient(ctx, {
      name: 'Hexagon ice',
      category: 'ice',
      subcategory: 'large hexagon cubes',
      quantity: 8,
      freeze_hours: 10,
    });
    const at = new Date(NOW.getTime() + 24 * 3_600_000).toISOString();
    const plan = planParty(ctx, { guests: 5, recipes: ['Moscow Mule'], party_at: at });
    expect(plan.ice).toMatchObject({
      cubes_needed: 60,
      cubes_in_stock: 60,
      large_in_stock: 8,
      cubes_short: 0,
      tracked: true,
    });
    const more = planParty(ctx, { guests: 10, recipes: ['Moscow Mule'], party_at: at });
    expect(more.ice.cubes_short).toBe(60);
    expect(more.ice.start_freezing_by).toBe(new Date(NOW.getTime() + 18 * 3_600_000).toISOString());
    expect(more.ice.too_late).toBe(false);
  });

  it('adds the cost and puts missing things on the shopping list', () => {
    const ctx = seededCtx();
    updateIngredientFields(ctx, 'Lillet Blanc', { price: 15 });
    updateIngredientFields(ctx, 'Tonic Water', { price: 1 });
    const plan = planParty(ctx, {
      guests: 4,
      drinks_per_guest: 1,
      recipes: [{ recipe: 'Lillet Tonic', servings: 4 }],
    });
    // 50/750*15 = 1.00 + 100/200*1 = 0.50 per drink
    expect(plan.cost).toMatchObject({ amount: 6, complete: true });
    const done = applyPartyShopping(
      ctx,
      { guests: 20, recipes: ['Moscow Mule'] },
      'Party Saturday',
    );
    expect(done.result.shopping.length).toBeGreaterThan(0);
    expect(listShopping(ctx.db).map((s) => s.name)).toEqual(
      expect.arrayContaining(['Vodka', 'Ginger Beer', 'Ice cubes']),
    );
  });

  it('flags drinks that do not suit a diet', () => {
    const ctx = seededCtx();
    saveRecipe(ctx, {
      name: 'Almond Sour',
      ingredients: [
        { name: 'Bourbon', subcategory: 'bourbon', amount: 5 },
        { name: 'Orgeat', subcategory: 'orgeat', amount: 2 },
      ],
    });
    const plan = planParty(ctx, {
      guests: 2,
      recipes: ['Almond Sour', 'Moscow Mule'],
      diets: ['nut allergy'],
    });
    expect(plan.drinks[0]!.not_for).toEqual([
      { diet: 'nut allergy', line: 'Orgeat', note: 'almond syrup' },
    ]);
    expect(plan.drinks[1]!.not_for).toEqual([]);
    const free = planParty(ctx, { guests: 2, recipes: ['Moscow Mule'], diets: ['alcohol free'] });
    expect(free.drinks[0]!.not_for.map((b) => b.diet)).toContain('alcohol free');
  });
});
