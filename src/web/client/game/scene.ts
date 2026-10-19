import {
  apply,
  GLASSES,
  liquidMl,
  newGame,
  POUR_ML_PER_S,
  scoreMix,
  TECHNIQUE_RATE,
  type Action,
  type GameRecipe,
  type GameState,
  type ScoreResult,
  type Source,
  type ToolVessel,
  type VesselId,
} from '../../../game/index.js';
import { h, svg } from '../lib/h.js';
import { label, t } from '../lib/i18n.js';
import { state } from '../lib/store.js';
import type { IngredientView, RecipeWithCheck } from '../lib/api.js';
import { openDialog, toast } from '../lib/ui.js';
import { formatAmount } from '../lib/units.js';
import { bottleSvg } from '../svg/art.js';
import { glassArt, glassIcon, iceBucketSvg, toolArt } from './art.js';

// The mixing game scene. It is built once and kept alive across re-renders,
// so live updates never interrupt a pour. Game state is the action log;
// everything else is derived by replaying it through src/game.

type Kind = 'liquid' | 'solid' | 'ice';

interface Item {
  id: string;
  kind: Kind;
  zone: string;
  category: string;
  fraction: number;
  source: Source;
  abv?: number | null;
  /** Recipe line names this item can stand for, by purpose. */
  lines?: { pour?: string; garnish?: string };
}

export interface TrainingInfo {
  id: number;
  recipe_id: number;
  note?: string | null;
  show_steps: boolean;
  sandbox: boolean;
}

interface Game {
  actions: Action[];
  state: GameState;
  sandbox: boolean;
  guideId: number | null;
  training: TrainingInfo | null;
  selected: string | null;
}

const game: Game = {
  actions: [],
  state: newGame(),
  sandbox: false,
  guideId: null,
  training: null,
  selected: null,
};

/** Called by the training module when a session is submitted. */
let onServeTraining: ((actions: Action[], recipe: RecipeWithCheck) => Promise<void>) | null = null;
export function setTrainingSubmit(fn: typeof onServeTraining): void {
  onServeTraining = fn;
}

let root: HTMLElement | null = null;
let busy = false; // a gesture is running: no rebuilds
let pendingRefresh = false;

const TOOL_TYPES: ToolVessel[] = ['shaker', 'blender', 'mixing_glass'];
const SOLID_CATEGORIES = new Set(['fruit', 'garnish']);
const VIRTUAL_COLORS = [
  '#f7a8a0',
  '#ffd166',
  '#9ad0c2',
  '#c3a6ff',
  '#f4978e',
  '#b5e48c',
  '#e0b97e',
];

const guide = (): RecipeWithCheck | undefined =>
  state.recipes.find((r) => r.id === (game.training?.recipe_id ?? game.guideId));

function hasEquipment(type: string): boolean {
  if (game.sandbox) return true;
  return state.equipment.some(
    (e) => e.available && (e.type === type || e.substitutes_for.includes(type)),
  );
}

/** A bottle can serve two lines (limes: juice and wedge); the action decides which. */
function linesFor(i: IngredientView, r?: RecipeWithCheck): Item['lines'] {
  if (!r) return undefined;
  const hits = r.availability.lines.filter(
    (l) => l.match?.id === i.id || l.unusable?.some((u) => u.id === i.id),
  );
  return {
    pour: hits.find((l) => !l.garnish)?.name ?? hits[0]?.name,
    garnish: hits.find((l) => l.garnish)?.name ?? hits[0]?.name,
  };
}

function sourceFor(item: Item, purpose: 'pour' | 'garnish'): Source {
  const line = item.lines?.[purpose] ?? item.source.line;
  return { ...item.source, ...(line ? { line } : {}) };
}

