import { z } from 'zod';
import { insertRow, parseJson, updateRow } from '../db/sql.js';
import { getRecipe, type Recipe } from '../db/repos/recipes.js';
import {
  feedbackText,
  scoreMix,
  type Action,
  type GameRecipe,
  type ScoreResult,
  type Source,
} from '../game/index.js';
import { mutate, nowIso, ShakyError, type Ctx } from './context.js';
import { listIngredientViews } from './inventory.js';
import { matchesSpec } from './matching.js';
import { resolveRecipe } from './recipes.js';

export type TrainingStatus = 'pending' | 'active' | 'done' | 'cancelled';

export interface Training {
  id: number;
  recipe_id: number | null;
  recipe_name: string;
  status: TrainingStatus;
  note: string | null;
  show_steps: boolean;
  sandbox: boolean;
  source: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: ScoreResult | null;
}

type Row = Omit<Training, 'show_steps' | 'sandbox' | 'result'> & {
  show_steps: number;
  sandbox: number;
  result: string | null;
  actions: string | null;
};

const map = (r: Row): Training => ({
  id: r.id,
  recipe_id: r.recipe_id,
  recipe_name: r.recipe_name,
  status: r.status,
  note: r.note,
  show_steps: r.show_steps === 1,
  sandbox: r.sandbox === 1,
  source: r.source,
  created_at: r.created_at,
  started_at: r.started_at,
  finished_at: r.finished_at,
  result: parseJson<ScoreResult | null>(r.result, null),
});

export function getTraining(ctx: Ctx, id: number): Training {
  const r = ctx.db.prepare('SELECT * FROM trainings WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new ShakyError('not_found', `No training with id ${id}.`);
  return map(r);
}

export function listTrainings(ctx: Ctx, opts: { open?: boolean; limit?: number } = {}): Training[] {
  const where = opts.open ? "WHERE status IN ('pending', 'active')" : '';
  return (
    ctx.db
      .prepare(`SELECT * FROM trainings ${where} ORDER BY id DESC LIMIT ?`)
      .all(opts.limit ?? 20) as Row[]
  ).map(map);
}

export const startTrainingSchema = z.object({
  recipe: z.union([z.number().int().positive(), z.string().trim().min(1)]),
  note: z.string().trim().max(300).optional(),
  show_steps: z.boolean().default(true),
  sandbox: z.boolean().default(false),
});

/** Creates a training. Any other open training is cancelled: one at a time. */
export function startTraining(ctx: Ctx, input: z.input<typeof startTrainingSchema>) {
  const p = startTrainingSchema.parse(input);
  return mutate(ctx, (cs) => {
    const recipe = resolveRecipe(ctx, p.recipe);
    for (const open of listTrainings(ctx, { open: true })) {
      updateRow(ctx.db, 'trainings', open.id, { status: 'cancelled', finished_at: nowIso(ctx) });
      cs.record({
        entity: 'training',
        entity_id: open.id,
        action: 'cancelled',
        summary: `Training for ${open.recipe_name} was replaced by a new one.`,
        data: { name: open.recipe_name },
      });
    }
    const id = insertRow(ctx.db, 'trainings', {
      recipe_id: recipe.id,
      recipe_name: recipe.name,
      status: 'pending',
      note: p.note ?? null,
      show_steps: p.show_steps,
      sandbox: p.sandbox,
      source: ctx.source,
      created_at: nowIso(ctx),
    });
    cs.record({
      entity: 'training',
      entity_id: id,
      action: 'created',
      summary: `Training ready: ${recipe.name}.`,
      data: { name: recipe.name, recipe_id: recipe.id },
    });
    return getTraining(ctx, id);
  });
}

export function markTrainingStarted(ctx: Ctx, id: number) {
  return mutate(ctx, (cs) => {
    const t = getTraining(ctx, id);
    if (t.status !== 'pending') return t;
    updateRow(ctx.db, 'trainings', id, { status: 'active', started_at: nowIso(ctx) });
    cs.record({
      entity: 'training',
      entity_id: id,
      action: 'started',
      summary: `Training for ${t.recipe_name} started.`,
      data: { name: t.recipe_name },
    });
    return getTraining(ctx, id);
  });
}

export function cancelTraining(ctx: Ctx, id: number) {
  return mutate(ctx, (cs) => {
    const t = getTraining(ctx, id);
    if (t.status === 'done' || t.status === 'cancelled') return t;
    updateRow(ctx.db, 'trainings', id, { status: 'cancelled', finished_at: nowIso(ctx) });
    cs.record({
      entity: 'training',
      entity_id: id,
      action: 'cancelled',
      summary: `Training for ${t.recipe_name} was cancelled.`,
      data: { name: t.recipe_name },
    });
    return getTraining(ctx, id);
  });
}

// ---------- submitted action log ----------

const vessel = z.enum(['glass', 'shaker', 'blender', 'mixing_glass']);
const tool = z.enum(['shaker', 'blender', 'mixing_glass']);
const source = z.object({
  label: z.string().max(80),
  color: z.string().max(20),
  ingredient_id: z.number().int().positive().optional(),
  line: z.string().max(80).optional(),
});
const secs = z.number().min(0).max(600);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('choose_glass'), glass: z.string().max(40) }),
  z.object({ type: z.literal('chill_glass') }),
  z.object({
    type: z.literal('add_ice'),
    vessel,
    cubes: z.number().int().min(1).max(40).optional(),
    crushed: z.boolean().optional(),
  }),
  z.object({ type: z.literal('pour'), vessel, source, ml: z.number().min(0).max(2000) }),
  z.object({ type: z.literal('add'), vessel, source, count: z.number().min(0).max(100) }),
  z.object({ type: z.literal('muddle'), vessel, s: secs }),
  z.object({ type: z.literal('shake'), s: secs }),
  z.object({ type: z.literal('stir'), vessel, s: secs }),
  z.object({ type: z.literal('blend'), s: secs }),
  z.object({ type: z.literal('strain'), from: tool }),
  z.object({ type: z.literal('transfer'), from: tool }),
  z.object({ type: z.literal('garnish'), source }),
  z.object({ type: z.literal('empty'), vessel }),
]);
export const actionLogSchema = z.array(actionSchema).max(500);

