import { z } from 'zod';
import { insertRow } from '../db/sql.js';
import { mutate, nowIso, ShakyError, type Ctx } from './context.js';
import type { Substitution } from './matching.js';

export const substitutionInputSchema = z.object({
  for_words: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .describe('What the recipe asks for, e.g. "ginger beer".'),
  use_words: z.string().trim().min(1).max(60).describe('What may stand in, e.g. "ginger ale".'),
  ratio: z
    .number()
    .positive()
    .max(5)
    .optional()
    .describe('Amount factor, e.g. 0.67 for the sweeter rich syrup.'),
  note: z.string().trim().max(200).nullish().describe('How it changes the drink, e.g. "milder".'),
  two_way: z
    .boolean()
    .optional()
    .describe('Also the other way round (lime juice <-> lemon juice).'),
});

type Row = Omit<Substitution, 'two_way'> & { two_way: number; created_at: string };

export function listSubstitutions(ctx: Ctx): Substitution[] {
  return (ctx.db.prepare('SELECT * FROM substitutions ORDER BY for_words').all() as Row[]).map(
    (r) => ({
      id: r.id,
      for_words: r.for_words,
      use_words: r.use_words,
      ratio: r.ratio,
      note: r.note,
      two_way: r.two_way === 1,
    }),
  );
}

export function addSubstitution(ctx: Ctx, input: z.input<typeof substitutionInputSchema>) {
  const p = substitutionInputSchema.parse(input);
  return mutate(ctx, (cs) => {
    const id = insertRow(ctx.db, 'substitutions', {
      ...p,
      ratio: p.ratio ?? 1,
      two_way: p.two_way ?? false,
      created_at: nowIso(ctx),
    });
    cs.record({
      entity: 'substitution',
      entity_id: id,
      action: 'created',
      summary: `${p.use_words} may stand in for ${p.for_words}${p.note ? ` (${p.note})` : ''}.`,
      data: { name: `${p.use_words} / ${p.for_words}` },
    });
    return listSubstitutions(ctx).find((s) => s.id === id)!;
  });
}

export function removeSubstitution(ctx: Ctx, id: number) {
  return mutate(ctx, (cs) => {
    const s = listSubstitutions(ctx).find((x) => x.id === id);
    if (!s) throw new ShakyError('not_found', `No substitution with id ${id}.`);
    ctx.db.prepare('DELETE FROM substitutions WHERE id = ?').run(id);
    cs.record({
      entity: 'substitution',
      entity_id: id,
      action: 'deleted',
      summary: `${s.use_words} no longer stands in for ${s.for_words}.`,
      data: { name: `${s.use_words} / ${s.for_words}` },
    });
    return s;
  });
}
