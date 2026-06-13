# Live Debugging Patterns

Use these patterns when debugging Melvor Idle mods through the MCP live session tools.

## Verify The Rendered Behavior

Do not stop at checking game data. When a user reports a visual bug, verify the rendered DOM or screenshot as well.

Good checks compare both sides:

- the game model, such as `game.bank.itemsByTab`, active skill state, settings, or mod state;
- the rendered UI, such as custom elements, selected menus, child node order, button text, or visible status text.

Use `game_session_debug_probe` before writing one-off page scripts. It reports common game/session state, selected global symbols, modal state, and selector counts/samples. Use `game_session_screenshot` when visual layout or overlap matters.

## Bare Globals Versus `globalThis`

Some Melvor UI objects may be visible as bare browser globals without being properties of `globalThis`. A mod can fail if it only reads `globalThis.someName`.

Check both forms:

```js
const menu = globalThis.bankTabMenu
  || (typeof bankTabMenu !== 'undefined' ? bankTabMenu : undefined);
```

`game_session_debug_probe` reports `bareOnly` for requested symbols so this class of issue is visible without custom injected code.

## Modals Can Block Correct-Looking Tests

SweetAlert modals, pet unlocks, and warning prompts can block page clicks while scripts still appear to run. Before UI-click tests, call:

```json
{ "action": "dismiss_modals", "maxClicks": 5 }
```

Then verify the target selector exists and is visible before clicking.

## Do Not Trust One Signal

Some session actions can report success while another signal still looks stale. For example, `open_page` can return the target page object while the game state field still reports the previous active page. Confirm with selectors that only exist on the target page, visible text, or a screenshot.

For release testing, also confirm the loaded mod version in browser console events or `game_session_state.loadedMods`. If a mod update should change behavior, verify that the new version was actually loaded before testing.

## Prefer Structured Console Evidence

For async browser tests, log a unique marker and compact JSON:

```js
console.log('[MY_MOD_TEST]', JSON.stringify({
  changed,
  domMatchesData,
  firstItems,
}));
```

Then read it with `game_session_state` using enough `maxBrowserEvents`. This is more reliable than visually scanning the browser during automated checks.

## Keep Save And Release Testing Safe

Start sessions with `readOnly: true` unless explicitly testing persistence. The save guard blocks common save-write paths and summarizes blocked writes in `readOnlySaveWriteSummary`.

For public or hidden public mod.io mods, upload test files inactive first with `active: false`, verify the loaded version, and promote only after testing. The mod.io upload API defaults can otherwise change the active client-facing file immediately.

## Useful Flow

1. Start or replace a read-only live session with the target save.
2. Confirm the loaded mod version and Optimizer/profile state with `game_session_state`.
3. Dismiss modals with `game_session_action` and `action: "dismiss_modals"`.
4. Open the target page, then prove the target UI exists with `game_session_debug_probe`.
5. Trigger the user workflow using selectors or a small evaluate script.
6. Compare game data and rendered DOM, then capture a screenshot if the issue is visual.
7. Stop the session when done.
