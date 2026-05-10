# Melvor Idle Web Game JS Assets Catalog (Consolidated)

(Originally `melvoridle.com/assets/js/README.md`)

# Melvor Idle Web Game JS Assets Catalog

This document catalogs the JavaScript assets found in `game-source/melvoridle.com/assets/js/` and provides a high‑level architectural overview of how the game works. It is written from inspection of the distributed (already built) game code. Some source context (e.g. original TypeScript or module sources) is not present; filenames and runtime structures are therefore used to infer intent. Adjust or extend as you explore further.

---
## Directory Layout
```
assets/js/
  Sortable.min.js
  basis.min.js
  dagre.min.js
  dexie.min.js
  fflate.min.js
  fuse.min.js
  ifvisible.js
  jquery.mobile-events.js
  mitt.min.js
  oneui.app.min.js
  oneui.core.min.js
  petite-vue.min.js
  pixi.min.js
  popper.min.js
  tippy-bundle.umd.min.js
  toastify-js.js
  viewport.min.js
  game/                 (Game-specific helper scripts)
  pages/                (OneUI animation helper)
  plugins/              (3rd‑party plugin bundles)
  built/                (Compiled core game logic & UI modules)
```

### `game/`
| File | Purpose (Observed / Inferred) |
|------|--------------------------------|
| `samsungAndroidFix.js` | Adjusts `<meta viewport>` to disable pinch zoom or scaling issues on certain Samsung Android 12 devices. |
| `someCoolFunctions.js` | Push notification scheduling, device connect/disconnect, platform detection, storing OneSignal tokens, interacting with PlayFab and cloud endpoints. |

### `pages/`
| File | Purpose |
|------|---------|
| `be_ui_animations.min.js` | OneUI demo animation toggler (adds animation classes for preview UI). Not core gameplay. |

### `plugins/`
Subfolders contain bundled plugin assets that supplement UI/UX.
| Path | Contents / Notes |
|------|------------------|
| `plugins/es6-promise/es6-promise.auto.min.js` | Polyfill for Promises. |
| `plugins/ion-rangeslider/` | Range slider component (CSS + JS). |
| `plugins/sweetalert2/` | Customized SweetAlert2 modal (JS + CSS). |

### Third‑Party Library Bundles (Top Level)
| File | Role |
|------|------|
| `Sortable.min.js` | Drag & drop sorting (inventory/bank rearrangement likely). |
| `basis.min.js` | (Likely) Basis Universal texture transcoder (compressed textures). |
| `dagre.min.js` | Directed graph layout (used for skill trees / node graphs). |
| `dexie.min.js` | IndexedDB wrapper for local persistent storage (save data cache). |
| `fflate.min.js` | Compression (save file compression, asset packs). |
| `fuse.min.js` | Fuzzy search (searching items, pets, skills). |
| `ifvisible.js` | Tab visibility & idle detection (pausing loops, idle timers). |
| `jquery.mobile-events.js` | Adds mobile touch event abstractions. |
| `mitt.min.js` | Lightweight event emitter. (Game also has its own event system.) |
| `oneui.core.min.js`, `oneui.app.min.js` | OneUI template framework scripts (layout, helpers). |
| `petite-vue.min.js` | Lightweight reactive UI binding (select components / menus). |
| `pixi.min.js` | PixiJS renderer (canvas rendering for effects / possible future visuals). |
| `popper.min.js` | Tooltip positioning (dependency of tippy). |
| `tippy-bundle.umd.min.js` | Tooltips / popovers throughout UI. |
| `toastify-js.js` | Toast notifications. |
| `viewport.min.js` | Likely viewport / responsive helper (media queries). |

### `built/` (Core Game Logic)
These are compiled (minified or transpiled) modules. Each file generally encapsulates a domain: a skill, system manager, UI menu, or data definition. The architecture centers around a central `Game` class (`game.js`) plus a large registry & event system. Many files pair logic with a `*Menu(s).js` for UI rendering.

Below is a categorized catalog (grouped by concern). Names are inferred from filenames and partial code inspection.

