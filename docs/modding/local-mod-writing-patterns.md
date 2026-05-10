# Local Mod Writing Patterns

These behaviours were distilled from working Melvor mods and written here as standalone guidance for future mod authors and AI agents. The original local mod folders are not required to use this document.

## Lifecycle Placement

The local mods use three common timing bands:

- Run cheap global setup immediately in `setup`: register settings, expose APIs, initialize shared state, and define helper functions.
- Use `onCharacterLoaded` for game-object work: `game.skills.allObjects`, skill instances, combat/player state, `OfflineLoadingElement`, `OfflineProgressElement`, and class patching are safest after a character exists.
- Use `onInterfaceReady` for DOM-heavy work: injected PetiteVue scopes, existing page containers, recipe option elements, sidebars, tooltips, and sortable lists need the interface rendered first.

Good examples:

- `offline-processing-plus` creates component state immediately, then mounts it and patches offline progress in `onCharacterLoaded`.
- `skiller-optimized` loads config and patch modules in `onCharacterLoaded`, but builds its PetiteVue UI in `onInterfaceReady`.
- `tinsin-recipe-preview-optimized` waits for `onInterfaceReady` before starting observers and recipe DOM scans.
- `disable-autoscroll` registers settings immediately and installs its `window.scrollTo` / `scrollBy` wrappers in `onInterfaceReady`.

## Patch Styles

Use `ctx.patch` when patching game classes. The examples show three useful styles:

- Additive `after` hooks for automation after normal game behavior completes. `skiller-optimized` patches each skill's `postAction` with `after` and then decides whether to switch actions.
- `before` hooks for phase tracking or state resets. `offline-processing-plus` resets rate counters around `Game.enterOfflineLoop` and `Game.exitOfflineLoop`.
- `replace` only when the mod must change the method result or suppress expensive original work. `offline-processing-plus` replaces `OfflineLoadingElement.updateProgress` but still calls the original on a throttle; `optimizer` and `pause-offline-rendering` replace render methods to skip work during offline processing.

When patching many related classes, enumerate live instances and patch their constructors once. `melvor-no-lifer`, `pause-offline-rendering`, and `optimizer` all walk `game.skills.allObjects`, inspect each constructor prototype, and mark patched prototypes with flags to avoid duplicate patch registration.

Avoid direct prototype or global replacement when `ctx.patch` can express the change. When global replacement is the point, preserve the original and provide a restoration path. `disable-autoscroll` stores original scroll functions and has a reinstall button; `optimizer` stores the original `document.querySelectorAll` and exposes a restore helper.

## Offline Awareness

Several mods need to behave differently while Melvor rebuilds offline progress:

- `optimizer` listens to `game.on("offlineLoopEntered")` and `game.on("offlineLoopExited")`, tracks a context flag, hides expensive notification/drop UI, temporarily disables `game.enableRendering`, and restores state afterward.
- `offline-processing-plus` patches offline loading progress and computes wall-time estimates from progress deltas instead of trusting raw TPS alone.
- `tinsin-recipe-preview-optimized` watches `globalThis.loadingOfflineProgress`, pauses timers and observers while offline progress is running, and resumes with an immediate refresh.
- `pause-offline-rendering` and `optimizer` suppress render work during offline processing by replacing selected render methods and calling the original only outside that phase.

Reusable rule: expensive polling, DOM scanning, observers, and per-frame rendering should either stop or become no-ops during offline reconstruction unless they are directly serving the offline modal.

## UI Integration

The local mods use a few stable UI patterns:

- Declare `templates.html` or `template.html` in `manifest.json` when a reusable UI surface exists.
- Mount small live components with `ui.create(component, mountElement)` when attaching to existing game UI such as `#offline-loading-modal`.
- Use `PetiteVue.createApp` and `v-scope` for larger repeated UI surfaces. `skiller-optimized` injects a `Skiller(skillId)` scope after each skill info panel.
- Use direct `createElement` for one-off generated content when building from runtime data, as `better-offline-recap` does for collapsible offline recap sections.
- Add sidebar entries through `sidebar.category('Modding').item(...)` when a mod has a full panel, as `mod-profiler` does.

When touching page DOM, prefer targeted selectors and cache stable containers. `tinsin-recipe-preview-optimized` caches the active artisan panel and observes only recipe option elements; this is much cheaper than rescanning the whole document.

## Settings, Storage, And APIs

The examples separate user preferences by scope:

- `settings.section(...).add(...)` for mod settings UI and account-level options.
- `ctx.characterStorage` for per-character UI state such as collapsed offline recap sections or custom ordering.
- Module-local or context-local state for runtime counters and caches.
- `ctx.api(...)` for APIs meant to be consumed by other mods.

Good inter-mod examples:

- `optimizer` exposes `mod.api.pavr_optimizer.getSettings()` and `getSetting(key)`.
- `offline-processing-plus` reads `mod.api.pavr_optimizer` if present, so it can cooperate with Optimizer without taking a hard dependency.
- `skiller-optimized` exports an event bus, cache, constants, and helper events through `api(...)`.
- `mod-profiler` instruments existing and future mod contexts, resource loaders, lifecycle registrations, and exported API endpoints.

## Performance Behaviours

Useful tactics from the optimized mods:

- Throttle visual updates. `offline-processing-plus` updates its own metrics around once per second but lets the vanilla progress UI update more frequently.
- Cache by stable keys. `optimizer` normalizes selector strings and stores `querySelectorAll` results with adaptive TTLs; `tinsin-recipe-preview-optimized` snapshots bank quantities by media filename key.
- Invalidate caches from game events instead of polling everything. `skiller-optimized` listens for bank item changes, skill level/mastery changes, and food events to mark only affected caches dirty.
- Restrict DOM work to visible or changed nodes. `tinsin-recipe-preview-optimized` combines `MutationObserver`, `IntersectionObserver`, a visible set, and an inventory hash so it only re-renders visible recipes when inputs changed.
- Keep hot hook work small. `skiller-optimized` does selection decisions after `postAction`, but pushes expensive eligibility and sorted-list work into cached helpers.

## Cautionary Patterns

Some behaviours are useful but sharp:

- Replacing core methods can conflict with other mods. Prefer `before` or `after` unless changing the return value or suppressing the original is required.
- Patching `document.querySelectorAll`, `window.scrollTo`, or other globals can affect every mod. Store originals, gate behavior behind settings, and expose a restore path.
- Polling timers and observers should have cleanup hooks. `tinsin-recipe-preview-optimized` stores a cleanup function on its context; new mods should call similar cleanup when a feature is disabled or reinitialized.
- Hardcoded globals are brittle. `gameFileVersion-fix` is intentionally tiny, but it only works because the missing global has a known safe fallback.
- Prototype flags prevent duplicate patching by one mod, but they do not coordinate across mods. Use `ctx.isPatched` or clear console warnings when cross-mod conflict detection matters.

## Search Keywords

Use this note for questions about `ctx.patch`, `before`, `after`, `replace`, `onCharacterLoaded`, `onInterfaceReady`, `OfflineLoadingElement`, `OfflineProgressElement`, `loadingOfflineProgress`, `offlineLoopEntered`, `offlineLoopExited`, `querySelectorAll`, `ui.create`, `templates.html`, `PetiteVue`, `MutationObserver`, `IntersectionObserver`, `ctx.characterStorage`, `settings.section`, and `ctx.api`.
