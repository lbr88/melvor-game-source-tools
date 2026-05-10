# Melvor Modding Docs Overview

This folder is the packaged documentation corpus for the Melvor Game Source MCP. It is meant to be useful even when a developer has not checked out any separate local game-source or mod workspace.

Use the MCP guide tools this way:

- Start with `melvor_modding_guides_list` to discover packaged docs and official wiki pages.
- Read this overview with `melvor_modding_guides_read` using page `README` or `Local/Melvor Modding Docs Overview`.
- Search all packaged docs and official wiki guide pages with `melvor_modding_guides_search`.
- Read official wiki pages with `format: "wikitext"` when exact code examples or templates matter.

## Packaged Docs

`game-source-assets-js.md`

Use for source architecture questions: which bundled JS files exist, what `built/` contains, where mod loader code lives, and which browser/runtime libraries the client ships.

`generated-source-reference.md`

Use for generated source lookups: modding-relevant classes, custom elements, lifecycle hooks, patching, offline processing, rendering, event names, and source file/line snippets. Regenerate it with `npm run source:docs`.

`local-mod-writing-patterns.md`

Use for practical mod implementation patterns learned from local mods: lifecycle hooks, `ctx.patch`, `before`/`after`/`replace`, offline processing guards, templates, PetiteVue, settings, storage, APIs, DOM observers, and caching.

`creator-toolkit-local-mods.md`

Use for Creator Toolkit behaviour: local mod records, IndexedDB storage, linked mod.io mods, local load failure guards, `.modignore`, and MCP verification flows.

`live-game-sessions.md`

Use for interactive MCP browser work: persistent Melvor sessions, read-only save guards, screenshots, live state reads, and profiling attached to an open session.

`game-save-browser-tests.md`

Use for one-shot browser regression checks: loading a save, blocking save writes, opening pages, clicking selectors, and reading generated reports.

## Common Questions

For "how do I patch game behavior?", search for `ctx.patch`, `before`, `after`, `replace`, or read `local-mod-writing-patterns.md`.

For "what should I call after the game loads?", search for `onCharacterLoaded`, `onInterfaceReady`, or read `local-mod-writing-patterns.md`.

For "how do I avoid hurting offline processing?", search for `offlineLoopEntered`, `offlineLoopExited`, `loadingOfflineProgress`, `OfflineLoadingElement`, or read `local-mod-writing-patterns.md`.

For "where is the mod loader?", search for `mod loader`, `built/mod.js`, or read `game-source-assets-js.md`.

For "where is a symbol or hook in source?", search for `generated source reference`, the symbol name, or read `generated-source-reference.md`.

For "how do I test a local mod safely?", read `creator-toolkit-local-mods.md`, `live-game-sessions.md`, and `game-save-browser-tests.md`.
