# Game Save Browser Tests

`game_save_test` loads Melvor in Playwright, signs in with `.env` credentials, loads a configured save slot, captures browser console/page errors, and writes an ignored report with a screenshot.

The default save slot comes from `MELVOR_TEST_CHARACTER_SLOT`. Pass `saveSlot` to override it for a single run. `saveSource` may be `cloud` or `local`.

Save tests are read-only by default. The browser helper blocks obvious local and cloud save-write paths, including `saveData`, save-game `localStorage.setItem` writes, Steam/native cloud backup calls, `cloudManager.forceUpdatePlayFabSave`, and PlayFab save-slot `UpdateUserData` writes. Pass `readOnly: false` only for tests that intentionally mutate the save.

Supported post-load actions:

- `snapshot`: load the save and capture state.
- `wait`: load the save and wait for `durationMs`.
- `open_page`: resolve `actionPage` through `game.pages.getObjectByID()` and call `changePage(page)` after load.
- `click_selector`: click a CSS selector after load.

Reports include loaded save metadata, current character slot, gamemode, active page/action, loaded mods, read-only guard events, modal text when present, console/page errors, and `page.png`.
