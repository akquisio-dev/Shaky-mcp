/** Capacity in ml and the drawing family for each glass type. */
export const GLASSES: Record<string, { capacity: number; shape: GlassShape }> = {
  highball: { capacity: 350, shape: 'tall' },
  collins: { capacity: 400, shape: 'tall' },
  rocks: { capacity: 300, shape: 'short' },
  coupe: { capacity: 200, shape: 'coupe' },
  martini: { capacity: 200, shape: 'martini' },
  nick_and_nora: { capacity: 150, shape: 'coupe' },
  hurricane: { capacity: 450, shape: 'hurricane' },
  tiki: { capacity: 450, shape: 'tiki' },
  copper_mug: { capacity: 450, shape: 'mug' },
  wine: { capacity: 400, shape: 'wine' },
  flute: { capacity: 200, shape: 'flute' },
  shot: { capacity: 50, shape: 'shot' },
};

export type GlassShape =
  'tall' | 'short' | 'coupe' | 'martini' | 'hurricane' | 'tiki' | 'mug' | 'wine' | 'flute' | 'shot';

export const TOOL_CAPACITY = { shaker: 700, blender: 1500, mixing_glass: 600 } as const;

export function glassInfo(type: string) {
  return GLASSES[type] ?? { capacity: 300, shape: 'tall' as GlassShape };
}

/** ml per unit for volume units; undefined for count units. */
export const ML_PER_UNIT: Record<string, number> = {
  ml: 1,
  cl: 10,
  oz: 29.5735,
  dash: 0.9,
  barspoon: 5,
  tsp: 5,
  tbsp: 15,
};

/** Pour speed while holding, in ml per second. One constant for client and server. */
export const POUR_ML_PER_S = 15;
/** Shake/stir/blend progress per second of holding. */
export const TECHNIQUE_RATE = 1;
