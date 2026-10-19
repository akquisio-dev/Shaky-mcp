import { t } from './i18n.js';
import { state } from './store.js';

const OZ_PER_CL = 1 / 2.957;

/** Formats a recipe amount, converting cl/ml to oz when the user prefers oz. */
export function formatAmount(a?: number, unit?: string): string {
  if (a === undefined) return '';
  let value = a;
  let u = unit ?? '';
  if (state.meta?.settings.units === 'oz' && (u === 'cl' || u === 'ml')) {
    value = Math.round(a * (u === 'cl' ? OZ_PER_CL : OZ_PER_CL / 10) * 4) / 4;
    u = 'oz';
  }
  const num = String(Math.round(value * 100) / 100).replace('.', t().lang === 'de' ? ',' : '.');
  return `${num} ${u.replace(/_/g, ' ')}`.trim();
}
