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

- `melvor_mcp_context`: returns a compact map of Melvor game internals, packaged docs, searchable topics, and recommended discovery workflow.
- `game_source_download`: downloads web or Android-loaded source into ignored `game-source/`.
- `game_source_beautify`: writes opt-in readable formatted copies into ignored `game-source-readable/`; raw downloaded source is left unchanged.
- `game_source_search`: searches raw local source by default, or a readable/git-backed source checkout when `repo` is overridden.
- `game_source_read`: reads bounded source slices.
- `game_source_manifest`: reads detected version metadata.
- `melvor_modding_guides_list`: lists packaged modding docs, recommended use cases, and official wiki Mod Creation guide pages.
- `melvor_modding_guides_read`: reads a packaged doc or official guide page as plain text or wikitext.
- `melvor_modding_guides_search`: searches packaged modding docs and official wiki guide pages.
- `mod_manager_loaded_mods`: opens Melvor with Playwright and reports installed/loaded Mod Manager mods.
- `mod_manager_fetch_sources`: exports installed Mod Manager mod resources into ignored `mod-sources/`.
- `mod_source_search`: searches locally fetched installed Mod Manager mod source folders under `mod-sources/`.
- `mod_source_read`: reads bounded line slices from a locally fetched installed Mod Manager mod source file.
- `game_save_test`: logs in, loads a configured cloud/local save slot, blocks save writes by default, and writes a screenshot/report.
- `game_session_start`: starts a persistent, visible Melvor browser session and optionally loads the configured save slot.
- `game_session_action`: clicks, types, waits, opens game pages, dismisses SweetAlert modals, or evaluates page JavaScript in that live session.
- `game_session_state`: reads the live session state, loaded mods, Optimizer state, browser events, and blocked save writes.
- `game_session_save`: lists save slots/fixtures, exports named ignored save fixtures, imports fixtures into local test slots, and loads slot/fixture saves.
- `game_session_local_mod`: installs generated or local-path Creator Toolkit local mods into the live session, reloads, verifies, and cleans them up.
- `game_session_mod_profile`: snapshots, temporarily replaces, reloads, and restores the live session's active Mod Manager profile for isolated or interaction-set profiling.
- `game_session_debug_probe`: samples reusable live debugging facts, including modal state, bare/globalThis symbols, common game state, and selector matches.
- `game_session_time_skip`: triggers Melvor offline processing in a loaded live session with `game.testForOffline(hours)`, useful for testing mods that handle offline progress.
- `game_session_screenshot`: screenshots the live session without closing it.
- `game_session_stop`: closes the live session when testing is done.
- `game_profile_start`: starts tracing, CDP CPU profiling, browser metrics, and live performance collection on an existing game session.
- `game_profile_read`: reads current profiling counters, Chrome metric deltas, heap usage, and browser events while the session keeps running.
- `game_profile_mark`: adds named marks to segment a live profile by scenario step.
- `game_profile_stop`: stops profiling, writes a trace, `.cpuprofile`, browser metrics, and report while leaving the browser open.
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

Keep the raw downloaded source as the ground truth. Beautified output is useful for reading and generated docs, but it can change formatting and line positions. Use `game_source_search` against raw `game-source/` when exact runtime shape matters; pass `repo` pointing at `game-source-readable/...` only when readability is more important.

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

Release uploads are blocked for `reference_only` mods, unmapped mods, and any mod whose workspace mapping does not set `automation.upload` to `true`. Owned upload roles such as `owned_public_mod` and `owned_hidden_draft` are allowed by policy when they include a mod.io id. Read credentials from an ignored workspace `.env`; do not put API keys or OAuth tokens in this repository.

### mod.io Credentials

The release tools use two different mod.io credentials:

- `MODIO_API_KEY`: read/query credential. mod.io documents API-key requests as read-only.
- `MODIO_ACCESS_TOKEN`: OAuth bearer token. mod.io requires OAuth access tokens for create, update, delete, upload operations, and hidden/private mod refreshes.

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
4. Run `melvor_modio_upload` with `apply: true`, `active: false`, and the exact `confirm` phrase for public test files. Hidden draft/private files may be uploaded active when the intended result is an installable private build.
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

The MCP exposes the fetched installed-mod corpus directly:

- `mod_source_search`: search all fetched mods, or filter by `modId`, `modName`, and path.
- `mod_source_read`: read a specific fetched mod file after selecting one mod by `modId` or `modName`.

## Modding Guides

The MCP guide tools read the official Melvor Idle wiki `Mod Creation` pages through the wiki API and packaged local notes under `docs/modding/`. Start with `melvor_mcp_context` when the question is broad or the right search terms are unknown. It returns the high-level map: how Melvor works internally, source layout, mod loader/context API, lifecycle hooks, offline processing, UI/custom elements, bank/items/equipment/combat areas, Creator Toolkit, live debugging, and safe save/release testing.

Use `melvor_modding_guides_list` next: it returns the docs overview, recommended use cases, searchable topic hints, and the packaged docs index. `docs/modding/README.md` is the human-facing entry point. For "how does Melvor work?" read `game-internals-overview`; for source file layout read `game-source-assets-js`; for exact symbols read `generated-source-reference`. These packaged docs mean `melvor_modding_guides_search` works without depending on a separate local checkout. For new mod setup, search or read the official `Mod Creation/Getting Started`, `Mod Creation/Essentials`, and `Mod Creation/Creator Toolkit` pages, then use packaged `creator-toolkit-local-mods` and `local-mod-writing-patterns` for loading and implementation patterns. `local-mod-writing-patterns` is repo-authored practical guidance, not official Melvor documentation, and it does not require the user to already have local mods. Use `melvor_modding_guides_read` with `format: "wikitext"` when official wiki code examples matter.

For offline-processing mod tests, start a read-only live session with a loaded save and an active action, then call `game_session_time_skip` with a small `hours` value. The tool uses the same underlying game helper that Time Skip relies on, `game.testForOffline(hours)`, and reports offline loop entry/exit, before/after state, modals, and blocked save writes.

For performance analysis, use `game_profile_start` on an existing live session. By default it enables Playwright tracing, Chrome DevTools Protocol CPU sampling, Chrome performance metrics, heap usage reads, long-task collection, and optional targeted instrumentation such as `instrumentQuerySelectorAll`. Use `game_profile_mark` before and after expensive steps, then `game_profile_stop` to write `trace.zip`, `cpu-profile.cpuprofile`, `browser-metrics.json`, and `report.json` under ignored `reports/`.

For isolated mod profiling, use `game_session_mod_profile` after `game_session_start` and before `game_profile_start`. It can dry-run or apply a temporary browser-session-only Mod Manager profile containing one mod, one mod plus transitive installed dependencies, or an explicit interaction set. Actual changes require `apply: true`; use `restore` with the same `snapshotKey` to return to the previous profile state.

For repeatable save-state testing, use `game_session_save` in a live session. Save fixtures are JSON files under ignored `save-fixtures/`; list operations redact save strings and return metadata only. Exporting/writing fixtures, importing fixtures into local slots, and loading saves are dry-run unless `apply: true` is supplied.

For temporary local test code, use `game_session_local_mod` in a live session. It uses the installed Creator Toolkit to add a generated setup module or a local mod path into IndexedDB, reloads so Creator Toolkit loads it, verifies by marker/name/namespace, and can clean up the session-created local mods. This is the preferred path for save-generation probes, runtime instrumentation, and local profiling shims that should never be uploaded.
