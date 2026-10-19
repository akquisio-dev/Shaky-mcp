import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z, ZodError } from 'zod';
import { listActivity } from '../db/repos/misc.js';
import { listShopping } from '../db/repos/misc.js';
import {
  equipmentUpsertSchema,
  glassUpsertSchema,
  listCategoryDefaults,
  listEquipment,
  listGlassware,
  setCategoryDefaults,
  setEquipment,
  setGlassware,
  setLocation,
} from '../core/catalog.js';
import { ShakyError, type Change, type Ctx } from '../core/context.js';
import { countExampleData, removeExampleData } from '../core/examples.js';
import { listTrash, listUndoable, restoreFromTrash, undo } from '../core/undo.js';
import {
  addPreference,
  describePreference,
  listPreferences,
  preferenceInputSchema,
  removePreference,
} from '../core/preferences.js';
import {
  listTemplates,
  makePreparation,
  makeSchema,
  saveTemplate,
  templateSchema,
} from '../core/prep.js';
import { batchCalculator, batchSchema } from '../core/batch.js';
import { getAllSettings, settingsSchema, updateSettings } from '../core/settings.js';
import {
  addIngredient,
  addIngredients,
  archiveIngredient,
  getExpiring,
  getIngredientView,
  listIngredientViews,
  markOpened,
  setFillLevel,
  updateIngredientFields,
  type IngredientView,
} from '../core/inventory.js';
import { logMix } from '../core/mixing.js';
import { barOverview, overviewText } from '../core/overview.js';
import {
  deleteRecipe,
  findMakeable,
  patchRecipe,
  recipePatchSchema,
  getRecipeWithCheck,
  listRecipesWithCheck,
  saveRecipe,
} from '../core/recipes.js';
import {
  categoryDefaultsInputSchema,
  dateSchema,
  fillLevelSchema,
  ingredientInputSchema,
  ingredientPatchSchema,
  locationInputSchema,
  recipeInputSchema,
  shoppingInputSchema,
  UNITS,
} from '../core/schemas.js';
import { addShopping, updateShoppingItem } from '../core/shopping.js';
import {
  cancelTraining,
  describeTraining,
  getTraining,
  listTrainings,
  startTraining,
} from '../core/training.js';

// Thin MCP wrapper around core/. Every tool returns a short human-readable
// line plus compact JSON; mutating tools always list what they changed.

interface Reply {
  text: string;
  data: Record<string, unknown>;
}

function ok(text: string, data: Record<string, unknown>): Reply {
  return { text, data };
}

function changed(text: string, changes: Change[], data: Record<string, unknown>): Reply {
  return ok(text, { changed: changes.map((c) => c.summary), ...data });
}

function toResult(r: Reply): CallToolResult {
  return {
    content: [{ type: 'text', text: `${r.text}\n\n${JSON.stringify(r.data)}` }],
    structuredContent: r.data,
  };
}

function toError(e: unknown): CallToolResult {
  let msg: string;
  if (e instanceof ShakyError) msg = e.message;
  else if (e instanceof ZodError)
    msg = `Invalid input: ${e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`;
  else msg = `Unexpected error: ${e instanceof Error ? e.message : String(e)}`;
  return { content: [{ type: 'text', text: msg }], isError: true };
}

const ingredientRef = z
  .union([z.number().int().positive(), z.string().trim().min(1)])
  .describe('Ingredient id (preferred, see get_bar_overview) or its exact name.');
const recipeRef = z
  .union([z.number().int().positive(), z.string().trim().min(1)])
  .describe('Recipe id or exact name.');

/** Compact ingredient for lists. */
export function brief(i: IngredientView) {
  return {
    id: i.id,
    name: i.name,
    ...(i.brand && { brand: i.brand }),
    category: i.category,
    ...(i.subcategory && { subcategory: i.subcategory }),
    ...(i.tags.length && { tags: i.tags }),
    location: i.location,
    fill_level: i.fill_level,
    ...(i.amount_ml !== null && { amount_ml: i.amount_ml, ml_is_estimate: i.amount_is_estimate }),
    ...(i.quantity !== 1 && { quantity: i.quantity }),
    ...(i.abv !== null && { abv: i.abv }),
    ...(i.opened_at && { opened: i.opened_at.slice(0, 10) }),
    ...(i.expires_on && { expires_on: i.expires_on, days_left: i.days_left }),
    available: i.available,
    ...(i.archived && { archived: true }),
  };
}