function items(): Item[] {
  const r = guide();
  const out: Item[] = state.ingredients
    .filter((i) => !i.archived && (game.sandbox || i.available))
    .map((i) => ({
      id: `i${i.id}`,
      // Fruit with a juice yield is squeezed like pouring from a bottle.
      kind: SOLID_CATEGORIES.has(i.category) && !i.yield_ml ? 'solid' : 'liquid',
      zone: i.location,
      category: i.category,
      fraction: game.sandbox ? Math.max(i.fill_fraction, 0.6) : i.fill_fraction,
      abv: i.abv,
      source: { label: i.name, color: i.display_color, ingredient_id: i.id },
      lines: linesFor(i, r),
    }));
  if (game.sandbox) {
    // Sandbox: every recipe line nobody owns becomes a virtual bottle.
    const seen = new Set(out.map((x) => x.source.label.toLowerCase()));
    let n = 0;
    for (const rec of state.recipes) {
      for (const l of rec.availability.lines) {
        if (l.status === 'available' || seen.has(l.name.toLowerCase())) continue;
        seen.add(l.name.toLowerCase());
        const spec = rec.ingredients.find((x) => x.name === l.name);
        const volume = ['cl', 'ml', 'oz', 'dash', 'barspoon', 'tsp', 'tbsp'].includes(l.unit);
        out.push({
          id: `v:${l.name}`,
          kind: volume && !l.garnish ? 'liquid' : 'solid',
          zone: 'sandbox',
          category: spec?.category ?? (volume ? 'other' : 'fruit'),
          fraction: 0.8,
          source: {
            label: l.name,
            color: VIRTUAL_COLORS[n++ % VIRTUAL_COLORS.length]!,
            line: l.name,
          },
        });
      }
    }
  }
  return out;
}

// ---------- state changes ----------

function dispatch(a: Action): boolean {
  const r = apply(game.state, a);
  if (r.rejected) {
    toast(label(t().game.rejected, r.rejected), 'error');
    return false;
  }
  game.actions.push(a);
  game.state = r.state;
  drawVessels();
  drawLog();
  return true;
}

function resetGame(keepGlass = true) {
  const glass = keepGlass ? game.state.glass : (guide()?.glass ?? defaultGlass());
  // The log always starts with the glass, so a replay builds the same scene.
  game.actions = [{ type: 'choose_glass', glass }];
  game.state = newGame(glass);
  drawVessels();
  drawLog();
}

function undo() {
  if (game.actions.length <= 1 && game.actions[0]?.type === 'choose_glass') return;
  game.actions.pop();
  let s = newGame();
  for (const a of game.actions) s = apply(s, a).state;
  game.state = s;
  drawVessels();
  drawLog();
}

function ownedGlasses(): string[] {
  if (game.sandbox) return Object.keys(GLASSES);
  const owned = [...new Set(state.glassware.filter((g) => g.count > 0).map((g) => g.type))];
  return owned.filter((g) => g in GLASSES).length
    ? owned.filter((g) => g in GLASSES)
    : ['highball'];
}

function defaultGlass(): string {
  return ownedGlasses()[0] ?? 'highball';
}

// ---------- DOM refs ----------

const refs: {
  shelf?: HTMLElement;
  counter?: HTMLElement;
  glass?: HTMLElement;
  tools: Partial<Record<ToolVessel, HTMLElement>>;
  hud?: HTMLElement;
  panel?: HTMLElement;
  log?: HTMLElement;
  garnish?: HTMLElement;
} = { tools: {} };

function vesselLabel(v: VesselId): string {
  return v === 'glass' ? label(t().game.glasses, game.state.glass) : label(t().game.tools, v);
}

function drawVessel(id: VesselId, s: GameState = game.state) {
  const host = id === 'glass' ? refs.glass : refs.tools[id];
  const art = host?.querySelector('.vessel-art');
  if (!art) return;
  art.replaceChildren(
    svg(id === 'glass' ? glassArt(s, vesselLabel(id)) : toolArt(s, id, vesselLabel(id))),
  );
  const ml = host!.querySelector('.vessel-ml');
  if (ml) ml.textContent = formatAmount(Math.round(liquidMl(s.vessels[id])) / 10, 'cl');
}

function drawVessels(s: GameState = game.state) {
  drawVessel('glass', s);
  const list = refs.garnish?.querySelector('.garnish-list');
  if (list)
    list.textContent = s.garnishes.length
      ? s.garnishes.map((x) => x.label).join(', ')
      : t().game.garnishHere;
  for (const tool of TOOL_TYPES) drawVessel(tool, s);
}

