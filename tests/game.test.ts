import { describe, expect, it } from 'vitest';
import {
  apply,
  liquidMl,
  mixColors,
  newGame,
  replay,
  scoreMix,
  stepVessels,
  stepsToActions,
  type Action,
  type GameRecipe,
  type Source,
} from '../src/game/index.js';
import { readSeedFile } from '../src/core/seed.js';
import { recipeInputSchema } from '../src/core/schemas.js';

const src = (line: string, color = '#ffffff'): Source => ({ label: line, color, line });
const seedRecipes = (): GameRecipe[] =>
  (readSeedFile().recipes ?? []).map((r) => recipeInputSchema.parse(r) as GameRecipe);

describe('game engine', () => {
  it('stacks layers in pour order and merges repeated pours', () => {
    let s = newGame('highball');
    s = apply(s, { type: 'pour', vessel: 'glass', source: src('OJ', '#ff9900'), ml: 100 }).state;
    s = apply(s, { type: 'pour', vessel: 'glass', source: src('OJ', '#ff9900'), ml: 20 }).state;
    s = apply(s, {
      type: 'pour',
      vessel: 'glass',
      source: src('Grenadine', '#cc0022'),
      ml: 15,
    }).state;
    expect(s.vessels.glass.layers.map((l) => [l.label, l.ml])).toEqual([
      ['OJ', 120],
      ['Grenadine', 15],
    ]);
  });

  it('shaking mixes, straining dilutes and keeps the ice back', () => {
    const { state } = replay([
      { type: 'pour', vessel: 'shaker', source: src('Rum', '#f7f3e8'), ml: 50 },
      { type: 'pour', vessel: 'shaker', source: src('Lime', '#9acd32'), ml: 30 },
      { type: 'add_ice', vessel: 'shaker' },
      { type: 'shake', s: 12 },
      { type: 'strain', from: 'shaker' },
    ]);
    expect(state.vessels.shaker.layers).toEqual([]);
    expect(state.vessels.glass.ice).toBe(0);
    expect(state.vessels.glass.layers).toHaveLength(1);
    expect(liquidMl(state.vessels.glass)).toBe(100); // 80 ml + 25 % water
  });

  it('rejects impossible actions without changing the state', () => {
    const s = newGame();
    const r = apply(s, { type: 'shake', s: 10 });
    expect(r.rejected).toBe('shaker_empty');
    expect(r.state).toBe(s);
  });

  it('spills what does not fit', () => {
    const { state } = replay(
      [{ type: 'pour', vessel: 'glass', source: src('Soda'), ml: 500 }],
      'rocks',
    );
    expect(liquidMl(state.vessels.glass)).toBe(300);
    expect(state.spilled_ml).toBe(200);
  });

  it('mixes colors by volume', () => {
    expect(
      mixColors([
        { color: '#ff0000', ml: 1 },
        { color: '#0000ff', ml: 1 },
      ]),
    ).toBe('#800080');
  });
});

describe('recipe steps', () => {
  it('routes steps to the right vessel, including floats after straining', () => {
    const maiTai = seedRecipes().find((r) => r.name === 'Mai Tai')!;
    const v = stepVessels(maiTai.steps);
    expect(v.slice(0, 6)).toEqual(['shaker', 'shaker', 'shaker', 'shaker', 'shaker', 'shaker']);
    expect(v[7]).toBe('glass'); // dark rum float
    const colada = seedRecipes().find((r) => r.name === 'Piña Colada')!;
    expect(stepVessels(colada.steps)[3]).toBe('blender'); // ice goes into the blender
  });

  it('every seed recipe played perfectly scores at least 95', () => {
    for (const r of seedRecipes()) {
      const actions = stepsToActions(r, (line) => src(line));
      const result = scoreMix(r, actions);
      expect({ name: r.name, score: result.score, feedback: result.feedback }).toMatchObject({
        name: r.name,
        score: expect.any(Number),
      });
      expect(result.score, `${r.name}: ${JSON.stringify(result.feedback)}`).toBeGreaterThanOrEqual(
        95,
      );
      expect(replay(actions).rejected, r.name).toEqual([]);
    }
  });
});

describe('scoring', () => {
  const mule = () => seedRecipes().find((r) => r.name === 'Moscow Mule')!;
  const daiquiri = () => seedRecipes().find((r) => r.name === 'Strawberry Daiquiri')!;

  it('punishes wrong amounts and names the line', () => {
    const actions: Action[] = [
      { type: 'add_ice', vessel: 'glass' },
      { type: 'pour', vessel: 'glass', source: src('Vodka'), ml: 100 },
      { type: 'pour', vessel: 'glass', source: src('Lime juice'), ml: 15 },
      { type: 'pour', vessel: 'glass', source: src('Ginger beer'), ml: 120 },
      { type: 'stir', vessel: 'glass', s: 5 },
      { type: 'garnish', source: src('Lime wedge') },
    ];
    const r = scoreMix(mule(), actions);
    expect(r.score).toBeLessThan(90);
    expect(r.feedback).toContainEqual(
      expect.objectContaining({ code: 'amount_off', line: 'Vodka' }),
    );
  });

  it('notices a skipped technique, extras and a missing garnish', () => {
    const r = scoreMix(daiquiri(), [
      { type: 'add', vessel: 'blender', source: src('Strawberries'), count: 5 },
      { type: 'pour', vessel: 'blender', source: src('White rum'), ml: 50 },
      { type: 'pour', vessel: 'blender', source: src('Lime juice'), ml: 20 },
      { type: 'pour', vessel: 'blender', source: src('Simple syrup'), ml: 15 },
      { type: 'pour', vessel: 'blender', source: { label: 'Ketchup', color: '#c00' } },
      { type: 'transfer', from: 'blender' },
    ] as Action[]);
    const codes = r.feedback.map((f) => f.code);
    expect(codes).toContain('technique_missing');
    expect(codes).toContain('extra_ingredient');
    expect(r.stars).toBeLessThan(3);
  });

  it('uses a resolver to map real bottles to recipe lines', () => {
    const names = mule().ingredients.map((l) => l.name);
    const actions = stepsToActions(mule(), (line) => ({
      label: `bottle for ${line}`,
      color: '#fff',
      ingredient_id: names.indexOf(line) + 100,
    }));
    const r = scoreMix(mule(), actions, (s) =>
      s.ingredient_id !== undefined ? names[s.ingredient_id - 100] : s.line,
    );
    expect(r.score).toBeGreaterThanOrEqual(95);
  });
});