export function registerTools(server: McpServer, ctx: Ctx, webUrl = 'http://localhost:8787'): void {
  const reg = <S extends z.ZodRawShape>(
    name: string,
    config: {
      title: string;
      description: string;
      input: S;
      readOnly?: boolean;
      destructive?: boolean;
    },
    handler: (args: z.output<z.ZodObject<S>>) => Reply,
  ) => {
    // Every tool that changes something can be tried first: dry_run runs it,
    // reports what would change and rolls everything back.
    const input = config.readOnly
      ? config.input
      : {
          ...config.input,
          dry_run: z
            .boolean()
            .optional()
            .describe('Only show what would change; nothing is saved. Use before bulk changes.'),
        };
    server.registerTool(
      name,
      {
        title: config.title,
        description: config.description,
        inputSchema: input,
        annotations: {
          readOnlyHint: config.readOnly ?? false,
          destructiveHint: config.destructive ?? false,
          openWorldHint: false,
        },
      },
      // The SDK has already validated args against the shape.
      ((raw: z.output<z.ZodObject<S>> & { dry_run?: boolean }) => {
        const { dry_run, ...args } = raw;
        ctx.dryRun = Boolean(dry_run) && !config.readOnly;
        try {
          const reply = handler(args as z.output<z.ZodObject<S>>);
          if (ctx.dryRun) {
            reply.text = `Dry run, nothing was saved. This would happen: ${reply.text}`;
            reply.data = { dry_run: true, ...reply.data };
          }
          return toResult(reply);
        } catch (e) {
          return toError(e);
        } finally {
          ctx.dryRun = false;
        }
      }) as never,
    );
  };

  // ---------- overview & ingredients ----------

  reg(
    'get_bar_overview',
    {
      title: 'Bar overview',
      description:
        'Call this first. Compact summary of the home bar: everything in stock grouped by category (with ids and fill levels), warnings (expired, expiring soon, almost empty), available equipment and glasses, and which saved recipes can be made right now or miss just one ingredient. Empty and expired items are not listed as in stock.',
      input: {},
      readOnly: true,
    },
    () => {
      const o = barOverview(ctx);
      return ok(overviewText(o), o);
    },
  );

  reg(
    'list_ingredients',
    {
      title: 'List ingredients',
      description:
        'List ingredients with optional filters. By default empty and archived items are hidden. Use search for free text over name, brand, subcategory, tags and notes.',
      input: {
        category: z
          .string()
          .optional()
          .describe('e.g. spirit, liqueur, syrup, juice, mixer, fruit'),
        location: z.string().optional().describe('e.g. shelf, fridge, freezer, pantry'),
        tag: z.string().optional(),
        search: z.string().optional(),
        include_empty: z.boolean().optional(),
        include_archived: z.boolean().optional(),
      },
      readOnly: true,
    },
    (a) => {
      const items = listIngredientViews(ctx, a).map(brief);
      return ok(`${items.length} ingredient(s).`, { count: items.length, items });
    },
  );

  reg(
    'get_ingredient',
    {
      title: 'Get ingredient',
      description: 'Full details of one ingredient, including computed expiry and availability.',
      input: { ingredient: ingredientRef },
      readOnly: true,
    },
    (a) => {
      const i = getIngredientView(ctx, a.ingredient);
      return ok(`${i.name}: ${i.fill_level}, ${i.available ? 'available' : 'not available'}.`, {
        ...i,
      });
    },
  );

  reg(
    'add_ingredient',
    {
      title: 'Add ingredient',
      description:
        'Add a new bottle or item to the bar. Category and fields are free, custom values are fine (e.g. a Monin syrup: category "syrup", subcategory "monin", tags ["passion fruit"]). Pick a hex color that looks like the liquid; container and label_color set how it is drawn (a purple can may hold a clear drink). Fill level defaults to full. Check list_ingredients first so you do not add a duplicate; to restock an existing item, update its quantity instead.',
      input: ingredientInputSchema.shape,
    },
    (a) => {
      const { result, changes } = addIngredient(ctx, a);
      return changed(`Added ${result.name} (id ${result.id}).`, changes, {
        ingredient: brief(result),
      });
    },
  );

  reg(
    'add_ingredients',
    {
      title: 'Add several ingredients',
      description:
        'Add up to 100 ingredients in one call, same fields as add_ingredient. All or nothing: if one item is invalid, nothing is added and the error names the item. Use this when stocking a bar.',
      input: { items: z.array(z.object(ingredientInputSchema.shape)).min(1).max(100) },
    },
    (a) => {
      const { result, changes } = addIngredients(ctx, a.items);
      return changed(
        `Added ${result.length} ingredient(s).`,
        changes.filter((c) => c.entity === 'location'),
        {
          added: result.map((i) => ({ id: i.id, name: i.name, location: i.location })),
        },
      );
    },
  );

  reg(
    'update_ingredient',
    {
      title: 'Update ingredient',
      description:
        'Change any fields of an ingredient. Only the given fields change. Setting amount_ml makes stock exact and derives the fill level; setting fill_level alone clears a stored ml figure.',
      input: { ingredient: ingredientRef, ...ingredientPatchSchema.shape },
    },
    (a) => {
      const { ingredient, ...patch } = a;
      const { result, changes } = updateIngredientFields(ctx, ingredient, patch);
      return changed(
        changes.length ? changes.map((c) => c.summary).join(' ') : 'Nothing changed.',
        changes,
        { ingredient: brief(result) },
      );
    },
  );

  reg(
    'archive_ingredient',
    {
      title: 'Archive ingredient',
      description:
        'Soft-delete an ingredient (it disappears from the bar but stays in history). Use restore: true to bring it back. For a bottle that is simply finished, prefer set_fill_level "empty".',
      input: { ingredient: ingredientRef, restore: z.boolean().optional() },
      destructive: true,
    },
    (a) => {
      const { result, changes } = archiveIngredient(ctx, a.ingredient, !a.restore);
      return changed(`${result.name} ${a.restore ? 'restored' : 'archived'}.`, changes, {
        ingredient: brief(result),
      });
    },
  );

  reg(
    'set_fill_level',
    {
      title: 'Set fill level',
      description:
        'Set how full the open bottle is: full, three_quarters, half, quarter, almost_empty or empty. For counted containers (cans, fruit) change quantity with update_ingredient and use mark_opened for an opened can instead. Optionally give amount_ml for an exact figure. quantity (number of bottles) is not changed; use update_ingredient for that.',
      input: {
        ingredient: ingredientRef,
        fill_level: fillLevelSchema,
        amount_ml: z.number().min(0).optional(),
      },
    },
    (a) => {
      const { result, changes } = setFillLevel(ctx, a.ingredient, a.fill_level, a.amount_ml);
      return changed(
        changes.length
          ? changes.map((c) => c.summary).join(' ')
          : `${result.name} was already ${result.fill_level}.`,
        changes,
        { ingredient: brief(result) },
      );
    },
  );

  reg(
    'mark_opened',
    {
      title: 'Mark opened',
      description:
        'Record that a bottle was opened (today by default). Starts the shelf-life clock, e.g. Lillet keeps about 5 weeks in the fridge once open.',
      input: { ingredient: ingredientRef, date: dateSchema.optional() },
    },
    (a) => {
      const { result, changes } = markOpened(ctx, a.ingredient, a.date);
      return changed(
        `${result.name} opened ${result.opened_at?.slice(0, 10)}${result.expires_on ? `, use by ${result.expires_on}` : ', keeps indefinitely'}.`,
        changes,
        { ingredient: brief(result) },
      );
    },
  );

  reg(
    'get_expiring',
    {
      title: 'Expiring soon',
      description:
        'Open items that expire within the given number of days (default 7), soonest first, including already expired ones. Good for "what should I use up?".',
      input: {
        days: z.number().int().min(0).max(365).default(7),
        include_expired: z.boolean().default(true),
      },
      readOnly: true,
    },
    (a) => {
      const items = getExpiring(ctx, a.days, a.include_expired).map(brief);
      return ok(
        items.length
          ? items
              .map(
                (i) => `${i.name}: ${i.days_left! < 0 ? 'expired' : `${i.days_left} day(s) left`}`,
              )
              .join('; ')
          : `Nothing expires in the next ${a.days} days.`,
        { items },
      );
    },
  );

  // ---------- equipment, glassware, locations ----------

  reg(
    'list_equipment',
    {
      title: 'List equipment',
      description:
        'All bar tools with type, availability and what they can substitute for (e.g. a jam jar standing in for a shaker).',
      input: {},
      readOnly: true,
    },
    () => {
      const items = listEquipment(ctx.db);
      return ok(
        items.map((e) => `${e.name} (${e.type}${e.available ? '' : ', unavailable'})`).join(', ') ||
          'No equipment.',
        { items },
      );
    },
  );

  reg(
    'set_equipment',
    {
      title: 'Add or change equipment',
      description:
        'Add, change or remove a bar tool. Matched by id, else by name; an unknown name creates it (type required). Use substitutes_for to say what it can replace, e.g. {name: "Jam jar", type: "other", substitutes_for: ["shaker"]}. Use available: false when something is broken or lent out, remove: true to delete.',
      input: equipmentUpsertSchema.shape,
    },
    (a) => {
      const { result, changes } = setEquipment(ctx, a);
      return changed(changes.map((c) => c.summary).join(' ') || 'Nothing changed.', changes, {
        ...result,
      });
    },
  );

  reg(
    'list_glassware',
    {
      title: 'List glassware',
      description: 'All glasses with type and count.',
      input: {},
      readOnly: true,
    },
    () => {
      const items = listGlassware(ctx.db);
      return ok(items.map((g) => `${g.count}x ${g.name}`).join(', ') || 'No glasses.', { items });
    },
  );

  reg(
    'set_glassware',
    {
      title: 'Add or change glassware',
      description:
        'Add, change or remove glasses. Matched by id, else by name; an unknown name creates it (type required, e.g. highball, rocks, coupe, hurricane, tiki). remove: true deletes.',
      input: glassUpsertSchema.shape,
    },
    (a) => {
      const { result, changes } = setGlassware(ctx, a);
      return changed(changes.map((c) => c.summary).join(' ') || 'Nothing changed.', changes, {
        ...result,
      });
    },
  );

  reg(
    'set_location',
    {
      title: 'Add or rename a storage location',
      description:
        'Create or relabel a storage location beyond shelf, fridge, freezer and pantry (e.g. "bar_cart"). Ingredients can then use its key.',
      input: locationInputSchema.shape,
    },
    (a) => {
      const { result, changes } = setLocation(ctx, a);
      return changed(`Location ${result.key} saved.`, changes, { location: result });
    },
  );

  reg(
    'set_category_defaults',
    {
      title: 'Change category defaults',
      description:
        'Change defaults for an ingredient category: shelf life after opening in days (null = keeps indefinitely), default location, typical bottle size and color. Also creates new categories. Without arguments besides category, returns the current defaults of all categories.',
      input: categoryDefaultsInputSchema.shape,
    },
    (a) => {
      const keys = Object.keys(a).filter(
        (k) => k !== 'category' && a[k as keyof typeof a] !== undefined,
      );
      if (keys.length === 0) {
        return ok('Current category defaults.', { categories: listCategoryDefaults(ctx.db) });
      }
      const { result, changes } = setCategoryDefaults(ctx, a);
      return changed(`Defaults for ${result.category} saved.`, changes, { defaults: result });
    },
  );

  // ---------- recipes ----------

  reg(
    'list_recipes',
    {
      title: 'List saved recipes',
      description:
        'Saved recipes with availability status (makeable, missing_one, missing_more). Filters: tag, search, favorite, status.',
      input: {
        tag: z.string().optional(),
        search: z.string().optional(),
        favorite: z.boolean().optional(),
        status: z.enum(['makeable', 'missing_one', 'missing_more']).optional(),
      },
      readOnly: true,
    },
    (a) => {
      const items = listRecipesWithCheck(ctx, a).map((r) => ({
        id: r.id,
        name: r.name,
        tags: r.tags,
        glass: r.glass,
        ...(r.favorite && { favorite: true }),
        ...(r.rating && { rating: r.rating }),
        status: r.availability.status,
        ...(r.availability.missing.length && { missing: r.availability.missing }),
        abv: r.strength.abv,
        ...(r.personal.avoided.length && { avoided: r.personal.avoided }),
      }));
      return ok(`${items.length} recipe(s).`, { items });
    },
  );

  reg(
    'get_recipe',
    {
      title: 'Get recipe',
      description:
        "Full recipe with ingredients (each marked available, unavailable or missing, with the matching bottle), structured steps, missing equipment, strength (abv, standard drinks, energy drink warning) and personal: the amounts after the user's preferences. Use personal amounts when telling the user how to mix.",
      input: { recipe: recipeRef },
      readOnly: true,
    },
    (a) => {
      const r = getRecipeWithCheck(ctx, a.recipe);
      return ok(`${r.name}: ${r.availability.status.replace('_', ' ')}.`, { ...r });
    },
  );

  reg(
    'save_recipe',
    {
      title: 'Save recipe',
      description:
        'Create a recipe or overwrite an existing one (same id or name). Describe ingredients generically so matching works: use category + subcategory words ("white rum", "orange liqueur", "lime juice") rather than brands, unless a specific bottle is required (then ingredient_id). Amounts default to cl. Steps are structured and drive the later mixing game: add_ice, pour, muddle, shake, stir, blend, strain, top_up, garnish, chill_glass, custom.',
      input: { id: z.number().int().positive().optional(), ...recipeInputSchema.shape },
    },
    (a) => {
      const { result, changes } = saveRecipe(ctx, a);
      return changed(
        `Saved ${result.name} (id ${result.id}), ${result.availability.status.replace('_', ' ')}.`,
        changes,
        {
          recipe: { id: result.id, name: result.name, availability: result.availability },
        },
      );
    },
  );

  reg(
    'update_recipe',
    {
      title: 'Change part of a recipe',
      description:
        'Change a saved recipe without resending all of it: plain fields (name, tags, glass, method, notes, rating, favorite ...), update_lines [{name, set: {...}}] to change single ingredient lines (amount, unit, subcategory, exact, exclude ...), add_lines, remove_lines (by name) and steps (replaces all steps). The result is validated like save_recipe.',
      input: { recipe: recipeRef, ...recipePatchSchema.shape },
    },
    (a) => {
      const { recipe, ...patch } = a;
      const { result, changes } = patchRecipe(ctx, recipe, patch);
      return changed(
        `Updated ${result.name}, ${result.availability.status.replace('_', ' ')}.`,
        changes,
        {
          recipe: {
            id: result.id,
            name: result.name,
            ingredients: result.ingredients,
            availability: result.availability,
          },
        },
      );
    },
  );

  reg(
    'delete_recipe',
    {
      title: 'Delete recipe',
      description: 'Delete a saved recipe permanently. Mix log entries keep their name.',
      input: { recipe: recipeRef },
      destructive: true,
    },
    (a) => {
      const { result, changes } = deleteRecipe(ctx, a.recipe);
      return changed(`Deleted ${result.name}.`, changes, { deleted: result });
    },
  );

  reg(
    'find_makeable_recipes',
    {
      title: 'What can I make?',
      description:
        'Saved recipes that can be made right now with what is in stock (with servings_possible: how many times the stock allows, each recipe counted on its own), plus those missing exactly one required ingredient (great for shopping suggestions). Matching is fuzzy over category, subcategory and tags; empty and expired items do not count. Equipment gaps are reported but do not block. For drinks not saved yet, use get_bar_overview and your own knowledge.',
      input: {
        tag: z.string().optional().describe('Only recipes with this tag, e.g. tiki, longdrink.'),
        include_missing_more: z.boolean().optional(),
        include_avoided: z
          .boolean()
          .optional()
          .describe('Also list recipes with ingredients the user avoids.'),
      },
      readOnly: true,
    },
    (a) => {
      const r = findMakeable(ctx, a);
      const slim = (c: (typeof r.makeable)[number]) => ({
        id: c.recipe_id,
        name: c.name,
        ...(c.missing.length && { missing: c.missing }),
        ...(c.missing_optional.length && { missing_optional: c.missing_optional }),
        ...(c.missing_equipment.length && { missing_equipment: c.missing_equipment }),
        ...(c.substitutes_used.length && { substitutes_used: c.substitutes_used }),
        ...(c.status === 'makeable' &&
          c.servings_possible !== null && { servings_possible: c.servings_possible }),
      });
      return ok(
        `Makeable: ${r.makeable.map((c) => (c.servings_possible !== null ? `${c.name} (${c.servings_possible}x)` : c.name)).join(', ') || 'none'}. Missing one: ${
          r.missing_one.map((c) => `${c.name} (${c.missing[0]})`).join(', ') || 'none'
        }.`,
        {
          makeable: r.makeable.map(slim),
          missing_one: r.missing_one.map(slim),
          missing_more_count: r.missing_more_count,
          ...(r.avoided.length && { left_out_because_avoided: r.avoided }),
          ...(r.missing_more && { missing_more: r.missing_more.map(slim) }),
        },
      );
    },
  );

  reg(
    'log_mix',
    {
      title: 'Log a mixed drink',
      description:
        'Record that a drink was made. With a saved recipe, stock is deducted automatically (exact for bottles with ml, estimated from fill level otherwise; fruit via yield_ml). For an unsaved drink, give name and optionally used: [{ingredient, amount, unit}]. Set deduct: false to only log. The reply lists every stock change.',
      input: {
        recipe: recipeRef.optional(),
        name: z.string().trim().min(1).max(80).optional(),
        servings: z.number().positive().max(20).optional(),
        rating: z.number().int().min(1).max(5).optional(),
        notes: z.string().max(1000).optional(),
        deduct: z.boolean().optional(),
        used: z
          .array(
            z.object({
              ingredient: ingredientRef,
              amount: z.number().positive(),
              unit: z.enum(UNITS).default('cl'),
            }),
          )
          .optional(),
      },
    },
    (a) => {
      const { result, changes } = logMix(ctx, a);
      return changed(
        `Logged ${result.name}.${result.deducted.length ? '' : ' No stock deducted.'}${
          result.skipped.length
            ? ` Skipped: ${result.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}.`
            : ''
        }`,
        changes,
        { mix: result },
      );
    },
  );

  // ---------- shopping list ----------

  reg(
    'shopping_list_get',
    {
      title: 'Shopping list',
      description: 'Open shopping list items, high priority first. include_done adds bought items.',
      input: { include_done: z.boolean().optional() },
      readOnly: true,
    },
    (a) => {
      const items = listShopping(ctx.db, { includeDone: a.include_done });
      return ok(items.map((s) => s.name).join(', ') || 'The shopping list is empty.', { items });
    },
  );

  reg(
    'shopping_list_add',
    {
      title: 'Add to shopping list',
      description:
        'Put something on the shopping list, with an optional reason (e.g. "for Mai Tai") and priority. An open item with the same name is updated instead of duplicated.',
      input: shoppingInputSchema.omit({ done: true }).shape,
    },
    (a) => {
      const { result, changes } = addShopping(ctx, a);
      return changed(changes[0]?.summary ?? 'Saved.', changes, { item: result.item });
    },
  );

  reg(
    'shopping_list_update',
    {
      title: 'Update shopping list item',
      description: 'Change an item, mark it bought (done: true) or delete it (remove: true).',
      input: {
        id: z.number().int().positive(),
        ...shoppingInputSchema.partial().shape,
        remove: z.boolean().optional(),
      },
    },
    (a) => {
      const { id, ...rest } = a;
      const { result, changes } = updateShoppingItem(ctx, id, rest);
      return changed(changes.map((c) => c.summary).join(' ') || 'Nothing changed.', changes, {
        ...result,
      });
    },
  );

  // ---------- personal taste ----------

  reg(
    'list_preferences',
    {
      title: 'Personal preferences',
      description:
        'The user\'s standing adjustments ("0.5 cl less lemon juice in sours") and things they avoid ("tequila"). They are already applied to get_recipe (personal amounts), log_mix, trainings and find_makeable_recipes.',
      input: {},
      readOnly: true,
    },
    () => {
      const items = listPreferences(ctx).map((p) => ({ ...p, text: describePreference(p) }));
      return ok(items.map((p) => p.text).join('; ') || 'No preferences yet.', { items });
    },
  );

  reg(
    'add_preference',
    {
      title: 'Remember a preference',
      description:
        'Remember the user\'s taste. kind "adjust": change an ingredient\'s amount by delta (in unit, default cl) or factor, optionally only in recipes with a tag (e.g. "sour", also matches the word in the name) or one recipe. kind "avoid": recipes containing that ingredient are left out of suggestions. Saved recipes stay unchanged.',
      input: preferenceInputSchema.shape,
    },
    (a) => {
      const { result, changes } = addPreference(ctx, a);
      return changed(`Remembered: ${describePreference(result)}.`, changes, { preference: result });
    },
  );

  reg(
    'remove_preference',
    {
      title: 'Forget a preference',
      description: 'Remove a preference by id (see list_preferences).',
      input: { id: z.number().int().positive() },
    },
    (a) => {
      const { result, changes } = removePreference(ctx, a.id);
      return changed(`Forgot: ${describePreference(result)}.`, changes, { removed: result });
    },
  );

  // ---------- homemade & batches ----------

  reg(
    'list_preparations',
    {
      title: 'Homemade ingredient recipes',
      description:
        'Saved preparations like "Simple syrup 1:1" or "Rich syrup 2:1": inputs (from stock or not, like water), output volume and shelf life.',
      input: {},
      readOnly: true,
    },
    () => {
      const items = listTemplates(ctx);
      return ok(
        items
          .map(
            (t) => `${t.name} (${t.output.ml} ml, keeps ${t.output.shelf_life_days ?? '?'} days)`,
          )
          .join('; '),
        { items },
      );
    },
  );

  reg(
    'make_preparation',
    {
      title: 'Make a homemade ingredient',
      description:
        'Make a preparation: takes the inputs out of stock (sugar in g, honey ...) and adds or refills the output bottle with today as its opening date, so its shelf life starts now. Use template (name or id) or custom, and batches or output_ml to scale.',
      input: makeSchema.shape,
    },
    (a) => {
      const { result, changes } = makePreparation(ctx, a);
      return changed(`Made ${result.made_ml} ml ${result.template}.`, changes, { ...result });
    },
  );

  reg(
    'save_preparation',
    {
      title: 'Save a preparation recipe',
      description:
        'Create or replace a homemade ingredient recipe (same name replaces). Units g/kg are fine for sugar.',
      input: templateSchema.shape,
    },
    (a) => {
      const { result, changes } = saveTemplate(ctx, a);
      return changed(`Saved preparation ${result.name}.`, changes, { template: result });
    },
  );

  reg(
    'batch_calculator',
    {
      title: 'Batch calculator',
      description:
        "Scale a recipe (with personal adjustments) to N glasses or a target volume, e.g. for a slush machine: amounts per ingredient, the machine's min/max fill (equipment of type slush_machine with specs min_ml/max_ml), the batch's alcohol percentage and a warning with a top-up amount when it is too strong to freeze (setting slush_max_abv, default 8 %).",
      input: batchSchema.shape,
      readOnly: true,
    },
    (a) => {
      const r = batchCalculator(ctx, a);
      return ok(
        `${r.recipe}: ${r.total_ml} ml for ${r.glasses} glasses, about ${r.abv} %.${r.warnings.length ? ` ${r.warnings.join(' ')}` : ''}`,
        { ...r },
      );
    },
  );

  // ---------- safety net ----------

  reg(
    'undo',
    {
      title: 'Undo a change',
      description:
        'Undo the latest change (any source: web, AI or command line), or a specific one by group id from list_undoable. One group is one action, e.g. a whole log_mix with all its stock deductions. Refuses if the same items changed again later (force overrides). Changes are kept 30 days.',
      input: { group: z.number().int().positive().optional(), force: z.boolean().optional() },
    },
    (a) => {
      const { result, changes } = undo(ctx, a);
      return changed(`Undone: ${result.label ?? `change ${result.undone}`}`, changes, {
        ...result,
      });
    },
  );

  reg(
    'list_undoable',
    {
      title: 'Recent changes that can be undone',
      description:
        'The latest change groups with id, time, source and what they did, newest first.',
      input: { limit: z.number().int().min(1).max(50).default(10) },
      readOnly: true,
    },
    (a) => {
      const items = listUndoable(ctx, a.limit);
      return ok(
        items.map((g) => `#${g.id} ${g.source}: ${g.label ?? ''}`).join('\n') || 'Nothing to undo.',
        { items },
      );
    },
  );

  reg(
    'trash',
    {
      title: 'Trash',
      description:
        'Deleted ingredients, equipment, glasses, recipes, shopping items and preferences from the last 30 days. Pass restore: <id> to put one back with its old id.',
      input: { restore: z.number().int().positive().optional() },
    },
    (a) => {
      if (a.restore) {
        const { result, changes } = restoreFromTrash(ctx, a.restore);
        return changed(`Restored ${result.name}.`, changes, { restored: result });
      }
      const items = listTrash(ctx);
      return ok(
        items.map((t) => `${t.id}: ${t.kind} ${t.name}`).join(', ') || 'The trash is empty.',
        { items },
      );
    },
  );

  // ---------- setup ----------

  reg(
    'remove_example_data',
    {
      title: 'Remove example data',
      description:
        'Removes the example bar loaded with "shaky seed" (bottles, recipes, equipment, glasses, shopping items). Anything the user added or changed stays. Call with confirm: false first to see how many items would go.',
      input: { confirm: z.boolean().default(false) },
      destructive: true,
    },
    (a) => {
      if (!a.confirm) {
        const n = countExampleData(ctx);
        return ok(`${n} example item(s) would be removed. Call again with confirm: true.`, {
          count: n,
        });
      }
      const { result, changes } = removeExampleData(ctx);
      return changed(`Removed ${result.total} example item(s).`, changes, {
        removed: result.removed,
      });
    },
  );

  reg(
    'update_settings',
    {
      title: 'Settings',
      description:
        'Read or change settings: language, units (cl/oz), theme, expiry_warning_days, web_autostart and household_substitutes (household items that stand in for missing bar tools, e.g. {"bar_spoon": "spoon"}). Without arguments returns the current settings.',
      input: settingsSchema.shape,
    },
    (a) => {
      if (!Object.values(a).some((v) => v !== undefined))
        return ok('Current settings.', { settings: getAllSettings(ctx.db) });
      const { result, changes } = updateSettings(ctx, a);
      return changed('Settings saved.', changes, { settings: result });
    },
  );

  // ---------- training ----------

  reg(
    'start_training',
    {
      title: 'Start a mixing training',
      description: `Load a saved recipe as an exercise into the mixing game of the web UI (${webUrl}/#/mix). If the page is open it pops up immediately, otherwise when the user opens it. The user mixes in the game; the server scores amounts, order, technique and garnish. Afterwards call get_training_result. Set show_steps false for an exam from memory. If the bar lacks an ingredient or tool, sandbox mode switches on by default (virtual bottles and tools); pass sandbox false to forbid that. Starting a new training cancels an unfinished one.`,
      input: {
        recipe: recipeRef,
        note: z
          .string()
          .max(300)
          .optional()
          .describe('A short tip shown with the exercise, e.g. "Watch the lime amount".'),
        show_steps: z.boolean().optional(),
        sandbox: z.boolean().optional(),
      },
    },
    (a) => {
      const { result, changes } = startTraining(ctx, a);
      const t = result.training;
      const gaps = [
        ...(result.missing.length ? [`missing ingredients: ${result.missing.join(', ')}`] : []),
        ...(result.missing_equipment.length
          ? [`missing equipment: ${result.missing_equipment.join(', ')}`]
          : []),
      ];
      const sandboxNote = gaps.length
        ? result.sandbox_auto
          ? ` The bar lacks ${gaps.join('; ')}, so sandbox mode is on and the game offers them virtually.`
          : t.sandbox
            ? ''
            : ` Warning: the bar lacks ${gaps.join('; ')} and sandbox is off, so the user cannot complete it as written.`
        : '';
      return changed(
        `Training ${t.id} for ${t.recipe_name} is waiting. Ask the user to open ${webUrl}/#/mix (Mix tab), mix it and hand it in, then call get_training_result.${sandboxNote}`,
        changes,
        {
          training: describeTraining(t),
          open: `${webUrl}/#/mix`,
          ...(gaps.length && {
            missing: result.missing,
            missing_equipment: result.missing_equipment,
          }),
        },
      );
    },
  );

  reg(
    'get_training_result',
    {
      title: 'Training result',
      description:
        'Status and score of a training (the latest one if no id is given). While the status is pending or active the user has not handed it in yet: do not guess a score. When done: score 0 to 100, stars, poured vs expected amounts per ingredient and feedback lines to coach the user.',
      input: { id: z.number().int().positive().optional() },
      readOnly: true,
    },
    (a) => {
      const t = a.id ? getTraining(ctx, a.id) : listTrainings(ctx, { limit: 1 })[0];
      if (!t) return ok('No training has been started yet.', { training: null });
      const d = describeTraining(t);
      const text =
        t.status === 'done'
          ? `${t.recipe_name}: ${d.score}/100, ${d.stars} star(s). ${(d.feedback ?? []).join(' ')}`
          : t.status === 'cancelled'
            ? `The ${t.recipe_name} training was cancelled.`
            : `The ${t.recipe_name} training is ${t.status}; the user has not handed it in yet.`;
      return ok(text, { training: d });
    },
  );

  reg(
    'cancel_training',
    {
      title: 'Cancel training',
      description: 'Cancel an unfinished training.',
      input: { id: z.number().int().positive() },
    },
    (a) => {
      const { result, changes } = cancelTraining(ctx, a.id);
      return changed(`Training ${result.id} is ${result.status}.`, changes, {
        training: describeTraining(result),
      });
    },
  );

  reg(
    'get_recent_activity',
    {
      title: 'Recent activity',
      description:
        'The latest changes to the bar with their source: "web" (the user in the web UI), "mcp" (an AI) or "cli".',
      input: { limit: z.number().int().min(1).max(200).default(20) },
      readOnly: true,
    },
    (a) => {
      const items = listActivity(ctx.db, { limit: a.limit }).map(({ data: _d, ...rest }) => rest);
      return ok(`${items.length} recent change(s).`, { items });
    },
  );
}