function describeAction(a: Action): string {
  const g = t().game;
  switch (a.type) {
    case 'pour':
      return `${label(g.verbs, 'pour')} ${formatAmount(Math.round(a.ml) / 10, 'cl')} ${a.source.label} → ${vesselLabel(a.vessel)}`;
    case 'add':
      return `${label(g.verbs, 'add')} ${a.count}× ${a.source.label} → ${vesselLabel(a.vessel)}`;
    case 'add_ice':
      return `${label(g.verbs, 'add_ice')} → ${vesselLabel(a.vessel)}`;
    case 'garnish':
      return `${label(g.verbs, 'garnish')} ${a.source.label}`;
    case 'shake':
    case 'blend':
      return `${label(g.verbs, a.type)} ${Math.round(a.s)} s`;
    case 'stir':
    case 'muddle':
      return `${label(g.verbs, a.type)} ${Math.round(a.s)} s (${vesselLabel(a.vessel)})`;
    case 'strain':
    case 'transfer':
      return `${label(g.verbs, a.type)} ${vesselLabel(a.from)} → ${vesselLabel('glass')}`;
    case 'choose_glass':
      return `${label(g.verbs, 'choose_glass')} ${label(g.glasses, a.glass)}`;
    default:
      return label(g.verbs, a.type);
  }
}

function drawLog() {
  if (!refs.log) return;
  const shown = game.actions.filter((a) => a.type !== 'choose_glass');
  refs.log.replaceChildren(
    ...(shown.length
      ? shown.map((a) => h('li', null, describeAction(a)))
      : [h('li', { class: 'muted' }, t().game.logEmpty)]),
  );
  refs.log.scrollTop = refs.log.scrollHeight;
}

// ---------- gestures ----------

interface Gesture {
  item: Item;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  ghost?: HTMLElement;
  target?: HTMLElement;
  poured: number;
  last: number;
  raf: number;
}

let gesture: Gesture | null = null;

const vesselAt = (x: number, y: number) =>
  (document.elementFromPoint(x, y)?.closest('[data-vessel]') as HTMLElement | null) ?? undefined;

function startPourLoop(
  g: { poured: number; last: number; raf: number },
  vessel: () => HTMLElement | undefined,
  label?: HTMLElement,
) {
  g.last = performance.now();
  // Pouring starts only after resting on a vessel briefly (the bottle tilts),
  // so dragging across a glass on the way somewhere else spills nothing.
  let over: HTMLElement | undefined;
  let dwell = 0;
  const tick = (now: number) => {
    const v = vessel();
    const dt = Math.min(0.1, (now - g.last) / 1000);
    g.last = now;
    if (v !== over) {
      over = v;
      dwell = 0;
    } else dwell += dt;
    if (v && dwell >= TILT_S && !v.classList.contains('is-off') && !isGarnishTarget(v)) {
      g.poured += dt * POUR_ML_PER_S;
      const id = v.dataset.vessel as VesselId;
      const preview = apply(game.state, {
        type: 'pour',
        vessel: id,
        source: { label: '', color: currentPourColor },
        ml: g.poured,
      });
      drawVessel(id, preview.state);
      if (label) label.textContent = formatAmount(Math.round(g.poured) / 10, 'cl');
    }
    g.raf = requestAnimationFrame(tick);
  };
  g.raf = requestAnimationFrame(tick);
}

let currentPourColor = '#ffffff';
const TILT_S = 0.25;

const isGarnishTarget = (el?: HTMLElement) => el?.dataset.vessel === 'garnish';

function commitPour(item: Item, target: HTMLElement | undefined, ml: number) {
  if (isGarnishTarget(target)) return dropItem(item, target);
  if (!target || ml < 1) {
    drawVessels();
    return;
  }
  dispatch({
    type: 'pour',
    vessel: target.dataset.vessel as VesselId,
    source: sourceFor(item, 'pour'),
    ml: Math.round(ml),
  });
}

