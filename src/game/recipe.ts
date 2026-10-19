import { ML_PER_UNIT } from './glasses.js';
import type { Action, Source, ToolVessel, VesselId } from './types.js';

// The parts of a recipe the game needs, kept free of server types.
export interface GameLine {
  name: string;
  amount?: number;
  unit: string;
  optional?: boolean;
  garnish?: boolean;
}
export interface GameStep {
  action: string;
  ingredient?: string;
  amount?: number;
  unit?: string;
  equipment?: string;
  duration_s?: number;
}
export interface GameRecipe {
  name: string;
  glass?: string | null;
  color?: string | null;
  ingredients: GameLine[];
  steps: GameStep[];
}

export const isVolume = (unit?: string) => unit !== undefined && unit in ML_PER_UNIT;
export const toMl = (amount: number, unit: string) => amount * (ML_PER_UNIT[unit] ?? 1);

const TOOLS: ToolVessel[] = ['shaker', 'blender', 'mixing_glass'];
const asTool = (e?: string) =>
  (TOOLS as string[]).includes(e ?? '') ? (e as ToolVessel) : undefined;

/**
 * Which vessel each step works in. Pours go into the tool that a later
 * shake/blend/strain will use, until that tool has been emptied into the glass.
 */
export function stepVessels(steps: GameStep[]): VesselId[] {
  const out: VesselId[] = [];
  steps.forEach((step, i) => {
    const explicit = asTool(step.equipment);
    if (explicit) return void out.push(explicit);
    const rest = steps.slice(i);
    const emptyAt = rest.findIndex(
      (s) => s.action === 'strain' || (s.action === 'pour' && !s.ingredient),
    );
    const upcoming = (emptyAt === -1 ? rest : rest.slice(0, emptyAt + 1)).find(
      (s) => s.action === 'shake' || s.action === 'blend' || asTool(s.equipment),
    );
    if (
      upcoming &&
      step.action !== 'top_up' &&
      step.action !== 'garnish' &&
      step.action !== 'chill_glass'
    ) {
      if (upcoming.action === 'shake') return void out.push('shaker');
      if (upcoming.action === 'blend') return void out.push('blender');
      return void out.push(asTool(upcoming.equipment) ?? 'glass');
    }
    out.push('glass');
  });
  return out;
}

/** The perfect play for a recipe: used for demos and as the scoring self-test. */
export function stepsToActions(recipe: GameRecipe, sourceFor: (line: string) => Source): Action[] {
  const vessels = stepVessels(recipe.steps);
  const actions: Action[] = [];
  let lastTool: ToolVessel | undefined;
  if (recipe.glass) actions.push({ type: 'choose_glass', glass: recipe.glass });
  recipe.steps.forEach((step, i) => {
    const vessel = vessels[i]!;
    if (vessel !== 'glass') lastTool = vessel;
    const line = recipe.ingredients.find((l) => l.name === step.ingredient);
    const amount = step.amount ?? line?.amount;
    const unit = step.unit ?? line?.unit ?? 'cl';
    switch (step.action) {
      case 'chill_glass':
        return void actions.push({ type: 'chill_glass' });
      case 'add_ice':
        return void actions.push({ type: 'add_ice', vessel, cubes: 6 });
      case 'pour':
      case 'top_up': {
        if (!step.ingredient) {
          if (lastTool) actions.push({ type: 'transfer', from: lastTool });
          lastTool = undefined;
          return;
        }
        const source = sourceFor(step.ingredient);
        const target = step.action === 'top_up' ? 'glass' : vessel;
        if (amount !== undefined && isVolume(unit)) {
          actions.push({ type: 'pour', vessel: target, source, ml: toMl(amount, unit) });
        } else {
          actions.push({ type: 'add', vessel: target, source, count: amount ?? 1 });
        }
        return;
      }
      case 'muddle':
        return void actions.push({ type: 'muddle', vessel, s: step.duration_s ?? 5 });
      case 'shake':
        return void actions.push({ type: 'shake', s: step.duration_s ?? 12 });
      case 'stir':
        return void actions.push({ type: 'stir', vessel, s: step.duration_s ?? 15 });
      case 'blend':
        return void actions.push({ type: 'blend', s: step.duration_s ?? 20 });
      case 'strain': {
        const from = lastTool ?? 'shaker';
        actions.push({ type: 'strain', from });
        lastTool = undefined;
        return;
      }
      case 'garnish':
        if (step.ingredient) actions.push({ type: 'garnish', source: sourceFor(step.ingredient) });
        return;
      default:
        return;
    }
  });
  return actions;
}
