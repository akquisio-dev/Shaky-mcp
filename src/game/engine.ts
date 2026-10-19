import { mixColors, WATER } from './color.js';
import { glassInfo, TOOL_CAPACITY } from './glasses.js';
import type { Action, GameState, Layer, Source, Vessel, VesselId } from './types.js';

const emptyVessel = (): Vessel => ({
  layers: [],
  ice: 0,
  crushed: false,
  solids: [],
  muddled_s: 0,
  shaken_s: 0,
  stirred_s: 0,
  blended_s: 0,
});

export function newGame(glass = 'highball'): GameState {
  return {
    glass,
    chilled: false,
    vessels: {
      glass: emptyVessel(),
      shaker: emptyVessel(),
      blender: emptyVessel(),
      mixing_glass: emptyVessel(),
    },
    garnishes: [],
    spilled_ml: 0,
  };
}

export const sourceKey = (s: Source) =>
  s.ingredient_id !== undefined ? `i${s.ingredient_id}` : `l:${(s.line ?? s.label).toLowerCase()}`;

export const liquidMl = (v: Vessel) => v.layers.reduce((s, l) => s + l.ml, 0);
/** Ice takes room: about 12 ml per cube. */
const iceMl = (v: Vessel) => v.ice * 12;

export function capacityOf(state: GameState, id: VesselId): number {
  return id === 'glass' ? glassInfo(state.glass).capacity : TOOL_CAPACITY[id];
}

function clone(s: GameState): GameState {
  return structuredClone(s);
}

/** Merges all liquid into one layer, the result of shaking, stirring or blending. */
function mixLayers(v: Vessel): void {
  if (v.layers.length <= 1) return;
  const ml = liquidMl(v);
  v.layers = [
    {
      key: 'mix',
      label: 'mix',
      color: mixColors(v.layers),
      ml,
    },
  ];
}

function addLiquid(state: GameState, id: VesselId, layer: Layer): void {
  const v = state.vessels[id];
  const room = Math.max(0, capacityOf(state, id) - liquidMl(v) - iceMl(v));
  const ml = Math.min(room, layer.ml);
  state.spilled_ml += layer.ml - ml;
  if (ml <= 0) return;
  const top = v.layers[v.layers.length - 1];
  if (top && top.key === layer.key) top.ml += ml;
  else v.layers.push({ ...layer, ml });
}

function dilute(v: Vessel, share: number): void {
  if (v.ice <= 0) return;
  const water = liquidMl(v) * share;
  if (water > 0) v.layers.push({ ...WATER, ml: water });
}

export interface Step {
  state: GameState;
  /** Set when the action could not do anything, e.g. shaking an empty shaker. */
  rejected?: string;
}

/** Applies one action. Never mutates the input. */
export function apply(prev: GameState, a: Action): Step {
  const s = clone(prev);
  switch (a.type) {
    case 'choose_glass': {
      if (liquidMl(s.vessels.glass) > 0) return { state: prev, rejected: 'glass_not_empty' };
      s.glass = a.glass;
      return { state: s };
    }
    case 'chill_glass':
      s.chilled = true;
      return { state: s };
    case 'add_ice': {
      const v = s.vessels[a.vessel];
      v.ice += a.cubes ?? 6;
      v.crushed = v.crushed || Boolean(a.crushed);
      return { state: s };
    }
    case 'pour': {
      if (a.ml <= 0) return { state: prev, rejected: 'nothing_poured' };
      addLiquid(s, a.vessel, {
        key: sourceKey(a.source),
        label: a.source.label,
        color: a.source.color,
        ml: a.ml,
      });
      return { state: s };
    }
    case 'add': {
      const v = s.vessels[a.vessel];
      const key = sourceKey(a.source);
      const hit = v.solids.find((x) => x.key === key);
      if (hit) hit.count += a.count;
      else v.solids.push({ key, label: a.source.label, color: a.source.color, count: a.count });
      return { state: s };
    }
    case 'muddle': {
      const v = s.vessels[a.vessel];
      if (!v.solids.length && !v.layers.length)
        return { state: prev, rejected: 'nothing_to_muddle' };
      v.muddled_s += a.s;
      return { state: s };
    }
    case 'shake': {
      const v = s.vessels.shaker;
      if (!v.layers.length) return { state: prev, rejected: 'shaker_empty' };
      v.shaken_s += a.s;
      mixLayers(v);
      return { state: s };
    }
    case 'stir': {
      const v = s.vessels[a.vessel];
      if (!v.layers.length) return { state: prev, rejected: 'nothing_to_stir' };
      v.stirred_s += a.s;
      mixLayers(v);
      return { state: s };
    }
    case 'blend': {
      const v = s.vessels.blender;
      if (!v.layers.length && !v.solids.length) return { state: prev, rejected: 'blender_empty' };
      // Blended ice melts into the drink.
      if (v.ice > 0) {
        v.layers.push({ ...WATER, ml: v.ice * 10 });
        v.ice = 0;
        v.crushed = false;
      }
      for (const solid of v.solids)
        v.layers.push({
          key: solid.key,
          label: solid.label,
          color: solid.color,
          ml: solid.count * 12,
        });
      v.solids = [];
      v.blended_s += a.s;
      mixLayers(v);
      return { state: s };
    }
    case 'strain':
    case 'transfer': {
      const from = s.vessels[a.from];
      if (!from.layers.length) return { state: prev, rejected: 'nothing_to_pour' };
      if (a.type === 'strain') {
        // Shaking or stirring on ice dilutes the drink before it is strained off the ice.
        if (from.shaken_s > 0) dilute(from, 0.25);
        else if (from.stirred_s > 0) dilute(from, 0.15);
      }
      mixLayers(from);
      const layer = from.layers[0]!;
      addLiquid(s, 'glass', { ...layer, key: `${a.from}_mix`, label: layer.label });
      if (a.type === 'transfer') {
        s.vessels.glass.ice += from.ice;
        s.vessels.glass.crushed ||= from.crushed;
      }
      s.vessels[a.from] = emptyVessel();
      return { state: s };
    }
    case 'garnish':
      s.garnishes.push({ key: sourceKey(a.source), label: a.source.label, color: a.source.color });
      return { state: s };
    case 'empty':
      s.vessels[a.vessel] = emptyVessel();
      if (a.vessel === 'glass') s.garnishes = [];
      return { state: s };
  }
}

/** Replays a whole log. Rejected actions are skipped but reported. */
export function replay(actions: Action[], glass = 'highball') {
  let state = newGame(glass);
  const rejected: { index: number; reason: string }[] = [];
  actions.forEach((a, index) => {
    const r = apply(state, a);
    if (r.rejected) rejected.push({ index, reason: r.rejected });
    state = r.state;
  });
  return { state, rejected };
}