function dropItem(item: Item, target: HTMLElement | undefined) {
  if (!target || target.classList.contains('is-off')) return;
  if (isGarnishTarget(target)) {
    if (item.kind !== 'ice') dispatch({ type: 'garnish', source: sourceFor(item, 'garnish') });
    return;
  }
  const vessel = target.dataset.vessel as VesselId;
  if (item.kind === 'ice') dispatch({ type: 'add_ice', vessel, cubes: 6 });
  else if (item.kind === 'solid')
    dispatch({ type: 'add', vessel, source: sourceFor(item, 'pour'), count: 1 });
}

function onItemDown(e: PointerEvent, item: Item, el: HTMLElement) {
  if (e.button !== 0 || gesture) return;
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  busy = true;
  gesture = {
    item,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,

    poured: 0,
    last: 0,
    raf: 0,
  };
}

function onItemMove(e: PointerEvent, el: HTMLElement) {
  const g = gesture;
  if (!g || e.pointerId !== g.pointerId) return;
  if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 8) return;
  if (!g.moved) {
    g.moved = true;
    g.ghost = h(
      'div',
      { class: `ghost ghost-${g.item.kind}` },
      el.querySelector('svg')!.cloneNode(true),
      h('span', { class: 'pour-count' }),
    );
    document.body.append(g.ghost);
    document.body.classList.add('is-dragging');
    if (g.item.kind === 'liquid') {
      currentPourColor = g.item.source.color;
      startPourLoop(g, () => g.target, g.ghost.querySelector('.pour-count') as HTMLElement);
    }
  }
  g.ghost!.style.transform = `translate(${e.clientX - 30}px, ${e.clientY - 90}px)`;
  const target = vesselAt(e.clientX, e.clientY);
  if (target !== g.target) {
    // Leaving a vessel ends that pour; entering another starts a new one.
    if (g.item.kind === 'liquid' && g.target && !isGarnishTarget(g.target)) {
      commitPour(g.item, g.target, g.poured);
      g.poured = 0;
    }
    g.target?.classList.remove('is-target');
    g.target = target;
    g.target?.classList.add('is-target');
    g.ghost!.classList.toggle(
      'is-pouring',
      Boolean(target) && !isGarnishTarget(target) && g.item.kind === 'liquid',
    );
  }
}

function onItemUp(e: PointerEvent) {
  const g = gesture;
  if (!g || e.pointerId !== g.pointerId) return;
  cancelAnimationFrame(g.raf);
  gesture = null;
  document.body.classList.remove('is-dragging');
  g.ghost?.remove();
  g.target?.classList.remove('is-target');
  if (!g.moved) selectItem(g.item.id);
  else if (g.item.kind === 'liquid') commitPour(g.item, g.target, g.poured);
  else dropItem(g.item, g.target);
  endBusy();
}

function selectItem(id: string) {
  game.selected = game.selected === id ? null : id;
  refs.shelf
    ?.querySelectorAll('.game-item')
    .forEach((n) =>
      n.classList.toggle('is-selected', (n as HTMLElement).dataset.id === game.selected),
    );
  refs.counter?.classList.toggle('has-selection', Boolean(game.selected));
}

/** Tap/keyboard path: with an item selected, hold on a vessel to pour. */
function bindVesselTarget(el: HTMLElement) {
  let hold: { poured: number; last: number; raf: number; item: Item } | null = null;
  const start = () => {
    const item = items().find((i) => i.id === game.selected);
    if (!item || el.classList.contains('is-off')) return false;
    if (item.kind !== 'liquid' || isGarnishTarget(el)) {
      dropItem(item, el);
      return true;
    }
    busy = true;
    currentPourColor = item.source.color;
    hold = { poured: 0, last: 0, raf: 0, item };
    startPourLoop(hold, () => el, el.querySelector('.vessel-ml') as HTMLElement);
    return true;
  };
  const stop = () => {
    if (!hold) return;
    cancelAnimationFrame(hold.raf);
    commitPour(hold.item, el, hold.poured);
    hold = null;
    endBusy();
  };
  el.addEventListener('pointerdown', (e) => {
    if (gesture || !game.selected) return;
    if (start()) {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
    }
  });
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && !hold) {
      if (start()) e.preventDefault();
    }
  });
  el.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') stop();
  });
}

