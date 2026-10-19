# Shaky

**Your local AI bartender.** Shaky is an MCP server that knows exactly what is in your home bar: spirits, liqueurs, syrups, juices, fruit, garnishes, equipment and glasses. Your AI (Claude Desktop, for example) already knows thousands of recipes. Shaky gives it the missing piece, a reliable picture of what you actually have, so it can suggest drinks you can make right now, offer substitutes, help you use up the open Lillet before it turns, and keep your shopping list.

Next to the MCP server runs a playful web UI on `localhost`, where you see and manage your bar yourself. You and the AI write to the same database, and changes show up on both sides instantly.

<!-- Screenshots: add docs/screenshots/bar.png, recipes.png, live-toast.png -->

> **Local only, no authentication.** Shaky binds to `127.0.0.1` and is meant to run on your own computer.
>
> **For adults of legal drinking age.** Please drink responsibly.

## Features

- **Bar inventory that stays true**: fill levels (full, three quarters, half, quarter, almost empty, empty) or exact ml, bottle counts, opened date and shelf life with sensible editable defaults per category (an open vermouth or Lillet keeps about five weeks in the fridge, fresh juice a few days, spirits practically forever).
- **Fuzzy recipe matching**: "rum" matches any rum, "dark rum" never matches your white rum. Empty and expired bottles do not count. Find what you can make now and what misses just one ingredient.
- **Log a drink, deduct the stock**: exact for bottles with ml, estimated from the fill level otherwise, limes via juice per piece. When a bottle runs out and you have a spare, the next one is opened.
- **Data driven**: equipment (including substitutes like "a jam jar can replace a shaker"), glasses, storage locations and category defaults are data the AI can change through tools. No code changes needed.
- **Live web UI**: your bar as a scene (shelf, fridge, freezer, pantry), recipes with what is in stock, a "Mixed it!" button, shopping list, equipment and history. When the AI changes something, a speech bubble tells you ("Shaky set Lillet Blanc to a quarter"). English and German, light and dark mode.
- **Every change is logged** with its source (you in the web UI, or the AI over MCP).

## Requirements