#### Core Boot & Framework
| File | Description |
|------|-------------|
| `main.js` | Startup sequence: initializes libraries, sets up UI, loads player data, wires menus, sets initial page, language updates, entitlement gating, triggers `game.onLoad()`. Handles modal lifecycle & initial sidebar state. |
| `game.js` | Defines `Game` class: registries (namespaces, skills, actions, items, areas), game loop timing (online/offline), save scheduling, realm management, rendering queue flags, currency/items initialization, default objects, offline processing constants, telemetry, notifications, events. |
| `constants.js` | Large constant structures: lore entries, enumerations, ID lists. Uses `getLangString` for localization indirection. |
| `enums.js` | Enumerations used across systems (skill types, modifiers, stat keys, etc.). |
| `namespaceRegistry.js` | Infrastructure for namespaced object registration (Base game vs expansions vs events). |
| `namespaceRegistry` related (e.g. `namespaceRegistry.js`, `namespaceMap`, `namespacedArray` if present) | Support typed grouping of content across DLC realms/expansions. |
| `pages.js` | Page definitions (distinct top-level UI sections) and logic for page transitions. |
| `components.js` | Custom web components definitions (UI widgets). |
| `ui.js`, `uiCallbacks.js` | Core UI rendering utilities and callback handlers for dynamic updates (progress bars, skill displays, tooltips). |
| `utils.js` | General utility helpers (DOM, formatting, math, throttling, etc.). |
| `dataStructures.js` | Custom data containers (drop tables, queues, sets, ring buffers). |
| `db.js` | Likely IndexedDB interaction via Dexie (local save caching, versioning). |
| `save.js`, `saveWriter.js`, `serializeSave.js` | Load/save pipeline: serialization of game state, compression, cloud sync boundaries, header/body sizing, version migration. |
| `cloud.js`, `cloudManager.js` | Cloud connectivity (PlayFab / Melvor Cloud), device linking (ties into push notifications). |
| `nativeManager.js` | Native platform bridging (Steam, Epic, Mobile JS bridges, price updates). |
| `language.js`, `localizationGeneration.js` | Localization: `getLangString` usage, dynamic regeneration of UI text. |
| `keyboardInput.js` | Handles keyboard shortcuts and hotkey mapping. |
| `notifications.js` | In-game notification queue (toastify & tippy integration) including max queue logic for gamemodes. |
| `telemetry.js` | Client telemetry / analytics events dispatch. |
| `eventManager.js`, `eventMenu.js` | Seasonal / limited-time event tracking & UI. |
| `gamemode.js` | Game mode definitions (modifiers to HP multiplier, instant actions, restrictions). |
| `modifierTable.js`, `modifiers.js`, `conditionalModifiers.js` | Systems for applying and resolving stat modifiers from gear, passives, skills, relics, realms. |
| `statProvider.js`, `statTracker.js`, `statistics.js`, `statsTable.js` | Aggregation and tracking of stats (kills, resources, playtime) and display logic. |
| `tests.js` | Possibly internal test harness hooks (dev only). |
| `tutorialIsland.js`, `tutorialMenus.js` | New player onboarding logic. |
| `progressbar.js` | UI progress bar rendering (skills, actions). |
| `petManager` related (see `pets.js`, `pet log` integration) | Pet acquisition, tracking, UI updates. |

#### Player, Items & Inventory
| File | Description |
|------|-------------|
| `player.js` | Player state: levels, stats, equipment, combat state, interactions with actions. |
| `item.js` | Item base class definitions & metadata fields (category, type, stats). |
| `equipment.js`, `equippedFood.js` | Equipment slots, equipping rules, food healing logic. |
| `itemCharges.js` | Charge tracking for consumable equipment (rings, relics, potions). |
| `itemSynergies.js` | Unique effects granted by pairing specific items. |
| `bank2.js`, `bankMenus.js` | Bank / inventory storage logic & related UIs (sorting via Sortable, search via Fuse). |
| `shop.js`, `shopMenu.js` | Purchasing, selling, price calculations, category filtering, restocking. |
| `currency.js` | Currency classes (GP, Slayer Coins, Raid Coins, etc.). |
| `pets.js` | Pet definitions & unlock effects. |
| `account.js` | Account-level data (name, login state, entitlement flags). |

#### Actions, Skills & Mastery
Core idle loop revolves around “actions” a skill performs (gathering, crafting, combat). Skills register into `game.skills` with optional mastery trees.

