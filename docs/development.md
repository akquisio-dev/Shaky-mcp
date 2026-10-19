# Development

## Project layout

```
src/
  cli.ts            shaky serve | mcp | seed | doctor
  config.ts         SHAKY_HOST / SHAKY_PORT / SHAKY_DATA_DIR / SHAKY_WEB_AUTOSTART
  paths.ts          per-user data directory
  db/               connection (WAL, busy timeout), checksummed migrations, repositories
  core/             domain logic shared by MCP and web: inventory, shelf life,
                    fill levels and deduction, fuzzy matching, recipes, mixing,
                    shopping, overview, seed. Every write goes through mutate(),
                    which writes the activity row in the same transaction.
  game/             mixing game rules, pure TypeScript shared by browser and server:
                    reducer, glasses, colors, recipe steps -> vessels, scoring
  mcp/              MCP server: tools, resources, prompts (thin layer over core/)
  web/              Hono app: REST API (/api), SSE (/api/events), MCP over HTTP (/mcp)
    events.ts       EventBus + ActivityWatcher (tails the activity table)
    client/         Vite app (plain TypeScript): views/, svg/, i18n/, lib/,
                    game/ (scene, vessel art, training flow)
examples/seed.json  example bar and recipes for `shaky seed`
tests/              Vitest: db, core, game (incl. perfect-play replay of every seed
                    recipe), training, MCP (in-memory client), REST/SSE/HTTP
```

How live updates work: every change writes a row to `activity` in the same transaction. The web server polls `MAX(id)` of that table every 400 ms and pushes new rows over Server-Sent Events. Because it reads the table rather than listening in-process, it also sees changes made by the separate stdio process Claude Desktop starts.

## Commands

| Command          | Purpose                                                    |
| ---------------- | ---------------------------------------------------------- |
| `npm run dev`    | API on 127.0.0.1:8787 (tsx watch) + Vite on 127.0.0.1:5173 |
| `npm run build`  | Compile server to `dist/`, client to `dist/client/`        |
| `npm start`      | `shaky serve` from `dist/`                                 |
| `npm test`       | Vitest                                                     |
| `npm run lint`   | ESLint, Prettier check, TypeScript check                   |
| `npm run format` | Prettier + ESLint fix                                      |
| `npm run seed`   | Load `examples/seed.json` into your database               |

Use a throwaway database while developing:

```bash
export SHAKY_DATA_DIR=$PWD/.data   # ignored by git
npm run build && npm run seed
```

## Developing on a remote server

Shaky only listens on `127.0.0.1` and has no authentication, so never open a firewall port for it. Forward the port over SSH instead:

```bash
ssh -L 8787:127.0.0.1:8787 user@server
# and for the Vite dev server:
ssh -L 8787:127.0.0.1:8787 -L 5173:127.0.0.1:5173 user@server
```

Then open http://localhost:8787 (or http://localhost:5173 with `npm run dev`) on your own machine. The Host check accepts `localhost` and `127.0.0.1`, which is what the tunnel sends.

## MCP Inspector

Interactive UI (run it on your machine, or tunnel port 6274 as well):

```bash
npx @modelcontextprotocol/inspector node dist/cli.js mcp --no-web
```

Scripted, without a UI:

```bash
# stdio
npx @modelcontextprotocol/inspector --cli node dist/cli.js mcp --no-web --method tools/list
npx @modelcontextprotocol/inspector --cli node dist/cli.js mcp --no-web \
  --method tools/call --tool-name set_fill_level --tool-arg ingredient="Lillet Blanc" --tool-arg fill_level=half

# Streamable HTTP (while `npm start` runs)
npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --transport http --method tools/call --tool-name get_bar_overview
```

To watch live updates, keep `curl -N http://localhost:8787/api/events` open while you call a tool from another terminal.

## Notes

- In `shaky mcp`, stdout belongs to the MCP protocol. Log only to stderr.
- One `McpServer` per HTTP session: an instance can only be connected to one transport.
- Migrations are checksummed. Changing an applied file stops the app; add a new one instead.
- better-sqlite3 v13 ships prebuilt binaries inside the package for win32, darwin and linux (x64/arm64, glibc and musl).