- Node.js **22.12 or newer** (24 LTS recommended)
- Windows, macOS or Linux. No database server, no Docker, no C++ compiler. SQLite ships with the package as a prebuilt binary for all three systems (the repo's `.npmrc` turns off install scripts so npm never tries to compile it).

## Installation

```bash
git clone https://github.com/akquisio-dev/Shaky-mcp.git
cd Shaky-mcp
npm install
npm run build
npm run seed      # optional: loads an example bar and twelve recipes
npm run doctor    # checks the setup and prints your Claude Desktop config
```

Your data lives outside the repository in a per-user folder (override with `SHAKY_DATA_DIR`):

| System  | Database location                                  |
| ------- | -------------------------------------------------- |
| Windows | `%APPDATA%\shaky\shaky.db`                         |
| macOS   | `~/Library/Application Support/shaky/shaky.db`     |
| Linux   | `$XDG_DATA_HOME/shaky/shaky.db` (`~/.local/share`) |

## Running

There are two ways to start Shaky. Both use the same database, so you can mix them.

| Command                     | What it does                                                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node dist/cli.js mcp`      | MCP over **stdio**. This is what Claude Desktop starts. If port 8787 is free it also starts the web UI, so after opening Claude Desktop you can visit http://localhost:8787. Disable with `--no-web`. |
| `npm start` (`shaky serve`) | Web UI, REST API and MCP over **Streamable HTTP** at `http://localhost:8787/mcp`.                                                                                                                     |
| `npm run seed`              | Loads `examples/seed.json`. Existing items are kept; `node dist/cli.js seed --reset` wipes the bar first.                                                                                             |
| `npm run doctor`            | Checks Node, database and port, and prints a ready-to-paste Claude Desktop config.                                                                                                                    |

Settings (environment variable or flag):

| Variable              | Flag         | Default         |
| --------------------- | ------------ | --------------- |
| `SHAKY_HOST`          | `--host`     | `127.0.0.1`     |
| `SHAKY_PORT`          | `--port`     | `8787`          |
| `SHAKY_DATA_DIR`      | `--data-dir` | per-user folder |
| `SHAKY_WEB_AUTOSTART` | `--no-web`   | `true`          |

## Claude Desktop

The easiest way is `npm run doctor`: it prints the exact snippet with the absolute paths for your machine. Open the config file (Claude Desktop: Settings, Developer, Edit Config), merge the `shaky` entry into `mcpServers` and restart Claude Desktop.

Using the absolute path of `node` avoids PATH problems with apps started from the dock or start menu (`which node` on macOS/Linux, `where node` on Windows).

**macOS** (`~/Library/Application Support/Claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "shaky": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/you/Shaky-mcp/dist/cli.js", "mcp"]
    }
  }
}
```

**Windows** (`%APPDATA%\Claude\claude_desktop_config.json`, note the doubled backslashes)

```json
{
  "mcpServers": {
    "shaky": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\you\\Shaky-mcp\\dist\\cli.js", "mcp"]
    }
  }
}
```

**Linux** (`~/.config/Claude/claude_desktop_config.json`, for community builds of Claude Desktop or any other MCP client)

```json
{
  "mcpServers": {
    "shaky": {
      "command": "/usr/bin/node",
      "args": ["/home/you/Shaky-mcp/dist/cli.js", "mcp"]
    }
  }
}
```

Then ask Claude something like _"What can I mix tonight, something fruity?"_ or _"I just finished the Lillet."_ Clients that speak Streamable HTTP can use `http://localhost:8787/mcp` while `shaky serve` runs.

## MCP interface

**Tools**: `get_bar_overview` (call first), `list_ingredients`, `get_ingredient`, `add_ingredient`, `update_ingredient`, `archive_ingredient`, `set_fill_level`, `mark_opened`, `get_expiring`, `list_equipment`, `set_equipment`, `list_glassware`, `set_glassware`, `set_location`, `set_category_defaults`, `list_recipes`, `get_recipe`, `save_recipe`, `delete_recipe`, `find_makeable_recipes`, `log_mix`, `shopping_list_get`, `shopping_list_add`, `shopping_list_update`, `get_recent_activity`.

**Resources**: `shaky://bar/overview`, `shaky://inventory`, `shaky://equipment`.

**Prompts**: `suggest_drink` (mood, taste), `use_up_leftovers`.

Every tool answers with a short readable line plus compact JSON. Tools that change something list exactly what changed.

## Security

Shaky has **no authentication** in this version. That is fine on your own computer because it only listens on `127.0.0.1` and only answers requests whose `Host` and `Origin` point to localhost (this blocks DNS rebinding and other websites in your browser writing to your bar). Do not bind it to a public interface. To use it on a remote machine, tunnel it over SSH, see [docs/development.md](docs/development.md).

## Tech choices

- **Node.js + TypeScript (ESM)** and the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) with zod schemas shared by MCP tools, REST API and web client.
- **SQLite via better-sqlite3**: stable, synchronous (simple transactions), and since v13 the package ships prebuilt binaries for Windows, macOS and Linux (x64 and arm64), so `npm install` needs no compiler. The built-in `node:sqlite` is not yet marked stable in Node 22/24. WAL mode lets the stdio process and the web server share the file; migrations are versioned and checksummed.
- **Hono** for the HTTP server: small, built-in Server-Sent Events, and the MCP SDK's web-standard transport plugs straight into a route.
- **Vite + plain TypeScript** for the UI, no framework. Views are plain DOM, so a 2D game engine (PixiJS or similar) can later draw into its own canvas next to them, sharing the same store and event stream.
- **Vitest**, **ESLint**, **Prettier**, GitHub Actions on Ubuntu, Windows and macOS.

## Roadmap

- **Stage 2, the mixing game (free mode)**: the bar view becomes a game scene. Drag bottles from shelf, fridge and freezer, hold to pour with a cl counter, shake with a shake meter, blend, muddle, and watch the glass fill in layers of the real ingredient colors. Only what you own appears, with an optional "sandbox: everything available" switch.
- **Stage 3, training with the AI**: the AI loads an exercise into the game (`start_training` with a recipe), the game checks order and amounts against the recipe steps and scores you, and the AI reads the result and gives feedback. Plus a "mix for real" step-by-step kitchen view that deducts stock at the end.

Already prepared: structured recipe steps, a color per ingredient, storage locations as scene zones, equipment as data and a server-to-browser event stream that game events can share.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/development.md](docs/development.md).

## License

[MIT](LICENSE) © akquisio-dev