| Skill Group | Logic Files | Menu / UI Files | Notes |
|-------------|-------------|-----------------|-------|
| Combat | `combat.js`, `combatManager.js`, `combatAreas.js`, `combatAreaCategories`, `combatTriangle.js`, `combatEffects.js`, `combatEffectRenderer.js`, `attacks.js`, `attacks2.js`, `attackStyle.js`, `spells.js`, `prayer.js`, `slayer.js`, `combatLoot.js`, `combatPassives` | `combatMenus.js` | Turn-based tick loop; attack interval management; special attacks; damage types; resistances; barrier; loot & drop tables; area/dungeon/slayer task progression. |
| Hitpoints / Corruption (Combat extensions) | Integrated | Integrated | Corruption adds new stat line; modifiers interplay with damage types. |
| Township | `township.js`, `townshipMenus.js`, `townshipTasks.js` | menus | City-building meta skill (resource buildings, tasks). |
| Woodcutting | `woodcutting.js` | `woodcuttingMenu.js` | Tree nodes, respawn, axe effects. |
| Fishing | `fishing.js` | `fishingMenus.js` | Area-based catches, junk vs fish tables, mastery bonuses. |
| Firemaking | `firemakingTicks.js` | `firemakingMenus.js` | Burn timers, log types, global burn modifiers. |
| Mining / Rocks | (Likely `harvesting.js` for veins + mining-specific functions) | associated menus | Rock node initialization seen in `main.js`. |
| Agility | `agility.js` | `agilityMenus.js` | Obstacle courses, passive global buffs, pillar effects. |
| Thieving | `thieving2.js` | `thievingMenu.js` | NPC targets, stun, success chance, unique loot. |
| Farming | `farming2.js` | `farmingMenus.js` | Patch growth timers, crop states. |
| Herblore | `herblore.js` | Menus via artisan frameworks | Potion creation, ingredients, modifiers. |
| Fletching | `fletching.js` | Menus | Bow/ammo crafting actions. |
| Crafting | `crafting.js` | Menus | Armor/jewelry/other item creation. |
| Smithing | `smithing.js` | Menus | Ore to bars to equipment pipeline, catalysts. |
| Runecrafting | `runecrafting.js` | Menus | Rune essence conversion, alt magic synergy. |
| Summoning | `summoning.js` | `summoningMenus.js` | Tablet creation, familiar effects, synergy with other skills. |
| Cooking | `cooking.js` | `cookingMenu.js` | Raw → cooked item with burn chance/multipliers. |
| Archaeology | `archaeology.js` | `archaeologyMenu.js` | Relic excavation, soil sifting (inferred). |
| Cartography | `cartography.js` | `cartographyMenu.js` | Map creation & exploration, hex map integration. |
| Astrology | `astrology.js` | `astrologyMenus.js` | Star sign buffs, rerolls, resource sinks. |
| Corruption | `corruption.js` | `corruption` browse menu | Status effects / global challenges. |
| Alt Magic | `altMagic.js` | `altMagicMenu.js` | Alternate magical transmutation actions. |
| Mastery | `mastery2.js`, `masteryDisplays.js` | Menus & displays | Per-item/recipe XP bars, global mastery pool bonuses. |
| Skill Trees | `skillTree.js`, `skillTreeMenus.js` | UI | Node graph unlocking (uses Dagre layout). |
| Passives | `passives.js` | integrated UI | Always-on benefits / relic‑like perks. |
| Realms & Ancient Relics | `realms.js`, `ancientRelics.js`, `ancientRelicsMenu.js` | Menus | Realm gating & relic drop system; modifies scope sources for modifiers. |
| Potions | `potionManager.js` | `potion-select-menu` component | Charge usage by actions/combat. |
| Pets | `pets.js` | Pet log UI | Collection bonuses. |
| Lore | `lore.js` | UI in log | Unlockable narrative entries (backed by `constants.js` LORE array). |
| Completion | `completionLog.js` | Log UI | Tracks 100% metrics (items, monsters, skills, relics). |
| Achievements | `achievements.js` | Possibly UI section | Steam & internal achievements; integrates with telemetry and `Game.steamAchievementNames`. |
| Milestones | `milestones.js` | `skillMilestoneDisplay` | Level milestone definitions & reward prompts. |
| Requirements | `requirements.js` | n/a | Generic gated unlock requirement evaluation (level, item, quest). |
| Recipe / Selection | `recipeSelection.js` | multi-skill | Central recipe filtering for artisan skills. |

