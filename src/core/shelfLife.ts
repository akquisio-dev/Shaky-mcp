const DAY = 86_400_000;

export interface ExpiryInfo {
  /** Effective shelf life after opening, null = keeps indefinitely. */
  shelf_life_days: number | null;
  /** ISO date (YYYY-MM-DD) or null. */
  expires_on: string | null;
  days_left: number | null;
  expired: boolean;
  expiring_soon: boolean;
}

export function toDateOnly(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * A manual expires_at wins. Opened items expire opened_at + shelf life (own
 * value, else the category default). Unopened items expire on their best
 * before date if one is known, otherwise not at all.
 */
export function expiryInfo(
  item: {
    opened_at: string | null;
    shelf_life_days: number | null;
    expires_at: string | null;
    best_before?: string | null;
  },
  categoryDays: number | null | undefined,
  now: Date,
  warnDays = 7,
): ExpiryInfo {
  const shelf = item.shelf_life_days ?? categoryDays ?? null;
  let expiresMs: number | null = null;
  if (item.expires_at) expiresMs = Date.parse(item.expires_at);
  else if (item.opened_at && shelf !== null) expiresMs = Date.parse(item.opened_at) + shelf * DAY;
  // Unopened: the best before date printed on the pack.
  else if (!item.opened_at && item.best_before) expiresMs = Date.parse(item.best_before);
  if (expiresMs === null || Number.isNaN(expiresMs)) {
    return {
      shelf_life_days: shelf,
      expires_on: null,
      days_left: null,
      expired: false,
      expiring_soon: false,
    };
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expDay = new Date(expiresMs);
  const expDate = Date.UTC(expDay.getUTCFullYear(), expDay.getUTCMonth(), expDay.getUTCDate());
  const days_left = Math.round((expDate - today) / DAY);
  return {
    shelf_life_days: shelf,
    expires_on: new Date(expDate).toISOString().slice(0, 10),
    days_left,
    expired: days_left < 0,
    expiring_soon: days_left >= 0 && days_left <= warnDays,
  };
}
