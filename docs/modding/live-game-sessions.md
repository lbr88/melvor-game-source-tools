# Live Game Sessions

The persistent session tools are for interactive testing. They keep the same browser open so an AI client can start the game, inspect it, click through UI, profile a scenario, read results, and continue based on user direction.

Use `game_save_test` only for one-shot regression checks. Use these tools when the browser should stay alive:

- `game_session_start`: launches Chromium, signs in with `.env` credentials, waits for Mod Manager, optionally loads `MELVOR_TEST_CHARACTER_SLOT`, and keeps the page open.
- `game_session_action`: runs actions against that same page. Supported actions are `wait`, `click_selector`, `fill_selector`, `press`, `open_page`, and `evaluate`.
- `game_session_state`: reads current page/game/mod state without closing the browser.
- `game_session_save`: lists local/cloud slots and ignored save fixtures, exports named fixtures, imports fixtures into local test slots, and loads slot or fixture saves.
- `game_session_local_mod`: installs generated or local-path Creator Toolkit local mods into the live session, reloads, verifies, and removes session-created locals.
- `game_session_mod_profile`: snapshots, temporarily replaces, reloads, and restores the live session's active Mod Manager profile for isolated or interaction-set profiling.
- `game_session_debug_probe`: reads reusable debugging facts from the live page, including modal state, common game state, requested bare/globalThis symbols, and CSS selector samples.
- `game_session_time_skip`: triggers offline processing in a loaded session with `game.testForOffline(hours)` and reports offline loop entry/exit, before/after state, modal state, and blocked save writes.
- `game_session_screenshot`: writes a screenshot and JSON report while the session remains open.
- `game_session_stop`: closes the browser only when explicitly requested.

By default `game_session_start` is headful and read-only. The read-only guard blocks common local, cloud, native, and PlayFab save writes. Repeated writes are summarized under `readOnlySaveWriteSummary`, with a short recent sample under `readOnlySaveWritesBlocked`.

Use `game_session_save` when a test needs a known save state. Save fixtures live under ignored `save-fixtures/` and store exported Melvor save strings plus metadata. The tool redacts save strings from responses. Exporting/writing fixture files, importing fixtures into local slots, and loading saves are dry-run unless `apply: true` is supplied. Fixture imports write only the selected browser local slot; they do not upload cloud saves.

Use `game_session_local_mod` when a test needs temporary code loaded through Creator Toolkit in the same browser session. `install_generated` wraps `setupScript` inside a generated `setup.mjs` that records a marker under `globalThis.__mcpLocalModShenanigans[namespace]`; `install_path` packages a local mod directory or zip. The tool reloads by default so Creator Toolkit loads the local mod, verifies by marker, loaded mod name, or namespace context, and keeps session-created locals until `cleanup` or browser close.

## Profiling

Profiling is attached to an existing live session:

- `game_profile_start`: starts Playwright tracing, Chrome DevTools Protocol CPU profiling, Chrome performance metrics, heap usage reads, and in-page performance collection.
- `game_profile_read`: reads current counters, Chrome metric deltas, heap usage, long tasks, Optimizer state, and browser events while profiling continues.
- `game_profile_mark`: adds a named mark to the active profile so scenario steps can be matched against trace/profile output.
- `game_profile_stop`: stops profiling, writes `trace.zip`, `cpu-profile.cpuprofile`, `browser-metrics.json`, and `report.json`, and leaves the game session open.

`game_profile_start` enables CDP CPU profiling and browser metrics by default. The CPU profile is written in Chrome `.cpuprofile` format and can be opened in DevTools. The report also includes a compact top-functions summary by sampled self-time plus Chrome metric deltas such as script, task, layout, style recalculation, node count, event listener count, and heap usage.

`game_profile_start` can optionally set `instrumentQuerySelectorAll: true`. That wraps the current `document.querySelectorAll` only for the profiling window, counts calls, totals time, records slow selectors, and restores the original function on `game_profile_stop`. Leave it off when you want lower overhead.

