import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../src/mcp/server.js';
import { listActivity } from '../src/db/repos/misc.js';
import type { Ctx } from '../src/core/context.js';
import { seededCtx } from './helpers.js';

let ctx: Ctx;
let client: Client;

beforeEach(async () => {
  ctx = seededCtx();
  const server = createMcpServer(ctx.db);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 't', version: '0' });
  await client.connect(b);
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
  return {
    ...r,
    data: r.structuredContent as Record<string, any>,
    text: (r.content[0] as { text: string }).text,
  };
}

describe('advice tools', () => {
  it('check_recipe_lines checks an unsaved drink', async () => {
    const r = await call('check_recipe_lines', {
      name: 'Tom Collins',
      ingredients: [
        { name: 'Gin', subcategory: 'gin', amount: 5 },
        { name: 'Lime juice', subcategory: 'lime juice', amount: 2.5 },
        { name: 'Simple syrup', category: 'syrup', subcategory: 'sugar', amount: 1.5 },
        { name: 'Soda', category: 'mixer', subcategory: 'soda', amount: 6 },
      ],
      steps: [
        { action: 'shake' },
        { action: 'strain' },
        { action: 'top_up', ingredient: 'Soda', amount: 6, unit: 'cl' },
      ],
    });
    expect(r.data.availability.status).toBe('missing_one');
    expect(r.data.availability.missing).toEqual(['Simple syrup']);
    expect(r.data.strength.abv).toBeGreaterThan(10);
    expect(r.text).toContain('missing Simple syrup');
    expect(
      ctx.db.prepare("SELECT COUNT(*) n FROM recipes WHERE name = 'Tom Collins'").get(),
    ).toEqual({ n: 0 });
  });

  it('find_recipes_by_ingredient by words and by bottle', async () => {
    const words = await call('find_recipes_by_ingredient', { ingredient: 'tequila' });
    expect(words.data.recipes.map((r: { name: string }) => r.name).sort()).toEqual([
      'Paloma',
      'Tequila Sunrise',
    ]);
    const bottle = await call('find_recipes_by_ingredient', { ingredient: 'Limes' });
    expect(bottle.data.ingredient.name).toBe('Limes');
    expect(bottle.data.recipes[0].status).toBe('makeable');
    expect(bottle.data.recipes.length).toBeGreaterThan(5);
  });

  it('suggest_purchases ranks the bottle that unlocks most', async () => {
    const r = await call('suggest_purchases', { limit: 3 });
    const top = r.data.items[0];
    expect(top.buy).toBe('dark rum');
    expect(top.unlocks).toEqual(["Dark 'n' Stormy"]);
    expect(top.helps).toEqual(expect.arrayContaining(['Mai Tai', 'Painkiller']));
  });

  it('surprise_me picks a makeable drink and respects filters', async () => {
    const r = await call('surprise_me', {});
    expect(['Moscow Mule', 'Gin & Tonic', 'Lillet Tonic']).toContain(r.data.recipe.name);
    const none = await call('surprise_me', { alcohol_free: true });
    expect(none.data.recipe).toBeNull();
    await call('log_mix', { recipe: 'Moscow Mule' });
    await call('log_mix', { recipe: 'Gin & Tonic' });
    for (let i = 0; i < 5; i++)
      expect((await call('surprise_me', {})).data.recipe.name).toBe('Lillet Tonic');
  });
});

describe('history and stats', () => {
  it('lists, rates and summarises mixes', async () => {
    await call('update_ingredient', { ingredient: 'Vodka', price: 14 });
    await call('log_mix', { recipe: 'Moscow Mule', servings: 2 });
    await call('log_mix', { recipe: 'Gin & Tonic' });
    const h = await call('get_mix_history', {});
    expect(h.data.items.map((m: { name: string }) => m.name)).toEqual([
      'Gin & Tonic',
      'Moscow Mule',
    ]);
    const rated = await call('rate_mix', { rating: 5, notes: 'perfect with lots of lime' });
    expect(rated.data.mix).toMatchObject({ name: 'Gin & Tonic', rating: 5 });
    const s = await call('bar_stats', { days: 7 });
    expect(s.data.drinks_mixed).toBe(3);
    expect(s.data.top_drinks[0]).toMatchObject({ name: 'Moscow Mule', count: 2 });
    expect(s.data.consumption.find((c: { name: string }) => c.name === 'Vodka')).toMatchObject({
      ml: 100,
      cost: 2,
    });
    expect(s.data.standard_drinks.total).toBeGreaterThan(4);
    expect(s.data.never_mixed).toContain('Paloma');
  });
});

describe('stock tools', () => {
  it('shopping_checkout restocks, replaces an empty bottle and creates new items', async () => {
    await call('set_fill_level', { ingredient: 'Vodka', fill_level: 'empty' });
    const v = await call('shopping_list_add', { name: 'Vodka' });
    const rum = (await call('shopping_list_get', {})).data.items.find(
      (i: { name: string }) => i.name === 'Dark rum',
    );
    const missing = await call('shopping_checkout', { items: [{ id: rum.id }] });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('Pass new_ingredient');
    const r = await call('shopping_checkout', {
      items: [
        { id: v.data.item.id, add_quantity: 2 },
        {
          id: rum.id,
          new_ingredient: { name: 'Dark Rum', category: 'spirit', subcategory: 'dark rum' },
        },
      ],
    });
    expect(r.data.done).toEqual([
      { item: 'Vodka', stock: 'Vodka', quantity: 2, created: false },
      { item: 'Dark rum', stock: 'Dark Rum', quantity: 1, created: true },
    ]);
    const vodka = await call('get_ingredient', { ingredient: 'Vodka' });
    expect(vodka.data).toMatchObject({ fill_level: 'full', quantity: 2, amount_ml: null });
    expect(
      (await call('find_makeable_recipes', {})).data.makeable.map((m: { name: string }) => m.name),
    ).toContain("Dark 'n' Stormy");
    expect((await call('shopping_list_get', {})).data.items).toEqual([]);
  });

  it('update_ingredients changes many in one undo step', async () => {
    const r = await call('update_ingredients', {
      items: [
        { ingredient: 'Vodka', price: 14 },
        { ingredient: 'Bourbon', location: 'bar cart' },
      ],
    });
    expect(r.data.items).toHaveLength(2);
    const bad = await call('update_ingredients', {
      items: [
        { ingredient: 'Vodka', price: 1 },
        { ingredient: 'Nope', price: 2 },
      ],
    });
    expect(bad.text).toContain('Item 2 (Nope)');
    expect((await call('get_ingredient', { ingredient: 'Vodka' })).data.price).toBe(14);
    await call('undo', {});
    expect((await call('get_ingredient', { ingredient: 'Bourbon' })).data.location).toBe('shelf');
    expect((await call('get_ingredient', { ingredient: 'Vodka' })).data.price).toBeNull();
  });

  it('show_in_web writes a navigation event and nothing else', async () => {
    const r = await call('show_in_web', { view: 'make', recipe: 'Mai Tai' });
    expect(r.data.route).toMatch(/^#\/make\?recipe=\d+$/);
    expect(listActivity(ctx.db, { limit: 1 })[0]).toMatchObject({
      entity: 'ui',
      action: 'navigate',
      source: 'mcp',
    });
    expect(
      (await call('list_undoable', {})).data.items.some((g: { label: string }) =>
        g.label?.includes('web UI'),
      ),
    ).toBe(false);
  });
});