/** A button you hold to shake, stir, blend or muddle. Shows a meter against the target time. */
function holdButton(
  text: string,
  target: number,
  onCommit: (s: number) => void,
  onTick?: (s: number) => void,
): HTMLElement {
  const fill = h('span', { class: 'meter-fill' });
  const secs = h('span', { class: 'meter-s' });
  const btn = h(
    'button',
    { type: 'button', class: 'btn hold-btn' },
    h('span', null, text),
    h('span', { class: 'meter' }, fill),
    secs,
  );
  let run: { s: number; last: number; raf: number } | null = null;
  const start = () => {
    if (btn.disabled || run) return;
    busy = true;
    run = { s: 0, last: performance.now(), raf: 0 };
    btn.classList.add('is-holding');
    const tick = (now: number) => {
      if (!run) return;
      run.s += Math.min(0.1, (now - run.last) / 1000) * TECHNIQUE_RATE;
      run.last = now;
      fill.style.width = `${Math.min(100, (run.s / target) * 100)}%`;
      fill.classList.toggle('is-done', run.s >= target);
      secs.textContent = `${run.s.toFixed(1)} s`;
      onTick?.(run.s);
      run.raf = requestAnimationFrame(tick);
    };
    run.raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    const s = Math.round(run.s * 10) / 10;
    run = null;
    btn.classList.remove('is-holding');
    fill.style.width = '0';
    secs.textContent = '';
    if (s >= 0.5) onCommit(s);
    endBusy();
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    start();
  });
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      start();
    }
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') stop();
  });
  return btn;
}

function endBusy() {
  busy = false;
  if (pendingRefresh) {
    pendingRefresh = false;
    refresh();
  }
}

// ---------- building ----------

function targetSeconds(action: string, fallback: number): number {
  const step = guide()?.steps.find((s) => s.action === action);
  return step?.duration_s ?? fallback;
}

function buildShelf(): HTMLElement {
  const g = t().game;
  const list = items();
  const zones = [...new Set(['shelf', 'fridge', 'freezer', 'pantry', ...list.map((i) => i.zone)])];
  const locs = state.meta?.locations ?? [];
  const itemEl = (it: Item) => {
    const el = h(
      'button',
      {
        type: 'button',
        class: `game-item${game.selected === it.id ? ' is-selected' : ''}`,
        dataset: { id: it.id },
        'aria-label': it.source.label,
      },
      it.kind === 'ice'
        ? svg(iceBucketSvg)
        : svg(bottleSvg(it.category, it.source.color, it.fraction, 1, it.source.label)),
      h('span', null, it.source.label),
    );
    el.addEventListener('pointerdown', (e) => onItemDown(e, it, el));
    el.addEventListener('pointermove', (e) => onItemMove(e, el));
    el.addEventListener('pointerup', onItemUp);
    el.addEventListener('pointercancel', onItemUp);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectItem(it.id);
      }
    });
    return el;
  };
  const ice: Item = {
    id: 'ice',
    kind: 'ice',
    zone: 'freezer',
    category: 'other',
    fraction: 1,
    source: { label: g.ice, color: '#ffffff' },
  };
  return h(
    'div',
    { class: 'game-shelf' },
    zones.map((z) => {
      const inZone = list.filter((i) => i.zone === z);
      if (z === 'freezer') inZone.unshift(ice);
      if (!inZone.length) return null;
      const loc = locs.find((l) => l.key === z);
      const name =
        z === 'sandbox'
          ? g.sandboxShelf
          : loc
            ? t().lang === 'de'
              ? loc.label_de
              : loc.label_en
            : label(t().zones, z);
      return h(
        'section',
        { class: `game-zone zone-${loc?.game_zone ?? (z === 'sandbox' ? 'sandbox' : 'custom')}` },
        h('h3', null, name),
        h('div', { class: 'game-items' }, inZone.map(itemEl)),
      );
    }),
  );
}

