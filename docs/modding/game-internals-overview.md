# Melvor Game Internals Overview

This is local repository guidance, not official Melvor Idle documentation. It summarizes how the distributed web client appears to work from the packaged source catalog, generated source reference, live browser sessions, and observed modding patterns. Use it as a map, then verify exact behavior with `game_source_search`, `game_source_read`, or a live read-only game session.

## Mental Model

Melvor Idle is a client-heavy idle game. Most gameplay state and progression logic lives in the browser client. The runtime centers around a global `game` object, a large set of registries, typed game objects, and UI custom elements that render selected parts of that state.

The practical modding model is:

- Data and object definitions are registered into namespaced registries.
- A loaded save hydrates the central `Game` instance and its managers.
- Active skills, combat, passive timers, and offline simulation mutate game state.
- Render queues mark specific UI areas dirty instead of rebuilding the whole interface.
- Menus and custom elements read game state and update DOM.
- Mods patch classes, register data, add UI, and react to lifecycle hooks.

## Boot And Load Flow

The web page loads static libraries, then built game modules under `assets/js/built/`. `main.js` and `game.js` are the most important starting points.

High-level flow:

1. Browser loads shared libraries such as jQuery, SweetAlert2, Tippy, Sortable, Fuse, Dexie, and PetiteVue.
2. Built game modules define classes, managers, registries, menus, and custom elements.
3. The game creates and initializes the central `Game` object.
4. Namespaces, skills, actions, items, currencies, pages, areas, monsters, modifiers, and UI elements are registered.
5. Local or cloud save data is deserialized and migrated.
6. Menus and pages initialize their DOM bindings.
7. The online game loop starts, or a large time gap triggers offline processing.

Search next:

- `main.js game onLoad`
- `Game class registries`
- `registeredNamespaces registerNamespace`
- `initMenus customElements.define`

## Source Layout

Useful source groups:

- `assets/js/built/game.js`: central `Game` class, registries, loop state, save timing, realm state, rendering flags.
- `assets/js/built/main.js`: startup and UI initialization flow.
- `assets/js/built/mod.js`: Mod Manager, mod contexts, lifecycle hooks, patching API.
- `assets/js/built/bank2.js` and `bankMenus.js`: bank model and bank UI.
- `assets/js/built/equipment.js`, `item.js`, `player.js`, `character.js`: items, equipment, player/combat stat state.
- `assets/js/built/combat*.js`, `enemy.js`, `attackStyle.js`, `combatTriangle.js`: combat managers, areas, effects, attacks, and combat UI.
- Skill files such as `woodcutting.js`, `fishing.js`, `smithing.js`, `artisanSkill.js`, `mastery2.js`: skill-specific action logic.
- Menu files ending in `Menu.js` or `Menus.js`: custom elements and page-specific UI behavior.

Use raw `game-source/` as ground truth. Use `game-source-readable/` only as a readable copy when exact formatting and source positions are less important.

## Registries And Namespaces

Game content is normally not found by scanning loose arrays directly. Content is registered into namespaced registries so base game, expansions, realms, events, and mods can coexist.

Common object types:

- `NamespacedObject` and `RealmedObject`
- Items, skills, pages, combat areas, monsters, pets, currencies, recipes, modifiers, and requirements
- Namespace IDs such as `melvorD:Something`

For modding, this matters because string IDs are usually namespaced. When a mod adds data or looks up existing data, it should use the game registries and namespaced IDs instead of assuming a plain object shape.

Search next:

- `NamespacedObject`
- `RealmedObject`
- `namespaceRegistry`
- `game.items`
- `game.skills`

## Game Loop And Offline Processing

The online loop advances active actions and passive systems while the page is running. A large time gap triggers offline simulation, which batches progression without rendering every intermediate UI state.

Important implications:

- Expensive DOM scans should pause or throttle during offline processing.
- Render work may be suppressed or delayed while offline progress is reconstructed.
- Mods should avoid assuming every tick is a visible real-time tick.
- Live testing should check both game data and rendered UI after offline processing exits.

Useful signals and searches:

- `offlineLoopEntered`
- `offlineLoopExited`
- `loadingOfflineProgress`
- `OfflineLoadingElement`
- `OfflineProgressElement`
- `game.enableRendering`
- `game.testForOffline(hours)`
- `game_session_time_skip`
- `game_profile_start`
- `game_profile_mark`
- `game_profile_stop`

For live mod tests, use `game_session_time_skip` in a read-only session instead of writing ad hoc timestamp code. It calls the same game helper used by Time Skip-style mods and reports whether the offline loop entered and exited.

For runtime performance investigations, attach `game_profile_start` to a live session. It can capture Playwright traces, Chrome DevTools Protocol CPU samples, Chrome performance metric deltas, heap usage, long tasks, and named scenario marks. Use `game_profile_stop` to write ignored artifacts such as `trace.zip`, `cpu-profile.cpuprofile`, `browser-metrics.json`, and `report.json`.

## Skills And Actions

Most non-combat skills are action systems. A skill has selectable actions or recipes, action intervals, rewards, mastery, modifiers, requirements, and render queues. Artisan skills share common recipe/product patterns; gathering skills share node/action patterns.

Common concepts:

