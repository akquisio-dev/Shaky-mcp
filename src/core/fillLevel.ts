import type { FillLevel, Unit } from './schemas.js';

/** Representative share of a bottle for each fill level. */
export const LEVEL_FRACTION: Record<FillLevel, number> = {
  full: 1,
  three_quarters: 0.75,
  half: 0.5,
  quarter: 0.25,
  almost_empty: 0.1,
  empty: 0,
};

/** Maps a remaining share to the nearest level. Anything left is never "empty". */
export function levelFromFraction(f: number): FillLevel {
  if (f <= 0) return 'empty';
  if (f < 0.175) return 'almost_empty';
  if (f < 0.375) return 'quarter';
  if (f < 0.625) return 'half';
  if (f < 0.875) return 'three_quarters';
  return 'full';
}

const ML_PER_UNIT: Partial<Record<Unit, number>> = {
  ml: 1,
  cl: 10,
  oz: 29.5735,
  dash: 0.9,
  barspoon: 5,
  tsp: 5,
  tbsp: 15,
  // Solids (sugar) are kept in grams; a pack's size and amount are then grams too.
  g: 1,
  kg: 1000,
};

/** Volume in ml, or null for count-like units (piece, wedge, leaf, top ...). */
export function toMl(amount: number, unit: Unit): number | null {
  const f = ML_PER_UNIT[unit];
  return f === undefined ? null : amount * f;
}

export const isCountUnit = (unit: Unit) => unit === 'piece' || unit === 'scoop';

export interface StockState {
  fill_level: FillLevel;
  amount_ml: number | null;
  amount_is_estimate: boolean;
  bottle_size_ml: number | null;
  quantity: number;
  opened_at: string | null;
}

export interface DeductResult {
  next: StockState;
  /** True when the open bottle ran out and the next one was opened. */
  openedNext: boolean;
  /** Set when nothing could be deducted, with the reason. */
  skipped?: string;
}

/**
 * Takes a volume out of the open bottle. With exact ml it is exact; with
 * levels only it estimates from the level (so repeated small pours add up,
 * the estimate is stored and flagged). If the bottle runs out and spares
 * exist, the next bottle is opened.
 */
export function deductVolume(
  s: StockState,
  ml: number,
  defaultBottleMl: number | null,
  nowIso: string,
): DeductResult {
  const size = s.bottle_size_ml ?? defaultBottleMl;
  const estimate = s.amount_ml === null || s.amount_is_estimate;
  let current = s.amount_ml;
  if (current === null) {
    if (size === null) return { next: s, openedNext: false, skipped: 'unknown bottle size' };
    current = LEVEL_FRACTION[s.fill_level] * size;
  }
  let rest = current - ml;
  let quantity = s.quantity;
  let opened_at = s.opened_at ?? nowIso;
  let openedNext = false;
  while (rest <= 0 && quantity > 1 && size) {
    quantity -= 1;
    rest += size;
    opened_at = nowIso;
    openedNext = true;
  }
  rest = Math.max(0, Math.round(rest * 10) / 10);
  const fill_level: FillLevel =
    rest === 0 ? 'empty' : size ? levelFromFraction(rest / size) : s.fill_level;
  return {
    next: {
      ...s,
      fill_level,
      amount_ml: rest,
      amount_is_estimate: estimate,
      quantity,
      opened_at,
    },
    openedNext,
  };
}

/** Takes pieces (limes, scoops ...) off the quantity. */
export function deductCount(s: StockState, count: number): DeductResult {
  const quantity = Math.max(0, Math.round((s.quantity - count) * 100) / 100);
  return {
    next: { ...s, quantity, fill_level: quantity === 0 ? 'empty' : s.fill_level },
    openedNext: false,
  };
}