/**
 * Maps a poured or garnished source to a recipe line. Real bottles are matched
 * on the server with the same fuzzy rules as the inventory, the client's own
 * line claim is ignored. Virtual sandbox bottles only count in sandbox trainings.
 */
function resolver(ctx: Ctx, recipe: Recipe, sandbox: boolean) {
  const stock = new Map(
    listIngredientViews(ctx, { include_empty: true, include_archived: true }).map((i) => [i.id, i]),
  );
  return (s: Source, purpose: 'pour' | 'garnish'): string | undefined => {
    if (s.ingredient_id === undefined) {
      return sandbox && recipe.ingredients.some((l) => l.name === s.line) ? s.line : undefined;
    }
    const ing = stock.get(s.ingredient_id);
    if (!ing) return undefined;
    const hits = recipe.ingredients.filter((l) => matchesSpec(l, ing));
    const preferred = hits.find((l) => (purpose === 'garnish' ? l.garnish : !l.garnish));
    return (preferred ?? hits[0])?.name;
  };
}

export function submitTraining(ctx: Ctx, id: number, actions: unknown) {
  const log = actionLogSchema.parse(actions) as Action[];
  return mutate(ctx, (cs) => {
    const t = getTraining(ctx, id);
    if (t.status === 'done')
      throw new ShakyError('conflict', 'This training was already handed in.');
    if (t.status === 'cancelled') throw new ShakyError('conflict', 'This training was cancelled.');
    const recipe = t.recipe_id !== null ? getRecipe(ctx.db, t.recipe_id) : undefined;
    if (!recipe) throw new ShakyError('not_found', 'The recipe of this training was deleted.');
    const result = scoreMix(recipe as GameRecipe, log, resolver(ctx, recipe, t.sandbox));
    updateRow(ctx.db, 'trainings', id, {
      status: 'done',
      started_at: t.started_at ?? nowIso(ctx),
      finished_at: nowIso(ctx),
      actions: log,
      result,
    });
    cs.record({
      entity: 'training',
      entity_id: id,
      action: 'finished',
      summary: `Training ${recipe.name}: ${result.score}/100, ${result.stars} star(s).`,
      data: { name: recipe.name, score: result.score, stars: result.stars },
    });
    return getTraining(ctx, id);
  });
}

/** A compact, readable result for the AI. */
export function describeTraining(t: Training) {
  return {
    id: t.id,
    recipe: t.recipe_name,
    status: t.status,
    ...(t.note && { note: t.note }),
    show_steps: t.show_steps,
    sandbox: t.sandbox,
    created_at: t.created_at,
    ...(t.finished_at && { finished_at: t.finished_at }),
    ...(t.result && {
      score: t.result.score,
      stars: t.result.stars,
      parts: t.result.parts,
      amounts: t.result.lines.map((l) => ({
        line: l.name,
        expected: Math.round(l.expected * 10) / 10,
        poured: Math.round(l.actual * 10) / 10,
        unit: l.unit,
      })),
      feedback: t.result.feedback.map(feedbackText),
    }),
  };
}
