# Melvor Game Source Tools Guidance

This repository contains reusable Melvor Idle modding tools, CLI helpers, and the MCP server. Keep it portable: anything committed here should be safe to clone on another machine without private game-source snapshots or local credentials.

## Boundaries

- `game-source/`, `game-source-readable/`, `snapshots/`, `mod-sources/`, `reports/`, `.env`, and test artifacts are local ignored data stores. Do not commit raw Melvor client source, downloaded snapshots, browser storage, credentials, or generated report output.
- Packaged docs under `docs/modding/` should stay compact and modding-oriented. Prefer symbol names, file references, and short explanatory notes over copying game client code.
- This repo may be public. Treat every commit as publishable unless the user explicitly changes repository visibility.

## MCP Work

- Main MCP entry point: `scripts/game-source-mcp.mjs`.
- Keep MCP tools dry-run/read-only by default when they can mutate local files, GitHub, mod.io, browser state, or saves.
- mod.io upload support must remain policy-gated: read `config/modio-matches.json` from the caller workspace, block `reference_only` mods, require `automation.upload == true`, and require an explicit confirmation phrase for actual uploads.
- Use the official mod.io REST docs as the source of truth for API changes. Read API keys and OAuth tokens from ignored `.env` files only; never print or commit them.

## Verification

Run focused checks after MCP or script edits:

```bash
npm run check
```

For browser-backed tools, reports belong under ignored `reports/`.
