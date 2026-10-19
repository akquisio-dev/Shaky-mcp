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
Start with get_bar_overview, then suggest drinks from your own recipe knowledge using only what is in stock (empty and expired items are not usable).
Prefer ingredients that expire soon. Offer substitutes when one ingredient is missing, and put missing items on the shopping list when the user agrees.
When the user says they used, finished, bought or opened something, update the bar (set_fill_level, mark_opened, update_ingredient, log_mix) and tell them what changed.
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
