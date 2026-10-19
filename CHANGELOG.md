# Changelog

All notable changes to Shaky. The format follows [Keep a Changelog](https://keepachangelog.com/), versions follow [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-10-19

### Added

- Undo for any change (one action at a time, also from the AI), a trash for deleted items (30 days) and `dry_run` on every changing MCP tool. Built on a journal of SQLite triggers (migration 006).
- CSV export and import for ingredients and recipes (comma or semicolon, decimal comma), with a preview.
- Substitution rules: recipes become "makeable with a stand-in" with a note how the drink changes.
- Use-up suggestions, cost per drink from bottle prices, alcohol-free filter and five mocktail examples.
- Ice as an ingredient with freezing time; party planner with shopping, ice timing, cost and a printable drinks menu; guest diets as data.
- Prompts `add_bottle_from_photo`, `plan_a_party`, `unify_language`; units, methods, glass and equipment types shown in the UI language.
- 50 MCP tools in total. Migrations 006 and 007.

## [1.1.0] - 2026-10-19

Based on the first real setup.

### Fixed

- A recipe line of category juice now finds limes tagged or providing "lime juice" (new field `provides`; a provided phrase beats the category).
- "Tonic" no longer has to take the wild berry tonic: recipe lines can be `exact` or `exclude` words.
- "Makeable" says how often: `servings_possible` per recipe (stock in ml, or juice per piece).
- Empty items no longer warn that they expire.
- Stirring no longer demands a bar spoon: household stand-ins (default: a spoon) count as equipment.

### Added

- `add_ingredients` (up to 100 at once), `update_recipe` (patch lines, steps or fields), `remove_example_data`, `update_settings`; `shaky seed --remove`.
- Containers separate from the liquid color, with label color: bottle shapes, syrup bottle, dropper, cans (counted, open or closed), tetra pak, PET bottle, carton, freezer bag, jar, pack, counted fruit, herbs.
- Variants under one entry, best before dates for unopened items.
- Drink strength (ABV with melt water, standard drinks, energy drink warning).
- Personal preferences (adjust or avoid), applied to display, stock deduction, game and trainings.
- Homemade preparations (simple syrup 1:1, rich syrup 2:1, honey syrup, own templates).
- Batch calculator with slush machine limits and a freeze warning.
- Migrations 003 to 005; 1.0 databases upgrade in place.

## [1.0.0] - 2026-10-19

First full version.

### Added

- MCP server (stdio and Streamable HTTP) with 39 tools, 3 resources and 2 prompts: bar overview, ingredients with fill levels and shelf life, equipment with substitutes, glassware, storage locations and category defaults as data, recipes with fuzzy matching, "what can I make", logging drinks with stock deduction, shopping list, activity history and trainings.
- Web UI on localhost in a comic tiki style: the bar as a scene with hand-drawn bottles filled to their level, recipes with an editor for structured steps, shopping list, equipment and glasses, history, backup export and import, English and German, light and dark mode.
- Mixing game: drag and hold to pour, ice, squeezing fruit, shaker, blender, mixing glass, stirring, muddling, straining, garnish, layered colors, sandbox mode, scoring against a recipe.
- "Mix for real": step-by-step kitchen mode with servings, timers and wake lock that logs the drink and updates the stock.
- Trainings: `start_training` loads a recipe into the game, the server replays and scores the submitted actions, `get_training_result` gives the AI the score and coaching lines.
- Live updates over Server-Sent Events, also for changes made by another process (Claude Desktop's stdio server).
- CLI: `serve`, `mcp`, `seed`, `export`, `import`, `doctor`.
- Example bar with twelve recipes.