- Skill instances live under `game.skills`.
- Actions often produce item rewards, XP, mastery XP, currency, pets, or completion progress.
- Requirements and modifiers alter what can be selected, produced, or shown.
- Mastery and realm state can affect rewards and visibility.

Search next:

- `GatheringSkill`
- `CraftingSkill`
- `ArtisanSkill`
- `BasicSkillRecipe`
- `MasterySkill`
- `postAction`

## Combat

Combat is manager-driven and uses player/enemy character state, equipment stats, attack styles, combat triangles, modifiers, special attacks, prayers, spells, passives, effects, areas, dungeons, and loot tables.

Key pieces:

- `CombatManager` coordinates active combat.
- `Player`, `Enemy`, and `Character` classes hold combat state and stats.
- Equipment sets and food are part of player state.
- Combat effects and modifiers can change stats, damage, resistance, barrier, timing, and special behavior.
- Combat UI is separate from combat state; menus read the state and render it.

Search next:

- `CombatManager`
- `CharacterCombatStats`
- `EquipmentSetMenu`
- `combatTriangle`
- `CombatEffect`
- `SpecialAttack`
- `Prayer`
- `Spell`

## Items, Bank, Equipment, And Shop

The bank is both a data model and a complex UI surface. Bank item order, tabs, selected-item sidebars, quick equip, item stats, upgrades, sell mode, and search/filter behavior are split across `bank2.js` and `bankMenus.js`.

Important distinction:

- The bank model stores items, quantities, tabs, and ordering.
- The bank UI renders icons, selected item menus, stats panels, tab menus, and controls.
- A successful data mutation may not visibly change anything until the right render path runs.

Equipment is related but separate. Equipping rules, equipment slots, equipment sets, food, item stats, and quick-equip UI are primarily in equipment/player/combat files.

Search next:

- `Bank extends GameEventEmitter`
- `BankRenderQueue`
- `BankTabMenuElement`
- `BankSelectedItemMenuElement`
- `BankItemStatsMenuElement`
- `EquipmentItem`
- `EquipmentSetMenu`
- `QuickEquipTooltipElement`

## Modifiers, Requirements, Realms, And Completion

Much of Melvor's behavior is driven by generic systems rather than skill-specific code:

- Requirements gate items, skills, recipes, areas, shop purchases, and pages.
- Modifiers adjust stats, rewards, intervals, costs, preservation, and combat behavior.
- Realms and expansions scope what content is visible or active.
- Completion, pets, achievements, and relics observe progress across systems.

For mods, this means it is often better to use existing requirement/modifier APIs than to hardcode one-off checks.

Search next:

- `requirements.js`
- `modifiers.js`
- `conditionalModifiers.js`
- `modifierTable.js`
- `realms.js`
- `completionLog.js`

## UI And Rendering

Melvor uses many custom elements and page/menu classes. These are often the best integration points for UI mods.

Rendering is usually targeted:

- Game state changes set render queue flags.
- Menus or elements read those flags and update specific DOM areas.
- Tooltips and popovers use Tippy/Popper.
- Bank drag/drop uses Sortable.
- Searches may use Fuse.
- Larger mod UIs may use PetiteVue or plain DOM elements.

Important debugging rule: verify both the data model and the rendered DOM. A patch can update state correctly while the visible UI remains stale.

Search next:

- `customElements.define`
- `RenderQueue`
- `renderQueue`
- `render()`
- `BankSelectedItemMenuElement`
- `sidebar.category`

## Saves, Cloud, And Local Storage

The client serializes save data locally and can sync through cloud/PlayFab flows. Browser-backed MCP tools should default to read-only save guards when testing.

For modding:

- Use `ctx.characterStorage` for per-character mod state.
- Use account-level settings/storage only for preferences that should apply across characters.
- Avoid writing save-affecting data during tests unless that is explicit.
- Use read-only browser sessions for debugging when possible.

Search next:

- `serializeSave`
- `saveWriter`
- `cloudManager`
- `characterStorage`
- `accountStorage`

## Modding Surface

The most useful modding APIs and patterns are exposed through the Mod Context API and Creator Toolkit:

- `setup(ctx)` is the normal mod entry point.
- `ctx.patch(...).before/after/replace` patches game methods.
- Lifecycle hooks such as `onCharacterLoaded` and `onInterfaceReady` separate game-object work from DOM work.
- `settings.section(...).add(...)` creates settings.
- `ctx.api(...)` exposes APIs to other mods.
- `manifest.json` declares metadata and load files such as `setup.mjs` and templates.

Search or read:

- `Mod Creation/Getting Started`
- `Mod Creation/Essentials`
- `Mod Creation/Mod Context API Reference`
- `creator-toolkit-local-mods`
- `local-mod-writing-patterns`

## Debugging Strategy

A reliable debugging flow:

1. Use `melvor_mcp_context` or this document to choose the likely subsystem.
2. Search packaged docs for the concept.
3. Search raw source for exact symbols.
4. If mods might interact, refresh installed mod sources with `mod_manager_fetch_sources` and search them with `mod_source_search`.
5. If behavior depends on runtime state, start a read-only live session and collect structured console evidence.
6. Check both model state and rendered DOM before concluding a fix works.
