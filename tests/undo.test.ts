import { describe, expect, it } from 'vitest';
import {
  getIngredientView,
  listIngredientViews,
  setFillLevel,
  addIngredients,
} from '../src/core/inventory.js';
import { logMix } from '../src/core/mixing.js';
import { setEquipment, listEquipment } from '../src/core/catalog.js';
import { deleteRecipe, getRecipeWithCheck, saveRecipe } from '../src/core/recipes.js';
import { removeExampleData } from '../src/core/examples.js';
import { updateSettings } from '../src/core/settings.js';
import { listTrash, listUndoable, restoreFromTrash, undo } from '../src/core/undo.js';
import { ctxFor, seededCtx } from './helpers.js';

describe('undo', () => {
  it('undoes the last change, including a whole log_mix', () => {
    const ctx = seededCtx();
    const before = getIngredientView(ctx, 'Vodka');
    logMix(ctx, { recipe: 'Moscow Mule' });
    expect(getIngredientView(ctx, 'Vodka').amount_ml).toBe(300);
    const r = undo(ctx).result;
    expect(r.rows).toBeGreaterThanOrEqual(4);
    expect(getIngredientView(ctx, 'Vodka')).toMatchObject({
      amount_ml: before.amount_ml,
      fill_level: before.fill_level,
    });
    expect(ctx.db.prepare('SELECT COUNT(*) n FROM mix_log').get()).toEqual({ n: 0 });
  });

  it('refuses when the same rows changed later, unless forced', () => {
    const ctx = seededCtx();
    setFillLevel(ctx, 'London Dry Gin', 'half');
    const first = listUndoable(ctx, 1)[0]!.id;
    setFillLevel(ctx, 'London Dry Gin', 'quarter');
    expect(() => undo(ctx, { group: first })).toThrow(/Changed again/);
    undo(ctx, { group: first, force: true });
    expect(getIngredientView(ctx, 'London Dry Gin').fill_level).toBe('three_quarters');
  });

  it('does not undo an undo, and the next undo goes one step further back', () => {
    const ctx = seededCtx();
    setFillLevel(ctx, 'Bourbon', 'quarter');
    setFillLevel(ctx, 'Vodka', 'quarter');
    undo(ctx);
    undo(ctx);
    expect(getIngredientView(ctx, 'Bourbon').fill_level).toBe('half');
    expect(getIngredientView(ctx, 'Vodka').fill_level).toBe('half');
  });

  it('undoes settings and bulk adds', () => {
    const ctx = seededCtx();
    updateSettings(ctx, { units: 'oz' });
    undo(ctx);
    expect(ctx.db.prepare("SELECT value FROM settings WHERE key = 'units'").get()).toEqual({
      value: '"cl"',
    });
    addIngredients(ctx, [
      { name: 'A', category: 'other' },
      { name: 'B', category: 'other' },
    ]);
    undo(ctx);
    expect(listIngredientViews(ctx, { search: 'A' }).filter((i) => i.name === 'A')).toEqual([]);
  });
});

describe('trash', () => {
  it('keeps deleted equipment, recipes and example data restorable', () => {
    const ctx = seededCtx();
    setEquipment(ctx, { name: 'Blender', remove: true });
    deleteRecipe(ctx, 'Paloma');
    removeExampleData(ctx);
    const trash = listTrash(ctx);
    expect(trash.map((t) => t.name)).toContain('Blender');
    expect(trash.map((t) => t.name)).toContain('Paloma');
    const blender = trash.find((t) => t.name === 'Blender')!;
    restoreFromTrash(ctx, blender.id);
    expect(listEquipment(ctx.db).map((e) => e.name)).toEqual(['Blender']);
    const paloma = trash.find((t) => t.name === 'Paloma' && t.kind === 'recipe')!;
    restoreFromTrash(ctx, paloma.id);
    expect(getRecipeWithCheck(ctx, 'Paloma').name).toBe('Paloma');
    expect(listTrash(ctx).map((t) => t.name)).not.toContain('Blender');
  });
});

describe('dry run', () => {
  it('reports what would change and changes nothing', () => {
    const ctx = seededCtx();
    const dry = ctxFor(ctx.db, 'mcp');
    dry.dryRun = true;
    const r = removeExampleData(dry);
    expect(r.dry_run).toBe(true);
    expect(r.result.total).toBeGreaterThan(30);
    expect(listIngredientViews(ctx, { include_empty: true }).length).toBe(13);
    expect(
      ctx.db.prepare('SELECT COUNT(*) n FROM activity WHERE action = ?').get('examples_removed'),
    ).toEqual({ n: 0 });
    const s = saveRecipe(dry, {
      name: 'Ghost',
      ingredients: [{ name: 'Gin', subcategory: 'gin', amount: 5 }],
    });
    expect(s.result.name).toBe('Ghost');
    expect(() => getRecipeWithCheck(ctx, 'Ghost')).toThrow();
  });
});
