import { z } from 'zod';

// Shared vocabulary. MCP tools, the REST API and the web client all import
// from here, so a value means the same thing everywhere.

export const FILL_LEVELS = [
  'full',
  'three_quarters',
  'half',
  'quarter',
  'almost_empty',
  'empty',
] as const;
export type FillLevel = (typeof FILL_LEVELS)[number];

/** Suggested categories. Custom values are allowed. */
export const CATEGORIES = [
  'spirit',
  'liqueur',
  'wine_aperitif',
  'syrup',
  'juice',
  'mixer',
  'fruit',
  'garnish',
  'dairy_cream',
  'bitters',
  'other',
] as const;

/** Suggested equipment types. Custom values are allowed. */
export const EQUIPMENT_TYPES = [
  'shaker',
  'jigger',
  'muddler',
  'strainer',
  'bar_spoon',
  'blender',
  'mixing_glass',
  'citrus_press',
  'ice_crusher',
  'other',
] as const;

/** Suggested glass types. Custom values are allowed. */
export const GLASS_TYPES = [
  'highball',
  'collins',
  'rocks',
  'coupe',
  'martini',
  'nick_and_nora',
  'hurricane',
  'tiki',
  'copper_mug',
  'wine',
  'flute',
  'shot',
  'other',
] as const;

export const STEP_ACTIONS = [
  'add_ice',
  'pour',
  'muddle',
  'shake',
  'stir',
  'blend',
  'strain',
  'top_up',
  'garnish',
  'chill_glass',
  'custom',
] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

export const UNITS = [
  'cl',
  'ml',
  'oz',
  'dash',
  'barspoon',
  'tsp',
  'tbsp',
  'piece',
  'slice',
  'wedge',
  'leaf',
  'sprig',
  'scoop',
  'top',
  'to_taste',
] as const;
export type Unit = (typeof UNITS)[number];

export const SOURCES = ['web', 'mcp', 'cli', 'system'] as const;
export type Source = (typeof SOURCES)[number];

export const PRIORITIES = ['low', 'normal', 'high'] as const;

const key = (what: string, known: readonly string[]) =>
  z
    .string()
    .trim()
    .min(1)
    .max(40)
    .transform((s) => s.toLowerCase().replace(/[\s-]+/g, '_'))
    .describe(`${what}. Usually one of: ${known.join(', ')}. Custom values are allowed.`);

export const categorySchema = key('Ingredient category', CATEGORIES);
export const equipmentTypeSchema = key('Equipment type', EQUIPMENT_TYPES);
export const glassTypeSchema = key('Glass type', GLASS_TYPES);
export const locationKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((s) => s.toLowerCase().replace(/[\s-]+/g, '_'))
  .describe('Storage location key: shelf, fridge, freezer, pantry or a custom one.');

export const fillLevelSchema = z.enum(FILL_LEVELS);
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #f5a623')
  .describe('Hex color like #f5a623, used to draw the liquid.');

/** Accepts "2026-10-19" or a full ISO timestamp. */
export const dateSchema = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Expected a date like 2026-10-19')
  .describe('Date (YYYY-MM-DD) or ISO timestamp.');

const tagsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(30)
  .transform((tags) => [...new Set(tags.map((t) => t.toLowerCase()))]);

export const ingredientInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  brand: z.string().trim().max(80).nullish(),
  category: categorySchema,
  subcategory: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .describe('Free text, e.g. "white rum", "london dry gin", "monin".'),
  tags: tagsSchema
    .optional()
    .describe('Free tags. Tags also count for recipe matching, e.g. tag limes with "lime juice".'),
  provides: tagsSchema
    .optional()
    .describe(
      'What this item supplies besides itself, e.g. limes: ["lime juice", "lime zest", "lime wedge"]. A recipe line asking for one of these matches even if its category differs.',
    ),
  abv: z.number().min(0).max(100).nullish(),
  color: hexColorSchema.nullish(),
  flavor_notes: z.string().trim().max(300).nullish(),
  location: locationKeySchema.optional(),
  fill_level: fillLevelSchema.optional(),
  amount_ml: z.number().min(0).max(100000).nullish(),
  bottle_size_ml: z.number().positive().max(100000).nullish(),
  yield_ml: z
    .number()
    .positive()
    .max(10000)
    .nullish()
    .describe('For things counted in pieces (limes, lemons): usable juice per piece in ml.'),
  opened_at: dateSchema.nullish(),
  shelf_life_days: z
    .number()
    .int()
    .positive()
    .max(36500)
    .nullish()
    .describe('Days it keeps after opening. Omit to use the category default.'),
  expires_at: dateSchema
    .nullish()
    .describe('Manual expiry date. Omit to compute it from opened_at and shelf life.'),
  quantity: z.number().min(0).max(1000).optional().describe('Number of bottles, packs or pieces.'),
  notes: z.string().trim().max(1000).nullish(),
});
export type IngredientInput = z.input<typeof ingredientInputSchema>;
export const ingredientPatchSchema = ingredientInputSchema.partial();
export type IngredientPatch = z.input<typeof ingredientPatchSchema>;

