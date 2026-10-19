import { replay } from './engine.js';
import { isVolume, stepsToActions, toMl, type GameRecipe } from './recipe.js';
import type { Action, Source } from './types.js';

export type FeedbackCode =
  | 'perfect'
  | 'amount_off'
  | 'missing_ingredient'
  | 'extra_ingredient'
  | 'order'
  | 'technique_missing'
  | 'technique_short'
  | 'garnish_missing'
  | 'overflow';

export interface Feedback {
  code: FeedbackCode;
  line?: string;
  technique?: string;
  expected?: number;
  actual?: number;
  unit?: string;
}

export interface ScoreResult {
  score: number;
  stars: 0 | 1 | 2 | 3;
  parts: { amounts: number; order: number; technique: number; garnish: number; penalty: number };
  lines: { name: string; unit: string; expected: number; actual: number; accuracy: number }[];
  feedback: Feedback[];
}

/** Which recipe line a poured source stands for. Defaults to the source's own line name. */
export type LineResolver = (source: Source) => string | undefined;

const TECHNIQUES = ['shake', 'stir', 'blend', 'muddle'] as const;

function lcs(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] =
        a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
  return dp[a.length]![b.length]!;
}

const dedupe = (xs: string[]) => xs.filter((x, i) => x !== xs[i - 1]);

function tokens(actions: Action[], resolve: LineResolver): string[] {
  const out: string[] = [];
  for (const a of actions) {
    switch (a.type) {
      case 'pour':
      case 'add':
        out.push(`pour:${resolve(a.source) ?? '?'}`);
        break;
      case 'add_ice':
        out.push('ice');
        break;
      case 'garnish':
        // Garnish timing rarely matters; it is scored separately.
        break;
      case 'chill_glass':
      case 'choose_glass':
      case 'empty':
        break;
      default:
        out.push(a.type);
    }
  }
  return dedupe(out);
}

/**
 * Scores an action log against a recipe: amounts 45, order 25, technique 20,
 * garnish 10, minus up to 20 for ingredients that do not belong.
 */
export function scoreMix(
  recipe: GameRecipe,
  actions: Action[],
  resolve: LineResolver = (s) => s.line,
): ScoreResult {
  const feedback: Feedback[] = [];
  const { state } = replay(actions);

  // Amounts per line.
  const poured = new Map<string, number>();
  const extras = new Set<string>();
  for (const a of actions) {
    if (a.type !== 'pour' && a.type !== 'add') continue;
    const line = resolve(a.source);
    const known = line && recipe.ingredients.some((l) => l.name === line);
    if (!known) {
      extras.add(a.source.label);
      continue;
    }
    poured.set(line!, (poured.get(line!) ?? 0) + (a.type === 'pour' ? a.ml : a.count));
  }
  const lines: ScoreResult['lines'] = [];
  for (const l of recipe.ingredients) {
    if (l.garnish || l.amount === undefined) continue;
    const volume = isVolume(l.unit);
    const expected = volume ? toMl(l.amount, l.unit) : l.amount;
    const actual = poured.get(l.name) ?? 0;
    if (l.optional && actual === 0) continue;
    const accuracy =
      actual === 0 ? 0 : Math.max(0, 1 - (Math.abs(actual - expected) / expected) * 1.5);
    lines.push({ name: l.name, unit: volume ? 'ml' : l.unit, expected, actual, accuracy });
    if (actual === 0) feedback.push({ code: 'missing_ingredient', line: l.name });
    else if (accuracy < 0.85)
      feedback.push({
        code: 'amount_off',
        line: l.name,
        expected,
        actual: Math.round(actual * 10) / 10,
        unit: volume ? 'ml' : l.unit,
      });
  }
  const amounts = lines.length ? lines.reduce((s, l) => s + l.accuracy, 0) / lines.length : 1;

  // Order: longest common subsequence of the step tokens.
  const expectedTokens = tokens(
    stepsToActions(recipe, (line) => ({ label: line, color: '#000', line })),
    (s) => s.line,
  );
  const actualTokens = tokens(actions, resolve);
  const order = expectedTokens.length
    ? lcs(expectedTokens, actualTokens) / expectedTokens.length
    : 1;
  if (order < 0.8) feedback.push({ code: 'order' });

  // Technique: shake, stir, blend, muddle with their durations.
  const techs = TECHNIQUES.flatMap((t) => {
    const steps = recipe.steps.filter((s) => s.action === t);
    if (!steps.length) return [];
    const want = steps.reduce((s, x) => s + (x.duration_s ?? 5), 0);
    const got = actions.reduce((s, a) => s + (a.type === t ? a.s : 0), 0);
    if (got === 0) feedback.push({ code: 'technique_missing', technique: t });
    else if (got < want * 0.6)
      feedback.push({
        code: 'technique_short',
        technique: t,
        expected: want,
        actual: Math.round(got),
      });
    return [Math.min(1, got / want)];
  });
  const technique = techs.length ? techs.reduce((a, b) => a + b, 0) / techs.length : 1;

  // Garnish.
  const wanted = recipe.ingredients.filter((l) => l.garnish && !l.optional);
  const got = new Set(actions.flatMap((a) => (a.type === 'garnish' ? [resolve(a.source)] : [])));
  const garnishHits = wanted.filter((l) => got.has(l.name)).length;
  for (const l of wanted)
    if (!got.has(l.name)) feedback.push({ code: 'garnish_missing', line: l.name });
  const garnish = wanted.length ? garnishHits / wanted.length : 1;

  for (const x of extras) feedback.push({ code: 'extra_ingredient', line: x });
  let penalty = Math.min(20, extras.size * 7);
  if (state.spilled_ml > 5) {
    feedback.push({ code: 'overflow', actual: Math.round(state.spilled_ml) });
    penalty += 5;
  }

  const raw = amounts * 45 + order * 25 + technique * 20 + garnish * 10 - penalty;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  if (!feedback.length) feedback.push({ code: 'perfect' });
  const stars = score >= 85 ? 3 : score >= 65 ? 2 : score >= 40 ? 1 : 0;
  const r1 = (x: number) => Math.round(x * 100) / 100;
  return {
    score,
    stars,
    parts: {
      amounts: r1(amounts),
      order: r1(order),
      technique: r1(technique),
      garnish: r1(garnish),
      penalty,
    },
    lines,
    feedback,
  };
}

/** Plain English for the AI. The web client localizes from the codes itself. */
export function feedbackText(f: Feedback): string {
  switch (f.code) {
    case 'perfect':
      return 'Spot on.';
    case 'amount_off':
      return `${f.line}: poured ${f.actual} ${f.unit}, recipe says ${f.expected} ${f.unit}.`;
    case 'missing_ingredient':
      return `${f.line} was missing.`;
    case 'extra_ingredient':
      return `${f.line} is not part of this recipe.`;
    case 'order':
      return 'The order of the steps was quite different from the recipe.';
    case 'technique_missing':
      return `The recipe needs to ${f.technique}, that step was skipped.`;
    case 'technique_short':
      return `${f.technique} for about ${f.expected} s, it was only ${f.actual} s.`;
    case 'garnish_missing':
      return `Garnish missing: ${f.line}.`;
    case 'overflow':
      return `About ${f.actual} ml spilled over the rim.`;
  }
}
