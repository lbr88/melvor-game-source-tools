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
- `game_session_action`: clicks, types, waits, opens game pages, dismisses SweetAlert modals, or evaluates page JavaScript in that live session.
- `game_session_state`: reads the live session state, loaded mods, Optimizer state, browser events, and blocked save writes.
- `game_session_debug_probe`: samples reusable live debugging facts, including modal state, bare/globalThis symbols, common game state, and selector matches.
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


## MCP Release And mod.io Tools

The MCP server can inspect and prepare releases for mods kept in a separate workspace, without committing or uploading game source. Point the tools at the workspace root that contains `mods/` and `config/modio-matches.json`.

Useful tools:

- `melvor_mod_release_status`: read local manifests, Git state, release policy, and current mod.io versions.
- `melvor_mod_release_package`: build or plan `releases/<mod>/<mod>-<version>.zip` for a releasable mod.
- `melvor_modio_upload`: upload a prepared zip to mod.io. This is dry-run by default and requires `apply: true` plus the exact confirmation phrase returned by the dry-run.

Release uploads are blocked for `reference_only` mods and for any mod whose workspace mapping does not set `automation.upload` to `true`. Read credentials from an ignored workspace `.env`; do not put API keys or OAuth tokens in this repository.

### mod.io Credentials

The release tools use two different mod.io credentials:

- `MODIO_API_KEY`: read/query credential. mod.io documents API-key requests as read-only.
- `MODIO_ACCESS_TOKEN`: OAuth bearer token. mod.io requires OAuth access tokens for create, update, delete, and upload operations.

The canonical mod.io docs are:

- REST API overview and API access: https://docs.mod.io/restapi
- Authentication overview: https://docs.mod.io/restapi/introduction
- Email security-code OAuth flow: https://docs.mod.io/restapi/docs/request-email-security-code

For this workspace, keep the real values in the ignored mod workspace `.env`, not in this tools repo:

```dotenv
MODIO_API_BASE_URL=https://u-48472067.modapi.io/v1
MODIO_API_KEY=your_32_character_api_key
MODIO_ACCESS_TOKEN=your_oauth_bearer_token
MODIO_GAME_ID=2869
```

The MCP tools also accept explicit paths so a Codex session can read the correct workspace without copying secrets:

```json
{
  "workspaceRoot": "/home/lrasmussen/git/melvor-modding",
  "modsRoot": "/home/lrasmussen/git/melvor-modding/mods",
  "mappingFile": "/home/lrasmussen/git/melvor-modding/config/modio-matches.json",
  "envFile": "/home/lrasmussen/git/melvor-modding/.env",
  "mod": "skiller-auto-resume"
}
```

Typical workflow:

1. Run `melvor_mod_release_status` first. This is read-only and verifies git state, manifest version, release policy, and mod.io mapping.
2. Build or pass a zip path.
3. Run `melvor_modio_upload` without `apply` to get the exact confirmation phrase.
4. Run `melvor_modio_upload` with `apply: true`, `active: false`, and the exact `confirm` phrase.
5. Promote a tested public file separately. New public mod files should be uploaded inactive first.

Example upload arguments:

```json
{
  "workspaceRoot": "/home/lrasmussen/git/melvor-modding",
  "modsRoot": "/home/lrasmussen/git/melvor-modding/mods",
  "mappingFile": "/home/lrasmussen/git/melvor-modding/config/modio-matches.json",
  "envFile": "/home/lrasmussen/git/melvor-modding/.env",
  "mod": "skiller-auto-resume",
  "zipPath": "/home/lrasmussen/git/melvor-modding/build/skiller-auto-resume/skiller-auto-resume-4.zip",
  "active": false,
  "apply": true,
  "confirm": "upload skiller-auto-resume 0.1.32 to mod.io 6132432",
  "changelog": "Short changelog for the inactive test build."
}
```

Do not print `.env`, API keys, access tokens, usernames, or passwords in logs.

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