#### Combat Subsystems (Detailed)
| File | Purpose |
|------|---------|
| `enemy.js`, `raidManager.js`, `raidPlayer.js` | Multi-entity combat and raid-specific logic. |
| `combatLoot.js` | Loot roll resolution, drop tables, gem tables, relic tables. |
| `combatAreas.js`, `combatAreaCategories.js`, `dungeons` within | Area definitions including Slayer areas, dungeons, depths, strongholds, events. |
| `combatMenus.js`, `combatAreaMenus` (manager inside `combat.js`) | Handles multi-tab area selection UI, dynamic reward preview, rune counts, prayer updates. |
| `combatEffects.js` plus `combatEffectGroups/templates/tables` | Status effects: DoT, lifesteal, barrier, resistances; groups for stacking rules. |
| `specialAttacks` (in `game.js` registration) | Attack templates, prehit/onhit effect arrays, lifesteal, multi-hit counts. |
| `attackStyles.js`, `attacks.js`, `attacks2.js` | Style definitions (melee/ranged/magic), timing and probability logic for specials. |
| `combatTriangle.js` | Offensive/defensive relationships between style sets. |
| `prayer.js` | Activatable buff toggles with point drain over time. |
| `auroraSpells` / `curseSpells` / `attackSpells` | Spellbook registries (namespaces). |
| `slayer.js` | Task assignment/ completion, slayer coin rewards, area gating. |
| `equipment.js` | Stats snapshotting for damage calculations. |

#### Menus & UI
Pattern: `<domain>Menus.js` or `<domain>Menu.js` holds interactive UI logic (DOM queries, event binding, building tables, filtering). Many custom elements are defined (see `initMenus` in `combat.js`). Tooltip system uses Tippy; dynamic reposition uses Popper; search inputs use Fuse; drag sort uses Sortable.

#### Modding / Extensions
| File | Purpose |
|------|---------|
| `mod.js` | Base mod integration layer (registers mod namespaces, hooks into events & data pipelines). |
| `nativeManager.js` | Offers bridging hooks for native platform embedding which mods can utilize for pricing or entitlement checks. |

#### Event & Seasonal Content
| File | Purpose |
|------|---------|
| `clueHunt.js` | Clue step tracking & progression logic (with render flag `clueHuntStep6`). |
| `birthdayEvent2023...` (inferred inside game state arrays) | Seasonal event progression tracking. |
| `ancientRelics.js` | Endgame / realm expansion collectible system. |

#### Rendering & Performance
| Concept | Details |
|---------|---------|
| Render Queue (`game.renderQueue`) | Flags set to trigger targeted re-render of UI segments (title, combat minibar, active skill panels, sidebar classes/opacity, realm visibility). Minimizes full-DOM refresh. |
| Passive Tick System | `Game._passiveTickers` holds passive action updaters run each loop. |
| Frame Throttling | `_frameRateThrottled` suggests adaptive rendering cadence on inactivity or tab hidden.
| Idle Detection | `ifvisible.js` (STATUS_ACTIVE / IDLE / HIDDEN) pauses timers to reduce CPU usage when tab hidden. |

#### Time & Offline Progress
| Aspect | Description |
|--------|-------------|
| Online Loop | Standard tick at nominal 1s intervals (exact timing managed by `previousTickTime` and performance.now). |
| Offline Trigger | If loop observes a gap ≥ `MIN_OFFLINE_TIME` (60s), enters offline simulation mode. |
| Offline Bounds | Processes at most `MAX_OFFLINE_TIME` (24h) and up to `MAX_PROCESS_TICKS` (20 * 60 * 60 * 24 raw ticks). |
| Exit Condition | When remaining simulated time < `OFFLINE_EXIT_TIME` (500ms) or action queues emptied. |
| GC Breathing | `OFFLINE_GC_RATIO = 0.95` leaves a margin per slice to let GC run between batches. |
| Output | Offline progress triggers aggregated XP, loot, mastery gains, notifications, and possible push notifications (if permitted). |

