# Live Game Sessions

The persistent session tools are for interactive testing. They keep the same browser open so an AI client can start the game, inspect it, click through UI, profile a scenario, read results, and continue based on user direction.

Use `game_save_test` only for one-shot regression checks. Use these tools when the browser should stay alive:

- `game_session_start`: launches Chromium, signs in with `.env` credentials, waits for Mod Manager, optionally loads `MELVOR_TEST_CHARACTER_SLOT`, and keeps the page open.
- `game_session_action`: runs actions against that same page. Supported actions are `wait`, `click_selector`, `fill_selector`, `press`, `open_page`, and `evaluate`.
- `game_session_state`: reads current page/game/mod state without closing the browser.
- `game_session_screenshot`: writes a screenshot and JSON report while the session remains open.
- `game_session_stop`: closes the browser only when explicitly requested.

By default `game_session_start` is headful and read-only. The read-only guard blocks common local, cloud, native, and PlayFab save writes. Repeated writes are summarized under `readOnlySaveWriteSummary`, with a short recent sample under `readOnlySaveWritesBlocked`.

## Profiling

Profiling is attached to an existing live session:

- `game_profile_start`: starts Playwright tracing and in-page performance collection.
- `game_profile_read`: reads current counters while profiling continues.
- `game_profile_stop`: stops profiling, writes `trace.zip` plus `report.json`, and leaves the game session open.

`game_profile_start` can optionally set `instrumentQuerySelectorAll: true`. That wraps the current `document.querySelectorAll` only for the profiling window, counts calls, totals time, records slow selectors, and restores the original function on `game_profile_stop`. Leave it off when you want lower overhead.

Optimizer-specific state is included in session and profile reads:

- whether `pavr_optimizer` has a mod context,
- whether its settings global exists,
- whether the current `querySelectorAll` is the Optimizer patch,
- whether Optimizer thinks it is inside the offline loop,
- whether game rendering is currently enabled.

Example flow:

```json
{ "sessionId": "optimizer", "loadSave": true, "headful": true }
```

Start profiling:

```json
{ "sessionId": "optimizer", "label": "offline-load", "instrumentQuerySelectorAll": true }
```

Interact:

```json
{ "sessionId": "optimizer", "action": "open_page", "pageId": "melvorD:Woodcutting", "durationMs": 2000 }
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
