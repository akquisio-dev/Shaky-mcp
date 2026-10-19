import { z } from 'zod';
import { mutate, type Ctx } from './context.js';
import { resolveRecipe } from './recipes.js';

// Lets the AI steer an open web UI: "here is the recipe" opens it in the browser.
// It rides the activity feed like every change, but touches no data.

export const VIEWS = [
  'bar',
  'recipes',
  'recipe',
  'make',
  'mix',
  'party',
  'shopping',
  'gear',
  'activity',
] as const;

export const navigateSchema = z.object({
  view: z
    .enum(VIEWS)
    .describe(
      'bar, recipes, recipe (detail), make (step-by-step "mix for real" with timers), mix (the game, following the recipe), party, shopping, gear, activity.',
    ),
  recipe: z
    .union([z.number().int().positive(), z.string().trim().min(1)])
    .optional()
    .describe('For recipe, make and mix.'),
});

export function navigate(ctx: Ctx, input: z.input<typeof navigateSchema>) {
  const p = navigateSchema.parse(input);
  const r = p.recipe !== undefined ? resolveRecipe(ctx, p.recipe) : undefined;
  const route =
    p.view === 'recipe'
      ? r
        ? `#/recipes?open=${r.id}`
        : '#/recipes'
      : p.view === 'make' || p.view === 'mix'
        ? `#/${p.view}${r ? `?recipe=${r.id}` : ''}`
        : `#/${p.view}`;
  return mutate(ctx, (cs) => {
    cs.record({
      entity: 'ui',
      entity_id: r?.id ?? null,
      action: 'navigate',
      summary: `Showed ${p.view}${r ? ` for ${r.name}` : ''} in the web UI.`,
      data: { route, view: p.view, name: r?.name ?? '' },
    });
    return { route, view: p.view, recipe: r?.name ?? null };
  });
}
