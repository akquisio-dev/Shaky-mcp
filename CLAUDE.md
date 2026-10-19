# Shaky-mcp

Local AI bartender: an MCP server that reliably knows what is in the user's home bar, plus a playful web UI on localhost. AI (MCP) and user (web) share one SQLite database; changes from either side appear live on the other.

## Hard rules

- **Local only.** Default bind is `127.0.0.1`, never `0.0.0.0`. No auth in stage 1, so nothing may make it reachable from outside. Requests are only served for loopback `Host`/`Origin` (`src/web/server.ts`). No Docker, no DB server: `git clone`, `npm install`, `npm run build` must be enough on Windows, macOS and Linux. Paths always via `node:path`.
- **Data driven.** Equipment (with `substitutes_for`), glasses, locations (= future game zones) and category defaults (shelf life, bottle size, color) live in the DB and are changeable via MCP tools. Do not hard-code behavior that belongs there.
- **Own artwork.** All graphics are original CSS/SVG (`src/web/client/svg/art.ts`). Never copy graphics, names or characters from existing games or brands.
- **English in the repo** (code, comments, docs, commits). UI text in `src/web/client/i18n/en.ts` and `de.ts`, always both.
- No em dashes or spaced en dashes in visible text (owner preference). Use commas, colons or " | ".
- Never edit an applied migration in `src/db/migrations/`; add `00N_name.sql`.
- In `shaky mcp` stdout is the protocol: log to stderr only.
- `.npmrc` sets `ignore-scripts=true`: npm 10 would otherwise compile better-sqlite3 with node-gyp (fails on Windows without build tools) although prebuilds ship in the package. A new dependency that truly needs an install script must be discussed first.

## Architecture

```
db/    connection (WAL, busy_timeout), migrate (checksums), repos (SQL + row mapping)
core/  domain logic, shared by MCP and web. Writes go through mutate(ctx, fn), which runs
       the change and its activity row in one IMMEDIATE transaction and returns `changes`.
mcp/   tools.ts (thin wrappers, text + compact JSON, mutations list what changed),
       server.ts (resources, prompts, instructions). One McpServer per transport/session.
web/   api.ts (REST, source "web"), events.ts (ActivityWatcher tails `activity` -> EventBus),
       mcpHttp.ts (Streamable HTTP /mcp), server.ts (Host/Origin guard, SSE, static),
       client/ (Vite, plain TS: lib/ store, api, live; views/; svg/; i18n/)
```

Cross-process live updates: the stdio MCP process and the web server are separate processes. The web server polls `activity` (id > last) every 400 ms and pushes SSE `change` events. Stage 2/3 game events will use the same bus/stream with new event types.

Matching (`core/matching.ts`): every word of the recipe line (subcategory/tags, else name; synonyms like brown=dark, blanco=white) must appear on the bottle (name, brand, subcategory, tags, category). Empty, archived and expired items are unavailable. Optional and garnish lines never block. Missing equipment is reported, not blocking.

Stock (`core/fillLevel.ts`): fill level is the default, exact ml optional. Deducting from a level-only bottle stores an ml estimate (`amount_is_estimate`). Pieces via `quantity`; juice from fruit via `yield_ml`. A finished bottle with spares opens the next one.

## Commands

```bash
npm run dev      # API (tsx watch) + Vite on 127.0.0.1
npm run build    # dist/ + dist/client/
npm test         # vitest
npm run lint     # eslint + prettier --check + tsc
npm run seed     # examples/seed.json
node dist/cli.js doctor
```

Use `SHAKY_DATA_DIR` pointing to a scratch folder for manual tests. On the dev vServer, browse via `ssh -L 8787:127.0.0.1:8787`.

## Roadmap (prepare, do not build yet)

Stage 2: the bar view becomes a drag-and-drop mixing game (pour, shake, blend, muddle, layered glass in ingredient colors, sandbox switch). Put the engine under `src/web/client/game/`, reuse `state` and the SSE stream. Stage 3: `start_training` MCP tool loads a recipe into the game, the game scores order/amounts against `steps`, the AI reads the result; plus a "mix for real" step view that deducts stock.