function vesselCard(
  id: VesselId,
  available: boolean,
  missing: string,
  controls: HTMLElement[],
): HTMLElement {
  const target = h(
    'div',
    {
      class: `vessel-target${available ? '' : ' is-off'}`,
      dataset: { vessel: id },
      tabIndex: available ? 0 : -1,
      role: 'button',
      'aria-label': `${vesselLabel(id)}: ${t().game.dropHint}`,
    },
    h('div', { class: 'vessel-art' }),
    h('span', { class: 'vessel-ml' }),
  );
  bindVesselTarget(target);
  return h(
    'div',
    { class: `vessel-card vessel-${id}${available ? '' : ' is-missing'}` },
    h('h3', null, vesselLabel(id)),
    target,
    available
      ? h('div', { class: 'vessel-controls' }, controls)
      : h('p', { class: 'muted small' }, missing),
  );
}

function techniqueButton(
  type: string,
  action: string,
  fallback: number,
  onCommit: (s: number) => void,
  onTick?: (s: number) => void,
): HTMLElement {
  const g = t().game;
  const b = holdButton(label(g.verbs, action), targetSeconds(action, fallback), onCommit, onTick);
  if (!hasEquipment(type)) {
    (b as HTMLButtonElement).disabled = true;
    b.title = g.needs(label(g.equipment, type));
    b.append(h('small', { class: 'needs' }, g.needs(label(g.equipment, type))));
  }
  return b;
}

function buildCounter(): HTMLElement {
  const g = t().game;
  const glassCard = vesselCard('glass', true, '', [
    techniqueButton('bar_spoon', 'stir', 10, (s) => dispatch({ type: 'stir', vessel: 'glass', s })),
    techniqueButton('muddler', 'muddle', 5, (s) =>
      dispatch({ type: 'muddle', vessel: 'glass', s }),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-small btn-quiet',
        onclick: () => dispatch({ type: 'chill_glass' }),
      },
      label(g.verbs, 'chill_glass'),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-small btn-quiet',
        onclick: () => dispatch({ type: 'empty', vessel: 'glass' }),
      },
      label(g.verbs, 'empty'),
    ),
  ]);
  refs.glass = glassCard.querySelector('.vessel-target') as HTMLElement;
  const garnishZone = h(
    'div',
    {
      class: 'garnish-target',
      dataset: { vessel: 'garnish' },
      tabIndex: 0,
      role: 'button',
      'aria-label': g.garnishHere,
    },
    svg(
      '<svg viewBox="0 0 40 24" aria-hidden="true"><path d="M8 20a12 12 0 0 1 24 0z" fill="var(--palm)" stroke="var(--ink)" stroke-width="3"/><path d="M20 8V2" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/></svg>',
    ),
    h('span', { class: 'garnish-list' }),
  );
  bindVesselTarget(garnishZone);
  refs.garnish = garnishZone;
  refs.glass.before(garnishZone);

  const shakerCard = vesselCard(
    'shaker',
    hasEquipment('shaker'),
    g.needs(label(g.equipment, 'shaker')),
    [
      techniqueButton(
        'shaker',
        'shake',
        12,
        (s) => {
          refs.tools.shaker?.classList.remove('shaking');
          dispatch({ type: 'shake', s });
        },
        () => refs.tools.shaker?.classList.add('shaking'),
      ),
      techniqueButton('muddler', 'muddle', 5, (s) =>
        dispatch({ type: 'muddle', vessel: 'shaker', s }),
      ),
      strainButton('shaker'),
    ],
  );
  const blenderCard = vesselCard(
    'blender',
    hasEquipment('blender'),
    g.needs(label(g.equipment, 'blender')),
    [
      techniqueButton(
        'blender',
        'blend',
        20,
        (s) => {
          refs.tools.blender?.classList.remove('shaking');
          dispatch({ type: 'blend', s });
        },
        () => refs.tools.blender?.classList.add('shaking'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small',
          onclick: () => dispatch({ type: 'transfer', from: 'blender' }),
        },
        label(g.verbs, 'transfer'),
      ),
    ],
  );
  const mixingCard = vesselCard(
    'mixing_glass',
    hasEquipment('mixing_glass'),
    g.needs(label(g.equipment, 'mixing_glass')),
    [
      techniqueButton('bar_spoon', 'stir', 15, (s) =>
        dispatch({ type: 'stir', vessel: 'mixing_glass', s }),
      ),
      strainButton('mixing_glass'),
    ],
  );
  for (const [tool, card] of [
    ['shaker', shakerCard],
    ['blender', blenderCard],
    ['mixing_glass', mixingCard],
  ] as const) {
    refs.tools[tool] = card.querySelector('.vessel-target') as HTMLElement;
  }
  return h(
    'div',
    { class: 'game-counter' },
    glassCard,
    h('div', { class: 'tool-row' }, shakerCard, blenderCard, mixingCard),
  );
}

