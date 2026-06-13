# Melvor Modding Docs Overview

This folder is the packaged documentation corpus for the Melvor Game Source MCP. It is meant to be useful even when a developer has not checked out any separate local game-source or mod workspace.

Use the MCP guide tools this way:

- Start with `melvor_modding_guides_list` to discover packaged docs and official wiki pages.
- Use `melvor_mcp_context` when the question is broad and you need a map of game internals, searchable topics, and available tools.
- Read this overview with `melvor_modding_guides_read` using page `README` or `Local/Melvor Modding Docs Overview`.
- Search all packaged docs and official wiki guide pages with `melvor_modding_guides_search`.
- Use `mod_manager_fetch_sources`, then `mod_source_search` or `mod_source_read`, when comparing against installed Mod Manager mods downloaded into local `mod-sources/`.
- Use `game_source_download` for raw local source. Use `game_source_beautify` only for a separate readable copy under `game-source-readable/`; raw source should remain the ground truth.
- Read official wiki pages with `format: "wikitext"` when exact code examples or templates matter.

## Packaged Docs

`game-source-assets-js.md`

Use for source architecture questions: which bundled JS files exist, what `built/` contains, where mod loader code lives, and which browser/runtime libraries the client ships.

`game-internals-overview.md`

Use when the question is "how does Melvor work?" rather than "where is this one symbol?": boot/load flow, registries, game loop, offline processing, skills/actions, combat, bank/items/equipment, UI rendering, saves/cloud, and modding surfaces.

`generated-source-reference.md`

Use for generated source lookups: modding-relevant classes, custom elements, lifecycle hooks, patching, offline processing, rendering, event names, and source file/line snippets. Regenerate it with `npm run source:docs`.

`local-mod-writing-patterns.md`

Use for repo-authored practical mod implementation patterns learned from observed working mods: lifecycle hooks, `ctx.patch`, `before`/`after`/`replace`, offline processing guards, templates, PetiteVue, settings, storage, APIs, DOM observers, and caching. This is standalone guidance and does not require local mod folders.

`creator-toolkit-local-mods.md`

Use for Creator Toolkit behaviour: local mod records, IndexedDB storage, linked mod.io mods, local load failure guards, `.modignore`, and MCP verification flows.

`live-game-sessions.md`

Use for interactive MCP browser work: persistent Melvor sessions, read-only save guards, save fixtures, temporary Creator Toolkit local mods, screenshots, live state reads, temporary Mod Manager profiles, offline time-skip testing, CDP CPU profiling, Chrome performance metrics, and profiling attached to an open session.

`live-debugging-patterns.md`

Use for practical live debugging habits: checking rendered UI as well as game data, bare globals versus `globalThis`, modal dismissal, structured console evidence, and inactive mod.io test uploads.

`game-save-browser-tests.md`

Use for one-shot browser regression checks: loading a save, blocking save writes, opening pages, clicking selectors, and reading generated reports.

## Common Questions

For "how do I patch game behavior?", search for `ctx.patch`, `before`, `after`, `replace`, or read `local-mod-writing-patterns.md`.

For "how does Melvor Idle work internally?", read `game-internals-overview.md`, then use `game-source-assets-js.md` or `generated-source-reference.md` for exact files and symbols.

For "how do I set up a new mod?", read or search `Mod Creation/Getting Started`, `Mod Creation/Essentials`, and `Mod Creation/Creator Toolkit`; then read `creator-toolkit-local-mods.md` and `local-mod-writing-patterns.md` for local loading and implementation patterns. Treat `local-mod-writing-patterns.md` as repo-authored practical guidance, not official Melvor documentation.

For "what should I call after the game loads?", search for `onCharacterLoaded`, `onInterfaceReady`, or read `local-mod-writing-patterns.md`.

For "how do I avoid hurting offline processing?", search for `offlineLoopEntered`, `offlineLoopExited`, `loadingOfflineProgress`, `OfflineLoadingElement`, or read `local-mod-writing-patterns.md`.

For "where is the mod loader?", search for `mod loader`, `built/mod.js`, or read `game-source-assets-js.md`.

For "should I search minified or beautified source?", use raw `game-source/` for exact runtime source and `game-source-readable/` only as a readability aid.

For "where is a symbol or hook in source?", search for `generated source reference`, the symbol name, or read `generated-source-reference.md`.

For "what do installed mods do with this symbol?", run `mod_manager_fetch_sources` to refresh local installed mod sources, then use `mod_source_search`.

For "how do I test a local mod safely?", read `creator-toolkit-local-mods.md`, `live-game-sessions.md`, and `game-save-browser-tests.md`.

For "how do I test against a known save?", read `live-game-sessions.md` and use `game_session_save` to export, import, and load ignored save fixtures.

For "how do I run temporary local test code?", read `live-game-sessions.md` and use `game_session_local_mod` with Creator Toolkit.

For "how do I profile one installed mod or a specific interaction set?", read `live-game-sessions.md` and use `game_session_mod_profile` before `game_profile_start`.

For "why does this look fixed in data but not in the game?", read `live-debugging-patterns.md` and compare both the game model and rendered DOM.