Use `game_session_mod_profile` before `game_profile_start` when the profile should isolate one installed mod or a specific interaction set. `load_with_dependencies` computes transitive dependencies from installed Mod Manager metadata. `load_set` accepts explicit `modIds` and can also include dependencies. The tool is dry-run by default; `apply: true` writes temporary browser-session values, guards PlayFab mod-profile writes while the override is active, reloads the game by default, and stores an in-memory snapshot for `restore`.

Optimizer-specific state is included in session and profile reads:

- whether `pavr_optimizer` has a mod context,
- whether its settings global exists,
- whether the current `querySelectorAll` is the Optimizer patch,
- whether Optimizer thinks it is inside the offline loop,
- whether game rendering is currently enabled.

## Debugging

Use `game_session_debug_probe` before writing a custom `evaluate` script. It is useful for checking whether the page is blocked by a modal, whether a runtime symbol exists only as a bare global instead of `globalThis`, and whether expected selectors are present.

`game_session_action` also supports `dismiss_modals`, which clicks SweetAlert confirm buttons or closes visible SweetAlert popups. Use it before selector-click workflows when pet unlocks, warnings, or mod.io prompts may block the page.

For offline-processing tests, prefer `game_session_time_skip` over ad hoc timestamp mutation. It uses Melvor's own `game.testForOffline(hours)` helper, the same core mechanism used by Time Skip-style mods, and should usually run inside a read-only session. Start with small values such as `hours: 0.25`, then increase only when a longer offline batch is required.

When debugging UI behavior, compare both game state and rendered DOM. A mod can update game data correctly while the visible UI remains stale, especially when custom elements own their own render cache.

Example flow:

```json
{ "sessionId": "optimizer", "loadSave": true, "headful": true }
```

Start profiling:

```json
{ "sessionId": "optimizer", "label": "offline-load", "instrumentQuerySelectorAll": true, "cpuProfile": true }
```

Temporarily load one mod plus installed dependencies before profiling:

```json
{ "sessionId": "optimizer", "operation": "load_with_dependencies", "modId": 5163298, "apply": true }
```

Restore the previous Mod Manager profile after profiling:

```json
{ "sessionId": "optimizer", "operation": "restore", "apply": true }
```

Export the currently loaded save as a named fixture:

```json
{ "sessionId": "optimizer", "operation": "export_current", "fixture": "bank-heavy", "apply": true }
```

Load a fixture through a local test slot:

```json
{ "sessionId": "optimizer", "operation": "load_fixture", "fixture": "bank-heavy", "targetSlot": 7, "overwriteLocalSlot": true, "apply": true }
```

Install a generated local probe:

```json
{
  "sessionId": "optimizer",
  "operation": "install_generated",
  "name": "MCP Bank Probe",
  "namespace": "mcp_bank_probe",
  "setupScript": "ctx.onCharacterLoaded(() => { globalThis.__bankProbe = { bankItems: game.bank.items.length }; });",
  "apply": true
}
```

Remove session-created local mods:

```json
{ "sessionId": "optimizer", "operation": "cleanup", "apply": true }
```

Interact:

```json
{ "sessionId": "optimizer", "action": "open_page", "pageId": "melvorD:Woodcutting", "durationMs": 2000 }
```

Mark expensive steps:

```json
{ "sessionId": "optimizer", "label": "before-smart-sort", "detail": "bank page loaded" }
```

Probe the live UI:

```json
{
  "sessionId": "optimizer",
  "globalNames": ["game", "mod", "bankTabMenu"],
  "selectors": [".swal2-popup", "#bank-tab-menu"]
}
```

Read current profile:

```json
{ "sessionId": "optimizer", "maxLongTasks": 25, "maxBrowserEvents": 50 }
```

Stop profile, keep game open:

```json
{ "sessionId": "optimizer" }
```

Close only when done:

```json
{ "sessionId": "optimizer" }
```