function strainButton(from: ToolVessel): HTMLElement {
  const g = t().game;
  const ok = hasEquipment('strainer');
  return h(
    'button',
    {
      type: 'button',
      class: 'btn btn-small',
      disabled: !ok,
      title: ok ? undefined : g.needs(label(g.equipment, 'strainer')),
      onclick: () => dispatch({ type: 'strain', from }),
    },
    label(g.verbs, 'strain'),
  );
}

function buildHud(): HTMLElement {
  const g = t().game;
  const r = guide();
  const glasses = ownedGlasses();
  const glassSel = h(
    'select',
    {
      'aria-label': g.chooseGlass,
      onchange: (e: Event) => {
        const glass = (e.target as HTMLSelectElement).value;
        if (dispatch({ type: 'choose_glass', glass })) refresh();
      },
    },
    [...new Set([...glasses, game.state.glass])].map((x) =>
      h('option', { value: x, selected: x === game.state.glass }, label(g.glasses, x)),
    ),
  );
  const guideSel = h(
    'select',
    {
      'aria-label': g.guide,
      disabled: Boolean(game.training),
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        game.guideId = v ? Number(v) : null;
        location.hash = v ? `#/mix?recipe=${v}` : '#/mix';
        resetGame(false);
        refresh();
      },
    },
    h('option', { value: '' }, g.freeStyle),
    state.recipes.map((x) => h('option', { value: x.id, selected: x.id === r?.id }, x.name)),
  );
  return h(
    'div',
    { class: 'game-hud' },
    game.training
      ? h(
          'div',
          { class: 'training-banner' },
          svg(
            '<svg viewBox="0 0 10 10" class="dot"><circle cx="5" cy="5" r="5" fill="var(--hibiscus)"/></svg>',
          ),
          h('strong', null, g.trainingFor(r?.name ?? '')),
          game.training.note ? h('span', null, game.training.note) : null,
        )
      : null,
    h('label', { class: 'pref' }, h('span', null, g.guide), guideSel),
    h(
      'label',
      { class: 'pref' },
      svg(glassIcon(game.state.glass)),
      h('span', null, g.chooseGlass),
      glassSel,
    ),
    h(
      'label',
      { class: 'switch' },
      h('input', {
        type: 'checkbox',
        checked: game.sandbox,
        onchange: (e: Event) => {
          game.sandbox = (e.target as HTMLInputElement).checked;
          refresh();
        },
      }),
      h('span', null, g.sandbox),
    ),
    h(
      'div',
      { class: 'hud-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small btn-quiet',
          onclick: undo,
          disabled: game.actions.filter((a) => a.type !== 'choose_glass').length === 0,
        },
        g.undo,
      ),
      h(
        'button',
        { type: 'button', class: 'btn btn-small btn-quiet', onclick: () => resetGame(false) },
        g.restart,
      ),
      h(
        'button',
        { type: 'button', class: 'btn btn-primary btn-big', onclick: serve },
        game.training ? g.submit : g.serve,
      ),
    ),
  );
}

function buildPanel(): HTMLElement {
  const g = t().game;
  const r = guide();
  const showSteps = r && (!game.training || game.training.show_steps);
  refs.log = h('ol', { class: 'game-log' });
  return h(
    'aside',
    { class: 'game-panel paper' },
    r
      ? h(
          'div',
          null,
          h('h3', null, r.name),
          showSteps
            ? h(
                'ol',
                { class: 'steps' },
                r.steps.map((s) =>
                  h(
                    'li',
                    null,
                    h('strong', null, label(t().recipe.actions, s.action)),
                    s.ingredient ? ` ${formatAmount(s.amount, s.unit)} ${s.ingredient}` : '',
                    s.duration_s ? ` (${s.duration_s} s)` : '',
                  ),
                ),
              )
            : h('p', { class: 'muted' }, g.stepsHidden),
        )
      : h('p', { class: 'muted' }, g.freeHint),
    h('h3', null, g.log),
    refs.log,
    h('p', { class: 'muted small' }, g.howTo),
  );
}

