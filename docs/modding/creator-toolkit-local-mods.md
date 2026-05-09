# Creator Toolkit Local Mods

Sources checked:

- Official guide: https://wiki.melvoridle.com/w/Mod_Creation/Creator_Toolkit
- Game source: `game-source/web/melvoridle.com/assets/js/built/mod.js`
- Creator Toolkit export: `mod-sources/2419237-Creator-Toolkit/setup.mjs`

## Load Order

Creator Toolkit local mods load after Creator Toolkit itself and before regular Mod Manager mods. Local mods are sorted by `loadPriority`, and records with `disabled: true` are skipped.

## Stored Shape

Creator Toolkit stores local mods in browser IndexedDB:

- database: `melvordb`
- store: `localMods`
- key: auto-incremented `id`

Each record follows this shape:

```json
{
  "id": 1,
  "name": "Display Name",
  "mod": {},
  "dir": "",
  "package": {},
  "released": false,
  "loadPriority": 0,
  "disabled": false
}
```

The `mod` object is the parsed Mod Manager mod object. The `package` field is the zip `File` used by Creator Toolkit for quick update and release flows.

## Linked Mod.io Mods

If a local mod is linked to an existing mod.io mod, the local mod should use the mod.io id and metadata. Creator Toolkit parses linked local packages with mod.io metadata and a local placeholder modfile version of `0.0.0`.

This matters because:

- A linked local mod prevents the installed mod.io version from loading at the same time.
- `characterStorage`, `accountStorage`, and settings persistence only work correctly for a local mod when it is linked to mod.io and the user has subscribed to and installed that mod through mod.io.
- Creator Toolkit loads a local mod with `mod.id` when `mod.id >= 2240240`; otherwise it falls back to the local IndexedDB record id. That means unlinked local mods get local-only ids, while linked mods keep their stable mod.io ids.

When an MCP tool adds a linked local mod, it should fetch the mod.io record and default the display name to the mod.io name unless the caller supplies an explicit local name.

## Local Storage Guard

Creator Toolkit uses localStorage key `mct_i--loading-mod` as a crash guard while loading local mods. It writes the current local mod record id before loading and removes the key after all local mods finish loading.

If the game crashes or navigation is interrupted while the key remains, Creator Toolkit treats that as a previous fatal local mod load failure. On the next startup it disables that local mod and shows a warning.

MCP tools that test local mod loading should report this key when present and should clean up test local mods after verification.

## Directory Link

Directory Link mode is only available in the Steam client. It zips the linked directory each reload. Browser automation can package a directory once and store the `dir` metadata, but it cannot provide Steam's live directory re-zipping behavior.

Creator Toolkit supports `.modignore` in the linked directory root. The file is plain text, one rule per line, and supports `*` wildcards. The `.modignore` file itself should not be packaged.