#### Namespaces & Realms
| Feature | Notes |
|---------|------|
| Namespaces | Provide isolation of IDs: base game, demo, expansions, events (e.g. `melvorF`, `melvorItA`). Registered via `registeredNamespaces.registerNamespace`. |
| Realms | Distinct content context (e.g. Abyssal). Realm Manager gates visibility & unlock requirements; switching affects which areas/items are accessible & UI category visibility. |
| Modifier Scope Sources | Registries for determining where a modifier originates (attack spells, combat areas, relics, realms) enabling selective stacking and display. |

#### Saving & Cloud
| Aspect | Description |
|--------|-------------|
| Local Save | Periodic autosave (timestamp tracked by `saveTimestamp`); body & header sizes stored for telemetry (`_lastSaveBodySize`). |
| Cloud Sync | Integrated with PlayFab & custom Melvor Cloud endpoints; push notifications connect platform & token (see `someCoolFunctions.js`). |
| Migration | On load: version comparisons (`lastLoadedGameVersion`) to apply retroactive fixes (e.g. Impending Darkness dungeon completion). |
| Data Integrity | `cleanSaveFile()` invoked during load to prune obsolete structures. |

#### Achievements & Telemetry
| Feature | Details |
|---------|---------|
| Steam Achievements | `steamAchievementNames` defines enumerated IDs; unlocking logic scattered via stat checks & events. |
| Telemetry | Event buffering (`playFabEventQueue`) and periodic upload; includes activity heartbeat (`_lastRichPresenceUpdate`). |

#### Notifications & Push
| Source | Description |
|--------|-------------|
| In-Game Notifications | `notifications.js` / `NotificationsManager` handles toast stacking, queue size caps (disabled in some gamemodes). |
| Push (Mobile) | `someCoolFunctions.js` sends scheduling requests to backend PHP endpoint after resolving platform & token; device connect/disconnect flows update PlayFab data keys `one_signal_*`. |
| Idle Tab Adjustments | `ifvisible.js` triggers focus/blur/idle to pause/resume timers & tick loops. |

#### Security & Anti‑Abuse (Inferred)
Minimal explicit obfuscation in distributed JS; balancing and gating rely on server-validated cloud calls (news, entitlements, push registration). Core progression logic is client‑authoritative (typical for idle games) — modding is thus feasible by patching built modules.

---
## High-Level Game Flow
1. Load HTML and static JS libraries (OneUI, tooltips, frameworks).  
2. `main.js` constructs global `game` (via `Game` class), registers namespaces, currencies, items, areas, and initializes UI components.  
3. External data (cloud save / local save) is deserialized; migrations & retroactive fixes run.  
4. Menus register custom elements; sidebars & pages generated.  
5. Initial page selected (Tutorial Island for new players else default page).  
6. Game loop begins (online mode). Each tick:  
   - Processes active & passive actions (skills, combat).  
   - Updates mastery, XP, timers, and render queue flags.  
   - Periodically schedules autosave & cloud/telemetry updates.  
7. If tab hidden or inactive, timers throttle (via `ifvisible`). Large time gaps trigger offline simulation which batch-applies results.  
8. Player interactions (menu clicks, equipment changes) set render flags; targeted UI components re-render.  
9. Achievements, relics, pets, and realm unlocks feed back into modifier system altering subsequent tick math.  
10. Save / exit: state serialized locally and (if connected) to cloud.

---
## Modding Considerations
- New content should ideally register under a distinct namespace to avoid ID collisions.  
- Hook into existing events via `GameEventEmitter` or global managers (menus often expose `onClick` or registration queues).  
- Avoid editing built core files directly; create injection scripts loaded after core (or use existing mod framework in repository root mods/).  
- For UI, prefer creating custom elements and appending to appropriate sidebar or page containers.  

---
## Potential Next Steps
- De-minify / map built files to original TS sources if source maps are obtainable (improves maintainability).  
- Generate automated API docs: scan `built/` for class/ function signatures (regex) and assemble a richer reference.  
- Formalize mod API surface (document guaranteed stable registries & events).  
- Introduce dependency graph visual (using Dagre itself) for skill & modifier relationships.  

---
## Disclaimer
This catalog is based on filename conventions and partial code review of compiled assets. Some descriptions may be incomplete or slightly inaccurate; refine as you explore deeper.

---
Last updated: 2025-09-02
