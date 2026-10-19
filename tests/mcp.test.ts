import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../src/mcp/server.js';
import { listActivity } from '../src/db/repos/misc.js';
import type { Db } from '../src/db/connection.js';
import { seededCtx } from './helpers.js';

let db: Db;
let client: Client;

beforeEach(async () => {
  db = seededCtx().db;
  const server = createMcpServer(db);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(b);
});

afterEach(async () => {
  await client.close();
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
  return {
    ...r,
    data: r.structuredContent as Record<string, any>,
    text: (r.content[0] as { text: string }).text,
  };
}

describe('MCP server', () => {
  it('lists all tools with descriptions', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of [
      'get_bar_overview',
      'list_ingredients',
      'get_ingredient',
      'add_ingredient',
      'update_ingredient',
      'archive_ingredient',
      'set_fill_level',
      'mark_opened',
      'get_expiring',
      'list_equipment',
      'set_equipment',
      'list_glassware',
      'set_glassware',
      'list_recipes',
      'get_recipe',
      'save_recipe',
      'delete_recipe',
      'find_makeable_recipes',
      'log_mix',
      'shopping_list_get',
      'shopping_list_add',
      'shopping_list_update',
    ]) {
      expect(names).toContain(n);
    }
    for (const t of tools) expect(t.description?.length).toBeGreaterThan(20);
    expect(client.getInstructions()).toContain('get_bar_overview');
  });

  it('get_bar_overview summarises stock and warnings', async () => {
    const r = await call('get_bar_overview');
    expect(r.isError).toBeFalsy();
    expect(r.data.in_stock.spirit.map((i: { name: string }) => i.name)).toContain('Tequila Blanco');
    expect(r.data.makeable_now).toContain('Moscow Mule');
    expect(r.text).toContain('Lillet Blanc');
  });

  it('set_fill_level changes stock, says what changed and logs source mcp', async () => {
    const r = await call('set_fill_level', { ingredient: 'Lillet Blanc', fill_level: 'quarter' });
    expect(r.data.changed[0]).toContain('half -> a quarter');
    const last = listActivity(db, { limit: 1 })[0]!;
    expect(last.source).toBe('mcp');
    expect(last.entity).toBe('ingredient');
  });

  it('returns readable errors instead of throwing', async () => {
    const r = await call('set_fill_level', { ingredient: 'Gin', fill_level: 'half' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('No ingredient named "Gin"');
    expect(r.text).toContain('London Dry Gin');
    const bad = await call('set_fill_level', { ingredient: 1, fill_level: 'sloshy' });
    expect(bad.isError).toBe(true);
  });

  it('adds a custom ingredient and saves an AI recipe that becomes makeable', async () => {
    const add = await call('add_ingredient', {
      name: 'Monin Passion Fruit',
      category: 'syrup',
      subcategory: 'monin',
      tags: ['passion fruit'],
      color: '#f2a900',
    });
    expect(add.data.ingredient.location).toBe('fridge');
    const save = await call('save_recipe', {
      name: 'Passion Mule',
      tags: ['fruity'],
      ingredients: [
        { name: 'Vodka', subcategory: 'vodka', amount: 4 },
        { name: 'Passion fruit syrup', subcategory: 'passion fruit', amount: 2 },
        { name: 'Ginger beer', subcategory: 'ginger beer', amount: 10 },
      ],
      steps: [
        { action: 'add_ice' },
        { action: 'pour', ingredient: 'Vodka', amount: 4, unit: 'cl' },
      ],
    });
    expect(save.isError).toBeFalsy();
    const mk = await call('find_makeable_recipes', {});
    expect(mk.data.makeable.map((m: { name: string }) => m.name)).toContain('Passion Mule');
    const recipe = await call('get_recipe', { recipe: 'Passion Mule' });
    expect(recipe.data.source).toBe('ai');
  });

  it('find_makeable_recipes reports the one missing ingredient', async () => {
    const r = await call('find_makeable_recipes', {});
    const stormy = r.data.missing_one.find((m: { name: string }) => m.name === "Dark 'n' Stormy");
    expect(stormy.missing).toEqual(['Dark rum']);
  });

  it('log_mix deducts and reports every change', async () => {
    const r = await call('log_mix', { recipe: 'Gin & Tonic' });
    expect(r.data.mix.deducted.map((d: { name: string }) => d.name).sort()).toEqual([
      'London Dry Gin',
      'Tonic Water',
    ]);
    expect(r.data.changed.length).toBeGreaterThanOrEqual(3);
  });

  it('set_equipment adds a substitute and shopping list round trip works', async () => {
    const e = await call('set_equipment', {
      name: 'Jam jar',
      type: 'other',
      substitutes_for: ['shaker'],
    });
    expect(e.data.item.substitutes_for).toEqual(['shaker']);
    const s = await call('shopping_list_add', {
      name: 'Orgeat',
      reason: 'Mai Tai',
      priority: 'high',
    });
    const id = s.data.item.id;
    const done = await call('shopping_list_update', { id, done: true });
    expect(done.data.item.done).toBe(true);
    const list = await call('shopping_list_get', {});
    expect(list.data.items.map((i: { name: string }) => i.name)).not.toContain('Orgeat');
  });

  it('serves resources and prompts', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      'shaky://bar/overview',
      'shaky://equipment',
      'shaky://inventory',
    ]);
    const inv = await client.readResource({ uri: 'shaky://inventory' });
    expect((inv.contents[0] as { text: string }).text).toContain('Cointreau');
    const p = await client.getPrompt({ name: 'suggest_drink', arguments: { mood: 'beach' } });
    expect(JSON.stringify(p.messages)).toContain('beach');
  });
});