function build(): HTMLElement {
  const shelf = buildShelf();
  const counter = buildCounter();
  refs.shelf = shelf;
  refs.counter = counter;
  refs.hud = buildHud();
  refs.panel = buildPanel();
  const el = h(
    'div',
    { class: 'view game' },
    refs.hud,
    h('div', { class: 'game-stage' }, shelf, counter, refs.panel),
  );
  return el;
}

/** Rebuilds controls and shelf from the store (not during a gesture). */
function refresh() {
  if (!root) return;
  if (busy) {
    pendingRefresh = true;
    return;
  }
  const next = build();
  root.replaceChildren(...Array.from(next.childNodes));
  drawVessels();
  drawLog();
}

// ---------- serving ----------

function estimatedAbv(): number | null {
  const byId = new Map(state.ingredients.map((i) => [i.id, i.abv ?? 0]));
  let alc = 0;
  let total = 0;
  for (const a of game.actions)
    if (a.type === 'pour') {
      total += a.ml;
      if (a.source.ingredient_id !== undefined)
        alc += a.ml * (byId.get(a.source.ingredient_id) ?? 0);
    }
  // Ice water from shaking or stirring counts too.
  const final = liquidMl(game.state.vessels.glass);
  return final > 0 && total > 0 ? Math.round((alc / Math.max(final, total)) * 10) / 10 : null;
}

export function showScore(result: ScoreResult, recipeName: string, extra?: HTMLElement): void {
  const g = t().game;
  openDialog(
    g.resultTitle(recipeName),
    h(
      'div',
      { class: 'sheet-body score' },
      h(
        'div',
        { class: 'stars', 'aria-label': `${result.stars}/3` },
        [0, 1, 2].map((i) => h('span', { class: i < result.stars ? 'on' : '' }, '★')),
      ),
      h('p', { class: 'big-score' }, `${result.score}`, h('small', null, ' / 100')),
      h(
        'ul',
        { class: 'feedback' },
        result.feedback.map((f) => h('li', null, g.feedback(f, formatAmount))),
      ),
      extra ?? null,
    ),
  );
}

async function serve() {
  const g = t().game;
  const r = guide();
  const glass = game.state.vessels.glass;
  if (!glass.layers.length) {
    toast(g.emptyGlass, 'error');
    return;
  }
  if (game.training && r && onServeTraining) {
    await onServeTraining([...game.actions], r);
    return;
  }
  if (r) {
    showScore(scoreMix(r as unknown as GameRecipe, game.actions), r.name);
    return;
  }
  const abv = estimatedAbv();
  openDialog(
    g.yourDrink,
    h(
      'div',
      { class: 'sheet-body score' },
      svg(glassArt(game.state, g.yourDrink)),
      h(
        'p',
        null,
        g.summary(Math.round(liquidMl(glass)), glass.layers.map((l) => l.label).join(', '), abv),
      ),
    ),
  );
}

// ---------- public ----------

/** The persistent scene element for the #/mix route. */
export function gameView(params: URLSearchParams): HTMLElement {
  const want = params.get('recipe');
  if (!game.training && want && Number(want) !== game.guideId) {
    game.guideId = Number(want);
    resetGame(false);
  }
  if (!root) {
    root = h('div', { class: 'game-root' });
    if (!game.actions.length) resetGame(false);
  }
  refresh();
  return root;
}

export function startTraining(info: TrainingInfo): void {
  game.training = info;
  game.sandbox = info.sandbox;
  game.guideId = info.recipe_id;
  resetGame(false);
  refresh();
}

export function endTraining(): void {
  game.training = null;
  refresh();
}

export const activeTraining = () => game.training;

/** Test hook: the current action log. */
export const gameActions = () => game.actions;
