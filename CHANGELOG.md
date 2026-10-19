# Changelog

All notable changes to Shaky. The format follows [Keep a Changelog](https://keepachangelog.com/), versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-19

First full version.

### Added

- MCP server (stdio and Streamable HTTP) with 28 tools, 3 resources and 2 prompts: bar overview, ingredients with fill levels and shelf life, equipment with substitutes, glassware, storage locations and category defaults as data, recipes with fuzzy matching, "what can I make", logging drinks with stock deduction, shopping list, activity history and trainings.
- Web UI on localhost in a comic tiki style: the bar as a scene with hand-drawn bottles filled to their level, recipes with an editor for structured steps, shopping list, equipment and glasses, history, backup export and import, English and German, light and dark mode.
- Mixing game: drag and hold to pour, ice, squeezing fruit, shaker, blender, mixing glass, stirring, muddling, straining, garnish, layered colors, sandbox mode, scoring against a recipe.
- "Mix for real": step-by-step kitchen mode with servings, timers and wake lock that logs the drink and updates the stock.
- Trainings: `start_training` loads a recipe into the game, the server replays and scores the submitted actions, `get_training_result` gives the AI the score and coaching lines.
- Live updates over Server-Sent Events, also for changes made by another process (Claude Desktop's stdio server).
- CLI: `serve`, `mcp`, `seed`, `export`, `import`, `doctor`.
- Example bar with twelve recipes.