export const recipeIngredientSchema = z
  .object({
    name: z.string().trim().min(1).max(80).describe('Display name, e.g. "White rum".'),
    ingredient_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Pin to one specific bottle. Usually leave empty and use category/subcategory.'),
    category: categorySchema.optional(),
    subcategory: z
      .string()
      .trim()
      .max(60)
      .optional()
      .describe('Matches any bottle whose subcategory/name/tags contain these words.'),
    tags: z.array(z.string().trim().min(1)).max(10).optional(),
    exact: z
      .boolean()
      .optional()
      .describe(
        'Strict match: the bottle may not carry extra qualifiers, so "tonic water" does not match "wild berry tonic water".',
      ),
    exclude: z
      .array(z.string().trim().min(1))
      .max(10)
      .optional()
      .describe('Words that rule a bottle out, e.g. ["wild berry", "pink"].'),
    amount: z.number().positive().max(10000).optional(),
    unit: z.enum(UNITS).default('cl'),
    optional: z.boolean().default(false),
    garnish: z.boolean().default(false),
  })
  .describe(
    'One recipe ingredient. Matching is fuzzy: "rum" matches any rum, "dark rum" does not match white rum.',
  );
export type RecipeIngredient = z.output<typeof recipeIngredientSchema>;

export const stepSchema = z.object({
  action: z.enum(STEP_ACTIONS),
  ingredient: z
    .string()
    .trim()
    .max(80)
    .optional()
    .describe('Name of the recipe ingredient this step uses.'),
  amount: z.number().positive().max(10000).optional(),
  unit: z.enum(UNITS).optional(),
  equipment: equipmentTypeSchema.optional(),
  duration_s: z.number().positive().max(600).optional(),
  note: z.string().trim().max(300).optional(),
});
export type Step = z.output<typeof stepSchema>;

export const recipeInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).nullish(),
  tags: tagsSchema.optional(),
  glass: glassTypeSchema.nullish(),
  method: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .describe('Short method, e.g. shaken, stirred, built, blended.'),
  source: z.enum(['user', 'ai']).optional(),
  favorite: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  color: hexColorSchema.nullish(),
  ingredients: z.array(recipeIngredientSchema).min(1).max(30),
  steps: z.array(stepSchema).max(40).default([]),
});
export type RecipeInput = z.input<typeof recipeInputSchema>;

export const equipmentInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: equipmentTypeSchema,
  available: z.boolean().optional(),
  substitutes_for: z
    .array(equipmentTypeSchema)
    .max(10)
    .optional()
    .describe(
      'Equipment types this item can stand in for, e.g. a jam jar substitutes for "shaker".',
    ),
  notes: z.string().trim().max(500).nullish(),
});
export type EquipmentInput = z.input<typeof equipmentInputSchema>;

export const glassInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: glassTypeSchema,
  count: z.number().int().min(0).max(1000).optional(),
  notes: z.string().trim().max(500).nullish(),
});
export type GlassInput = z.input<typeof glassInputSchema>;

export const shoppingInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  ingredient_id: z.number().int().positive().nullish(),
  quantity: z.string().trim().max(40).nullish().describe('Free text, e.g. "2 bottles", "500 ml".'),
  reason: z.string().trim().max(300).nullish(),
  priority: z.enum(PRIORITIES).optional(),
  done: z.boolean().optional(),
});
export type ShoppingInput = z.input<typeof shoppingInputSchema>;

export const locationInputSchema = z.object({
  key: locationKeySchema,
  label_en: z.string().trim().min(1).max(40),
  label_de: z.string().trim().min(1).max(40).optional(),
  sort: z.number().int().optional(),
});

export const categoryDefaultsInputSchema = z.object({
  category: categorySchema,
  shelf_life_days: z
    .number()
    .int()
    .positive()
    .max(36500)
    .nullable()
    .optional()
    .describe('Days after opening; null means it keeps indefinitely.'),
  default_location: locationKeySchema.optional(),
  bottle_size_ml: z.number().positive().nullable().optional(),
  color: hexColorSchema.optional(),
});
