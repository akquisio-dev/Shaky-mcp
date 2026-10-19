import { z } from 'zod';
import { getAllSettings, setSetting } from '../db/repos/misc.js';
import { mutate, type Ctx } from './context.js';

export const settingsSchema = z
  .object({
    language: z.enum(['auto', 'en', 'de']),
    units: z.enum(['cl', 'oz']),
    web_autostart: z.boolean(),
    expiry_warning_days: z.number().int().min(0).max(60),
    theme: z.enum(['auto', 'light', 'dark']),
    household_substitutes: z
      .record(z.string(), z.string().trim().min(1).max(40))
      .describe(
        'Household items that stand in for a missing bar tool, by tool type, e.g. {"bar_spoon": "spoon", "strainer": "fork"}.',
      ),
  })
  .partial();

export { getAllSettings };

export function updateSettings(ctx: Ctx, input: z.input<typeof settingsSchema>) {
  const b = settingsSchema.parse(input);
  return mutate(ctx, (cs) => {
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue;
      setSetting(ctx.db, k, v);
      cs.record({
        entity: 'settings',
        entity_id: null,
        action: 'updated',
        summary: `Setting ${k} set to ${JSON.stringify(v)}.`,
        data: { key: k, value: v },
      });
    }
    return getAllSettings(ctx.db);
  });
}
