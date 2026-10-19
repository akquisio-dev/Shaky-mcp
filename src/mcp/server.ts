import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Db } from '../db/connection.js';
import { listEquipment, listGlassware } from '../db/repos/catalog.js';
import { createCtx } from '../core/context.js';
import { listIngredientViews } from '../core/inventory.js';
import { barOverview } from '../core/overview.js';
import { VERSION } from '../version.js';
import { brief, registerTools } from './tools.js';

const INSTRUCTIONS = `Shaky knows what is in the user's home bar right now.
Start with get_bar_overview, then suggest drinks from your own recipe knowledge using only what is in stock (empty and expired items are not usable). Check a drink you know but is not saved with check_recipe_lines before recommending it; find_recipes_by_ingredient answers "what can I make with X", surprise_me picks one, suggest_purchases says what to buy next.
After a drink, ask how it was and save it with rate_mix; get_mix_history and bar_stats show habits and spend. After shopping, shopping_checkout ticks off and restocks in one step. show_in_web opens a recipe or the step-by-step view in the user's browser.
Prefer drinks that use up what expires soon (use_up_first). Offer substitutes when one ingredient is missing (with_substitute, list_substitutions), and put missing items on the shopping list when the user agrees.
Reply in the user's language, and name new items, tags and notes in the language of the bar (settings.language from get_bar_overview; "auto" means follow the user).
If the user sends a photo of a bottle label, read brand, product, category, ABV and bottle size from it and add it with add_ingredient (container and colors from the photo too). Ask only about what you cannot read.
For bulk changes, run the tool with dry_run: true first and show what would change. Every change can be undone with undo, deleted things are in the trash.
When the user says they used, finished, bought or opened something, update the bar (set_fill_level, mark_opened, update_ingredient, log_mix) and tell them what changed.
For a party, plan_party gives amounts, ice, cost and what to buy; party_shopping puts it on the shopping list. Guest diets (vegan, nut allergy ...) are data: list_diets.
To teach mixing, start_training loads a recipe into the web game; read the score with get_training_result once the user hands it in.
Equipment, glasses, storage locations and shelf-life defaults are data: adapt them with set_equipment, set_glassware, set_location and set_category_defaults.
Shaky is for adults of legal drinking age. Encourage responsible drinking and offer alcohol-free options when asked.`;

/** Builds a fresh MCP server. One instance per transport/session. */
export interface McpServerOptions {
  /** Where the web UI runs, so tools can point the user there. */
  webUrl?: string;
}

export function createMcpServer(db: Db, opts: McpServerOptions = {}): McpServer {
  const ctx = createCtx(db, 'mcp');
  const server = new McpServer(
    { name: 'shaky', title: 'Shaky, your AI bartender', version: VERSION },
    { instructions: INSTRUCTIONS, capabilities: { logging: {} } },
  );

  registerTools(server, ctx, opts.webUrl ?? 'http://localhost:8787');

  const json = (uri: URL, data: unknown) => ({
    contents: [
      { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) },
    ],
  });

  server.registerResource(
    'bar-overview',
    'shaky://bar/overview',
    {
      title: 'Bar overview',
      description:
        'Same as the get_bar_overview tool: stock, warnings, equipment, makeable recipes.',
      mimeType: 'application/json',
    },
    (uri) => json(uri, barOverview(ctx)),
  );
  server.registerResource(
    'inventory',
    'shaky://inventory',
    {
      title: 'Inventory',
      description: 'Every ingredient, including empty ones, with fill level and expiry.',
      mimeType: 'application/json',
    },
    (uri) => json(uri, listIngredientViews(ctx, { include_empty: true }).map(brief)),
  );
  server.registerResource(
    'equipment',
    'shaky://equipment',
    {
      title: 'Equipment and glassware',
      description: 'Bar tools (with substitutes) and glasses.',
      mimeType: 'application/json',
    },
    (uri) => json(uri, { equipment: listEquipment(db), glassware: listGlassware(db) }),
  );

  server.registerPrompt(
    'suggest_drink',
    {
      title: 'Suggest a drink',
      description: 'Ask Shaky for a drink that fits a mood or taste, using only what is at home.',
      argsSchema: {
        mood: z.string().optional().describe('e.g. "beach vibes", "cozy evening", "party"'),
        taste: z.string().optional().describe('e.g. "fruity", "sour", "not too sweet"'),
      },
    },
    ({ mood, taste }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Suggest one or two drinks I can make right now${mood ? ` for this mood: ${mood}` : ''}${
              taste ? `, taste: ${taste}` : ''
            }. First call get_bar_overview. Only use what is in stock; if a great option misses one ingredient, mention it with a substitute. Give amounts in cl and short steps for my equipment.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'add_bottle_from_photo',
    {
      title: 'Add a bottle from a photo',
      description: 'Attach a photo of the label; Shaky fills in brand, kind, ABV and size.',
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'I am attaching a photo of a bottle. Read brand, product name, category, kind (subcategory), ABV and bottle size from the label, pick a container and the colors of liquid and label from the photo, then check list_ingredients for a duplicate and add it with add_ingredient. Tell me what you added and ask only about values you could not read.',
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'plan_a_party',
    {
      title: 'Plan a party',
      description: 'A few drinks for your guests: amounts, ice, shopping list and a menu.',
      argsSchema: {
        guests: z.string().describe('How many guests'),
        when: z.string().optional().describe('When the party starts'),
        diets: z.string().optional().describe('e.g. vegan, nut allergy, some do not drink'),
      },
    },
    ({ guests, when, diets }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Help me plan a party for ${guests} guests${when ? ` on ${when}` : ''}${diets ? `; diets: ${diets}` : ''}. Call get_bar_overview, suggest 3 or 4 drinks that mostly work with my bar (include an alcohol-free one), then run plan_party and show me amounts, what to buy, the ice plan and the cost. Offer party_shopping to put the missing things on my shopping list.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'unify_language',
    {
      title: 'Put the whole bar in one language',
      description: 'Rename ingredients, recipes, descriptions, tags and notes into one language.',
      argsSchema: { language: z.string().describe('e.g. Deutsch, English') },
    },
    ({ language }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please make my bar consistently ${language}. Go through list_ingredients, list_recipes (with get_recipe), list_substitutions and list_preferences. Translate display names, descriptions, notes, flavor notes and tags into ${language}; keep brand names as they are. For ingredients keep the English words that matching relies on by moving them into tags or provides (e.g. a German "Limetten" keeps "lime" and "lime juice" in provides), so recipes still find them. Do it with add/update tools in batches: first show me a dry_run of each batch, then apply it after I agree. Also set update_settings language accordingly.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'use_up_leftovers',
    {
      title: 'Use up leftovers',
      description: 'Drinks that use up what is expiring soon or almost empty.',
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Help me use up what will go off soon or is almost empty. Call get_expiring and get_bar_overview, then suggest drinks that use those items first. Offer to log the drink with log_mix afterwards.',
          },
        },
      ],
    }),
  );

  return server;
}
