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
       backup.ts (export/import = seed format), training.ts (trainings, server-side scoring)
game/  pure, isomorphic mixing game: types, reducer (apply/replay), glasses, color mixing,
       recipe -> vessels/perfect play, scoring. No DOM, no zod: browser and server share it.
mcp/   tools.ts (thin wrappers, text + compact JSON, mutations list what changed),
       server.ts (resources, prompts, instructions). One McpServer per transport/session.
web/   api.ts (REST, source "web"), events.ts (ActivityWatcher tails `activity` -> EventBus),
       mcpHttp.ts (Streamable HTTP /mcp), server.ts (Host/Origin guard, SSE, static),
       client/ (Vite, plain TS): lib/ store, api, live, units; views/; svg/; i18n/;
       game/ scene.ts (persistent DOM/SVG scene), art.ts (vessels), training.ts (offers, submit)
```

Cross-process live updates: the stdio MCP process and the web server are separate processes. The web server polls `activity` (id > last) every 400 ms and pushes SSE `change` events. Trainings ride the same feed (entity `training`).

Matching (`core/matching.ts`): every word of the recipe line (subcategory/tags, else name; synonyms like brown=dark, blanco=white) must appear on the bottle (name, brand, subcategory, tags, category). Empty, archived and expired items are unavailable. Optional and garnish lines never block. Missing equipment is reported, not blocking.

Stock (`core/fillLevel.ts`): fill level is the default, exact ml optional. Deducting from a level-only bottle stores an ml estimate (`amount_is_estimate`). Pieces via `quantity`; juice from fruit via `yield_ml`. A finished bottle with spares opens the next one.

Game rules (`src/game`): actions record quantities, never timestamps (`POUR_ML_PER_S` is the one shared constant). `stepVessels` routes recipe steps to shaker/blender/mixing glass/glass (floats after straining go to the glass, a bare `pour` after blending is the pour-over). `tests/game.test.ts` replays every seed recipe's perfect play and requires >= 95 points: keep that green when touching steps or scoring. The server ignores the client's `line` claims for real bottles and resolves them with `matchesSpec`; virtual sandbox bottles count only in sandbox trainings.

Web shell: header, main and footer are permanent nodes; `render()` swaps contents. The game scene is mounted once and never rebuilt during a gesture (`busy` flag), so live updates cannot break a pour.

Matching extras: `provides` on an ingredient (or a tag that is exactly the asked phrase) beats the recipe line's category; lines can be `exact` or `exclude` words; `servings_possible` uses `stock_ml` (ml across bottles, or `yield_ml` x pieces). Household stand-ins (setting `household_substitutes`) count as equipment.

Personal taste (`core/preferences.ts`): `personalize()` returns the user's version of a recipe; it is what `RecipeWithCheck.availability`, `log_mix`, the game and trainings use. Saved recipes are never rewritten. Strength in `core/strength.ts`, preparations in `core/prep.ts`, batches in `core/batch.ts`.

Containers: `container` + `label_color` per ingredient, category default in `category_defaults.container`. `can` and `fruit` are counted (`counted` in the view): quantity and opened, no fill level. The plain list lives in `core/containers.ts` so the browser bundle does not pull in zod.

Safety net (`src/db/journal.ts`, `core/undo.ts`): triggers on every state table log rows before/after into `undo_log`; `mutate()` opens one `undo_groups` row per top-level call (nested calls join it) and rolls back for `ctx.dryRun`. A new state table must be added to `JOURNALED`. MCP's `reg()` adds `dry_run` to every non-read-only tool.

Party & more: `core/substitutions.ts` (stand-in rules, status `with_substitute`), `core/cost.ts`, `core/csv.ts`, `core/diets.ts`, `core/party.ts` (ice from add_ice steps, freezer stock by category `ice`).

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

## Status

Stage 1 (inventory, recipes, web), stage 2 (mixing game, sandbox, mix for real) and stage 3 (AI trainings) are built, plus the 1.1 and 1.2 feedback rounds (see CHANGELOG). Open ideas: a design reference from the owner may still change the look; more glass shapes; sound effects.
