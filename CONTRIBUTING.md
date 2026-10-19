# Contributing

Thanks for helping Shaky pour better drinks.

1. Fork and clone, then `npm install`.
2. `npm run dev` starts the API (with reload) and the Vite dev server. See [docs/development.md](docs/development.md).
3. Before you push: `npm run lint && npm test && npm run build`.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:` ...).
5. Open a pull request with a short description of what changed and why.

Ground rules:

- Shaky runs locally. Never bind to `0.0.0.0` by default or add anything that needs a server, Docker or an account.
- Keep it data driven: if behavior depends on equipment, locations or shelf life, it belongs in the database, not in code.
- All artwork is original (CSS/SVG). Do not copy graphics, names or characters from existing games or brands.
- Never edit an applied migration; add a new numbered file in `src/db/migrations/`.
- Code, comments, docs and commits are in English. UI text lives in `src/web/client/i18n/` (English and German).
