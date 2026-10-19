import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { stepsToActions, type Action, type GameRecipe } from '../src/game/index.js';
import { getRecipeWithCheck } from '../src/core/recipes.js';
import {
  getTraining,
  listTrainings,
  markTrainingStarted,
  startTraining,
  submitTraining,
} from '../src/core/training.js';
import { createMcpServer } from '../src/mcp/server.js';
import type { Ctx } from '../src/core/context.js';
import { seededCtx } from './helpers.js';

/** Perfect play using the real bottles the recipe check found. */
function perfectWithBottles(ctx: Ctx, name: string, wrongLines = false): Action[] {
  const r = getRecipeWithCheck(ctx, name);
  return stepsToActions(r as unknown as GameRecipe, (line) => {
    const hit = r.availability.lines.find((l) => l.name === line)?.match;
    return hit
      ? {
          label: hit.name,
          color: '#fff',
          ingredient_id: hit.id,
          ...(wrongLines ? { line: 'Ginger beer' } : {}),
        }
      : { label: line, color: '#fff', line };
  });
}

describe('trainings', () => {
  it('scores a perfect play with real bottles, ignoring line claims from the client', () => {
    const ctx = seededCtx('mcp');
    const t = startTraining(ctx, { recipe: 'Moscow Mule' }).result.training;
    expect(t.status).toBe('pending');
    markTrainingStarted(ctx, t.id);
    const done = submitTraining(ctx, t.id, perfectWithBottles(ctx, 'Moscow Mule', true)).result;
    expect(done.status).toBe('done');
    expect(done.result?.score).toBeGreaterThanOrEqual(95);
  });

  it('only counts virtual bottles in sandbox trainings', () => {
    const ctx = seededCtx();
    const plain = startTraining(ctx, { recipe: "Dark 'n' Stormy", sandbox: false }).result.training;
    const a = submitTraining(ctx, plain.id, perfectWithBottles(ctx, "Dark 'n' Stormy")).result;
    expect(a.result?.feedback.map((f) => f.code)).toContain('missing_ingredient');
    const sandbox = startTraining(ctx, { recipe: "Dark 'n' Stormy" }).result.training;
    expect(sandbox.sandbox).toBe(true);
    const b = submitTraining(ctx, sandbox.id, perfectWithBottles(ctx, "Dark 'n' Stormy")).result;
    expect(b.result?.score).toBeGreaterThanOrEqual(95);
  });

  it('keeps one open training and refuses double submission or bad logs', () => {
    const ctx = seededCtx();
    const first = startTraining(ctx, { recipe: 'Paloma' }).result.training;
    const second = startTraining(ctx, { recipe: 'Mojito' }).result.training;
    expect(getTraining(ctx, first.id).status).toBe('cancelled');
    expect(listTrainings(ctx, { open: true }).map((t) => t.id)).toEqual([second.id]);
    expect(() => submitTraining(ctx, second.id, [{ type: 'pour', ml: -1 }])).toThrow();
    submitTraining(ctx, second.id, []);
    expect(() => submitTraining(ctx, second.id, [])).toThrow(/already/);
  });
});

describe('training over MCP', () => {
  it('starts a training and reports pending, then the score', async () => {
    const ctx = seededCtx();
    const server = createMcpServer(ctx.db, { webUrl: 'http://localhost:9999' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 't', version: '0' });
    await client.connect(b);
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult & {
        structuredContent: any;
      };

    const start = await call('start_training', { recipe: 'Gin & Tonic', note: 'Easy one' });
    expect((start.content[0] as { text: string }).text).toContain('http://localhost:9999/#/mix');
    const pending = await call('get_training_result');
    expect(pending.structuredContent.training.status).toBe('pending');
    expect((pending.content[0] as { text: string }).text).toContain('not handed it in');

    const id = start.structuredContent.training.id;
    submitTraining(ctx, id, perfectWithBottles(ctx, 'Gin & Tonic'));
    const done = await call('get_training_result', { id });
    expect(done.structuredContent.training.score).toBeGreaterThanOrEqual(95);
    expect(done.structuredContent.training.feedback).toEqual(['Spot on.']);
    const maiTai = await call('start_training', { recipe: 'Mai Tai' });
    expect(maiTai.structuredContent.training.sandbox).toBe(true);
    expect(maiTai.structuredContent.missing).toEqual(['Dark rum', 'Orgeat']);
    expect((maiTai.content[0] as { text: string }).text).toContain('sandbox mode is on');
    const strict = await call('start_training', { recipe: 'Mojito', sandbox: false });
    expect((strict.content[0] as { text: string }).text).toContain('muddler');
    await client.close();
  });
});
