# Melvor Game Source Tools

Standalone public tooling for downloading, searching, beautifying, testing, and profiling Melvor Idle modding source locally.

This repository intentionally does not commit Melvor client source. The MCP server downloads source into ignored local folders:

- `game-source/web/`
- `game-source/android-loaded/`
- `game-source-readable/web/`
- `game-source-readable/android-loaded/`
- `reports/`

An external archived source checkout can still exist separately, but it is optional for day-to-day MCP use.

## Setup

```bash
git clone <repo-url>
cd melvor-game-source-tools
npm install
cp .env.example .env
```

The default standalone source store is ignored `./game-source`; the MCP docs live in this repo under `docs/modding/` and do not require any outside checkout.

## MCP

Start the MCP server over stdio:

```bash
npm run mcp
```

Example client config:

```json
{
  "mcpServers": {
    "melvor-game-source": {
      "command": "node",
      "args": ["/path/to/melvor-game-source-tools/scripts/game-source-mcp.mjs"]
    }
  }
}
```

Main tools:

- `game_source_download`: downloads web or Android-loaded source into ignored `game-source/`.
- `game_source_beautify`: writes readable formatted copies into ignored `game-source-readable/`.
- `game_source_search`: searches raw local source, readable source, or a git-backed source checkout.
- `game_source_read`: reads bounded source slices.
- `game_source_manifest`: reads detected version metadata.
- `melvor_modding_guides_list`: lists packaged modding docs, recommended use cases, and official wiki Mod Creation guide pages.
- `melvor_modding_guides_read`: reads a packaged doc or official guide page as plain text or wikitext.
- `melvor_modding_guides_search`: searches packaged modding docs and official wiki guide pages.
- `mod_manager_loaded_mods`: opens Melvor with Playwright and reports installed/loaded Mod Manager mods.
- `mod_manager_fetch_sources`: exports installed Mod Manager mod resources into ignored `mod-sources/`.
- `game_save_test`: logs in, loads a configured cloud/local save slot, blocks save writes by default, and writes a screenshot/report.
- `game_session_start`: starts a persistent, visible Melvor browser session and optionally loads the configured save slot.
- `game_session_action`: clicks, types, waits, opens game pages, or evaluates page JavaScript in that live session.
- `game_session_state`: reads the live session state, loaded mods, Optimizer state, browser events, and blocked save writes.
- `game_session_screenshot`: screenshots the live session without closing it.
- `game_session_stop`: closes the live session when testing is done.
- `game_profile_start`: starts tracing and live performance collection on an existing game session.
- `game_profile_read`: reads current profiling counters while the session keeps running.
- `game_profile_stop`: stops profiling, writes a trace/report, and leaves the browser open.
- `mod_test_browser_check`: verifies Playwright Chromium can launch.
- `mod_test_smoke`: opens Melvor, optionally injects a mod script/folder, and writes an ignored report.
- `mod_profile_runtime`: captures a Playwright trace/profile into ignored `reports/`.

## CLI Search

```bash
npm run source:search -- "OfflineProgressElement"
npm run source:search -- --preset mod-loader --branch all
npm run source:search -- --branch android-loaded nativeManager
```

With standalone storage, `--branch all` searches `game-source/web` and `game-source/android-loaded` when present.

## CLI Download And Beautify

```bash
npm run source:manifest
npm run source:refresh
npm run source:manifest:android
npm run source:refresh:android
npm run source:beautify
npm run source:beautify:android
npm run source:docs
```

The CLI refresh commands install captured source into ignored `game-source/web/` and `game-source/android-loaded/`. Beautify commands write readable copies into ignored `game-source-readable/web/` and `game-source-readable/android-loaded/`.
`source:docs` scans `game-source-readable/web/` by default, falls back to `game-source/web/`, and updates `docs/modding/generated-source-reference.md` with compact modding-relevant file/line snippets for MCP search.

## Mod Testing And Profiling

```bash
npm run mod:check
npm run mod:smoke -- --mod-path /path/to/mod
npm run mod:profile -- --mod-path /path/to/mod --duration-ms 15000
```

Reports, screenshots, and traces are written under ignored `reports/`.

## Mod Manager Sources

Put Melvor Cloud credentials in `.env` when you want browser automation to sign in:

```dotenv
MELVOR_CLOUD_USERNAME=
MELVOR_CLOUD_PASSWORD=
```

Then inspect or export the mods that the in-game Mod Manager has installed:

```bash
npm run mod-manager:list
npm run mod-manager:fetch
```

Fetched mod resources are written under ignored `mod-sources/`, one folder per mod. Each folder includes the mod's original files plus `mod-source.json` metadata, so the folder can be searched, edited locally, smoke-tested, or profiled with the mod testing commands.

## Modding Guides

The MCP guide tools read the official Melvor Idle wiki `Mod Creation` pages through the wiki API and packaged local notes under `docs/modding/`. Start with `melvor_modding_guides_list`: it returns a docs overview, recommended use cases, and the packaged docs index. `docs/modding/README.md` is the human-facing entry point, and the assets/js architecture catalog lives there as `game-source-assets-js.md`, so `melvor_modding_guides_search` works without depending on a separate local checkout. Use `melvor_modding_guides_read` with `format: "wikitext"` when official wiki code examples matter.
