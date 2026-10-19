// Mixing game core. Pure and isomorphic: the browser runs it for the scene,
// the server replays the same action log to score a training. No DOM, no zod.

export type VesselId = 'glass' | 'shaker' | 'blender' | 'mixing_glass';
export type ToolVessel = Exclude<VesselId, 'glass'>;

/** Where something came from: a real bottle (ingredient_id) or a virtual sandbox bottle (line). */
export interface Source {
  label: string;
  color: string;
  ingredient_id?: number;
  /** Recipe line name this source stands for (virtual bottles, or resolved for real ones). */
  line?: string;
}

export interface Layer {
  key: string;
  label: string;
  color: string;
  ml: number;
}

export interface Vessel {
  layers: Layer[];
  ice: number;
  crushed: boolean;
  /** Solid things added by count: mint leaves, strawberries ... */
  solids: { key: string; label: string; color: string; count: number }[];
  muddled_s: number;
  shaken_s: number;
  stirred_s: number;
  blended_s: number;
}

export interface GameState {
  glass: string;
  chilled: boolean;
  vessels: Record<VesselId, Vessel>;
  garnishes: { key: string; label: string; color: string }[];
  spilled_ml: number;
}

/** Every action records quantities, never timestamps, so a replay is exact. */
export type Action =
  | { type: 'choose_glass'; glass: string }
  | { type: 'chill_glass' }
  | { type: 'add_ice'; vessel: VesselId; cubes?: number; crushed?: boolean }
  | { type: 'pour'; vessel: VesselId; source: Source; ml: number }
  | { type: 'add'; vessel: VesselId; source: Source; count: number }
  | { type: 'muddle'; vessel: VesselId; s: number }
  | { type: 'shake'; s: number }
  | { type: 'stir'; vessel: VesselId; s: number }
  | { type: 'blend'; s: number }
  | { type: 'strain'; from: ToolVessel }
  | { type: 'transfer'; from: ToolVessel }
  | { type: 'garnish'; source: Source }
  | { type: 'empty'; vessel: VesselId };

export type ActionType = Action['type'];
