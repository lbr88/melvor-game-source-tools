#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_VERSION = '0.1.0';
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.join(REPO_ROOT, '.env'));

const DEFAULT_SOURCE_REPO = process.env.GAME_SOURCE_REPO
  || process.env.MELVOR_GAME_SOURCE_REPO
  || path.join(REPO_ROOT, 'game-source');
const DEFAULT_MODS_ROOT = process.env.MELVOR_MODS_ROOT || path.join(REPO_ROOT, 'mods');
const DEFAULT_REPORTS_DIR = process.env.MELVOR_REPORTS_DIR || path.join(REPO_ROOT, 'reports');
const DEFAULT_MOD_SOURCES_DIR = process.env.MELVOR_MOD_SOURCES_DIR || path.join(REPO_ROOT, 'mod-sources');
const DEFAULT_SAVE_FIXTURES_DIR = process.env.MELVOR_SAVE_FIXTURES_DIR || path.join(REPO_ROOT, 'save-fixtures');
const DEFAULT_MODIO_GAME_ID = process.env.MODIO_GAME_ID || '2869';
const DEFAULT_MODIO_GAME_API_BASE_URL = process.env.MODIO_GAME_API_BASE_URL || `https://g-${DEFAULT_MODIO_GAME_ID}.modapi.io/v1`;
const DEFAULT_MODIO_FILE_FIELD = process.env.MODIO_FILE_FIELD || 'filedata';
const DEFAULT_GUIDES_API_URL = process.env.MELVOR_GUIDES_API_URL || 'https://wiki.melvoridle.com/api.php';
const DEFAULT_GUIDES_BASE_URL = process.env.MELVOR_GUIDES_BASE_URL || 'https://wiki.melvoridle.com/w/';
const DEFAULT_GUIDES_PREFIX = process.env.MELVOR_GUIDES_PREFIX || 'Mod Creation';
const DEFAULT_LOCAL_GUIDES_DIR = process.env.MELVOR_LOCAL_GUIDES_DIR || path.join(REPO_ROOT, 'docs', 'modding');
const LOCAL_SOURCES = ['web', 'android-loaded'];
const DEFAULT_MELVOR_URL = 'https://melvoridle.com/index_game.php';
const MOD_PROFILE_STORAGE_KEYS = ['modProfiles', 'modLoadOrder', 'modActiveProfile', 'modPreferLatest', 'modDisabled'];
const MOD_PROFILE_OVERRIDE_STORAGE_KEY = '__mcpTemporaryModProfileOverride';
const gameSessions = new Map();

const PRESETS = [
  'classes',
  'cloud',
  'elements',
  'functions',
  'items',
  'mod-loader',
  'native',
  'offline',
  'rendering',
];

const TOOLS = [
  {
    name: 'melvor_mcp_context',
    title: 'Melvor MCP Context',
    description: 'Start here for a compact map of Melvor game internals, packaged docs, searchable topics, and which MCP tools to use for modding work.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'game_source_search',
    title: 'Search Melvor Game Source',
    description: 'Search an ignored local game-source store or an optional external/readable game-source checkout. Raw downloaded source remains the default; pass repo=game-source-readable/... when searching beautified output.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Regex or literal search pattern. Omit when preset is supplied.' },
        preset: { type: 'string', enum: PRESETS, description: 'Built-in modding-oriented regex preset.' },
        branch: { type: 'string', default: 'working', description: 'working, current, web, main, android-loaded, all, or another git ref.' },
        path: { type: 'string', default: '.', description: 'File or directory path inside the selected source.' },
        context: { type: 'integer', minimum: 0, default: 2 },
        maxLines: { type: 'integer', minimum: 0, default: 120, description: '0 means unlimited.' },
        ignoreCase: { type: 'boolean', default: false },
        filesOnly: { type: 'boolean', default: false },
        repo: { type: 'string', description: 'Override local game-source checkout path.' },
      },
    },
  },
  {
    name: 'game_source_read',
    title: 'Read Melvor Source File',
    description: 'Read a bounded line slice from an ignored local source folder or a git branch/ref.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path inside the game-source repo.' },
        branch: { type: 'string', default: 'working', description: 'working, web, main, android-loaded, or another git ref.' },
        startLine: { type: 'integer', minimum: 1, default: 1 },
        maxLines: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
        repo: { type: 'string', description: 'Override local game-source checkout path.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'game_source_manifest',
    title: 'Read Source Manifest',
    description: 'Read source-manifest.json from an ignored local source folder or a git branch/ref.',
    inputSchema: {
      type: 'object',
      properties: {
        branch: { type: 'string', default: 'working' },
        repo: { type: 'string', description: 'Override local game-source checkout path.' },
      },
    },
  },
  {
    name: 'game_source_branches',
    title: 'List Source Branches',
    description: 'List ignored local source folders and any branches/tags when the source path is git-backed.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Override local game-source checkout path.' },
      },
    },
  },
  {
    name: 'game_source_download',
    title: 'Download Game Source',
    description: 'Download desktop/web or Android-loaded source into the ignored local game-source store. This writes local files only and does not commit or push source.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['web', 'android'], default: 'web' },
        repo: { type: 'string', description: 'Local ignored source store path. Defaults to ./game-source beside the MCP server.' },
        outDir: { type: 'string', description: 'Temporary capture directory. Defaults to /tmp/melvor-game-source-<timestamp>.' },
        install: { type: 'boolean', default: true, description: 'Install the captured source into game-source/web or game-source/android-loaded.' },
        manifestOnly: { type: 'boolean', default: false },
        includeAll: { type: 'boolean', default: true },
        hashQueryFilenames: { type: 'boolean', default: false },
        maxAssets: { type: 'integer', minimum: 1, default: 500 },
        timeoutMs: { type: 'integer', minimum: 1000, default: 45000 },
        settleMs: { type: 'integer', minimum: 0, default: 3000 },
      },
    },
  },
  {
    name: 'game_source_beautify',
    title: 'Beautify Game Source',
    description: 'Create an opt-in readable copy of raw fetched source under ignored game-source-readable/. Raw fetched source is left unchanged and remains the ground-truth search target.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['web', 'android-loaded'], default: 'web' },
        sourceDir: { type: 'string', description: 'Override raw source directory.' },
        outDir: { type: 'string', description: 'Override readable output directory.' },
        check: { type: 'boolean', default: false },
        maxBytes: { type: 'integer', minimum: 1, default: 15728640 },
      },
    },
  },
  {
    name: 'melvor_modding_guides_list',
    title: 'List Melvor Modding Guides',
    description: 'Discover the packaged Melvor modding documentation index, searchable game-internals topics, recommended queries, and official wiki guide pages.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'melvor_modding_guides_read',
    title: 'Read Melvor Modding Guide',
    description: 'Read a packaged Melvor modding doc or official wiki guide. Packaged docs include the overview, source asset catalog, local mod-writing patterns, Creator Toolkit notes, browser sessions, live debugging patterns, and save-test notes.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'string', default: 'README', description: 'Guide title, for example "README", "local-mod-writing-patterns", or "Mod Creation/Essentials".' },
        section: { type: 'string', description: 'Optional packaged-doc section heading or anchor returned by guide search. Only applies to local packaged docs.' },
        format: { type: 'string', enum: ['text', 'wikitext'], default: 'text' },
        maxChars: { type: 'integer', minimum: 0, default: 30000, description: '0 means unlimited.' },
      },
    },
  },
  {
    name: 'melvor_modding_guides_search',
    title: 'Search Melvor Modding Guides',
    description: 'Search packaged Melvor modding docs plus official wiki guides. Use for game internals and mod-development questions about source architecture, mod loader, ctx.patch, lifecycle hooks, bank/UI rendering, combat/equipment, items, settings, templates, Creator Toolkit local mods, offline processing, browser sessions, live debugging, and save tests.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        regex: { type: 'boolean', default: false },
        ignoreCase: { type: 'boolean', default: true },
        format: { type: 'string', enum: ['text', 'wikitext'], default: 'text' },
        contextChars: { type: 'integer', minimum: 0, default: 240 },
        maxResults: { type: 'integer', minimum: 1, default: 20 },
        includeOfficial: { type: 'boolean', default: true, description: 'Search official wiki guides after packaged docs if more results are needed.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'mod_manager_loaded_mods',
    title: 'List Loaded Mod Manager Mods',
    description: 'Open Melvor with Playwright, use .env login when provided, and report installed/loaded Mod Manager mods.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', default: 'https://melvoridle.com/index_game.php' },
        includeDisabled: { type: 'boolean', default: false },
        timeoutMs: { type: 'integer', minimum: 1000, default: 90000 },
        waitMs: { type: 'integer', minimum: 0, default: 10000 },
        headful: { type: 'boolean', default: false },
        modioRecovery: { type: 'string', enum: ['local', 'reload', 'fail'], default: 'local', description: 'How to handle Melvor mod.io unreachable prompts during browser tests.' },
        screenshot: { type: 'boolean', default: true, description: 'Save a Playwright page screenshot and JSON report.' },
        reportDir: { type: 'string', description: 'Output directory for screenshots and JSON reports. Defaults to ignored reports/.' },
        storageState: { type: 'string', description: 'Optional Playwright storage state file to reuse/save login.' },
      },
    },
  },
  {
    name: 'mod_manager_fetch_sources',
    title: 'Fetch Loaded Mod Sources',
    description: 'Export installed Mod Manager mod resources from browser IndexedDB into ignored local mod-sources/ folders.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', default: 'https://melvoridle.com/index_game.php' },
        outDir: { type: 'string', description: 'Output directory. Defaults to ignored mod-sources/.' },
        includeDisabled: { type: 'boolean', default: false },
        timeoutMs: { type: 'integer', minimum: 1000, default: 90000 },
        waitMs: { type: 'integer', minimum: 0, default: 10000 },
        headful: { type: 'boolean', default: false },
        modioRecovery: { type: 'string', enum: ['local', 'reload', 'fail'], default: 'local', description: 'How to handle Melvor mod.io unreachable prompts during browser tests.' },
        screenshot: { type: 'boolean', default: true, description: 'Save a Playwright page screenshot and JSON report.' },
        reportDir: { type: 'string', description: 'Output directory for screenshots and JSON reports. Defaults to ignored reports/.' },
        storageState: { type: 'string', description: 'Optional Playwright storage state file to reuse/save login.' },
      },
    },
  },
  {
    name: 'mod_source_search',
    title: 'Search Fetched Mod Sources',
    description: 'Search locally fetched installed Mod Manager mod source folders under ignored mod-sources/. Run mod_manager_fetch_sources first to refresh the local installed-mod corpus.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Regex or literal search pattern.' },
        regex: { type: 'boolean', default: false },
        ignoreCase: { type: 'boolean', default: true },
        modId: { type: 'integer', minimum: 1, description: 'Optional installed mod.io id filter.' },
        modName: { type: 'string', description: 'Optional case-insensitive substring filter for fetched mod folder or metadata name.' },
        path: { type: 'string', default: '.', description: 'Optional path inside each selected mod folder.' },
        maxResults: { type: 'integer', minimum: 1, default: 100 },
        context: { type: 'integer', minimum: 0, default: 0 },
        outDir: { type: 'string', description: 'Fetched mod source directory. Defaults to ignored mod-sources/.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'mod_source_read',
    title: 'Read Fetched Mod Source File',
    description: 'Read a bounded line slice from a locally fetched installed Mod Manager mod source folder.',
    inputSchema: {
      type: 'object',
      properties: {
        modId: { type: 'integer', minimum: 1, description: 'Installed mod.io id of the fetched mod.' },
        modName: { type: 'string', description: 'Case-insensitive substring filter for fetched mod folder or metadata name.' },
        path: { type: 'string', description: 'File path inside the selected fetched mod folder.' },
        startLine: { type: 'integer', minimum: 1, default: 1 },
        maxLines: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
        outDir: { type: 'string', description: 'Fetched mod source directory. Defaults to ignored mod-sources/.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'mod_manager_configure_mod',
    title: 'Configure Mod Manager Mod',
    description: 'Dry-run or persist Mod Manager profile membership and live/latest version preference for an installed mod. Enable/add and disable/remove operate on the selected profile, not mod.io subscriptions.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['enable', 'disable', 'add_to_profile', 'remove_from_profile', 'prefer_latest', 'prefer_live'],
          description: 'Profile operations require the mod to already be installed. Version operations persist the live/latest preference.',
        },
        modId: { type: 'integer', minimum: 1, description: 'Mod.io id of the installed mod.' },
        profileId: { type: 'string', description: 'Optional Mod Manager profile id. Defaults to the active profile.' },
        apply: { type: 'boolean', default: false, description: 'Persist the change. Defaults to dry-run.' },
        persist: { type: 'boolean', default: true, description: 'Persist to PlayFab account data when available. False updates browser localStorage only.' },
        url: { type: 'string', default: 'https://melvoridle.com/index_game.php' },
        timeoutMs: { type: 'integer', minimum: 1000, default: 90000 },
        waitMs: { type: 'integer', minimum: 0, default: 10000 },
        headful: { type: 'boolean', default: false },
        modioRecovery: { type: 'string', enum: ['local', 'reload', 'fail'], default: 'local', description: 'How to handle Melvor mod.io unreachable prompts during browser tests.' },
        screenshot: { type: 'boolean', default: true, description: 'Save a Playwright page screenshot and JSON report.' },
        reportDir: { type: 'string', description: 'Output directory for screenshots and JSON reports. Defaults to ignored reports/.' },
        storageState: { type: 'string', description: 'Optional Playwright storage state file to reuse/save login.' },
      },
      required: ['operation', 'modId'],
    },
  },
  {
    name: 'game_session_mod_profile',
    title: 'Temporarily Configure Live Session Mods',
    description: 'Snapshot, temporarily replace, reload, and restore the active Mod Manager profile in an existing live game session for isolated or interaction-set profiling. Applies to the browser session only and guards PlayFab mod-profile writes while temporary overrides are active.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        operation: {
          type: 'string',
          enum: ['status', 'snapshot', 'load_only', 'load_with_dependencies', 'load_set', 'restore'],
          default: 'status',
          description: 'status reads current Mod Manager state; snapshot stores current profile keys; load_only/load_with_dependencies/load_set replace the active profile; restore restores a stored snapshot.',
        },
        modId: { type: 'integer', minimum: 1, description: 'Primary installed mod.io id for load_only or load_with_dependencies.' },
        modIds: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          description: 'Installed mod.io ids for load_set. Order is used as the requested root order before dependency expansion.',
        },
        additionalModIds: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          description: 'Extra installed mod.io ids to include with the primary mod for interaction profiling.',
        },
        includeDependencies: { type: 'boolean', default: true, description: 'For load_set, include transitive installed dependencies. load_with_dependencies always includes them; load_only does not.' },
        allowUnresolvedDependencies: { type: 'boolean', default: false, description: 'Allow applying when a dependency id is declared but not installed.' },
        snapshotKey: { type: 'string', default: 'default', description: 'Named in-memory snapshot for this live session.' },
        apply: { type: 'boolean', default: false, description: 'Actually change the live browser session. False returns the plan only.' },
        reload: { type: 'boolean', default: true, description: 'Reload the game after applying or restoring so Mod Manager loads the selected set.' },
        loadSave: { type: 'boolean', description: 'After reload, load the configured save. Defaults to the session loadSave option.' },
        timeoutMs: { type: 'integer', minimum: 1000, default: 90000 },
        waitMs: { type: 'integer', minimum: 0, default: 10000 },
        allowDuringProfile: { type: 'boolean', default: false, description: 'Allow mod profile changes while game_profile_start is active. Default blocks this because reload invalidates the profile window.' },
      },
    },
  },
  {
    name: 'creator_toolkit_local_mods',
    title: 'Manage Creator Toolkit Local Mods',
    description: 'List, add, remove, enable, or disable Creator Toolkit local mods through the browser IndexedDB localMods store. Mutations are dry-run unless apply is true.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['list', 'add', 'remove', 'enable', 'disable', 'verify_load'], default: 'list' },
        modPath: { type: 'string', description: 'Local mod directory containing manifest.json, or a .zip modfile, for operation=add.' },
        name: { type: 'string', description: 'Optional Creator Toolkit display name for operation=add.' },
        localModId: { type: 'integer', minimum: 1, description: 'Creator Toolkit localMods IndexedDB id for enable/disable/remove or targeted replacement.' },
        linkedModId: { type: 'integer', minimum: 1, description: 'Optional mod.io id to link the local mod to.' },
        directoryPath: { type: 'string', description: 'Optional directory-link path to preserve in Creator Toolkit metadata. Browser automation packages the directory once; Steam does live directory re-zipping.' },
        disabled: { type: 'boolean', default: false, description: 'When adding, store the local mod disabled.' },
        replace: { type: 'boolean', default: false, description: 'When adding, replace an existing local mod with the same namespace, linked mod id, or name.' },
        cleanup: { type: 'boolean', default: true, description: 'For operation=verify_load, remove the temporary local mod after verification.' },
        apply: { type: 'boolean', default: false, description: 'Persist the change. Defaults to dry-run.' },
        url: { type: 'string', default: 'https://melvoridle.com/index_game.php' },
        timeoutMs: { type: 'integer', minimum: 1000, default: 90000 },
        waitMs: { type: 'integer', minimum: 0, default: 10000 },
        headful: { type: 'boolean', default: false },
        modioRecovery: { type: 'string', enum: ['local', 'reload', 'fail'], default: 'local', description: 'How to handle Melvor mod.io unreachable prompts during browser tests.' },
        screenshot: { type: 'boolean', default: true, description: 'Save a Playwright page screenshot and JSON report.' },
        reportDir: { type: 'string', description: 'Output directory for screenshots and JSON reports. Defaults to ignored reports/.' },
        storageState: { type: 'string', description: 'Optional Playwright storage state file to reuse/save login.' },
      },
    },
  },
  {
    name: 'game_session_local_mod',
    title: 'Install Temporary Creator Toolkit Local Mod In Live Session',
    description: 'Use the installed Creator Toolkit in an existing live session to install, reload, verify, and remove temporary local mods for save setup, profiling probes, and runtime debugging. Mutations are dry-run unless apply=true.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        operation: {
          type: 'string',
          enum: ['status', 'install_generated', 'install_path', 'remove', 'cleanup'],
          default: 'status',
        },
        name: { type: 'string', default: 'MCP Local Probe', description: 'Display name for generated or installed local mod.' },
        namespace: { type: 'string', description: 'Namespace for generated local mod. Defaults to a safe mcp_* namespace.' },
        setupScript: { type: 'string', description: 'JavaScript body to run inside export function setup(ctx) for install_generated.' },
        moduleScript: { type: 'string', description: 'Full setup.mjs module text for install_generated. If omitted, setupScript is wrapped in export function setup(ctx).' },
        manifestJson: { type: 'string', description: 'Optional manifest.json text for install_generated. Defaults to name/namespace/setup.mjs.' },
        modPath: { type: 'string', description: 'Local mod directory containing manifest.json, or a .zip modfile, for install_path.' },
        linkedModId: { type: 'integer', minimum: 1, description: 'Optional installed mod.io id to assign to the temporary local mod.' },
        localModId: { type: 'integer', minimum: 1, description: 'Creator Toolkit localMods IndexedDB id for remove or targeted replacement.' },
        replace: { type: 'boolean', default: true, description: 'Replace an existing local mod with the same namespace, linked mod id, or display name.' },
        disabled: { type: 'boolean', default: false, description: 'Install the local mod disabled.' },
        directoryPath: { type: 'string', description: 'Optional directory-link path metadata to preserve on the local mod record.' },
        apply: { type: 'boolean', default: false, description: 'Actually write the Creator Toolkit localMods record or remove one. False returns the plan only.' },
        reload: { type: 'boolean', default: true, description: 'Reload after install/remove so Creator Toolkit applies the local mod set.' },
        loadSave: { type: 'boolean', description: 'After reload, load the configured save. Defaults to the session loadSave option.' },
        verify: { type: 'boolean', default: true, description: 'After reload, verify by loaded mod name, namespace context, or generated marker.' },
        timeoutMs: { type: 'integer', minimum: 1000, default: 90000 },
        waitMs: { type: 'integer', minimum: 0, default: 10000 },
        allowDuringProfile: { type: 'boolean', default: false, description: 'Allow local mod changes while game_profile_start is active. Default blocks this because reload invalidates the profile window.' },
      },
    },
  },
  {
    name: 'melvor_mod_release_status',
    title: 'Check Melvor Mod Release Status',
    description: 'Read local mod manifests, policy mapping, git state, and current mod.io records before a release. This is read-only and does not upload.',
    inputSchema: {
      type: 'object',
      properties: {
        mod: { type: 'string', description: 'Optional local mod folder name. Omit to inspect all mapped mods.' },
        workspaceRoot: { type: 'string', description: 'Workspace root containing mods/ and config/modio-matches.json.' },
        modsRoot: { type: 'string', description: 'Override mods directory.' },
        mappingFile: { type: 'string', description: 'Override mod.io policy mapping file.' },
        envFile: { type: 'string', description: 'Optional .env file containing MODIO_API_KEY and release credentials.' },
        apiBase: { type: 'string', description: 'mod.io game API base URL. Defaults to Melvor production game API.' },
        gameId: { type: 'string', default: '2869' },
        refreshModio: { type: 'boolean', default: true, description: 'Fetch current mod.io records with MODIO_API_KEY when available.' },
        includeReferenceOnly: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'melvor_mod_release_package',
    title: 'Package Melvor Mod Release',
    description: 'Create or plan a versioned release zip for a local Melvor mod. Reference-only mods are blocked.',
    inputSchema: {
      type: 'object',
      properties: {
        mod: { type: 'string', description: 'Local mod folder name.' },
        workspaceRoot: { type: 'string', description: 'Workspace root containing mods/.' },
        modsRoot: { type: 'string', description: 'Override mods directory.' },
        mappingFile: { type: 'string', description: 'Override mod.io policy mapping file.' },
        envFile: { type: 'string', description: 'Optional .env file.' },
        outDir: { type: 'string', description: 'Release output directory. Defaults to <workspace>/releases/<mod>.' },
        build: { type: 'boolean', default: true, description: 'When false, only report the expected zip path.' },
        refreshModio: { type: 'boolean', default: true },
      },
      required: ['mod'],
    },
  },
  {
    name: 'melvor_modio_upload',
    title: 'Upload Melvor Modfile To mod.io',
    description: 'Upload a release zip to mod.io using OAuth credentials. Dry-run by default; requires apply=true and an exact confirmation phrase.',
    inputSchema: {
      type: 'object',
      properties: {
        mod: { type: 'string', description: 'Local mod folder name.' },
        workspaceRoot: { type: 'string', description: 'Workspace root containing mods/ and config/modio-matches.json.' },
        modsRoot: { type: 'string', description: 'Override mods directory.' },
        mappingFile: { type: 'string', description: 'Override mod.io policy mapping file.' },
        envFile: { type: 'string', description: 'Optional .env file containing MODIO_ACCESS_TOKEN.' },
        apiBase: { type: 'string', description: 'mod.io game API base URL. Defaults to Melvor production game API.' },
        gameId: { type: 'string', default: '2869' },
        zipPath: { type: 'string', description: 'Existing release zip. Defaults to <workspace>/releases/<mod>/<mod>-<version>.zip.' },
        build: { type: 'boolean', default: false, description: 'Build the release zip before upload.' },
        changelog: { type: 'string', description: 'Optional mod.io changelog text.' },
        metadataBlob: { type: 'string', description: 'Optional mod.io metadata_blob field.' },
        active: { type: 'boolean', description: 'Optional mod.io active flag.' },
        fileField: { type: 'string', default: 'filedata', description: 'Multipart file field name. Defaults to mod.io filedata.' },
        apply: { type: 'boolean', default: false, description: 'Actually upload. False returns the plan only.' },
        confirm: { type: 'string', description: 'Must exactly match the required confirmation phrase when apply=true.' },
        refreshModio: { type: 'boolean', default: true },
      },
      required: ['mod'],
    },
  },
  {
    name: 'mod_test_browser_check',
    title: 'Check Mod Browser Automation',
    description: 'Launch Chromium through Playwright and report whether browser automation is usable.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'game_save_test',
    title: 'Load And Test A Melvor Save',
    description: 'Open Melvor with Playwright, log in with .env credentials, load a configured save slot, optionally perform a small browser action, and save screenshot/report artifacts. Save writes are blocked by default.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', default: 'https://melvoridle.com/index_game.php' },
        saveSlot: { type: 'integer', minimum: 0, description: 'Save slot to load. Defaults to MELVOR_TEST_CHARACTER_SLOT from .env.' },
        saveSource: { type: 'string', enum: ['cloud', 'local'], default: 'cloud' },
        gameAction: { type: 'string', enum: ['snapshot', 'wait', 'click_selector', 'open_page'], default: 'snapshot' },
        actionSelector: { type: 'string', description: 'CSS selector for gameAction=click_selector.' },
        actionPage: { type: 'string', description: 'Melvor page id for gameAction=open_page, for example melvorD:Woodcutting.' },
        readOnly: { type: 'boolean', default: true, description: 'Block obvious local/cloud save writes while the test runs.' },
        durationMs: { type: 'integer', minimum: 0, default: 5000 },
        timeoutMs: { type: 'integer', minimum: 1000, default: 90000 },
        waitMs: { type: 'integer', minimum: 0, default: 10000 },
        headful: { type: 'boolean', default: false },
        modioRecovery: { type: 'string', enum: ['local', 'reload', 'fail'], default: 'local', description: 'How to handle Melvor mod.io unreachable prompts during browser tests.' },
        screenshot: { type: 'boolean', default: true, description: 'Save a Playwright page screenshot and JSON report.' },
        reportDir: { type: 'string', description: 'Output directory for screenshots and JSON reports. Defaults to ignored reports/.' },
        storageState: { type: 'string', description: 'Optional Playwright storage state file to reuse/save login.' },
      },
    },
  },
  {
    name: 'game_session_start',
    title: 'Start Persistent Melvor Game Session',
    description: 'Launch a visible Playwright-controlled Melvor browser session, log in, optionally load a configured save, and keep the browser open for later MCP actions.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        replace: { type: 'boolean', default: false, description: 'Close and replace an existing session with the same id.' },
        url: { type: 'string', default: 'https://melvoridle.com/index_game.php' },
        saveSlot: { type: 'integer', minimum: 0, description: 'Save slot to load. Defaults to MELVOR_TEST_CHARACTER_SLOT from .env.' },
        saveSource: { type: 'string', enum: ['cloud', 'local'], default: 'cloud' },
        loadSave: { type: 'boolean', default: true, description: 'Load the configured save after Mod Manager is ready.' },
        readOnly: { type: 'boolean', default: true, description: 'Block obvious local/cloud save writes while the session runs.' },
        headful: { type: 'boolean', default: true, description: 'Show Chromium so the user can watch and direct testing.' },
        timeoutMs: { type: 'integer', minimum: 1000, default: 90000 },
        waitMs: { type: 'integer', minimum: 0, default: 10000 },
        modioRecovery: { type: 'string', enum: ['local', 'reload', 'fail'], default: 'local' },
        storageState: { type: 'string', description: 'Optional Playwright storage state file to reuse/save login.' },
      },
    },
  },
  {
    name: 'game_session_action',
    title: 'Interact With Persistent Game Session',
    description: 'Run an action against a live Melvor browser session without closing it.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        action: { type: 'string', enum: ['wait', 'click_selector', 'fill_selector', 'press', 'open_page', 'evaluate', 'dismiss_modals'] },
        selector: { type: 'string', description: 'CSS selector for click_selector, fill_selector, or press.' },
        text: { type: 'string', description: 'Text for fill_selector.' },
        key: { type: 'string', description: 'Keyboard key for press.' },
        pageId: { type: 'string', description: 'Melvor page id for open_page, for example melvorD:Woodcutting.' },
        script: { type: 'string', description: 'JavaScript expression or async function body to evaluate in the page for action=evaluate.' },
        durationMs: { type: 'integer', minimum: 0, default: 1000 },
        maxClicks: { type: 'integer', minimum: 1, default: 3, description: 'Maximum SweetAlert confirm/close attempts for action=dismiss_modals.' },
        timeoutMs: { type: 'integer', minimum: 1000, default: 30000 },
      },
      required: ['action'],
    },
  },
  {
    name: 'game_session_state',
    title: 'Read Persistent Game Session State',
    description: 'Inspect a live Melvor browser session, including loaded save, loaded mods, Optimizer state, blocked save writes, and recent browser events.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        maxBrowserEvents: { type: 'integer', minimum: 0, default: 50 },
      },
    },
  },
  {
    name: 'game_session_save',
    title: 'Manage Live Session Save Fixtures',
    description: 'Inspect local/cloud save slots, export named ignored save fixtures, import fixtures into local test slots, and load slot or fixture saves in an existing live session. Fixture writes and local slot writes are dry-run unless apply=true.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        operation: {
          type: 'string',
          enum: ['status', 'list_slots', 'list_fixtures', 'export_slot', 'export_current', 'write_fixture', 'import_fixture', 'load_slot', 'load_fixture'],
          default: 'status',
        },
        fixture: { type: 'string', description: 'Named save fixture. Stored as <fixture>.json under ignored save-fixtures/.' },
        saveDir: { type: 'string', description: 'Directory for ignored save fixtures. Defaults to save-fixtures/.' },
        saveSource: { type: 'string', enum: ['cloud', 'local'], default: 'local' },
        saveSlot: { type: 'integer', minimum: 0, description: 'Source slot for export_slot or load_slot. Defaults to MELVOR_TEST_CHARACTER_SLOT when configured.' },
        targetSlot: { type: 'integer', minimum: 0, description: 'Local slot to write when importing or loading a fixture.' },
        saveString: { type: 'string', description: 'Raw Melvor exported save string for write_fixture. The tool validates it and never echoes it back.' },
        notes: { type: 'string', description: 'Optional notes stored with exported/written fixture metadata.' },
        overwriteLocalSlot: { type: 'boolean', default: false, description: 'Allow import_fixture/load_fixture to overwrite a non-empty local save slot.' },
        apply: { type: 'boolean', default: false, description: 'Actually write fixture files or local test slots. False returns the plan only.' },
        loadAfterImport: { type: 'boolean', default: false, description: 'After import_fixture, reload and load the target local slot.' },
        reload: { type: 'boolean', default: true, description: 'Reload before loading a slot or fixture so character selection globals are fresh.' },
        timeoutMs: { type: 'integer', minimum: 1000, default: 90000 },
        waitMs: { type: 'integer', minimum: 0, default: 10000 },
      },
    },
  },
  {
    name: 'game_session_debug_probe',
    title: 'Probe Live Game Debug State',
    description: 'Read reusable live-session diagnostics: modal state, active game state, selected global symbols, and CSS selector samples. Use this before writing ad hoc evaluate scripts.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        globalNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Global symbol names to inspect as both bare globals and globalThis properties.',
        },
        selectors: {
          type: 'array',
          items: { type: 'string' },
          description: 'CSS selectors to count and sample.',
        },
        maxItems: { type: 'integer', minimum: 0, default: 5, description: 'Maximum array/object keys or selector elements to sample. 0 means unlimited.' },
        maxText: { type: 'integer', minimum: 0, default: 160, description: 'Maximum text/HTML characters per sample. 0 means unlimited.' },
      },
    },
  },
  {
    name: 'game_session_time_skip',
    title: 'Trigger Offline Processing In Live Session',
    description: 'Simulate offline time in an existing Melvor browser session using the game.testForOffline(hours) hook used by Time Skip-style testing. Use with readOnly sessions to exercise offline-processing mods without persisting saves.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        hours: { type: 'number', minimum: 0, default: 1, description: 'Offline time to simulate in hours. Fractions are allowed, e.g. 0.25 for 15 minutes.' },
        maxHours: { type: 'number', minimum: 0, default: 24, description: 'Safety cap for hours. Increase explicitly for longer offline simulations.' },
        waitForExit: { type: 'boolean', default: true, description: 'Wait for offlineLoopExited before returning, or return after triggering offline processing.' },
        requireActiveAction: { type: 'boolean', default: true, description: 'Fail if no skill/combat action is active. This matches the useful Time Skip test case.' },
        allowCombatWithoutOfflineSetting: { type: 'boolean', default: false, description: 'Allow combat/thieving skips when offline combat is disabled. Defaults to false because the game may stop those actions.' },
        dismissModals: { type: 'boolean', default: false, description: 'Click the SweetAlert confirm button after offline processing completes if a result modal is open.' },
        timeoutMs: { type: 'integer', minimum: 1000, default: 120000 },
      },
    },
  },
  {
    name: 'game_session_screenshot',
    title: 'Screenshot Persistent Game Session',
    description: 'Capture a screenshot/report for a live Melvor browser session without closing it.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        reportDir: { type: 'string', description: 'Output directory for screenshots/reports. Defaults to ignored reports/.' },
        fullPage: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'game_session_stop',
    title: 'Stop Persistent Game Session',
    description: 'Close a live Melvor browser session. If profiling is active, stop it and write its trace first.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
      },
    },
  },
  {
    name: 'game_profile_start',
    title: 'Start Live Game Profiling',
    description: 'Start Playwright tracing, CDP browser CPU profiling, Chrome performance metrics, and in-page performance collection on an existing persistent Melvor game session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        label: { type: 'string', default: 'profile' },
        trace: { type: 'boolean', default: true },
        cpuProfile: { type: 'boolean', default: true, description: 'Capture a Chrome DevTools Protocol JavaScript CPU profile until game_profile_stop.' },
        browserMetrics: { type: 'boolean', default: true, description: 'Capture Chrome Performance.getMetrics counters and heap usage at start/read/stop.' },
        samplingIntervalMicros: { type: 'integer', minimum: 100, default: 1000, description: 'CDP CPU profiler sampling interval in microseconds.' },
        screenshots: { type: 'boolean', default: true },
        snapshots: { type: 'boolean', default: true },
        sources: { type: 'boolean', default: true },
        instrumentQuerySelectorAll: { type: 'boolean', default: false, description: 'Wrap the current querySelectorAll to count and time calls until profiling stops.' },
      },
    },
  },
  {
    name: 'game_profile_read',
    title: 'Read Live Game Profiling Data',
    description: 'Read current in-page counters, Chrome performance metric deltas, heap usage, long tasks, Optimizer state, and browser events from an active or recently stopped profile.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        maxLongTasks: { type: 'integer', minimum: 0, default: 50 },
        maxBrowserEvents: { type: 'integer', minimum: 0, default: 50 },
      },
    },
  },
  {
    name: 'game_profile_mark',
    title: 'Mark Live Game Profile',
    description: 'Add a named performance mark to an active live game profile so browser traces and profile reports can be segmented by scenario step.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        label: { type: 'string', description: 'Short marker label, for example before-sort or after-offline-loop.' },
        detail: { type: 'string', description: 'Optional short context string to store in the profile report.' },
      },
    },
  },
  {
    name: 'game_profile_stop',
    title: 'Stop Live Game Profiling',
    description: 'Stop profiling on an existing persistent game session, write trace/report artifacts plus a .cpuprofile when enabled, and keep the browser open.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        reportDir: { type: 'string', description: 'Output directory for trace/report artifacts. Defaults to ignored reports/.' },
        maxLongTasks: { type: 'integer', minimum: 0, default: 50 },
        maxBrowserEvents: { type: 'integer', minimum: 0, default: 50 },
        maxCpuFunctions: { type: 'integer', minimum: 0, default: 25, description: 'Number of top self-time functions to include in the CPU profile summary. 0 means all.' },
      },
    },
  },
  {
    name: 'mod_test_smoke',
    title: 'Smoke-Test Melvor Mod',
    description: 'Open a local or remote Melvor URL with Playwright, optionally inject mod files, collect console/page errors, and save a screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', default: 'https://melvoridle.com/index_game.php' },
        modPath: { type: 'string', description: 'Path to a mod folder or single JS file to inject after DOMContentLoaded.' },
        timeoutMs: { type: 'integer', minimum: 1000, default: 45000 },
        waitMs: { type: 'integer', minimum: 0, default: 5000 },
        reportDir: { type: 'string', description: 'Output directory for screenshot and JSON report. Defaults to ignored reports/.' },
      },
    },
  },
  {
    name: 'mod_profile_runtime',
    title: 'Profile Melvor Mod Runtime',
    description: 'Run a Playwright session with Chromium tracing enabled, optionally inject a mod, and write an ignored profiling artifact.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', default: 'https://melvoridle.com/index_game.php' },
        modPath: { type: 'string', description: 'Path to a mod folder or single JS file to inject after DOMContentLoaded.' },
        durationMs: { type: 'integer', minimum: 1000, default: 15000 },
        timeoutMs: { type: 'integer', minimum: 1000, default: 45000 },
        reportDir: { type: 'string', description: 'Output directory for trace and JSON report. Defaults to ignored reports/.' },
      },
    },
  },
];

function textContent(text) {
  return {
    content: [{ type: 'text', text }],
    isError: false,
  };
}

function errorContent(error) {
  return {
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

function resolveRepo(repo) {
  return path.resolve(repo || DEFAULT_SOURCE_REPO);
}

function assertSafeRelativePath(value) {
  if (!value || path.isAbsolute(value) || value.split(/[\\/]+/).includes('..')) {
    throw new Error(`Unsafe repo-relative path: ${value || '(empty)'}`);
  }
  return value.replace(/\\/g, '/');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(stderr || stdout || `${command} exited with status ${result.status}`);
  }
  return result.stdout.replace(/\n$/, '');
}

function runAllowNoMatches(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(stderr || stdout || `${command} exited with status ${result.status}`);
  }
  return result.stdout.replace(/\n$/, '');
}

function numeric(value, fallback, min, max = Number.POSITIVE_INFINITY) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Expected integer between ${min} and ${max}`);
  }
  return parsed;
}

function numericFloat(value, fallback, min, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Expected number between ${min} and ${max}`);
  }
  return parsed;
}

function uniqueIntegerIds(values = []) {
  const seen = new Set();
  const ids = [];
  for (const value of values || []) {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}


function resolveReleaseContext(args = {}) {
  const configuredModsRoot = args.modsRoot || process.env.MELVOR_MODS_ROOT || '';
  const workspaceRoot = path.resolve(
    args.workspaceRoot
      || process.env.MELVOR_WORKSPACE_ROOT
      || (configuredModsRoot ? path.dirname(path.resolve(configuredModsRoot)) : REPO_ROOT)
  );
  const envFileCandidate = args.envFile || process.env.MELVOR_MODIO_ENV_FILE || path.join(workspaceRoot, '.env');
  const envFile = envFileCandidate ? path.resolve(envFileCandidate) : null;
  if (envFile && fs.existsSync(envFile)) loadDotEnv(envFile);

  const modsRoot = path.resolve(args.modsRoot || process.env.MELVOR_MODS_ROOT || path.join(workspaceRoot, 'mods'));
  const mappingFile = path.resolve(
    args.mappingFile || process.env.MELVOR_MODIO_MAPPING_FILE || path.join(workspaceRoot, 'config', 'modio-matches.json')
  );
  const gameId = String(args.gameId || process.env.MODIO_GAME_ID || DEFAULT_MODIO_GAME_ID);
  const apiBase = String(
    args.apiBase
      || process.env.MODIO_API_BASE_URL
      || process.env.MODIO_GAME_API_BASE_URL
      || DEFAULT_MODIO_GAME_API_BASE_URL
  ).replace(/\/+$/, '');

  return {
    workspaceRoot,
    modsRoot,
    mappingFile,
    envFile: envFile && fs.existsSync(envFile) ? envFile : null,
    gameId,
    apiBase,
    apiKey: process.env.MODIO_API_KEY || '',
    accessToken: process.env.MODIO_ACCESS_TOKEN || '',
  };
}

async function readJsonFile(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

async function readJsonFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return await readJsonFile(filePath);
}

function mappingEntry(mapping, mod) {
  return (mapping?.mods || []).find((entry) => entry.local_folder === mod) || null;
}

async function releaseModNames(context, mapping, args = {}) {
  if (args.mod) return [String(args.mod)];
  const includeReferenceOnly = args.includeReferenceOnly !== false;
  const names = new Set();
  for (const entry of mapping?.mods || []) {
    if (!includeReferenceOnly && entry.automation?.role === 'reference_only') continue;
    if (entry.local_folder) names.add(entry.local_folder);
  }

  if (names.size === 0 && fs.existsSync(context.modsRoot)) {
    const entries = await fsp.readdir(context.modsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && fs.existsSync(path.join(context.modsRoot, entry.name, 'manifest.json'))) {
        names.add(entry.name);
      }
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

function compareVersions(a, b) {
  const left = String(a || '').split(/[+-]/)[0].split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b || '').split(/[+-]/)[0].split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return String(a || '').localeCompare(String(b || ''));
}

function versionRelation(localVersion, remoteVersion) {
  if (!localVersion || !remoteVersion) return 'unknown';
  const compared = compareVersions(localVersion, remoteVersion);
  if (compared > 0) return 'local_ahead';
  if (compared < 0) return 'local_behind';
  return 'equal';
}

function gitSummary(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return { isRepo: false };
  try {
    return {
      isRepo: true,
      branch: run('git', ['-C', dir, 'branch', '--show-current']).trim() || null,
      remote: runAllowNoMatches('git', ['-C', dir, 'remote', 'get-url', 'origin']).trim() || null,
      dirty: Boolean(runAllowNoMatches('git', ['-C', dir, 'status', '--porcelain']).trim()),
      head: run('git', ['-C', dir, 'rev-parse', '--short', 'HEAD']).trim(),
    };
  } catch (error) {
    return { isRepo: true, error: error.message };
  }
}

function modioApiUrl(context, endpoint, params = {}) {
  const url = endpoint.startsWith('http')
    ? new URL(endpoint)
    : new URL(`${context.apiBase}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

function modioErrorMessage(payload) {
  return payload?.error?.message || payload?.message || JSON.stringify(payload);
}

async function modioJson(context, endpoint, params = {}) {
  if (!context.apiKey) throw new Error('MODIO_API_KEY is required for read-only mod.io checks. Pass envFile or set it in the MCP environment.');
  const url = modioApiUrl(context, endpoint, { ...params, api_key: context.apiKey });
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': `melvor-game-source-tools/${SERVER_VERSION}`,
    },
  });
  const payload = await response.json().catch(async () => ({ message: await response.text() }));
  if (!response.ok) throw new Error(`mod.io API failed: ${response.status} ${modioErrorMessage(payload)}`);
  return payload;
}

async function modioJsonAuthenticated(context, endpoint, params = {}) {
  if (!context.accessToken) throw new Error('MODIO_ACCESS_TOKEN is required for authenticated mod.io checks. Pass envFile or set it in the MCP environment.');
  const url = modioApiUrl(context, endpoint, params);
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${context.accessToken}`,
      'user-agent': `melvor-game-source-tools/${SERVER_VERSION}`,
    },
  });
  const payload = await response.json().catch(async () => ({ message: await response.text() }));
  if (!response.ok) throw new Error(`mod.io authenticated API failed: ${response.status} ${modioErrorMessage(payload)}`);
  return payload;
}

function isOwnedUploadRole(role) {
  return typeof role === 'string' && role.startsWith('owned_');
}

function roleNeedsAuthenticatedModioRead(role) {
  return /hidden|private|draft/i.test(String(role || ''));
}

function isoFromModioTimestamp(value) {
  try {
    if (!value) return null;
    if (value instanceof Date) {
      const time = value.getTime();
      return Number.isFinite(time) ? value.toISOString() : null;
    }

    if (typeof value === 'number' || /^[0-9]+$/.test(String(value))) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return null;
      const milliseconds = numeric > 9999999999 ? numeric : numeric * 1000;
      const date = new Date(milliseconds);
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }

    const date = new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  catch {
    return null;
  }
}

function sanitizeModioRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name || null,
    name_id: record.name_id || null,
    profile_url: record.profile_url || null,
    author: record.submitted_by?.username || record.submitted_by?.display_name || record.submitted_by?.id || null,
    visible: record.visible ?? null,
    status: record.status ?? null,
    tags: Array.isArray(record.tags)
      ? record.tags.map((tag) => (typeof tag === 'string' ? tag : tag?.name)).filter(Boolean)
      : [],
    date_updated: isoFromModioTimestamp(record.date_updated),
    modfile: record.modfile
      ? {
          id: record.modfile.id || null,
          version: record.modfile.version || null,
          filename: record.modfile.filename || null,
          metadata_blob: record.modfile.metadata_blob || null,
          active: record.modfile.active ?? null,
          virus_status: record.modfile.virus_status ?? null,
          virus_positive: record.modfile.virus_positive ?? null,
          date_scanned: isoFromModioTimestamp(record.modfile.date_scanned),
          date_added: isoFromModioTimestamp(record.modfile.date_added),
        }
      : null,
  };
}

async function fetchModioRecord(context, modId, options = {}) {
  if (!modId) return null;
  const payload = options.authenticated
    ? await modioJsonAuthenticated(context, `/games/${context.gameId}/mods/${modId}`)
    : await modioJson(context, `/games/${context.gameId}/mods/${modId}`);
  return sanitizeModioRecord(payload);
}

async function searchModioRecords(context, query) {
  if (!query) return [];
  const payload = await modioJson(context, `/games/${context.gameId}/mods`, { _q: query, _limit: 10 });
  return (payload.data || []).map(sanitizeModioRecord);
}

async function releaseSummary(context, mapping, mod, args = {}) {
  const dir = path.join(context.modsRoot, mod);
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = await readJsonFileIfExists(manifestPath);
  const entry = mappingEntry(mapping, mod);
  const automation = entry?.automation || {};
  const configuredModio = entry?.modio || null;
  const summary = {
    mod,
    dir,
    manifestPath,
    manifest: manifest
      ? {
          name: manifest.name || null,
          namespace: manifest.namespace || null,
          version: manifest.version || null,
          description: manifest.description || null,
          setup: manifest.setup || null,
        }
      : null,
    policy: {
      role: automation.role || 'unmapped',
      update_policy: automation.update_policy || null,
      upload: automation.upload === true,
      reason: automation.reason || null,
    },
    configuredModio: configuredModio
      ? {
          id: configuredModio.id || null,
          name: configuredModio.name || null,
          name_id: configuredModio.name_id || null,
          profile_url: configuredModio.profile_url || null,
          author: configuredModio.author || null,
          version: configuredModio.version || null,
          modfile_id: configuredModio.modfile_id || null,
          modfile_filename: configuredModio.modfile_filename || null,
          date_updated: configuredModio.date_updated || null,
        }
      : null,
    git: fs.existsSync(dir) ? gitSummary(dir) : { isRepo: false },
    currentModio: null,
    searchMatches: [],
    versionRelation: 'unknown',
    issues: [],
  };

  if (!manifest) summary.issues.push('missing manifest.json');
  if (!fs.existsSync(dir)) summary.issues.push('missing mod directory');
  if (summary.policy.role === 'reference_only') summary.issues.push('reference-only; do not release or upload');
  if (isOwnedUploadRole(summary.policy.role) && !summary.configuredModio?.id) summary.issues.push(`${summary.policy.role} mod has no mod.io id`);
  if (summary.git.isRepo && summary.git.dirty) summary.issues.push('git working tree is dirty');

  if (args.refreshModio !== false) {
    try {
      if (summary.configuredModio?.id) {
        summary.currentModio = await fetchModioRecord(context, summary.configuredModio.id, {
          authenticated: roleNeedsAuthenticatedModioRead(summary.policy.role),
        });
      } else if (manifest?.name) {
        summary.searchMatches = await searchModioRecords(context, manifest.name);
      }
    } catch (error) {
      summary.issues.push(`mod.io refresh failed: ${error.message}`);
    }
  }

  summary.versionRelation = versionRelation(summary.manifest?.version, summary.currentModio?.modfile?.version || summary.configuredModio?.version);
  summary.releaseZip = summary.manifest?.version
    ? path.join(context.workspaceRoot, 'releases', mod, `${mod}-${summary.manifest.version}.zip`)
    : null;
  summary.uploadEligible = Boolean(
    isOwnedUploadRole(summary.policy.role)
      && summary.policy.upload
      && summary.configuredModio?.id
      && summary.manifest?.version
      && summary.git.isRepo
      && !summary.git.dirty
  );
  return summary;
}

function assertCanPackage(summary) {
  if (!summary.manifest) throw new Error(`${summary.mod} is missing manifest.json.`);
  if (summary.policy.role === 'reference_only') throw new Error(`${summary.mod} is reference_only; release automation must not publish it.`);
  if (!summary.manifest.version) throw new Error(`${summary.mod} manifest is missing version.`);
}

function assertCanUpload(summary) {
  assertCanPackage(summary);
  if (!isOwnedUploadRole(summary.policy.role)) {
    throw new Error(`${summary.mod} is not mapped as an owned mod.io upload target (role=${summary.policy.role}).`);
  }
  if (summary.policy.upload !== true) throw new Error(`${summary.mod} is not enabled for mod.io upload by policy.`);
  if (!summary.configuredModio?.id) throw new Error(`${summary.mod} has no configured mod.io id.`);
  if (!summary.git.isRepo) throw new Error(`${summary.mod} is not a git repository.`);
  if (summary.git.dirty) throw new Error(`${summary.mod} has uncommitted changes.`);
}

async function packageModRelease(context, summary, args = {}) {
  assertCanPackage(summary);
  const outDir = path.resolve(args.outDir || path.join(context.workspaceRoot, 'releases', summary.mod));
  const zipPath = path.join(outDir, `${summary.mod}-${summary.manifest.version}.zip`);
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.rm(zipPath, { force: true });
  run('zip', [
    '-qr',
    zipPath,
    '.',
    '-x',
    '*.git/*',
    '*.gitignore',
    '*:Zone.Identifier',
    '*.pdn',
    '*.psd',
    '*.xcf',
    'releases/*',
    'build/*',
    '*.zip',
  ], { cwd: summary.dir });
  const stat = await fsp.stat(zipPath);
  return { path: zipPath, bytes: stat.size };
}

async function uploadModfile(context, summary, zipPath, args = {}) {
  if (!context.accessToken) throw new Error('MODIO_ACCESS_TOKEN is required for mod.io upload. Pass envFile or set it in the MCP environment.');
  const fileField = args.fileField || DEFAULT_MODIO_FILE_FIELD;
  const form = new FormData();
  const buffer = await fsp.readFile(zipPath);
  form.set(fileField, new Blob([buffer], { type: 'application/zip' }), path.basename(zipPath));
  form.set('version', summary.manifest.version);
  if (args.changelog) form.set('changelog', String(args.changelog));
  if (args.metadataBlob) form.set('metadata_blob', String(args.metadataBlob));
  if (args.active !== undefined) form.set('active', args.active ? '1' : '0');

  const url = modioApiUrl(context, `/games/${context.gameId}/mods/${summary.configuredModio.id}/files`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${context.accessToken}`,
      'user-agent': `melvor-game-source-tools/${SERVER_VERSION}`,
    },
    body: form,
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }
  if (!response.ok) throw new Error(`mod.io upload failed: ${response.status} ${modioErrorMessage(payload)}`);
  return sanitizeModioRecord({ ...summary.currentModio, modfile: payload }) || payload;
}

function sourceName(value) {
  if (value === 'android') return 'android-loaded';
  return value || 'web';
}

function limitText(text, maxChars) {
  if (!maxChars || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated to ${maxChars} characters]`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function guidePageUrl(title) {
  return `${DEFAULT_GUIDES_BASE_URL}${String(title)
    .replace(/ /g, '_')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}

function guideApiUrl(params) {
  const url = new URL(DEFAULT_GUIDES_API_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  return url;
}

async function fetchGuideJson(params) {
  const response = await fetch(guideApiUrl(params), {
    headers: {
      accept: 'application/json',
      'user-agent': `melvor-game-source-tools/${SERVER_VERSION}`,
    },
  });
  if (!response.ok) throw new Error(`Melvor wiki API failed: ${response.status} ${response.statusText}`);
  const json = await response.json();
  if (json.error) throw new Error(`Melvor wiki API error: ${json.error.info || json.error.code}`);
  return json;
}

async function fetchGuidePages() {
  const pages = [];
  let apcontinue;
  do {
    const json = await fetchGuideJson({
      action: 'query',
      list: 'allpages',
      apprefix: DEFAULT_GUIDES_PREFIX,
      apnamespace: 0,
      aplimit: 'max',
      apcontinue,
    });
    pages.push(...(json.query?.allpages || []));
    apcontinue = json.continue?.apcontinue;
  } while (apcontinue);

  return pages
    .filter((page) => page.title === DEFAULT_GUIDES_PREFIX || page.title.startsWith(`${DEFAULT_GUIDES_PREFIX}/`))
    .sort((a, b) => a.title.localeCompare(b.title));
}

async function fetchGuidePage(page, format = 'text') {
  const title = page || DEFAULT_GUIDES_PREFIX;
  if (format === 'wikitext') {
    const json = await fetchGuideJson({
      action: 'parse',
      prop: 'wikitext|sections|displaytitle',
      page: title,
      redirects: 1,
    });
    const parsed = json.parse;
    if (!parsed) throw new Error(`Melvor guide page not found: ${title}`);
    return {
      title: parsed.title,
      url: guidePageUrl(parsed.title),
      format,
      sections: parsed.sections || [],
      text: parsed.wikitext || '',
    };
  }

  const [extractJson, sectionsJson] = await Promise.all([
    fetchGuideJson({
      action: 'query',
      prop: 'extracts|info',
      explaintext: 1,
      exsectionformat: 'plain',
      inprop: 'url',
      titles: title,
      redirects: 1,
    }),
    fetchGuideJson({
      action: 'parse',
      prop: 'sections',
      page: title,
      redirects: 1,
    }),
  ]);
  const pageResult = extractJson.query?.pages?.[0];
  if (!pageResult || pageResult.missing) throw new Error(`Melvor guide page not found: ${title}`);
  return {
    title: pageResult.title,
    pageid: pageResult.pageid,
    url: pageResult.fullurl || guidePageUrl(pageResult.title),
    format,
    sections: sectionsJson.parse?.sections || [],
    text: pageResult.extract || '',
  };
}

function guideSnippet(text, index, length, contextChars) {
  const start = Math.max(0, index - contextChars);
  const end = Math.min(text.length, index + length + contextChars);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

function guideSearchTerms(query) {
  return [...new Set(String(query || '').match(/[A-Za-z0-9_.:-]+/g) || [])]
    .filter((term) => term.length > 1);
}

function guideSearchMatch(text, query, { regex = false, ignoreCase = true } = {}) {
  const flags = `g${ignoreCase ? 'i' : ''}`;
  if (regex) {
    const matcher = new RegExp(String(query), flags);
    const match = matcher.exec(text);
    if (!match) return null;
    return {
      index: match.index,
      length: match[0].length,
      match: match[0],
      score: 100,
      matchedTerms: [match[0]],
    };
  }

  const terms = guideSearchTerms(query);
  if (terms.length === 0) return null;
  const phrase = String(query || '').trim();
  const phraseMatcher = phrase ? new RegExp(escapeRegExp(phrase), flags) : null;
  const phraseMatch = phraseMatcher?.exec(text);
  let earliest = phraseMatch?.index ?? Number.POSITIVE_INFINITY;
  let length = phraseMatch?.[0]?.length ?? 0;
  let score = phraseMatch ? 1000 : 0;
  const matchedTerms = [];

  for (const term of terms) {
    const matcher = new RegExp(escapeRegExp(term), flags);
    let match;
    let count = 0;
    while ((match = matcher.exec(text)) !== null) {
      count += 1;
      if (match.index < earliest) {
        earliest = match.index;
        length = match[0].length;
      }
      if (matcher.lastIndex === match.index) matcher.lastIndex += 1;
    }
    if (count > 0) {
      matchedTerms.push(term);
      score += 25 + Math.min(count, 5);
    }
  }

  if (matchedTerms.length === 0) return null;
  if (matchedTerms.length === terms.length) score += 100;

  return {
    index: Number.isFinite(earliest) ? earliest : 0,
    length: length || matchedTerms[0].length,
    match: phraseMatch?.[0] || matchedTerms.join(' '),
    score,
    matchedTerms,
  };
}

function guideAnchor(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function lineNumberAt(text, index) {
  if (index <= 0) return 1;
  return text.slice(0, index).split(/\r?\n/).length;
}

async function listMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listMarkdownFiles(entryPath)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(entryPath);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function localGuideSections(text) {
  const sections = [];
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  let match;
  while ((match = headingPattern.exec(text)) !== null) {
    const heading = match[2].trim();
    sections.push({
      level: String(match[1].length),
      line: heading,
      index: String(sections.length + 1),
      anchor: guideAnchor(heading),
    });
  }
  return sections;
}

function localGuideChunks(doc) {
  const headings = [];
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  let match;
  while ((match = headingPattern.exec(doc.text)) !== null) {
    const heading = match[2].trim();
    headings.push({
      level: match[1].length,
      heading,
      anchor: guideAnchor(heading),
      index: headings.length + 1,
      start: match.index,
    });
  }

  if (headings.length === 0) {
    return [{
      title: doc.title,
      page: doc.relativePath.replace(/\.md$/i, ''),
      heading: doc.title.replace(/^Local\//, ''),
      anchor: 'document',
      index: 1,
      level: 1,
      startLine: 1,
      endLine: lineNumberAt(doc.text, doc.text.length),
      text: doc.text,
    }];
  }

  return headings.map((heading, index) => {
    const end = headings[index + 1]?.start ?? doc.text.length;
    const text = doc.text.slice(heading.start, end).trim();
    return {
      title: doc.title,
      page: doc.relativePath.replace(/\.md$/i, ''),
      heading: heading.heading,
      anchor: heading.anchor,
      index: heading.index,
      level: heading.level,
      startLine: lineNumberAt(doc.text, heading.start),
      endLine: lineNumberAt(doc.text, end),
      text,
    };
  });
}

async function localGuideDocs() {
  const files = await listMarkdownFiles(DEFAULT_LOCAL_GUIDES_DIR);
  const docs = [];
  for (const file of files) {
    const text = await fsp.readFile(file, 'utf8');
    const firstHeading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const relativePath = path.relative(DEFAULT_LOCAL_GUIDES_DIR, file).replace(/\\/g, '/');
    const fallbackTitle = relativePath
      .replace(/\.md$/i, '')
      .split('/')
      .map((part) => part.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()))
      .join('/');
    const title = `Local/${firstHeading || fallbackTitle}`;
    docs.push({
      title,
      source: 'local',
      path: file,
      root: DEFAULT_LOCAL_GUIDES_DIR,
      rootTitle: 'Local',
      relativePath,
      format: 'text',
      sections: localGuideSections(text),
      text,
    });
  }
  return docs;
}

function localGuideAliases(doc) {
  const aliases = new Set();
  const title = doc.title.toLowerCase();
  const relativeNoExt = doc.relativePath.replace(/\.md$/i, '').toLowerCase();
  const basenameNoExt = path.basename(doc.relativePath).replace(/\.md$/i, '').toLowerCase();
  aliases.add(title);
  aliases.add(title.replace(/^local\//i, ''));
  aliases.add(relativeNoExt);
  aliases.add(basenameNoExt);
  const rootTitles = [doc.rootTitle, doc.rootTitle.replace(/^local\/?/i, '')].filter(Boolean);
  for (const rootTitle of rootTitles) {
    aliases.add(`${rootTitle}/${relativeNoExt}`.toLowerCase());
    aliases.add(`${rootTitle}/${basenameNoExt}`.toLowerCase());
  }
  return aliases;
}

async function findLocalGuide(page) {
  const requested = String(page || '').replace(/^Local\//i, '').toLowerCase();
  const docs = await localGuideDocs();
  return docs.find((doc) => localGuideAliases(doc).has(String(page || '').toLowerCase()))
    || docs.find((doc) => localGuideAliases(doc).has(requested));
}

function findLocalGuideChunk(doc, section) {
  const requested = String(section || '').trim().toLowerCase();
  if (!requested) return null;
  return localGuideChunks(doc).find((chunk) => {
    const aliases = [
      String(chunk.index),
      chunk.anchor,
      chunk.heading.toLowerCase(),
      `${chunk.page}#${chunk.anchor}`.toLowerCase(),
    ];
    return aliases.includes(requested);
  }) || null;
}

const LOCAL_GUIDE_HINTS = {
  'README.md': 'Start here. Overview of packaged docs, common questions, and which guide to read first.',
  'game-internals-overview.md': 'Conceptual map of how the Melvor client works: boot/load flow, registries, game loop, offline processing, skills, combat, bank/items/equipment, UI rendering, saves, and modding surfaces.',
  'game-source-assets-js.md': 'Assets/js architecture catalog: bundled files, built modules, mod loader location, and runtime libraries.',
  'generated-source-reference.md': 'Generated source reference: extracted modding-relevant classes, custom elements, lifecycle hooks, patching, offline processing, and file/line snippets.',
  'local-mod-writing-patterns.md': 'Repository-authored practical mod implementation patterns: lifecycle hooks, ctx.patch, offline guards, templates, settings, APIs, DOM observers, and caching. Standalone guidance, not official docs.',
  'creator-toolkit-local-mods.md': 'Creator Toolkit local mods: IndexedDB shape, linked mod.io behavior, load guards, .modignore, and MCP verification.',
  'live-game-sessions.md': 'Persistent browser sessions, read-only save guards, screenshots, live state reads, and profiling.',
  'live-debugging-patterns.md': 'Live debugging patterns: rendered UI versus game data, bare globals versus globalThis, modal handling, structured console evidence, and inactive mod.io test uploads.',
  'game-save-browser-tests.md': 'One-shot save/browser regression checks and generated reports.',
};

const GUIDE_USE_CASES = [
  { question: 'What docs are available?', tool: 'melvor_modding_guides_list', page: 'README' },
  { question: 'What does this MCP know and where should I start?', tool: 'melvor_mcp_context' },
  { question: 'How does Melvor Idle work internally?', tool: 'melvor_modding_guides_read', page: 'game-internals-overview' },
  { question: 'How do I set up a new Melvor mod?', tool: 'melvor_modding_guides_search', query: 'Getting Started Essentials Creator Toolkit manifest setup.mjs templates' },
  { question: 'How should a Melvor mod patch game behavior?', tool: 'melvor_modding_guides_search', query: 'ctx.patch before after replace' },
  { question: 'Where is a modding API symbol in source?', tool: 'melvor_modding_guides_search', query: 'generated source reference patching lifecycle offline custom elements' },
  { question: 'Which lifecycle hook should a mod use?', tool: 'melvor_modding_guides_search', query: 'onCharacterLoaded onInterfaceReady' },
  { question: 'How should a mod handle offline processing?', tool: 'melvor_modding_guides_search', query: 'offlineLoopEntered loadingOfflineProgress OfflineLoadingElement' },
  { question: 'How can I trigger offline processing in a live test session?', tool: 'game_session_time_skip', hours: 1 },
  { question: 'How do I profile browser performance in a live session?', tool: 'game_profile_start', query: 'CDP CPU profile browser metrics long tasks heap trace' },
  { question: 'How do I temporarily profile one installed mod or an interaction set?', tool: 'game_session_mod_profile', operation: 'load_with_dependencies' },
  { question: 'How do I test a mod with a known save state?', tool: 'game_session_save', operation: 'list_fixtures' },
  { question: 'How do I load temporary local test code through Creator Toolkit?', tool: 'game_session_local_mod', operation: 'install_generated' },
  { question: 'How do local Creator Toolkit mods load?', tool: 'melvor_modding_guides_read', page: 'creator-toolkit-local-mods' },
  { question: 'How do I test a mod safely in the browser?', tool: 'melvor_modding_guides_read', page: 'live-game-sessions' },
  { question: 'How do I debug a live UI mismatch?', tool: 'melvor_modding_guides_read', page: 'live-debugging-patterns' },
];

const MCP_CONTEXT = {
  purpose: 'Melvor Game Source MCP provides a compact map of how Melvor Idle works internally, modding knowledge, searchable packaged docs, official wiki guides, local game-source search, live browser sessions, and safe release/mod.io helpers.',
  startHere: [
    {
      tool: 'melvor_mcp_context',
      use: 'Read the high-level map when you do not yet know the right file, symbol, or search term.',
    },
    {
      tool: 'melvor_modding_guides_search',
      use: 'Search packaged docs first for concepts and known patterns before reading raw game source.',
    },
    {
      tool: 'game_source_search',
      use: 'Search local raw or readable client source when docs do not answer the symbol-level question.',
    },
    {
      tool: 'mod_source_search',
      use: 'Search locally fetched installed Mod Manager mod sources after running mod_manager_fetch_sources.',
    },
    {
      tool: 'game_session_start',
      use: 'Start a live browser session when rendered behavior, globals, mod conflicts, or save-dependent state must be verified.',
    },
    {
      tool: 'game_session_time_skip',
      use: 'Trigger Melvor offline processing in a loaded read-only live session using game.testForOffline(hours).',
    },
    {
      tool: 'game_session_save',
      use: 'Manage ignored save fixtures and load known local/cloud save states in a live browser session.',
    },
    {
      tool: 'game_session_local_mod',
      use: 'Install generated or local-path Creator Toolkit local mods into the live browser session for save setup, profiling probes, and runtime debugging.',
    },
    {
      tool: 'game_session_mod_profile',
      use: 'Temporarily replace a live session Mod Manager profile with one mod, one mod plus dependencies, or an explicit interaction set before profiling.',
    },
    {
      tool: 'game_profile_start',
      use: 'Profile runtime performance in a live session with Playwright tracing, CDP CPU samples, Chrome metrics, heap usage, long tasks, and optional scenario marks.',
    },
  ],
  gameInternals: [
    {
      area: 'Boot, source layout, and runtime libraries',
      knowsAbout: ['assets/js bundles', 'built/ modules', 'web versus Android-loaded source stores', 'raw source as ground truth', 'opt-in readable copies under game-source-readable/', 'Pixi/jQuery/Dexie/runtime libraries'],
      docs: ['game-internals-overview', 'game-source-assets-js'],
      searches: ['how Melvor works boot load flow', 'source architecture built modules', 'runtime libraries assets/js', 'web android-loaded source', 'game_source_beautify readable source raw unchanged'],
    },
    {
      area: 'New mod setup',
      knowsAbout: ['official getting-started flow', 'manifest.json', 'setup.mjs', 'loadable templates', 'Creator Toolkit local mods', 'repo-authored packaged implementation patterns that do not require any local mod folders', 'local storage and settings patterns'],
      docs: ['Mod Creation/Getting Started', 'Mod Creation/Essentials', 'Mod Creation/Creator Toolkit', 'creator-toolkit-local-mods', 'local-mod-writing-patterns'],
      searches: ['Getting Started Essentials Creator Toolkit manifest setup.mjs templates', 'settings.section characterStorage accountStorage ctx.api', 'local mod writing lifecycle setup'],
    },
    {
      area: 'Mod loader and context API',
      knowsAbout: ['mod loading flow', 'ModContext', 'ctx.patch', 'before/after/replace patching', 'settings and storage helpers'],
      docs: ['generated-source-reference', 'local-mod-writing-patterns', 'Mod Creation/Mod Context API Reference'],
      searches: ['mod loader context API', 'ctx.patch before after replace', 'settings storage API'],
    },
    {
      area: 'Lifecycle and offline processing',
      knowsAbout: ['onCharacterLoaded', 'onInterfaceReady', 'offlineLoopEntered', 'offlineLoopExited', 'loadingOfflineProgress', 'controlled offline simulation with game_session_time_skip'],
      docs: ['game-internals-overview', 'generated-source-reference', 'local-mod-writing-patterns'],
      searches: ['onCharacterLoaded onInterfaceReady', 'offlineLoopEntered offlineLoopExited', 'loadingOfflineProgress OfflineLoadingElement', 'game.testForOffline Time Skip offline processing'],
    },
    {
      area: 'UI, rendering, and custom elements',
      knowsAbout: ['custom elements', 'menus', 'render methods', 'DOM observers', 'modal handling', 'rendered DOM versus game model checks', 'browser profiling with trace.zip and .cpuprofile artifacts'],
      docs: ['game-internals-overview', 'generated-source-reference', 'live-debugging-patterns', 'live-game-sessions'],
      searches: ['custom elements rendering menus', 'rendered DOM game data mismatch', 'dismiss_modals modal state', 'CDP CPU profile browser metrics long tasks heap trace'],
    },
    {
      area: 'Items, bank, equipment, and combat',
      knowsAbout: ['item/equipment model lookups', 'bank UI and tab behavior', 'equipment sets', 'combat-style and stat comparisons', 'source lookups for item-related classes'],
      docs: ['game-internals-overview', 'generated-source-reference', 'game-source-assets-js', 'live-debugging-patterns'],
      searches: ['Bank bankTabMenu bank items tabs', 'EquipmentItem equipment sets combat stats', 'items inventory bank render'],
    },
    {
      area: 'Saves, cloud, local testing, and Mod Manager',
      knowsAbout: ['read-only browser save guards', 'local/cloud save loading', 'ignored save fixtures under save-fixtures/', 'Creator Toolkit local mods', 'temporary generated local mods through game_session_local_mod', 'optional fetching and searching of installed Mod Manager mod resources', 'temporary live-session Mod Manager profiles for profiling', 'mod.io active/inactive release safety'],
      docs: ['creator-toolkit-local-mods', 'game-save-browser-tests', 'live-game-sessions'],
      searches: ['Creator Toolkit IndexedDB local mods', 'game_session_local_mod generated local probes Creator Toolkit', 'mod_manager_fetch_sources mod_source_search', 'game_session_save save fixtures local cloud slots', 'game_session_mod_profile temporary profile dependencies profiling', 'read-only save guards game_save_test', 'inactive mod.io upload'],
    },
  ],
  packagedDocs: Object.entries(LOCAL_GUIDE_HINTS).map(([file, summary]) => ({
    page: file.replace(/\.md$/i, ''),
    file,
    summary,
  })),
  searchStarters: [
    'ctx.patch before after replace',
    'how Melvor works boot registries game loop render queue',
    'Getting Started Essentials Creator Toolkit manifest setup.mjs templates',
    'onCharacterLoaded onInterfaceReady',
    'offlineLoopEntered offlineLoopExited loadingOfflineProgress',
    'game.testForOffline Time Skip offline processing',
    'CDP CPU profile browser metrics long tasks heap trace',
    'custom elements rendering menus',
    'Bank bankTabMenu bank items tabs',
    'EquipmentItem equipment sets combat stats',
    'Creator Toolkit IndexedDB local mods',
    'game_session_local_mod generated local probes Creator Toolkit',
    'mod_manager_fetch_sources mod_source_search installed mods',
    'game_session_save save fixtures local cloud slots',
    'game_session_mod_profile temporary profile dependencies profiling',
    'read-only save guards game_session_start game_save_test',
    'bare globals globalThis structured console evidence',
  ],
  workflow: [
    'Use melvor_mcp_context or melvor_modding_guides_list to learn the map.',
    'Read game-internals-overview when the question is about how Melvor works rather than one exact symbol.',
    'Use melvor_modding_guides_search for concept-level answers and known patterns.',
    'Use melvor_modding_guides_read on the returned page/section for detail.',
    'Use packaged local-mod-writing-patterns even on a fresh machine with no local mods; it is standalone guidance distilled into the repo.',
    'Use game_source_download for raw local source, game_source_beautify only when a readable copy is needed, and game_source_search/read for exact source symbols and implementation checks.',
    'Use mod_manager_fetch_sources, then mod_source_search/read, when comparing against installed mods.',
    'Use game_session_save to list save slots, export ignored save fixtures, import them into local test slots, and load known save states.',
    'Use game_session_local_mod to install temporary generated or local-path Creator Toolkit mods into the same browser session for setup code, probes, or profiling shims.',
    'Use game_session_mod_profile before profiling when you need a temporary one-mod, dependency-closed, or interaction-set Mod Manager profile in a live browser session.',
    'Use game_session_time_skip in a loaded read-only live session to exercise offline processing without waiting in real time.',
    'Use game_profile_start/read/mark/stop to collect browser performance traces, CPU samples, Chrome metric deltas, heap usage, long tasks, and scenario marks.',
    'Use live game session tools when the question depends on runtime state, rendered UI, mod interactions, or browser globals.',
  ],
};

const MCP_SERVER_INSTRUCTIONS = [
  'This server helps with Melvor Idle modding by combining packaged docs, official wiki guide access, local game-source search, live browser diagnostics, and safe release helpers.',
  'When the user asks a broad Melvor modding question and you do not know the right symbol yet, call melvor_mcp_context first, then melvor_modding_guides_search.',
  'Use packaged docs and official wiki guide access for how Melvor works internally, new mod setup, source layout, mod loader/context API, lifecycle hooks, offline processing, UI/custom elements, bank/items/equipment/combat topics, Creator Toolkit local mods, live debugging, and safe save/release testing.',
  'Use game_source_download for raw local game source. Use game_source_beautify only when a readable copy is needed; it must not replace raw source as ground truth.',
  'Use mod_manager_fetch_sources to export installed Mod Manager mods locally, then mod_source_search/read to compare against those downloaded mod sources.',
  'Use game_session_save in live sessions to manage ignored save fixtures and load known save states for repeatable testing; actual writes require apply=true.',
  'Use game_session_local_mod when temporary test code should run through the installed Creator Toolkit in the current live session; actual local mod writes require apply=true.',
  'Use game_session_mod_profile to temporarily change a live session Mod Manager profile for isolated or interaction-set profiling; actual changes require apply=true and can be restored from the in-memory snapshot.',
  'Use game_session_time_skip in read-only live sessions to exercise offline-processing behavior through game.testForOffline(hours).',
  'Use game_profile_start/read/mark/stop in live sessions when performance needs structured browser evidence such as CDP CPU profiles, Chrome metrics, heap usage, long tasks, and Playwright traces.',
  'For exact implementation details, search/read local game source. For rendered behavior or mod conflicts, start a read-only game session and gather structured evidence.',
].join(' ');

function isGitRepo(repoPath) {
  const result = spawnSync('git', ['-C', repoPath, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return false;
  try {
    return fs.realpathSync(result.stdout.trim()) === fs.realpathSync(repoPath);
  } catch {
    return false;
  }
}

function localSourceDir(repoPath, branch) {
  const selected = sourceName(branch === 'master' ? 'web' : branch);
  const candidate = path.join(repoPath, selected);
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

async function toolSearch(args = {}) {
  if (!args.query && !args.preset) {
    throw new Error('Missing game source search input. Pass query or preset.');
  }

  const repo = resolveRepo(args.repo);
  const commandArgs = [
    path.join(REPO_ROOT, 'scripts/search-game-source.mjs'),
    '--repo',
    repo,
    '--branch',
    args.branch || 'working',
    '--path',
    args.path || '.',
    '--context',
    String(numeric(args.context, 2, 0)),
    '--max',
    String(numeric(args.maxLines, 120, 0)),
    '--json',
  ];

  if (args.ignoreCase) commandArgs.push('--ignore-case');
  if (args.filesOnly) commandArgs.push('--files');
  if (args.preset) commandArgs.push('--preset', args.preset);
  if (args.query) commandArgs.push(String(args.query));

  const output = runAllowNoMatches(process.execPath, commandArgs);
  return textContent(output || JSON.stringify({ repo, results: [] }, null, 2));
}

async function toolRead(args = {}) {
  const repo = resolveRepo(args.repo);
  const relPath = assertSafeRelativePath(args.path);
  const branch = args.branch || 'working';
  const startLine = numeric(args.startLine, 1, 1);
  const maxLines = numeric(args.maxLines, 200, 1, 1000);
  let text;

  const localDir = branch === 'working' || branch === 'current' ? repo : localSourceDir(repo, branch);

  if (localDir) {
    const filePath = path.resolve(localDir, relPath);
    const repoWithSep = localDir.endsWith(path.sep) ? localDir : `${localDir}${path.sep}`;
    if (!filePath.startsWith(repoWithSep)) throw new Error(`Path escapes source repo: ${relPath}`);
    text = await fsp.readFile(filePath, 'utf8');
  } else if (isGitRepo(repo)) {
    text = run('git', ['-C', repo, 'show', `${branch}:${relPath}`]);
  } else {
    throw new Error(`No local source directory or git ref found for "${branch}" in ${repo}`);
  }

  const lines = text.split('\n');
  const selected = lines.slice(startLine - 1, startLine - 1 + maxLines);
  const numbered = selected.map((line, index) => `${startLine + index}:${line}`).join('\n');
  return textContent(numbered);
}

async function toolManifest(args = {}) {
  const repo = resolveRepo(args.repo);
  const branch = args.branch || 'working';
  let text;

  const localDir = branch === 'working' || branch === 'current' ? repo : localSourceDir(repo, branch);

  if (localDir && fs.existsSync(path.join(localDir, 'source-manifest.json'))) {
    text = await fsp.readFile(path.join(localDir, 'source-manifest.json'), 'utf8');
  } else if (isGitRepo(repo)) {
    text = run('git', ['-C', repo, 'show', `${branch}:source-manifest.json`]);
  } else {
    throw new Error(`No source-manifest.json found for "${branch}" in ${repo}`);
  }

  const manifest = JSON.parse(text);
  return textContent(JSON.stringify({
    branch,
    sourceVersion: manifest.sourceVersion,
    summary: manifest.summary,
    page: {
      location: manifest.page?.location,
      title: manifest.page?.title,
    },
  }, null, 2));
}

async function toolBranches(args = {}) {
  const repo = resolveRepo(args.repo);
  const localSources = LOCAL_SOURCES.filter((source) => fs.existsSync(path.join(repo, source)));
  const gitBacked = isGitRepo(repo);
  const branches = gitBacked
    ? run('git', ['-C', repo, 'branch', '--format=%(refname:short)']).split('\n').filter(Boolean)
    : [];
  const current = gitBacked ? run('git', ['-C', repo, 'branch', '--show-current']) : null;
  const tags = gitBacked
    ? runAllowNoMatches('git', ['-C', repo, 'tag', '--list', 'melvor-v*']).split('\n').filter(Boolean)
    : [];
  return textContent(JSON.stringify({ repo, localSources, gitBacked, current, branches, tags }, null, 2));
}

async function toolDownload(args = {}) {
  const source = args.source || 'web';
  const install = args.install !== false && !args.manifestOnly;
  const sourceStore = resolveRepo(args.repo);
  const normalizedSource = sourceName(source);
  const outDir = args.outDir
    || path.join('/tmp', `melvor-game-source-${new Date().toISOString().replace(/[:.]/g, '-')}-${normalizedSource}`);
  const commandArgs = [path.join(REPO_ROOT, 'scripts/refresh-game-source.mjs')];

  if (source === 'android') {
    commandArgs.push(
      '--all',
      '--device',
      'Pixel 5',
      '--source-name',
      'android-loaded',
      '--tag-qualifier',
      'android-loaded',
      '--url',
      'https://android.melvoridle.com/offlineClientStage3/index_mobile.php'
    );
  } else {
    commandArgs.push('--source-name', 'web', '--tag-qualifier', 'observed');
    if (args.includeAll !== false) commandArgs.push('--all');
  }

  if (args.manifestOnly) commandArgs.push('--manifest-only');
  if (args.hashQueryFilenames) commandArgs.push('--hash-query-filenames');
  commandArgs.push('--out', outDir);
  const installDir = path.join(sourceStore, normalizedSource);
  if (install) commandArgs.push('--install-to', installDir, '--clean-install');
  if (args.maxAssets) commandArgs.push('--max-assets', String(numeric(args.maxAssets, 500, 1)));
  if (args.timeoutMs) commandArgs.push('--timeout-ms', String(numeric(args.timeoutMs, 45000, 1000)));
  if (args.settleMs !== undefined) commandArgs.push('--settle-ms', String(numeric(args.settleMs, 3000, 0)));

  const output = run(process.execPath, commandArgs);
  let installedStore = null;
  if (install) {
    const manifest = JSON.parse(await fsp.readFile(path.join(installDir, 'source-manifest.json'), 'utf8'));
    installedStore = {
      targetDir: installDir,
      sourceVersion: manifest.sourceVersion,
      summary: manifest.summary,
    };
  }

  return textContent(JSON.stringify({
    output,
    stagingDir: outDir,
    installed: Boolean(installedStore),
    installedStore,
  }, null, 2));
}

async function toolBeautify(args = {}) {
  const source = sourceName(args.source);
  const sourceDir = args.sourceDir || path.join(resolveRepo(args.repo), source);
  const outDir = args.outDir || path.join(REPO_ROOT, 'game-source-readable', source);
  const commandArgs = [
    path.join(REPO_ROOT, 'scripts/beautify-game-source.mjs'),
    '--source',
    sourceDir,
    '--out',
    outDir,
    '--max-bytes',
    String(numeric(args.maxBytes, 15 * 1024 * 1024, 1)),
  ];
  if (args.check) commandArgs.push('--check');

  const output = run(process.execPath, commandArgs);
  return textContent(output);
}

async function toolMcpContext() {
  return textContent(JSON.stringify(MCP_CONTEXT, null, 2));
}

async function toolGuidesList() {
  const [pages, localDocs] = await Promise.all([fetchGuidePages(), localGuideDocs()]);
  const packagedDocs = localDocs.map((doc) => ({
    title: doc.title,
    page: doc.relativePath.replace(/\.md$/i, ''),
    source: 'local',
    path: doc.path,
    root: doc.root,
    relativePath: doc.relativePath,
    summary: LOCAL_GUIDE_HINTS[doc.relativePath] || 'Packaged local Melvor modding documentation.',
    sections: doc.sections.map((section) => ({
      heading: section.line,
      anchor: section.anchor,
      level: section.level,
    })),
  }));

  return textContent(JSON.stringify({
    overview: {
      description: 'Packaged Melvor modding docs are available under docs/modding and are searchable without any separate local game-source checkout.',
      contextTool: {
        tool: 'melvor_mcp_context',
        description: 'Use this zero-argument tool for a compact map of game internals, searchable topics, and the recommended discovery workflow.',
      },
      startHere: {
        title: 'Local/Melvor Modding Docs Overview',
        page: 'README',
      },
      gameInternals: MCP_CONTEXT.gameInternals,
      searchStarters: MCP_CONTEXT.searchStarters,
      useCases: GUIDE_USE_CASES,
    },
    packagedDocs,
    officialWiki: {
      api: DEFAULT_GUIDES_API_URL,
      prefix: DEFAULT_GUIDES_PREFIX,
      available: true,
    },
    localDocsDir: DEFAULT_LOCAL_GUIDES_DIR,
    pages: [
      ...pages.map((page) => ({
        title: page.title,
        pageid: page.pageid,
        source: 'official',
        url: guidePageUrl(page.title),
      })),
      ...packagedDocs,
    ],
  }, null, 2));
}

async function toolGuidesRead(args = {}) {
  const maxChars = numeric(args.maxChars, 30000, 0);
  const localDoc = await findLocalGuide(args.page || '');
  if (localDoc) {
    const selectedSection = args.section === undefined ? null : findLocalGuideChunk(localDoc, args.section);
    if (args.section !== undefined && !selectedSection) {
      throw new Error(`Local guide section not found: ${args.section}`);
    }
    const text = selectedSection?.text ?? localDoc.text;
    return textContent(JSON.stringify({
      title: localDoc.title,
      source: 'local',
      path: localDoc.path,
      format: args.format || 'text',
      sections: localDoc.sections,
      section: selectedSection
        ? {
            heading: selectedSection.heading,
            anchor: selectedSection.anchor,
            index: String(selectedSection.index),
            level: String(selectedSection.level),
            startLine: selectedSection.startLine,
            endLine: selectedSection.endLine,
          }
        : null,
      text: limitText(text, maxChars),
    }, null, 2));
  }

  const page = await fetchGuidePage(args.page || DEFAULT_GUIDES_PREFIX, args.format || 'text');
  return textContent(JSON.stringify({
    ...page,
    source: 'official',
    text: limitText(page.text, maxChars),
  }, null, 2));
}

async function toolGuidesSearch(args = {}) {
  const query = String(args.query || '');
  if (!query) throw new Error('Missing guide search query.');
  const maxResults = numeric(args.maxResults, 20, 1);
  const contextChars = numeric(args.contextChars, 240, 0);
  const format = args.format || 'text';
  const localDocs = await localGuideDocs();
  const results = [];
  const searchOptions = {
    regex: Boolean(args.regex),
    ignoreCase: args.ignoreCase !== false,
  };
  const localResults = [];

  for (const doc of localDocs) {
    for (const chunk of localGuideChunks(doc)) {
      const match = guideSearchMatch(chunk.text, query, searchOptions);
      if (!match) continue;
      localResults.push({
        title: doc.title,
        source: 'local',
        path: doc.path,
        page: chunk.page,
        section: {
          heading: chunk.heading,
          anchor: chunk.anchor,
          index: String(chunk.index),
          level: String(chunk.level),
          startLine: chunk.startLine,
          endLine: chunk.endLine,
        },
        read: {
          page: chunk.page,
          section: chunk.anchor,
        },
        index: match.index,
        match: match.match,
        score: match.score,
        matchedTerms: match.matchedTerms,
        snippet: guideSnippet(chunk.text, match.index, match.length, contextChars),
      });
    }
  }

  localResults.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.section.index - b.section.index);
  results.push(...localResults.slice(0, maxResults));

  const pages = args.includeOfficial === false || results.length >= maxResults ? [] : await fetchGuidePages();
  for (const guide of pages) {
    if (results.length >= maxResults) break;
    const page = await fetchGuidePage(guide.title, format);
    const match = guideSearchMatch(page.text, query, searchOptions);
    if (match) {
      results.push({
        title: page.title,
        source: 'official',
        url: page.url,
        index: match.index,
        match: match.match,
        score: match.score,
        matchedTerms: match.matchedTerms,
        snippet: guideSnippet(page.text, match.index, match.length, contextChars),
      });
    }
  }

  return textContent(JSON.stringify({
    query,
    regex: Boolean(args.regex),
    ignoreCase: args.ignoreCase !== false,
    format,
    results,
  }, null, 2));
}

function resolveModSourcesDir(outDir) {
  return path.resolve(outDir || DEFAULT_MOD_SOURCES_DIR);
}

function pathInsideRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(rootWithSep);
}

function slug(value) {
  return String(value || 'mod')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'mod';
}

function modResourceType(resourcePath) {
  const lower = String(resourcePath || '').toLowerCase();
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return '';
}

function safeResourcePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0')) throw new Error(`Invalid local mod resource path: ${value}`);
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..' || part === '.' || part === '')) {
    throw new Error(`Unsafe local mod resource path: ${value}`);
  }
  return normalized;
}

function shouldSkipLocalModPath(relativePath) {
  const parts = relativePath.split('/');
  return parts.includes('.git') || parts.includes('node_modules') || parts.includes('.DS_Store') || relativePath === '.modignore';
}

async function readModIgnore(root) {
  const ignorePath = path.join(root, '.modignore');
  if (!fs.existsSync(ignorePath)) return [];
  const text = await fsp.readFile(ignorePath, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'));
}

function matchesIgnorePattern(relativePath, pattern) {
  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\/+/, '');
  const normalizedPath = relativePath.replace(/\\/g, '/');
  if (!normalizedPattern) return false;
  if (normalizedPattern.endsWith('/')) return normalizedPath.startsWith(normalizedPattern);
  if (!normalizedPattern.includes('/')) return normalizedPath.split('/').includes(normalizedPattern);
  return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
}

async function collectLocalModFiles(root, currentDir, patterns, files = []) {
  const entries = await fsp.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = safeResourcePath(path.relative(root, absolutePath).replace(/\\/g, '/'));
    if (shouldSkipLocalModPath(relativePath) || patterns.some((pattern) => matchesIgnorePattern(relativePath, pattern))) continue;
    if (entry.isDirectory()) {
      await collectLocalModFiles(root, absolutePath, patterns, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const buffer = await fsp.readFile(absolutePath);
    files.push({
      path: relativePath,
      type: modResourceType(relativePath),
      size: buffer.length,
      base64: buffer.toString('base64'),
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function parseManifestText(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateLocalManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest.json must contain a JSON object.');
  if (manifest.namespace) {
    if (!/^(?!melvor)[A-Za-z_][A-Za-z0-9_]*$/i.test(manifest.namespace)) {
      throw new Error('manifest.namespace must contain only alphanumeric characters and underscores and cannot start with "melvor".');
    }
    if (manifest.namespace === 'dev') throw new Error('manifest.namespace "dev" is reserved.');
  }
  if (!manifest.setup && !manifest.load) throw new Error('manifest.json must define either setup or load.');
  const validLoadResource = (resource) =>
    typeof resource === 'string' &&
    (resource.endsWith('.js') || resource.endsWith('.mjs') || resource.endsWith('.css') || resource.endsWith('.json') || resource.endsWith('.html'));
  if (manifest.setup && !(typeof manifest.setup === 'string' && (manifest.setup.endsWith('.js') || manifest.setup.endsWith('.mjs')))) {
    throw new Error('manifest.setup must be a .js or .mjs resource.');
  }
  if (manifest.load && !(typeof manifest.load === 'string' ? validLoadResource(manifest.load) : Array.isArray(manifest.load) && manifest.load.every(validLoadResource))) {
    throw new Error('manifest.load must be a valid resource path or array of resource paths.');
  }
  if (manifest.icon && !(typeof manifest.icon === 'string' && (manifest.icon.endsWith('.png') || manifest.icon.endsWith('.svg')))) {
    throw new Error('manifest.icon must be a .png or .svg resource.');
  }
}

function safeGeneratedNamespace(value, fallbackName) {
  const raw = String(value || fallbackName || 'mcp_local_probe')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  let namespace = raw || 'mcp_local_probe';
  if (!/^[A-Za-z_]/.test(namespace)) namespace = `mcp_${namespace}`;
  if (/^melvor/i.test(namespace)) namespace = `mcp_${namespace}`;
  if (namespace === 'dev') namespace = 'mcp_dev';
  return namespace.slice(0, 64);
}

function generatedSetupModule({ namespace, name, setupScript }) {
  return `export function setup(ctx) {
  const marker = {
    namespace: ${JSON.stringify(namespace)},
    name: ${JSON.stringify(name)},
    loadedAt: new Date().toISOString()
  };
  globalThis.__mcpLocalModLoaded = marker;
  globalThis.__mcpLocalModShenanigans = globalThis.__mcpLocalModShenanigans || {};
  globalThis.__mcpLocalModShenanigans[${JSON.stringify(namespace)}] = marker;
  try {
${String(setupScript || '').split(/\r?\n/).map((line) => `    ${line}`).join('\n')}
  } catch (error) {
    marker.error = error instanceof Error ? error.message : String(error);
    console.error('[MCP local mod] setup failed', error);
    throw error;
  }
}
`;
}

function textFile(pathValue, text, type = '') {
  return {
    path: safeResourcePath(pathValue),
    type: type || modResourceType(pathValue),
    size: Buffer.byteLength(String(text)),
    base64: Buffer.from(String(text)).toString('base64'),
  };
}

async function buildGeneratedLocalModInput(args = {}) {
  const name = String(args.name || 'MCP Local Probe');
  const namespace = safeGeneratedNamespace(args.namespace, name);
  const manifest = args.manifestJson
    ? parseManifestText(String(args.manifestJson), 'manifestJson')
    : {
        name,
        namespace,
        version: '0.0.0',
        setup: 'setup.mjs',
      };
  if (!manifest.name) manifest.name = name;
  if (!manifest.namespace) manifest.namespace = namespace;
  if (!manifest.setup) manifest.setup = 'setup.mjs';
  validateLocalManifest(manifest);
  const setupText = args.moduleScript
    ? String(args.moduleScript)
    : generatedSetupModule({ namespace: manifest.namespace, name: manifest.name, setupScript: args.setupScript || '' });
  const files = [
    textFile('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, 'application/json'),
    textFile(manifest.setup, setupText, modResourceType(manifest.setup)),
  ];
  return {
    kind: 'directory',
    files,
    manifest,
    packageName: `${slug(name)}.zip`,
    requestedName: name,
    directoryPath: args.directoryPath || '',
    disabled: Boolean(args.disabled),
    linkedModId: args.linkedModId === undefined ? null : numeric(args.linkedModId, undefined, 1),
    localModId: args.localModId === undefined ? null : numeric(args.localModId, undefined, 1),
    replace: args.replace !== false,
    generated: true,
  };
}

async function buildPathLocalModInput(args = {}) {
  if (!args.modPath) throw new Error('game_session_local_mod install_path requires modPath.');
  const modPath = path.resolve(String(args.modPath));
  const stat = await fsp.stat(modPath).catch(() => null);
  if (!stat) throw new Error(`Local mod path does not exist: ${modPath}`);
  const common = {
    directoryPath: args.directoryPath || '',
    disabled: Boolean(args.disabled),
    linkedModId: args.linkedModId === undefined ? null : numeric(args.linkedModId, undefined, 1),
    localModId: args.localModId === undefined ? null : numeric(args.localModId, undefined, 1),
    replace: args.replace !== false,
    requestedName: args.name || '',
    sourcePath: modPath,
  };
  if (stat.isDirectory()) {
    const manifestPath = path.join(modPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`Local mod directory has no manifest.json: ${modPath}`);
    const manifest = parseManifestText(await fsp.readFile(manifestPath, 'utf8'), manifestPath);
    validateLocalManifest(manifest);
    const patterns = await readModIgnore(modPath);
    const files = await collectLocalModFiles(modPath, modPath, patterns);
    if (!files.some((file) => file.path === 'manifest.json')) throw new Error('Local mod package must include manifest.json.');
    return {
      ...common,
      kind: 'directory',
      files,
      manifest,
      packageName: `${slug(args.name || path.basename(modPath))}.zip`,
    };
  }
  if (!stat.isFile()) throw new Error(`Local mod path must be a directory or zip file: ${modPath}`);
  if (path.extname(modPath).toLowerCase() !== '.zip') throw new Error(`Local mod path must be a directory or .zip file: ${modPath}`);
  const buffer = await fsp.readFile(modPath);
  return {
    ...common,
    kind: 'zip',
    packageBase64: buffer.toString('base64'),
    packageName: path.basename(modPath),
    size: buffer.length,
  };
}

async function readFetchedModEntry(root, dirent) {
  const modDir = path.join(root, dirent.name);
  const metadataPath = path.join(modDir, 'mod-source.json');
  let metadata = null;
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(await fsp.readFile(metadataPath, 'utf8'));
    } catch (error) {
      metadata = { error: error.message };
    }
  }

  return {
    folder: dirent.name,
    path: modDir,
    metadataPath: fs.existsSync(metadataPath) ? metadataPath : null,
    id: Number.isInteger(metadata?.id) ? metadata.id : null,
    name: metadata?.name || dirent.name,
    namespace: metadata?.namespace || null,
    version: metadata?.version || null,
    loaded: metadata?.loaded ?? null,
    inActiveProfile: metadata?.inActiveProfile ?? null,
    metadata,
  };
}

function fetchedModSummary(entry) {
  return {
    id: entry.id,
    name: entry.name,
    folder: entry.folder,
    namespace: entry.namespace,
    version: entry.version,
    loaded: entry.loaded,
    inActiveProfile: entry.inActiveProfile,
  };
}

async function fetchedModEntries(root) {
  if (!fs.existsSync(root)) return [];
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const mods = [];
  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue;
    mods.push(await readFetchedModEntry(root, dirent));
  }
  return mods.sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.folder).localeCompare(String(b.folder)));
}

async function selectFetchedMods(args = {}, options = {}) {
  const root = resolveModSourcesDir(args.outDir);
  if (!fs.existsSync(root)) {
    throw new Error(`Fetched mod source directory not found: ${root}. Run mod_manager_fetch_sources first.`);
  }

  const allMods = await fetchedModEntries(root);
  let selected = allMods;
  if (args.modId !== undefined) {
    const modId = numeric(args.modId, undefined, 1);
    selected = selected.filter((entry) => entry.id === modId || entry.folder.startsWith(`${modId}-`));
  }
  if (args.modName) {
    const needle = String(args.modName).toLowerCase();
    selected = selected.filter((entry) =>
      String(entry.name).toLowerCase().includes(needle)
      || String(entry.folder).toLowerCase().includes(needle)
      || String(entry.namespace || '').toLowerCase().includes(needle)
    );
  }

  if (selected.length === 0) {
    throw new Error(`No fetched mod sources matched. Run mod_manager_fetch_sources first or adjust modId/modName. Root: ${root}`);
  }
  if (options.requireSingle && selected.length !== 1) {
    throw new Error(`Expected one fetched mod source, matched ${selected.length}: ${selected.map((entry) => entry.name).join(', ')}`);
  }
  return { root, allMods, selected };
}

function parseRipgrepJson(output, selectedMods, maxResults) {
  const results = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== 'match' && event.type !== 'context') continue;
    const absolutePath = path.resolve(event.data?.path?.text || '');
    const mod = selectedMods.find((entry) => pathInsideRoot(entry.path, absolutePath));
    const relativePath = mod ? path.relative(mod.path, absolutePath).replace(/\\/g, '/') : path.basename(absolutePath);
    results.push({
      type: event.type,
      mod: mod ? fetchedModSummary(mod) : null,
      path: relativePath,
      lineNumber: event.data?.line_number || null,
      text: String(event.data?.lines?.text || '').replace(/\r?\n$/, ''),
      ...(event.type === 'match'
        ? {
            submatches: (event.data?.submatches || []).map((match) => ({
              match: match.match?.text || '',
              start: match.start,
              end: match.end,
            })),
          }
        : {}),
    });
    if (results.length > maxResults) break;
  }
  return {
    results: results.slice(0, maxResults),
    truncated: results.length > maxResults,
  };
}

async function toolModSourceSearch(args = {}) {
  const query = String(args.query || '');
  if (!query) throw new Error('Missing fetched mod source search query.');
  const maxResults = numeric(args.maxResults, 100, 1);
  const context = numeric(args.context, 0, 0);
  const { root, allMods, selected } = await selectFetchedMods(args);
  const relPath = assertSafeRelativePath(args.path || '.');
  const targets = [];
  const missingTargets = [];

  for (const mod of selected) {
    const target = path.resolve(mod.path, relPath);
    if (!pathInsideRoot(mod.path, target)) throw new Error(`Path escapes fetched mod source: ${relPath}`);
    if (fs.existsSync(target)) targets.push(target);
    else missingTargets.push({ mod: fetchedModSummary(mod), path: relPath });
  }

  if (targets.length === 0) {
    throw new Error(`No selected fetched mod source contains path "${relPath}".`);
  }

  const commandArgs = [
    '--json',
    '--line-number',
    '--color',
    'never',
    '--no-messages',
    '--context',
    String(context),
    '--glob',
    '!mod-source.json',
  ];
  if (args.ignoreCase !== false) commandArgs.push('--ignore-case');
  if (!args.regex) commandArgs.push('--fixed-strings');
  commandArgs.push('--', query, ...targets);

  const output = runAllowNoMatches('rg', commandArgs);
  const parsed = parseRipgrepJson(output, selected, maxResults);
  return textContent(JSON.stringify({
    query,
    regex: Boolean(args.regex),
    ignoreCase: args.ignoreCase !== false,
    root,
    searchedMods: selected.map(fetchedModSummary),
    availableMods: allMods.length,
    path: relPath,
    missingTargets,
    ...parsed,
  }, null, 2));
}

async function toolModSourceRead(args = {}) {
  const relPath = assertSafeRelativePath(args.path);
  const startLine = numeric(args.startLine, 1, 1);
  const maxLines = numeric(args.maxLines, 200, 1, 1000);
  const { root, selected } = await selectFetchedMods(args, { requireSingle: true });
  const [mod] = selected;
  const filePath = path.resolve(mod.path, relPath);
  if (!pathInsideRoot(mod.path, filePath)) throw new Error(`Path escapes fetched mod source: ${relPath}`);
  if (!fs.existsSync(filePath)) throw new Error(`Fetched mod source file not found: ${relPath} in ${mod.name}`);

  const text = await fsp.readFile(filePath, 'utf8');
  const lines = text.split('\n');
  const selectedLines = lines.slice(startLine - 1, startLine - 1 + maxLines);
  const numbered = selectedLines.map((line, index) => `${startLine + index}:${line}`).join('\n');

  return textContent(JSON.stringify({
    root,
    mod: fetchedModSummary(mod),
    path: relPath,
    startLine,
    maxLines,
    text: numbered,
  }, null, 2));
}

async function toolBrowserCheck() {
  const output = run(process.execPath, [path.join(REPO_ROOT, 'scripts/mod-test.mjs'), '--mode', 'check']);
  return textContent(output);
}

function appendModManagerArgs(commandArgs, args = {}, mode) {
  commandArgs.push(path.join(REPO_ROOT, 'scripts/mod-manager-sources.mjs'), '--mode', mode);
  commandArgs.push('--url', args.url || DEFAULT_MELVOR_URL);
  commandArgs.push('--timeout-ms', String(numeric(args.timeoutMs, 90000, 1000)));
  commandArgs.push('--wait-ms', String(numeric(args.waitMs, 10000, 0)));
  if (args.includeDisabled) commandArgs.push('--include-disabled');
  if (args.headful) commandArgs.push('--headful');
  if (args.modioRecovery) commandArgs.push('--modio-recovery', args.modioRecovery);
  if (args.screenshot === false) commandArgs.push('--no-screenshot');
  if (args.reportDir) commandArgs.push('--report-dir', args.reportDir);
  if (args.storageState) commandArgs.push('--storage-state', args.storageState);
  if (mode === 'fetch') commandArgs.push('--out', args.outDir || DEFAULT_MOD_SOURCES_DIR);
}

function browserSessionId(args = {}) {
  return String(args.sessionId || 'default').trim() || 'default';
}

function configuredSaveSlot(args = {}) {
  if (args.saveSlot !== undefined) return numeric(args.saveSlot, undefined, 0);
  const configured = String(process.env.MELVOR_TEST_CHARACTER_SLOT || '').trim();
  if (!configured) return null;
  return numeric(configured, undefined, 0);
}

function authUrlFor(url) {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/[^/]*$/, 'index.php');
  parsed.search = '';
  parsed.hash = '';
  return parsed.href;
}

async function gotoAndSettle(page, url, timeoutMs) {
  await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
}

async function newReportDir(root, label) {
  const dir = path.resolve(root || DEFAULT_REPORTS_DIR, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function recordSessionBrowserEvent(session, event) {
  const observedAt = new Date().toISOString();
  const dedupeKey = JSON.stringify({
    type: event.type || '',
    level: event.level || '',
    text: event.text || '',
    location: event.location || '',
    url: event.url || '',
    failure: event.failure || '',
  });
  const previous = session.browserEvents.at(-1);
  if (previous?.dedupeKey === dedupeKey) {
    previous.count = (previous.count || 1) + 1;
    previous.lastObservedAt = observedAt;
    return;
  }
  session.browserEvents.push({ ...event, observedAt, count: 1, dedupeKey });
  if (session.browserEvents.length > 500) session.browserEvents.shift();
}

function visibleBrowserEvents(session, maxBrowserEvents = 50) {
  const max = numeric(maxBrowserEvents, 50, 0);
  return session.browserEvents.slice(max === 0 ? session.browserEvents.length : -max).map(({ dedupeKey, ...event }) => event);
}

function cdpMetricsToObject(result) {
  const metrics = {};
  for (const metric of result?.metrics || []) {
    if (!metric?.name) continue;
    metrics[metric.name] = metric.value;
  }
  return metrics;
}

function metricDeltas(current = {}, baseline = {}) {
  const deltas = {};
  for (const [key, value] of Object.entries(current || {})) {
    if (typeof value !== 'number' || typeof baseline?.[key] !== 'number') continue;
    deltas[key] = value - baseline[key];
  }
  return deltas;
}

async function readCdpPerformanceSnapshot(cdpSession) {
  const metrics = cdpMetricsToObject(await cdpSession.send('Performance.getMetrics'));
  let heapUsage = null;
  try {
    heapUsage = await cdpSession.send('Runtime.getHeapUsage');
  } catch (error) {
    heapUsage = { error: error instanceof Error ? error.message : String(error) };
  }
  return {
    capturedAt: new Date().toISOString(),
    metrics,
    heapUsage,
  };
}

function cpuProfileFunctionKey(node) {
  const frame = node?.callFrame || {};
  const functionName = frame.functionName || '(anonymous)';
  const url = frame.url || '';
  const lineNumber = Number.isFinite(frame.lineNumber) ? frame.lineNumber + 1 : null;
  const columnNumber = Number.isFinite(frame.columnNumber) ? frame.columnNumber + 1 : null;
  return JSON.stringify({ functionName, url, lineNumber, columnNumber });
}

function summarizeCpuProfile(cpuProfile, maxFunctions = 25) {
  const nodes = Array.isArray(cpuProfile?.nodes) ? cpuProfile.nodes : [];
  const samples = Array.isArray(cpuProfile?.samples) ? cpuProfile.samples : [];
  const timeDeltas = Array.isArray(cpuProfile?.timeDeltas) ? cpuProfile.timeDeltas : [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const fallbackDeltaMicros =
    samples.length > 0 && Number.isFinite(cpuProfile?.startTime) && Number.isFinite(cpuProfile?.endTime)
      ? Math.max(0, cpuProfile.endTime - cpuProfile.startTime) / samples.length
      : 0;
  const byFunction = new Map();
  let totalSelfTimeMs = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const node = nodeById.get(samples[index]);
    if (!node) continue;
    const deltaMicros = Number.isFinite(timeDeltas[index]) ? timeDeltas[index] : fallbackDeltaMicros;
    const selfTimeMs = Math.max(0, deltaMicros / 1000);
    const key = cpuProfileFunctionKey(node);
    const frame = node.callFrame || {};
    const existing = byFunction.get(key) || {
      functionName: frame.functionName || '(anonymous)',
      url: frame.url || '',
      lineNumber: Number.isFinite(frame.lineNumber) ? frame.lineNumber + 1 : null,
      columnNumber: Number.isFinite(frame.columnNumber) ? frame.columnNumber + 1 : null,
      sampleCount: 0,
      selfTimeMs: 0,
    };
    existing.sampleCount += 1;
    existing.selfTimeMs += selfTimeMs;
    byFunction.set(key, existing);
    totalSelfTimeMs += selfTimeMs;
  }

  const topFunctions = [...byFunction.values()]
    .sort((a, b) => b.selfTimeMs - a.selfTimeMs)
    .slice(0, maxFunctions === 0 ? byFunction.size : maxFunctions)
    .map((entry) => ({
      ...entry,
      selfTimeMs: Number(entry.selfTimeMs.toFixed(3)),
      percent: totalSelfTimeMs > 0 ? Number(((entry.selfTimeMs / totalSelfTimeMs) * 100).toFixed(2)) : 0,
    }));

  return {
    totalSelfTimeMs: Number(totalSelfTimeMs.toFixed(3)),
    sampleCount: samples.length,
    nodeCount: nodes.length,
    startTime: cpuProfile?.startTime ?? null,
    endTime: cpuProfile?.endTime ?? null,
    topFunctions,
  };
}

async function readBrowserProfileSnapshot(session) {
  const profile = session.profile;
  if (!profile) return null;
  if (profile.browserProfileStop || profile.cpuProfileStop) {
    return {
      cpuProfileActive: false,
      browserMetricsActive: false,
      start: profile.browserProfileStart || null,
      stop: profile.browserProfileStop || null,
      metricDeltas: profile.browserProfileStop?.metrics
        ? metricDeltas(profile.browserProfileStop.metrics, profile.browserProfileStart?.metrics || {})
        : null,
      cpuProfile: profile.cpuProfileStop || null,
      warnings: profile.cdpWarnings || [],
    };
  }
  if (!profile.cdpSession) {
    return {
      cpuProfileActive: false,
      browserMetricsActive: false,
      warnings: profile.cdpWarnings || [],
    };
  }
  const snapshot = profile.browserMetrics ? await readCdpPerformanceSnapshot(profile.cdpSession) : null;
  return {
    cpuProfileActive: Boolean(profile.cpuProfile && profile.active),
    browserMetricsActive: Boolean(profile.browserMetrics && profile.active),
    samplingIntervalMicros: profile.samplingIntervalMicros || null,
    start: profile.browserProfileStart || null,
    current: snapshot,
    metricDeltas: snapshot?.metrics ? metricDeltas(snapshot.metrics, profile.browserProfileStart?.metrics || {}) : null,
    warnings: profile.cdpWarnings || [],
  };
}

async function readModioUnreachablePrompt(page) {
  return await page
    .evaluate(() => {
      const popup = document.querySelector('.swal2-popup');
      if (!popup) return { present: false };
      const style = window.getComputedStyle(popup);
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && !popup.classList.contains('swal2-hide');
      const title = document.querySelector('.swal2-title')?.textContent?.trim() || '';
      const body = document.querySelector('.swal2-html-container')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const text = `${title}\n${body}`.trim();
      return {
        present: Boolean(visible && /mod\.io unreachable|mod\.io service cannot be reached/i.test(text)),
        title,
        text,
      };
    })
    .catch(() => ({ present: false }));
}

async function handleModioUnreachablePrompt(page, options) {
  const prompt = await readModioUnreachablePrompt(page);
  if (!prompt.present) return null;

  const action = options.modioRecovery || 'local';
  const event = {
    action,
    title: prompt.title,
    text: prompt.text,
    observedAt: new Date().toISOString(),
  };
  options.modioRecoveryActions = [...(options.modioRecoveryActions || []), event];

  if (action === 'fail') throw new Error(`mod.io unreachable prompt is open: ${prompt.text}`);

  await page.locator(action === 'reload' ? '.swal2-confirm' : '.swal2-deny').click({ timeout: 5000 });
  if (action === 'reload') {
    await page.waitForLoadState('domcontentloaded', { timeout: options.timeoutMs }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: options.timeoutMs }).catch(() => {});
  } else {
    await page
      .waitForFunction(
        () => {
          const popup = document.querySelector('.swal2-popup');
          if (!popup) return true;
          const style = window.getComputedStyle(popup);
          return style.display === 'none' || style.visibility === 'hidden' || popup.classList.contains('swal2-hide');
        },
        undefined,
        { timeout: 10000 }
      )
      .catch(() => {});
    await page.waitForTimeout(1000).catch(() => {});
  }
  return event;
}

async function isLoggedIn(page) {
  return await page.evaluate(() => {
    const playFabLoggedIn =
      (typeof PlayFabClientSDK !== 'undefined' && PlayFabClientSDK.IsClientLoggedIn?.()) ||
      (typeof PlayFab !== 'undefined' && PlayFab.ClientApi?.IsClientLoggedIn?.()) ||
      false;
    return Boolean(playFabLoggedIn || localStorage.getItem('melvorCloudAuthToken'));
  });
}

async function loginIfNeeded(page, options) {
  if (await isLoggedIn(page)) return { attempted: false, ok: true, reason: 'already logged in' };
  if (!options.username || !options.password) {
    return { attempted: false, ok: false, reason: 'missing MELVOR_CLOUD_USERNAME or MELVOR_CLOUD_PASSWORD' };
  }

  await gotoAndSettle(page, authUrlFor(options.url), options.timeoutMs);
  await page
    .evaluate(() => {
      if (typeof cloudManager !== 'undefined') cloudManager.showSignInContainer?.();
    })
    .catch(() => {});
  await page.waitForSelector('#formElements-signIn-username', { timeout: options.timeoutMs });
  await page.evaluate(
    ({ username, password }) => {
      const usernameInput = document.querySelector('#formElements-signIn-username');
      const passwordInput = document.querySelector('#formElements-signIn-password');
      const submit = document.querySelector('#formElements-signIn-submit');
      if (!usernameInput || !passwordInput || !submit) throw new Error('Melvor Cloud login form was not found.');
      usernameInput.value = username;
      passwordInput.value = password;
      for (const element of [usernameInput, passwordInput]) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
      submit.click();
    },
    { username: options.username, password: options.password }
  );

  await page.waitForFunction(
    () =>
      Boolean(
        (typeof PlayFabClientSDK !== 'undefined' && PlayFabClientSDK.IsClientLoggedIn?.()) ||
          (typeof PlayFab !== 'undefined' && PlayFab.ClientApi?.IsClientLoggedIn?.()) ||
          localStorage.getItem('melvorCloudAuthToken')
      ),
    undefined,
    { timeout: options.timeoutMs }
  );

  return { attempted: true, ok: true, reason: 'logged in' };
}

async function waitForModManager(page, options, { navigate = true } = {}) {
  if (navigate) await gotoAndSettle(page, options.url, options.timeoutMs);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForFunction(
      () =>
        Boolean(
          typeof mod !== 'undefined' &&
            mod.manager &&
            typeof mod.manager.getLoadedModList === 'function' &&
            typeof globalThis.indexedDB === 'object'
        ),
      undefined,
      { timeout: options.timeoutMs }
    );

    const earlyRecovery = await handleModioUnreachablePrompt(page, options);
    if (earlyRecovery?.action === 'reload') continue;

    await page
      .waitForFunction(() => typeof mod === 'undefined' || !mod.manager?.isProcessing?.(), undefined, {
        timeout: Math.min(options.timeoutMs, 30000),
      })
      .catch(() => {});
    if (options.waitMs > 0) await page.waitForTimeout(options.waitMs);

    const lateRecovery = await handleModioUnreachablePrompt(page, options);
    if (lateRecovery?.action === 'reload') continue;
    return;
  }
  throw new Error('mod.io unreachable prompt kept reappearing after recovery attempts.');
}

async function waitForSaveSelection(page, options) {
  await page.waitForFunction(
    ({ saveSlot, saveSource }) => {
      let headers;
      if (saveSource === 'cloud') {
        if (typeof cloudSaveHeaders === 'undefined') return false;
        headers = cloudSaveHeaders;
      } else {
        if (typeof localSaveHeaders === 'undefined') return false;
        headers = localSaveHeaders;
      }
      return Boolean(
        typeof loadCloudSave === 'function' &&
          typeof loadLocalSave === 'function' &&
          typeof cloudManager !== 'undefined' &&
          typeof mod !== 'undefined' &&
          Array.isArray(headers) &&
          headers.length > saveSlot
      );
    },
    { saveSlot: options.saveSlot, saveSource: options.saveSource },
    { timeout: options.timeoutMs }
  );
}

async function installReadOnlySaveGuard(page) {
  return await page.evaluate(() => {
    const mark = Symbol.for('mcpReadOnlySaveGuardInstalled');
    if (globalThis[mark]) return { installed: false, alreadyInstalled: true };
    globalThis[mark] = true;
    globalThis.__mcpBlockedSaveWrites = [];
    globalThis.__mcpBlockedSaveWriteSummary = {};
    const record = (kind, detail = {}) => {
      const at = new Date().toISOString();
      const key = JSON.stringify({ kind, detail });
      const summary = globalThis.__mcpBlockedSaveWriteSummary[key] || {
        kind,
        detail,
        count: 0,
        firstAt: at,
        lastAt: at,
      };
      summary.count += 1;
      summary.lastAt = at;
      globalThis.__mcpBlockedSaveWriteSummary[key] = summary;
      globalThis.__mcpBlockedSaveWrites.push({ kind, ...detail, at });
      if (globalThis.__mcpBlockedSaveWrites.length > 25) globalThis.__mcpBlockedSaveWrites.shift();
      if (summary.count === 1 || summary.count % 250 === 0) {
        console.warn('[MCP read-only save guard] blocked save write', kind, { ...detail, count: summary.count });
      }
    };

    if (typeof saveData === 'function') {
      globalThis.__mcpOriginalSaveData = saveData;
      saveData = () => {
        record('saveData');
        return false;
      };
    }

    const storageSetItem = globalThis.__mcpOriginalStorageSetItem || Storage.prototype.setItem;
    globalThis.__mcpOriginalStorageSetItem = storageSetItem;
    Storage.prototype.setItem = function guardedSetItem(key, value) {
      const stringKey = String(key);
      if (/^MI-(?:test-|beta-)?\d+-.*saveGame$/.test(stringKey)) {
        record('localStorage.setItem', { key: stringKey });
        return undefined;
      }
      return storageSetItem.call(this, key, value);
    };

    if (typeof nativeManager !== 'undefined' && typeof nativeManager.saveToNativeCloudBackup === 'function') {
      nativeManager.saveToNativeCloudBackup = (key, value) => {
        record('nativeManager.saveToNativeCloudBackup', { key: String(key), bytes: String(value ?? '').length });
        return false;
      };
    }

    if (typeof cloudManager !== 'undefined') {
      for (const name of ['forceUpdatePlayFabSave', 'saveToSteamCloud', 'deletePlayFabSave', 'deleteFromSteamCloud']) {
        if (typeof cloudManager[name] !== 'function') continue;
        const original = cloudManager[name].bind(cloudManager);
        globalThis[`__mcpOriginalCloudManager_${name}`] = original;
        cloudManager[name] = (...args) => {
          record(`cloudManager.${name}`, { args: args.map((arg) => String(arg)).slice(0, 3) });
          return name === 'forceUpdatePlayFabSave' ? Promise.resolve() : false;
        };
      }
    }

    const updateUserData =
      typeof PlayFab !== 'undefined' && PlayFab.ClientApi && typeof PlayFab.ClientApi.UpdateUserData === 'function'
        ? PlayFab.ClientApi.UpdateUserData
        : null;
    if (updateUserData) {
      PlayFab.ClientApi.UpdateUserData = (request, callback) => {
        const dataKeys = Object.keys(request?.Data || {});
        const removeKeys = request?.KeysToRemove || [];
        const touchesSave = [...dataKeys, ...removeKeys].some((key) => /^save\d+(?:_beta|_test)?$/.test(String(key)) || key === 'currentGamemode');
        if (touchesSave) {
          record('PlayFab.ClientApi.UpdateUserData', { dataKeys, removeKeys });
          callback?.({ code: 200, data: { DataVersion: -1 } }, null);
          return undefined;
        }
        return updateUserData.call(PlayFab.ClientApi, request, callback);
      };
    }

    return { installed: true, alreadyInstalled: false };
  });
}

async function loadGameSaveInSession(page, options) {
  if (!Number.isInteger(options.saveSlot)) {
    throw new Error('game_session_start with loadSave=true requires saveSlot or MELVOR_TEST_CHARACTER_SLOT.');
  }
  await waitForSaveSelection(page, options);
  const guard = options.readOnly ? await installReadOnlySaveGuard(page) : { installed: false, disabled: true };
  const loadResult = await page.evaluate(
    async ({ saveSlot, saveSource }) => {
      const headers = saveSource === 'cloud' ? cloudSaveHeaders : localSaveHeaders;
      const header = headers?.[saveSlot];
      if (typeof header === 'number') throw new Error(`${saveSource} save slot ${saveSlot} is not loadable; header code ${header}.`);
      if (!header) throw new Error(`${saveSource} save slot ${saveSlot} was not found.`);
      if (saveSource === 'cloud') {
        const saveString = cloudManager.getPlayFabSave(saveSlot);
        if (!saveString) throw new Error(`Cloud save slot ${saveSlot} has no save string.`);
        await loadCloudSave(saveSlot);
      } else {
        await loadLocalSave(saveSlot);
      }
      return {
        header: {
          characterName: header.characterName || null,
          saveVersion: header.saveVersion ?? null,
          currentGamemode: header.currentGamemode?.id || header.currentGamemode || null,
          totalSkillLevel: header.totalSkillLevel ?? null,
          gp: header.gp ?? null,
          tickTimestamp: header.tickTimestamp ?? null,
        },
      };
    },
    { saveSlot: options.saveSlot, saveSource: options.saveSource }
  );
  await page.waitForFunction(
    () =>
      Boolean(
        typeof game !== 'undefined' &&
          game.currentGamemode &&
          typeof isLoaded !== 'undefined' &&
          isLoaded === true &&
          typeof inCharacterSelection !== 'undefined' &&
          inCharacterSelection === false
      ),
    undefined,
    { timeout: options.timeoutMs }
  );
  return { guard, ...loadResult };
}

async function collectGameSessionState(session, args = {}) {
  const state = await session.page.evaluate(() => {
    const loadedMods = typeof mod !== 'undefined' ? mod.manager?.getLoadedModList?.() || [] : [];
    let optimizerContext = null;
    try {
      optimizerContext = typeof mod !== 'undefined' ? mod.getContext?.('pavr_optimizer') || null : null;
    } catch {}
    const modal = document.querySelector('.swal2-popup');
    const modalStyle = modal ? window.getComputedStyle(modal) : null;
    const modalVisible = Boolean(modal && modalStyle?.display !== 'none' && modalStyle?.visibility !== 'hidden');
    return {
      location: location.href,
      title: document.title,
      isLoggedIn: Boolean(
        (typeof PlayFabClientSDK !== 'undefined' && PlayFabClientSDK.IsClientLoggedIn?.()) ||
          (typeof PlayFab !== 'undefined' && PlayFab.ClientApi?.IsClientLoggedIn?.()) ||
          localStorage.getItem('melvorCloudAuthToken')
      ),
      modManager: {
        isEnabled: Boolean(typeof mod !== 'undefined' && mod.manager?.isEnabled?.()),
        isProcessing: Boolean(typeof mod !== 'undefined' && mod.manager?.isProcessing?.()),
        activeProfile: typeof mod !== 'undefined' ? mod.manager?.activeProfile || null : null,
      },
      game: {
        loaded: typeof isLoaded !== 'undefined' ? Boolean(isLoaded) : false,
        inCharacterSelection: typeof inCharacterSelection !== 'undefined' ? Boolean(inCharacterSelection) : null,
        currentCharacter: typeof currentCharacter !== 'undefined' ? currentCharacter : null,
        characterName: typeof game !== 'undefined' ? game.characterName || null : null,
        gamemode: typeof game !== 'undefined' ? { id: game.currentGamemode?.id || null, name: game.currentGamemode?.name || null } : null,
        activePage: typeof game !== 'undefined' ? game.activePage?.id || game.activeActionPage?.id || null : null,
        activeAction: typeof game !== 'undefined' ? game.activeAction?.id || game.activeAction?.name || null : null,
        gp: typeof game !== 'undefined' ? game.gp?.amount ?? null : null,
        bankItems: typeof game !== 'undefined' ? game.bank?.items?.length ?? null : null,
        enableRendering: typeof game !== 'undefined' ? game.enableRendering ?? null : null,
      },
      loadedMods,
      optimizer: {
        present: Boolean(
          optimizerContext ||
            globalThis.melvorOptimizerSettings ||
            globalThis.__melvorOptimizerApplyQSA ||
            globalThis.__melvorOptimizerOriginalQSA
        ),
        contextAvailable: Boolean(optimizerContext),
        inOfflineLoop: optimizerContext?._inOfflineLoop ?? null,
        settings: globalThis.melvorOptimizerSettings ? { ...globalThis.melvorOptimizerSettings } : null,
        qsaPatchAvailable: typeof globalThis.__melvorOptimizerApplyQSA === 'function',
        qsaRestoreAvailable: typeof globalThis.melvorOptimizerRestore === 'function',
        querySelectorAllName: document.querySelectorAll?.name || '',
        querySelectorAllPatched: document.querySelectorAll?.name === 'patchedQuerySelectorAll',
      },
      readOnlySaveWritesBlocked: globalThis.__mcpBlockedSaveWrites || [],
      readOnlySaveWriteSummary: Object.values(globalThis.__mcpBlockedSaveWriteSummary || {}),
      profile: globalThis.__mcpProfile
        ? {
            active: Boolean(globalThis.__mcpProfile.active),
            label: globalThis.__mcpProfile.label,
            startedAtIso: globalThis.__mcpProfile.startedAtIso,
            stoppedAtIso: globalThis.__mcpProfile.stoppedAtIso || null,
            durationMs: Math.max(0, performance.now() - globalThis.__mcpProfile.startedAt),
          }
        : null,
      modal: modalVisible
        ? {
            title: document.querySelector('.swal2-title')?.textContent?.trim() || '',
            text: document.querySelector('.swal2-html-container')?.textContent?.replace(/\s+/g, ' ').trim() || '',
          }
        : null,
    };
  });

  return {
    sessionId: session.id,
    createdAt: session.createdAt,
    closed: session.page.isClosed(),
    ...state,
    browserEvents: visibleBrowserEvents(session, args.maxBrowserEvents ?? 50),
  };
}

function resolveSaveFixturesDir(saveDir) {
  return path.resolve(saveDir || DEFAULT_SAVE_FIXTURES_DIR);
}

function safeSaveFixtureName(name) {
  const value = String(name || '').trim();
  if (!value) throw new Error('Save fixture name is required.');
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error('Save fixture names may only contain letters, numbers, dot, underscore, and hyphen.');
  }
  if (value === '.' || value === '..') throw new Error('Invalid save fixture name.');
  return value.replace(/\.json$/i, '');
}

function saveFixturePath(saveDir, fixture) {
  const root = resolveSaveFixturesDir(saveDir);
  const filePath = path.join(root, `${safeSaveFixtureName(fixture)}.json`);
  if (!pathInsideRoot(root, filePath)) throw new Error('Save fixture path escapes the save fixture directory.');
  return { root, filePath };
}

function saveStringHash(saveString) {
  return crypto.createHash('sha256').update(String(saveString)).digest('hex');
}

function redactSaveFixture(fixture) {
  if (!fixture) return fixture;
  const { saveString, ...rest } = fixture;
  return {
    ...rest,
    saveStringBytes: String(saveString || '').length,
    saveStringSha256: saveString ? saveStringHash(saveString) : null,
  };
}

async function listSaveFixtures(saveDir) {
  const root = resolveSaveFixturesDir(saveDir);
  if (!fs.existsSync(root)) return { root, fixtures: [] };
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const fixtures = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(root, entry.name);
    try {
      const parsed = JSON.parse(await fsp.readFile(filePath, 'utf8'));
      fixtures.push({
        file: entry.name,
        path: filePath,
        ...redactSaveFixture(parsed),
      });
    } catch (error) {
      fixtures.push({
        file: entry.name,
        path: filePath,
        unreadable: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  fixtures.sort((a, b) => String(a.name || a.file).localeCompare(String(b.name || b.file)));
  return { root, fixtures };
}

async function readSaveFixture(saveDir, fixtureName) {
  const { root, filePath } = saveFixturePath(saveDir, fixtureName);
  const parsed = JSON.parse(await fsp.readFile(filePath, 'utf8'));
  if (!parsed.saveString || typeof parsed.saveString !== 'string') {
    throw new Error(`Save fixture "${fixtureName}" does not contain a saveString.`);
  }
  return { root, filePath, fixture: parsed };
}

async function writeSaveFixture(saveDir, fixtureName, fixture) {
  const { root, filePath } = saveFixturePath(saveDir, fixtureName);
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(fixture, null, 2)}\n`);
  return { root, filePath, fixture: redactSaveFixture(fixture) };
}

async function readSaveSlots(session) {
  return await session.page.evaluate(async () => {
    function serializeHeader(header) {
      if (typeof header === 'number') {
        const statuses = {
          0: 'empty',
          1: 'corrupt',
          2: 'invalidVersion',
        };
        return { status: statuses[header] || 'error', code: header };
      }
      if (!header) return { status: 'missing' };
      return {
        status: 'ok',
        saveVersion: header.saveVersion ?? null,
        characterName: header.characterName || null,
        currentGamemode: header.currentGamemode
          ? { id: header.currentGamemode.id || null, name: header.currentGamemode.name || null }
          : null,
        totalSkillLevel: header.totalSkillLevel ?? null,
        gp: header.gp ?? null,
        offlineAction: header.offlineAction ? { id: header.offlineAction.id || null, name: header.offlineAction.name || null } : null,
        tickTimestamp: header.tickTimestamp ?? null,
        saveTimestamp: header.saveTimestamp ?? null,
        activeNamespaces: Array.isArray(header.activeNamespaces) ? header.activeNamespaces : [],
        modProfile: header.modProfile || null,
      };
    }

    if (typeof updateLocalSaveHeaders === 'function') await updateLocalSaveHeaders().catch(() => {});
    if (typeof updateCloudSaveHeaders === 'function') await updateCloudSaveHeaders().catch(() => {});

    const localHeaders = typeof localSaveHeaders !== 'undefined' ? localSaveHeaders : [];
    const cloudHeaders = typeof cloudSaveHeaders !== 'undefined' ? cloudSaveHeaders : [];
    const maxSlots = typeof maxSaveSlots === 'number' ? maxSaveSlots : Math.max(localHeaders.length || 0, cloudHeaders.length || 0);
    const local = [];
    const cloud = [];
    for (let slot = 0; slot < maxSlots; slot += 1) {
      local.push({ slot, ...serializeHeader(localHeaders[slot]) });
      cloud.push({ slot, ...serializeHeader(cloudHeaders[slot]) });
    }
    return {
      maxSaveSlots: maxSlots,
      currentCharacter: typeof currentCharacter !== 'undefined' ? currentCharacter : null,
      inCharacterSelection: typeof inCharacterSelection !== 'undefined' ? Boolean(inCharacterSelection) : null,
      gameLoaded: typeof isLoaded !== 'undefined' ? Boolean(isLoaded) : false,
      local,
      cloud,
    };
  });
}

async function readSaveStringFromSlot(session, saveSource, saveSlot) {
  return await session.page.evaluate(
    async ({ saveSource, saveSlot }) => {
      function serializeHeader(header) {
        if (typeof header === 'number') return { status: 'error', code: header };
        if (!header) return { status: 'missing' };
        return {
          status: 'ok',
          saveVersion: header.saveVersion ?? null,
          characterName: header.characterName || null,
          currentGamemode: header.currentGamemode
            ? { id: header.currentGamemode.id || null, name: header.currentGamemode.name || null }
            : null,
          totalSkillLevel: header.totalSkillLevel ?? null,
          gp: header.gp ?? null,
          tickTimestamp: header.tickTimestamp ?? null,
          saveTimestamp: header.saveTimestamp ?? null,
          activeNamespaces: Array.isArray(header.activeNamespaces) ? header.activeNamespaces : [],
          modProfile: header.modProfile || null,
        };
      }
      let saveString = '';
      if (saveSource === 'cloud') {
        if (typeof cloudManager === 'undefined' || typeof cloudManager.getPlayFabSave !== 'function') {
          throw new Error('cloudManager.getPlayFabSave is not available.');
        }
        saveString = cloudManager.getPlayFabSave(saveSlot);
      } else {
        if (typeof getLocalSaveString !== 'function') throw new Error('getLocalSaveString is not available.');
        saveString = await getLocalSaveString(true, saveSlot);
      }
      if (!saveString) throw new Error(`${saveSource} save slot ${saveSlot} is empty.`);
      const header = await game.getHeaderFromSaveString(saveString);
      if (typeof header === 'number') throw new Error(`${saveSource} save slot ${saveSlot} is not valid; header code ${header}.`);
      return { saveString, header: serializeHeader(header) };
    },
    { saveSource, saveSlot }
  );
}

async function readCurrentSaveString(session) {
  return await session.page.evaluate(async () => {
    function serializeHeader(header) {
      if (typeof header === 'number') return { status: 'error', code: header };
      if (!header) return { status: 'missing' };
      return {
        status: 'ok',
        saveVersion: header.saveVersion ?? null,
        characterName: header.characterName || null,
        currentGamemode: header.currentGamemode
          ? { id: header.currentGamemode.id || null, name: header.currentGamemode.name || null }
          : null,
        totalSkillLevel: header.totalSkillLevel ?? null,
        gp: header.gp ?? null,
        tickTimestamp: header.tickTimestamp ?? null,
        saveTimestamp: header.saveTimestamp ?? null,
        activeNamespaces: Array.isArray(header.activeNamespaces) ? header.activeNamespaces : [],
        modProfile: header.modProfile || null,
      };
    }
    if (typeof game === 'undefined' || typeof game.generateSaveString !== 'function') {
      throw new Error('A loaded game with game.generateSaveString is required.');
    }
    if (typeof isLoaded !== 'undefined' && !isLoaded) throw new Error('No save is currently loaded.');
    const saveString = game.generateSaveString();
    const header = await game.getHeaderFromSaveString(saveString);
    if (typeof header === 'number') throw new Error(`Generated current save was invalid; header code ${header}.`);
    return {
      saveString,
      header: serializeHeader(header),
      currentCharacter: typeof currentCharacter !== 'undefined' ? currentCharacter : null,
    };
  });
}

async function validateSaveStringInSession(session, saveString) {
  return await session.page.evaluate(async (saveString) => {
    function serializeHeader(header) {
      if (typeof header === 'number') return { status: 'error', code: header };
      if (!header) return { status: 'missing' };
      return {
        status: 'ok',
        saveVersion: header.saveVersion ?? null,
        characterName: header.characterName || null,
        currentGamemode: header.currentGamemode
          ? { id: header.currentGamemode.id || null, name: header.currentGamemode.name || null }
          : null,
        totalSkillLevel: header.totalSkillLevel ?? null,
        gp: header.gp ?? null,
        tickTimestamp: header.tickTimestamp ?? null,
        saveTimestamp: header.saveTimestamp ?? null,
        activeNamespaces: Array.isArray(header.activeNamespaces) ? header.activeNamespaces : [],
        modProfile: header.modProfile || null,
      };
    }
    const header = await game.getHeaderFromSaveString(saveString);
    if (typeof header === 'number') throw new Error(`Save string is invalid; header code ${header}.`);
    return serializeHeader(header);
  }, String(saveString || ''));
}

async function writeSaveStringToLocalSlot(session, saveString, targetSlot, overwriteLocalSlot = false) {
  return await session.page.evaluate(
    async ({ saveString, targetSlot, overwriteLocalSlot }) => {
      function serializeHeader(header) {
        if (typeof header === 'number') return { status: 'error', code: header };
        if (!header) return { status: 'missing' };
        return {
          status: 'ok',
          saveVersion: header.saveVersion ?? null,
          characterName: header.characterName || null,
          currentGamemode: header.currentGamemode
            ? { id: header.currentGamemode.id || null, name: header.currentGamemode.name || null }
            : null,
          totalSkillLevel: header.totalSkillLevel ?? null,
          gp: header.gp ?? null,
          tickTimestamp: header.tickTimestamp ?? null,
          saveTimestamp: header.saveTimestamp ?? null,
          activeNamespaces: Array.isArray(header.activeNamespaces) ? header.activeNamespaces : [],
          modProfile: header.modProfile || null,
        };
      }
      if (typeof getKeyForSaveSlot !== 'function') throw new Error('getKeyForSaveSlot is not available.');
      const header = await game.getHeaderFromSaveString(saveString);
      if (typeof header === 'number') throw new Error(`Save string is invalid; header code ${header}.`);
      const keyPrefix = getKeyForSaveSlot(targetSlot);
      const key = `${keyPrefix}saveGame`;
      const existing = localStorage.getItem(key);
      if (existing && !overwriteLocalSlot) {
        const existingHeader = await game.getHeaderFromSaveString(existing).catch(() => null);
        throw new Error(
          `Local save slot ${targetSlot} is not empty (${serializeHeader(existingHeader).characterName || 'unknown'}). Pass overwriteLocalSlot=true to replace it.`
        );
      }
      const originalSetItem = globalThis.__mcpOriginalStorageSetItem || Storage.prototype.setItem;
      originalSetItem.call(localStorage, key, saveString);
      if (typeof updateLocalSaveHeaders === 'function') await updateLocalSaveHeaders().catch(() => {});
      return {
        targetSlot,
        key,
        overwritten: Boolean(existing),
        header: serializeHeader(header),
      };
    },
    { saveString, targetSlot, overwriteLocalSlot: Boolean(overwriteLocalSlot) }
  );
}

async function reloadAndLoadSaveSlot(session, args = {}) {
  const saveSlot = numeric(args.saveSlot, undefined, 0);
  const saveSource = args.saveSource || 'local';
  const options = {
    ...session.options,
    saveSlot,
    saveSource,
    timeoutMs: numeric(args.timeoutMs, session.options.timeoutMs || 90000, 1000),
    waitMs: numeric(args.waitMs, session.options.waitMs || 10000, 0),
  };
  if (args.reload !== false) {
    await gotoAndSettle(session.page, options.url, options.timeoutMs);
    await waitForModManager(session.page, options, { navigate: false });
  }
  const load = await loadGameSaveInSession(session.page, options);
  session.load = load;
  const state = await collectGameSessionState(session, { maxBrowserEvents: 50 });
  return {
    load,
    state,
    slots: await readSaveSlots(session).catch(() => null),
  };
}

function fixtureForSaveString({ fixtureName, saveString, header, source, notes }) {
  return {
    schemaVersion: 1,
    name: fixtureName,
    createdAt: new Date().toISOString(),
    source,
    notes: notes || '',
    header,
    saveString,
    saveStringSha256: saveStringHash(saveString),
    saveStringBytes: String(saveString).length,
  };
}

async function readLiveModProfileState(session) {
  const state = await session.page.evaluate(
    async ({ storageKeys, overrideKey }) => {
      function getAllFromIndexedDB(dbName, storeName) {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const getAll = store.getAll();
            getAll.onerror = () => reject(getAll.error);
            getAll.onsuccess = () => {
              db.close();
              resolve(getAll.result || []);
            };
          };
        });
      }

      function parseJsonValue(value, fallback) {
        if (!value) return fallback;
        try {
          return JSON.parse(value);
        } catch {
          return fallback;
        }
      }

      function uniqueNumbers(values) {
        const seen = new Set();
        const output = [];
        for (const value of values || []) {
          const parsed = Number(value);
          if (!Number.isInteger(parsed) || parsed < 1 || seen.has(parsed)) continue;
          seen.add(parsed);
          output.push(parsed);
        }
        return output;
      }

      function dependencyId(dependency) {
        if (typeof dependency === 'number' || typeof dependency === 'string') return Number(dependency);
        if (!dependency || typeof dependency !== 'object') return NaN;
        return Number(dependency.id ?? dependency.mod_id ?? dependency.modId ?? dependency.modio_id ?? dependency.modioId);
      }

      function dependencyIds(dependencies) {
        return uniqueNumbers((dependencies || []).map(dependencyId));
      }

      const rawValues = {};
      for (const key of storageKeys) rawValues[key] = localStorage.getItem(key);

      const manager = typeof mod !== 'undefined' ? mod.manager : null;
      const activeProfile = manager?.activeProfile || null;
      const loadedNames = manager?.getLoadedModList?.() || [];
      let override = parseJsonValue(localStorage.getItem(overrideKey), null);
      if (!override || typeof override !== 'object') override = null;

      let profiles = parseJsonValue(rawValues.modProfiles, null);
      if (!Array.isArray(profiles)) profiles = activeProfile ? [activeProfile] : [];
      profiles = profiles.map((profile) => ({
        ...profile,
        mods: uniqueNumbers(profile.mods || []),
        autoEnable: Boolean(profile.autoEnable),
      }));

      const loadOrder = uniqueNumbers(parseJsonValue(rawValues.modLoadOrder, []));
      const activeProfileId = rawValues.modActiveProfile ?? activeProfile?.id ?? profiles[0]?.id ?? null;
      const storedMods = await getAllFromIndexedDB('melvordb', 'mods');
      const activeProfileModIds = new Set((activeProfile?.mods || []).map((id) => String(id)));
      const installedMods = storedMods.map((stored) => ({
        id: Number(stored.id),
        name: stored.name || '',
        namespace: stored.namespace || null,
        version: stored.version || null,
        dependencyIds: dependencyIds(stored.dependencies || []),
        inActiveProfile: activeProfileModIds.has(String(stored.id)),
        loaded: loadedNames.includes(stored.name),
      }));

      return {
        location: location.href,
        title: document.title,
        rawValues,
        override,
        profiles,
        loadOrder,
        activeProfile,
        activeProfileId,
        loadedNames,
        installedMods,
        modManager: {
          isEnabled: Boolean(manager?.isEnabled?.()),
          isProcessing: Boolean(manager?.isProcessing?.()),
          hasChanges: Boolean(manager?.hasChanges?.()),
        },
      };
    },
    { storageKeys: MOD_PROFILE_STORAGE_KEYS, overrideKey: MOD_PROFILE_OVERRIDE_STORAGE_KEY }
  );
  return {
    ...state,
    snapshotKeys: [...(session.modProfileSnapshots?.keys?.() || [])],
    temporaryOverrideActive: Boolean(state.override?.values),
  };
}

function normalizeSnapshotKey(value) {
  return String(value || 'default').trim() || 'default';
}

function compactModInfo(mod) {
  if (!mod) return null;
  return {
    id: mod.id,
    name: mod.name,
    namespace: mod.namespace,
    version: mod.version,
    dependencyIds: mod.dependencyIds || [],
  };
}

function storeModProfileSnapshot(session, key, state) {
  if (!session.modProfileSnapshots) session.modProfileSnapshots = new Map();
  const snapshot = {
    key,
    capturedAt: new Date().toISOString(),
    rawValues: { ...state.rawValues },
    activeProfile: state.activeProfile || null,
    activeProfileId: state.activeProfileId ?? null,
    profiles: state.profiles,
    loadOrder: state.loadOrder,
    loadedNames: state.loadedNames,
    installedMods: state.installedMods.map(compactModInfo),
  };
  session.modProfileSnapshots.set(key, snapshot);
  return snapshot;
}

function computeModProfilePlan(state, args = {}) {
  const operation = args.operation || 'status';
  const installedById = new Map(state.installedMods.map((mod) => [Number(mod.id), mod]));
  const requestedRootIds = [];
  if (operation === 'load_only' || operation === 'load_with_dependencies') {
    const modId = numeric(args.modId, undefined, 1);
    requestedRootIds.push(modId);
  } else if (operation === 'load_set') {
    requestedRootIds.push(...uniqueIntegerIds(args.modIds || []));
    if (requestedRootIds.length === 0) throw new Error('game_session_mod_profile load_set requires modIds.');
  }
  requestedRootIds.push(...uniqueIntegerIds(args.additionalModIds || []));

  const includeDependencies = operation === 'load_with_dependencies' || (operation === 'load_set' && args.includeDependencies !== false);
  const unresolvedDependencies = [];
  const missingRequested = requestedRootIds.filter((id) => !installedById.has(id));
  if (missingRequested.length > 0) {
    throw new Error(`Requested mod id(s) are not installed in this browser session: ${missingRequested.join(', ')}`);
  }

  const included = [];
  const seen = new Set();
  const visiting = new Set();
  const visit = (id, chain = []) => {
    if (seen.has(id)) return;
    const modInfo = installedById.get(id);
    if (!modInfo) {
      unresolvedDependencies.push({ id, requiredBy: chain.at(-1) || null, chain });
      return;
    }
    if (visiting.has(id)) return;
    visiting.add(id);
    if (includeDependencies) {
      for (const dependencyId of modInfo.dependencyIds || []) visit(Number(dependencyId), [...chain, id]);
    }
    visiting.delete(id);
    seen.add(id);
    included.push(id);
  };

  for (const id of requestedRootIds) visit(id, []);

  const allowUnresolvedDependencies = Boolean(args.allowUnresolvedDependencies);
  const activeProfile = state.activeProfile || state.profiles[0] || null;
  const targetProfile =
    state.profiles.find((profile) => activeProfile && String(profile.id) === String(activeProfile.id)) ||
    state.profiles.find((profile) => state.activeProfileId !== null && String(profile.id) === String(state.activeProfileId)) ||
    state.profiles[0] ||
    {
      id: 'mcp-temporary-profile',
      name: 'MCP Temporary Profile',
      mods: [],
      autoEnable: false,
    };

  const nextProfiles = state.profiles.some((profile) => String(profile.id) === String(targetProfile.id))
    ? state.profiles.map((profile) =>
        String(profile.id) === String(targetProfile.id)
          ? {
              ...profile,
              mods: included,
            }
          : profile
      )
    : [
        ...state.profiles,
        {
          ...targetProfile,
          mods: included,
        },
      ];

  const nextValues = { ...state.rawValues };
  nextValues.modProfiles = JSON.stringify(nextProfiles);
  nextValues.modLoadOrder = JSON.stringify(included);
  nextValues.modActiveProfile = String(targetProfile.id);

  const selectedMods = included.map((id) => compactModInfo(installedById.get(id))).filter(Boolean);
  return {
    operation,
    includeDependencies,
    requestedRootIds,
    selectedIds: included,
    selectedMods,
    targetProfile: {
      id: targetProfile.id,
      name: targetProfile.name || null,
      previousMods: targetProfile.mods || [],
      nextMods: included,
    },
    unresolvedDependencies,
    canApply: unresolvedDependencies.length === 0 || allowUnresolvedDependencies,
    nextValues,
  };
}

async function ensureModProfileOverrideScript(session) {
  if (session.modProfileOverrideScriptInstalled) return;
  await session.context.addInitScript(
    ({ overrideKey, profileKeys }) => {
      if (globalThis.__mcpTemporaryModProfileHookInstalled) return;
      globalThis.__mcpTemporaryModProfileHookInstalled = true;
      const keySet = new Set(profileKeys);

      function readOverride() {
        try {
          const parsed = JSON.parse(localStorage.getItem(overrideKey) || 'null');
          if (!parsed || typeof parsed !== 'object' || !parsed.values || typeof parsed.values !== 'object') return null;
          return parsed;
        } catch {
          return null;
        }
      }

      function requestedKeySet(request) {
        const keys = request?.Keys || request?.keys || null;
        if (!Array.isArray(keys)) return null;
        return new Set(keys.map(String));
      }

      function mergeUserDataResponse(response, request) {
        const override = readOverride();
        if (!override) return response;
        const requested = requestedKeySet(request);
        const next = {
          ...(response || {}),
          data: {
            ...((response && response.data) || {}),
            Data: {
              ...((response && response.data && response.data.Data) || {}),
            },
          },
        };
        for (const [key, value] of Object.entries(override.values)) {
          if (!keySet.has(key)) continue;
          if (requested && !requested.has(key)) continue;
          if (value === null || value === undefined) delete next.data.Data[key];
          else next.data.Data[key] = { ...(next.data.Data[key] || {}), Value: String(value) };
        }
        return next;
      }

      function recordBlockedUpdate(keys) {
        const at = new Date().toISOString();
        globalThis.__mcpTemporaryModProfileBlockedUpdates = globalThis.__mcpTemporaryModProfileBlockedUpdates || [];
        globalThis.__mcpTemporaryModProfileBlockedUpdates.push({ keys, at });
        if (globalThis.__mcpTemporaryModProfileBlockedUpdates.length > 50) {
          globalThis.__mcpTemporaryModProfileBlockedUpdates.shift();
        }
      }

      function sanitizeUpdateRequest(request) {
        const override = readOverride();
        if (!override || !request || typeof request !== 'object') return { request, blockedKeys: [], skip: false };
        const next = { ...request };
        const blockedKeys = [];
        if (request.Data && typeof request.Data === 'object') {
          next.Data = { ...request.Data };
          for (const key of Object.keys(next.Data)) {
            if (!keySet.has(key)) continue;
            blockedKeys.push(key);
            delete next.Data[key];
          }
        }
        if (Array.isArray(request.KeysToRemove)) {
          next.KeysToRemove = request.KeysToRemove.filter((key) => {
            if (!keySet.has(String(key))) return true;
            blockedKeys.push(String(key));
            return false;
          });
        }
        const hasData = next.Data && Object.keys(next.Data).length > 0;
        const hasKeysToRemove = Array.isArray(next.KeysToRemove) && next.KeysToRemove.length > 0;
        return { request: next, blockedKeys: [...new Set(blockedKeys)], skip: blockedKeys.length > 0 && !hasData && !hasKeysToRemove };
      }

      function wrapClientApi(api) {
        if (!api) return;
        if (typeof api.GetUserData === 'function' && !api.GetUserData.__mcpTemporaryModProfileWrapped) {
          const originalGetUserData = api.GetUserData;
          api.GetUserData = function mcpTemporaryModProfileGetUserData(request, callback, ...rest) {
            const wrappedCallback =
              typeof callback === 'function'
                ? (response, error) => callback(mergeUserDataResponse(response, request), error)
                : callback;
            const result = originalGetUserData.call(this, request, wrappedCallback, ...rest);
            if (result && typeof result.then === 'function') {
              return result.then((response) => mergeUserDataResponse(response, request));
            }
            return result;
          };
          api.GetUserData.__mcpTemporaryModProfileWrapped = true;
        }
        if (typeof api.UpdateUserData === 'function' && !api.UpdateUserData.__mcpTemporaryModProfileWrapped) {
          const originalUpdateUserData = api.UpdateUserData;
          api.UpdateUserData = function mcpTemporaryModProfileUpdateUserData(request, callback, ...rest) {
            const sanitized = sanitizeUpdateRequest(request);
            if (sanitized.blockedKeys.length > 0) recordBlockedUpdate(sanitized.blockedKeys);
            if (sanitized.skip) {
              callback?.({ code: 200, data: { DataVersion: -1 } }, null);
              return undefined;
            }
            return originalUpdateUserData.call(this, sanitized.request, callback, ...rest);
          };
          api.UpdateUserData.__mcpTemporaryModProfileWrapped = true;
        }
      }

      function install() {
        wrapClientApi(globalThis.PlayFab?.ClientApi);
      }

      try {
        let currentPlayFab = globalThis.PlayFab;
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'PlayFab');
        if (!descriptor || descriptor.configurable) {
          Object.defineProperty(globalThis, 'PlayFab', {
            configurable: true,
            enumerable: true,
            get() {
              return currentPlayFab;
            },
            set(value) {
              currentPlayFab = value;
              install();
            },
          });
        }
      } catch {}

      install();
      const interval = window.setInterval(install, 5);
      window.setTimeout(() => window.clearInterval(interval), 60000);
    },
    { overrideKey: MOD_PROFILE_OVERRIDE_STORAGE_KEY, profileKeys: MOD_PROFILE_STORAGE_KEYS }
  );
  session.modProfileOverrideScriptInstalled = true;
}

async function writeTemporaryModProfileValues(session, values) {
  await ensureModProfileOverrideScript(session);
  return await session.page.evaluate(
    ({ overrideKey, values }) => {
      const payload = {
        values,
        appliedAt: new Date().toISOString(),
      };
      localStorage.setItem(overrideKey, JSON.stringify(payload));
      for (const [key, value] of Object.entries(values)) {
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, String(value));
      }
      return {
        overrideActive: true,
        rawValues: Object.fromEntries(Object.keys(values).map((key) => [key, localStorage.getItem(key)])),
      };
    },
    { overrideKey: MOD_PROFILE_OVERRIDE_STORAGE_KEY, values }
  );
}

async function restoreModProfileSnapshotValues(session, snapshot) {
  return await session.page.evaluate(
    ({ overrideKey, values }) => {
      localStorage.removeItem(overrideKey);
      for (const [key, value] of Object.entries(values)) {
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, String(value));
      }
      return {
        overrideActive: false,
        rawValues: Object.fromEntries(Object.keys(values).map((key) => [key, localStorage.getItem(key)])),
      };
    },
    { overrideKey: MOD_PROFILE_OVERRIDE_STORAGE_KEY, values: snapshot.rawValues }
  );
}

async function clearTemporaryModProfileOverride(session) {
  return await session.page.evaluate((overrideKey) => {
    localStorage.removeItem(overrideKey);
    return { overrideActive: false };
  }, MOD_PROFILE_OVERRIDE_STORAGE_KEY);
}

async function reloadGameSessionForModProfile(session, args = {}) {
  const options = {
    ...session.options,
    timeoutMs: numeric(args.timeoutMs, session.options.timeoutMs || 90000, 1000),
    waitMs: numeric(args.waitMs, session.options.waitMs || 10000, 0),
  };
  await gotoAndSettle(session.page, options.url, options.timeoutMs);
  await waitForModManager(session.page, options, { navigate: false });
  const shouldLoadSave = args.loadSave === undefined ? Boolean(session.options.loadSave) : args.loadSave !== false;
  let load = null;
  if (shouldLoadSave) {
    load = await loadGameSaveInSession(session.page, options);
    session.load = load;
  }
  return {
    load,
    modioRecoveryActions: options.modioRecoveryActions || [],
    state: await collectGameSessionState(session, { maxBrowserEvents: 50 }),
    modProfileState: await readLiveModProfileState(session),
  };
}

async function manageLiveCreatorToolkitLocalMods(session, args = {}, localInput = null) {
  const operation = args.operation || 'status';
  const localModId = args.localModId === undefined ? null : numeric(args.localModId, undefined, 1);
  return await session.page.evaluate(
    async ({ apply, localInput, localModId, name, namespace, operation }) => {
      function getAllFromIndexedDB(dbName, storeName) {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const getAll = store.getAll();
            getAll.onerror = () => reject(getAll.error);
            getAll.onsuccess = () => {
              db.close();
              resolve(getAll.result || []);
            };
          };
        });
      }

      function putInIndexedDB(dbName, storeName, value) {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const put = store.put(value);
            put.onerror = () => reject(put.error);
            put.onsuccess = () => {
              db.close();
              resolve(put.result);
            };
          };
        });
      }

      function deleteFromIndexedDB(dbName, storeName, key) {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const del = store.delete(key);
            del.onerror = () => reject(del.error);
            del.onsuccess = () => {
              db.close();
              resolve(true);
            };
          };
        });
      }

      function bytesFromBase64(base64) {
        const binary = atob(base64 || '');
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
      }

      function textFromBytes(bytes) {
        return new TextDecoder().decode(bytes);
      }

      function resourceType(resourcePath) {
        const lower = String(resourcePath || '').toLowerCase();
        if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript';
        if (lower.endsWith('.json')) return 'application/json';
        if (lower.endsWith('.css')) return 'text/css';
        if (lower.endsWith('.html')) return 'text/html';
        if (lower.endsWith('.png')) return 'image/png';
        if (lower.endsWith('.svg')) return 'image/svg+xml';
        return '';
      }

      function validateManifest(manifest) {
        if (!manifest || typeof manifest !== 'object') throw new Error('manifest.json must contain a JSON object.');
        if (manifest.namespace) {
          if (!/^(?!melvor)[A-Za-z_][A-Za-z0-9_]*$/i.test(manifest.namespace)) {
            throw new Error('manifest.namespace must contain only alphanumeric characters and underscores and cannot start with "melvor".');
          }
          if (manifest.namespace === 'dev') throw new Error('manifest.namespace "dev" is reserved.');
        }
        if (!manifest.setup && !manifest.load) throw new Error('manifest.json must define either setup or load.');
      }

      function normalizeUnpacked(unpacked) {
        const entries = {};
        const paths = [];
        for (const [resourcePath, bytes] of Object.entries(unpacked || {})) {
          const normalized = String(resourcePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
          if (!normalized || normalized.endsWith('/')) continue;
          entries[normalized] = bytes;
          paths.push(normalized);
        }
        return { entries, paths: paths.sort() };
      }

      function summarizeLocalMod(record) {
        const resources = Object.keys(record?.mod?.resources || {}).sort();
        return {
          id: record?.id ?? null,
          name: record?.name || record?.mod?.name || null,
          disabled: Boolean(record?.disabled),
          directoryPath: record?.dir || null,
          loadPriority: record?.loadPriority ?? null,
          released: Boolean(record?.released),
          package: record?.package ? { name: record.package.name || null, size: record.package.size || 0, type: record.package.type || '' } : null,
          mod: {
            id: record?.mod?.id ?? null,
            name: record?.mod?.name || null,
            namespace: record?.mod?.namespace || null,
            version: record?.mod?.version || '',
            author: record?.mod?.author || '',
            setup: record?.mod?.setup || null,
            load: record?.mod?.load || null,
            icon: record?.mod?.icon || null,
            resourceCount: resources.length,
            resources,
          },
        };
      }

      async function buildLocalModRecord(input, existingLocalMods) {
        if (!globalThis.fflate?.zipSync || !globalThis.fflate?.unzipSync) {
          throw new Error('fflate zip helpers were not available in the game page.');
        }

        let manifest;
        let files;
        let packageBytes;
        if (input.kind === 'directory') {
          files = input.files.map((file) => ({
            path: file.path,
            type: file.type || resourceType(file.path),
            bytes: bytesFromBase64(file.base64),
          }));
          manifest = input.manifest;
          const zipInput = {};
          for (const file of files) zipInput[file.path] = file.bytes;
          packageBytes = globalThis.fflate.zipSync(zipInput);
        } else {
          packageBytes = bytesFromBase64(input.packageBase64);
          const unpacked = normalizeUnpacked(globalThis.fflate.unzipSync(packageBytes));
          if (!unpacked.entries['manifest.json']) throw new Error('Zip package has no manifest.json at the root.');
          manifest = JSON.parse(textFromBytes(unpacked.entries['manifest.json']));
          files = unpacked.paths.map((resourcePath) => ({
            path: resourcePath,
            type: resourceType(resourcePath),
            bytes: unpacked.entries[resourcePath],
          }));
        }

        validateManifest(manifest);
        const resources = {};
        for (const file of files) {
          if (!file.bytes?.length) continue;
          resources[file.path] = new Blob([file.bytes], { type: file.type || resourceType(file.path) });
        }
        const displayName = input.requestedName || manifest.name || input.packageName.replace(/\.zip$/i, '');
        const nextPriority = existingLocalMods.reduce((max, record) => Math.max(max, Number(record.loadPriority) || 0), 0) + 1;
        const linkedModId = Number.isInteger(input.linkedModId) ? input.linkedModId : -1;
        const modRecord = {
          id: linkedModId > 0 ? linkedModId : -1,
          name: displayName,
          namespace: manifest.namespace,
          version: manifest.version || '',
          tags: {
            supportedGameVersion: typeof gameVersion === 'string' ? gameVersion.substring(1) : '',
            platforms: [],
            types: [],
          },
          author: manifest.author || 'MCP',
          description: manifest.description || '',
          icon: manifest.icon,
          setup: manifest.setup,
          load: manifest.load,
          resources,
          modioUrl: '',
          homepageUrl: '',
          dependencies: manifest.dependencies || [],
          installed: Math.floor(Date.now() / 1000),
          updated: 0,
          changelog: '',
        };
        const existing =
          (Number.isInteger(input.localModId) && existingLocalMods.find((record) => Number(record.id) === input.localModId)) ||
          (input.replace &&
            existingLocalMods.find(
              (record) =>
                (manifest.namespace && record.mod?.namespace === manifest.namespace) ||
                (linkedModId > 0 && Number(record.mod?.id) === linkedModId) ||
                record.name === displayName
            )) ||
          null;

        const record = {
          name: displayName,
          mod: modRecord,
          dir: input.directoryPath || '',
          package: new File([packageBytes], input.packageName, { type: 'application/zip' }),
          released: existing ? Boolean(existing.released) : false,
          loadPriority: existing?.loadPriority ?? nextPriority,
          disabled: Boolean(input.disabled),
        };
        if (existing) record.id = existing.id;
        return record;
      }

      const localMods = await getAllFromIndexedDB('melvordb', 'localMods');
      const installedMods = await getAllFromIndexedDB('melvordb', 'mods');
      const loadedNames = typeof mod !== 'undefined' ? mod.manager?.getLoadedModList?.() || [] : [];
      const creatorToolkitInstalled = installedMods.some(
        (entry) => Number(entry.id) === 2419237 || entry.namespace === 'creatorToolkit' || entry.name === 'Creator Toolkit'
      );
      const creatorToolkitLoaded = loadedNames.includes('Creator Toolkit');
      const loadingModGuard = localStorage.getItem('mct_i--loading-mod');
      const warnings = [];
      if (!creatorToolkitInstalled) warnings.push('Creator Toolkit is not installed in Mod Manager.');
      if (!creatorToolkitLoaded) warnings.push('Creator Toolkit is not loaded in the active profile; local mods will not load until it is enabled and the game reloads.');
      if (loadingModGuard) warnings.push(`Creator Toolkit has a stale localStorage loading guard for local mod id ${loadingModGuard}.`);

      if (operation === 'status') {
        return {
          apply,
          changed: false,
          creatorToolkitInstalled,
          creatorToolkitLoaded,
          loadingModGuard,
          loadedNames,
          localMods: localMods.map(summarizeLocalMod),
          operation,
          warnings,
        };
      }

      if (operation === 'remove') {
        const existing =
          (Number.isInteger(localModId) && localMods.find((record) => Number(record.id) === localModId)) ||
          (namespace && localMods.find((record) => record.mod?.namespace === namespace)) ||
          (name && localMods.find((record) => record.name === name || record.mod?.name === name)) ||
          null;
        if (!existing) throw new Error('Creator Toolkit local mod was not found for remove.');
        if (apply) await deleteFromIndexedDB('melvordb', 'localMods', existing.id);
        return {
          apply,
          changed: true,
          creatorToolkitInstalled,
          creatorToolkitLoaded,
          loadingModGuard,
          localMod: summarizeLocalMod(existing),
          operation,
          reloadRequired: true,
          warnings: apply ? warnings : [...warnings, 'Dry run only. Pass apply=true to remove this local mod.'],
        };
      }

      if (operation !== 'install') throw new Error(`Unsupported live Creator Toolkit operation: ${operation}`);
      const record = await buildLocalModRecord(localInput, localMods);
      const key = apply ? await putInIndexedDB('melvordb', 'localMods', record) : record.id ?? null;
      if (key !== null && key !== undefined) record.id = key;
      return {
        apply,
        changed: true,
        creatorToolkitInstalled,
        creatorToolkitLoaded,
        loadingModGuard,
        localMod: summarizeLocalMod(record),
        operation,
        reloadRequired: true,
        warnings: apply ? warnings : [...warnings, 'Dry run only. Pass apply=true to install this local mod.'],
      };
    },
    {
      apply: Boolean(args.apply),
      localInput,
      localModId,
      name: args.name || '',
      namespace: args.namespace || '',
      operation,
    }
  );
}

async function readLiveLocalModVerification(session, target = {}) {
  return await session.page.evaluate(({ localModId, localModName, namespace }) => {
    function contextExists(value) {
      if (!value || typeof mod === 'undefined' || !mod.getContext) return false;
      try {
        mod.getContext(value);
        return true;
      } catch {
        return false;
      }
    }
    const loadedNames = typeof mod !== 'undefined' ? mod.manager?.getLoadedModList?.() || [] : [];
    const marker = globalThis.__mcpLocalModShenanigans?.[namespace] || globalThis.__mcpLocalModLoaded || null;
    const loadedByName = localModName ? loadedNames.includes(localModName) : false;
    const loadedByNamespace = contextExists(namespace);
    const loadedByMarker = marker && (!namespace || marker.namespace === namespace);
    return {
      loaded: Boolean(loadedByName || loadedByNamespace || loadedByMarker),
      loadedByName,
      loadedByNamespace,
      loadedByMarker: Boolean(loadedByMarker),
      marker,
      localModId: localModId ?? null,
      localModName: localModName || null,
      namespace: namespace || null,
      loadedNames,
      localStorageLoadingGuard: localStorage.getItem('mct_i--loading-mod'),
      title: document.title,
      location: location.href,
    };
  }, target);
}

async function waitForLiveLocalModVerification(session, target, args = {}) {
  const timeoutMs = numeric(args.timeoutMs, session.options.timeoutMs || 90000, 1000);
  const deadline = Date.now() + Math.min(timeoutMs, 60000);
  let last = null;
  while (Date.now() < deadline) {
    last = await readLiveLocalModVerification(session, target).catch((error) => ({
      loaded: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (last.loaded) return last;
    await session.page.waitForTimeout(1000).catch(() => {});
  }
  return last || { loaded: false, error: 'Timed out waiting for local mod verification.' };
}

async function getGameSession(id = 'default') {
  const session = gameSessions.get(id);
  if (!session || session.page.isClosed()) {
    gameSessions.delete(id);
    throw new Error(`No live game session named "${id}". Start one with game_session_start.`);
  }
  return session;
}

async function closeGameSession(session) {
  let stoppedProfile = null;
  if (session.profile?.active) {
    stoppedProfile = await stopGameProfile(session, {});
  }
  await session.context.close().catch(() => {});
  await session.browser.close().catch(() => {});
  gameSessions.delete(session.id);
  return stoppedProfile;
}

async function toolGameSessionStart(args = {}) {
  const id = browserSessionId(args);
  if (gameSessions.has(id)) {
    if (!args.replace) throw new Error(`Game session "${id}" is already running. Pass replace=true to close and replace it.`);
    await closeGameSession(gameSessions.get(id));
  }

  const options = {
    id,
    headful: args.headful !== false,
    loadSave: args.loadSave !== false,
    modioRecovery: args.modioRecovery || 'local',
    password: process.env.MELVOR_CLOUD_PASSWORD || '',
    readOnly: args.readOnly !== false,
    saveSlot: configuredSaveSlot(args),
    saveSource: args.saveSource || 'cloud',
    storageState: args.storageState || process.env.MELVOR_BROWSER_STORAGE_STATE || '',
    timeoutMs: numeric(args.timeoutMs, 90000, 1000),
    url: args.url || DEFAULT_MELVOR_URL,
    username: process.env.MELVOR_CLOUD_USERNAME || '',
    waitMs: numeric(args.waitMs, 10000, 0),
  };

  const browser = await chromium.launch({ headless: !options.headful });
  const contextOptions = {};
  if (options.storageState && fs.existsSync(options.storageState)) contextOptions.storageState = options.storageState;
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const session = {
    id,
    browser,
    context,
    page,
    options,
    browserEvents: [],
    createdAt: new Date().toISOString(),
    login: null,
    load: null,
    profile: null,
    modProfileSnapshots: new Map(),
    modProfileOverrideScriptInstalled: false,
    localModInstalls: new Map(),
  };

  page.on('console', (message) => {
    const location = message.location();
    recordSessionBrowserEvent(session, {
      type: 'console',
      level: message.type(),
      text: message.text(),
      location: location.url ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : '',
    });
  });
  page.on('pageerror', (error) => {
    recordSessionBrowserEvent(session, { type: 'pageerror', text: error.message });
  });
  page.on('requestfailed', (request) => {
    recordSessionBrowserEvent(session, {
      type: 'requestfailed',
      url: request.url(),
      failure: request.failure()?.errorText || '',
    });
  });

  try {
    await gotoAndSettle(page, options.url, options.timeoutMs);
    session.login = await loginIfNeeded(page, options);
    await waitForModManager(page, options);
    if (options.storageState) {
      await fsp.mkdir(path.dirname(path.resolve(options.storageState)), { recursive: true });
      await context.storageState({ path: options.storageState });
    }
    if (options.loadSave) session.load = await loadGameSaveInSession(page, options);
    gameSessions.set(id, session);
    const state = await collectGameSessionState(session, { maxBrowserEvents: 30 });
    return textContent(JSON.stringify({
      ok: true,
      sessionId: id,
      visible: options.headful,
      login: session.login,
      load: session.load,
      modioRecoveryActions: options.modioRecoveryActions || [],
      state,
    }, null, 2));
  } catch (error) {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }
}

async function toolGameSessionAction(args = {}) {
  const session = await getGameSession(browserSessionId(args));
  const timeoutMs = numeric(args.timeoutMs, 30000, 1000);
  const durationMs = numeric(args.durationMs, 1000, 0);
  let result;

  if (args.action === 'wait') {
    await session.page.waitForTimeout(durationMs);
    result = { action: 'wait', durationMs };
  } else if (args.action === 'click_selector') {
    if (!args.selector) throw new Error('game_session_action click_selector requires selector.');
    await session.page.locator(String(args.selector)).first().click({ timeout: timeoutMs });
    if (durationMs > 0) await session.page.waitForTimeout(durationMs);
    result = { action: 'click_selector', selector: args.selector, durationMs };
  } else if (args.action === 'fill_selector') {
    if (!args.selector) throw new Error('game_session_action fill_selector requires selector.');
    await session.page.locator(String(args.selector)).first().fill(String(args.text ?? ''), { timeout: timeoutMs });
    if (durationMs > 0) await session.page.waitForTimeout(durationMs);
    result = { action: 'fill_selector', selector: args.selector, textLength: String(args.text ?? '').length, durationMs };
  } else if (args.action === 'press') {
    if (!args.key) throw new Error('game_session_action press requires key.');
    if (args.selector) await session.page.locator(String(args.selector)).first().press(String(args.key), { timeout: timeoutMs });
    else await session.page.keyboard.press(String(args.key));
    if (durationMs > 0) await session.page.waitForTimeout(durationMs);
    result = { action: 'press', selector: args.selector || null, key: args.key, durationMs };
  } else if (args.action === 'open_page') {
    if (!args.pageId) throw new Error('game_session_action open_page requires pageId.');
    const opened = await session.page.evaluate((pageId) => {
      if (typeof changePage !== 'function') throw new Error('changePage was not available.');
      const page = typeof game !== 'undefined' ? game.pages?.getObjectByID?.(pageId) : null;
      if (!page) throw new Error(`Game page was not found: ${pageId}`);
      changePage(page);
      return { id: page.id, name: page.name || null };
    }, String(args.pageId));
    if (durationMs > 0) await session.page.waitForTimeout(durationMs);
    result = { action: 'open_page', page: opened, durationMs };
  } else if (args.action === 'evaluate') {
    if (!args.script) throw new Error('game_session_action evaluate requires script.');
    const value = await session.page.evaluate(async (script) => {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      return await new AsyncFunction(script)();
    }, String(args.script));
    if (durationMs > 0) await session.page.waitForTimeout(durationMs);
    result = { action: 'evaluate', value, durationMs };
  } else if (args.action === 'dismiss_modals') {
    const maxClicks = numeric(args.maxClicks, 3, 1, 20);
    const dismissed = await session.page.evaluate(async ({ maxClicks }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const modals = [];
      for (let index = 0; index < maxClicks; index += 1) {
        const popup = document.querySelector('.swal2-popup');
        const title = document.querySelector('.swal2-title')?.textContent?.trim() || '';
        const text = document.querySelector('.swal2-html-container')?.textContent?.replace(/\s+/g, ' ').trim() || '';
        const confirm = document.querySelector('.swal2-confirm');
        if (!popup && !confirm) break;

        let clicked = false;
        let closed = false;
        if (confirm) {
          confirm.click();
          clicked = true;
        }
        else {
          try {
            const swal = globalThis.Swal || (typeof Swal !== 'undefined' ? Swal : null);
            swal?.close?.();
            closed = true;
          } catch {}
        }
        modals.push({ title, text, clicked, closed });
        await sleep(100);
      }
      return {
        dismissed: modals.length,
        modals,
        stillPresent: Boolean(document.querySelector('.swal2-popup')),
      };
    }, { maxClicks });
    if (durationMs > 0) await session.page.waitForTimeout(durationMs);
    result = { action: 'dismiss_modals', ...dismissed, durationMs };
  } else {
    throw new Error(`Unsupported game session action: ${args.action}`);
  }

  const state = await collectGameSessionState(session, { maxBrowserEvents: 30 });
  return textContent(JSON.stringify({ ok: true, sessionId: session.id, result, state }, null, 2));
}

async function toolGameSessionState(args = {}) {
  const session = await getGameSession(browserSessionId(args));
  const state = await collectGameSessionState(session, args);
  return textContent(JSON.stringify({ ok: true, state }, null, 2));
}

async function toolGameSessionSave(args = {}) {
  const session = await getGameSession(browserSessionId(args));
  const operation = args.operation || 'status';
  const saveDir = args.saveDir || DEFAULT_SAVE_FIXTURES_DIR;
  const saveSource = args.saveSource || 'local';
  const configuredSlot = configuredSaveSlot(args);
  const saveSlot = args.saveSlot === undefined ? configuredSlot : numeric(args.saveSlot, undefined, 0);
  const targetSlot = args.targetSlot === undefined ? configuredSlot : numeric(args.targetSlot, undefined, 0);

  if (operation === 'status') {
    const [slots, fixtures] = await Promise.all([readSaveSlots(session), listSaveFixtures(saveDir)]);
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, slots, fixtures }, null, 2));
  }

  if (operation === 'list_slots') {
    const slots = await readSaveSlots(session);
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, slots }, null, 2));
  }

  if (operation === 'list_fixtures') {
    const fixtures = await listSaveFixtures(saveDir);
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, fixtures }, null, 2));
  }

  if (operation === 'export_slot') {
    if (!Number.isInteger(saveSlot)) throw new Error('export_slot requires saveSlot or MELVOR_TEST_CHARACTER_SLOT.');
    const fixtureName = safeSaveFixtureName(args.fixture);
    const { saveString, header } = await readSaveStringFromSlot(session, saveSource, saveSlot);
    const fixture = fixtureForSaveString({
      fixtureName,
      saveString,
      header,
      notes: args.notes || '',
      source: { type: 'slot', saveSource, saveSlot, sessionId: session.id },
    });
    const plan = {
      fixture: redactSaveFixture(fixture),
      saveDir: resolveSaveFixturesDir(saveDir),
      targetPath: saveFixturePath(saveDir, fixtureName).filePath,
    };
    if (!args.apply) return textContent(JSON.stringify({ ok: true, sessionId: session.id, dryRun: true, operation, plan }, null, 2));
    const written = await writeSaveFixture(saveDir, fixtureName, fixture);
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, written }, null, 2));
  }

  if (operation === 'export_current') {
    const fixtureName = safeSaveFixtureName(args.fixture);
    const { saveString, header, currentCharacter } = await readCurrentSaveString(session);
    const fixture = fixtureForSaveString({
      fixtureName,
      saveString,
      header,
      notes: args.notes || '',
      source: { type: 'current', sessionId: session.id, currentCharacter },
    });
    const plan = {
      fixture: redactSaveFixture(fixture),
      saveDir: resolveSaveFixturesDir(saveDir),
      targetPath: saveFixturePath(saveDir, fixtureName).filePath,
    };
    if (!args.apply) return textContent(JSON.stringify({ ok: true, sessionId: session.id, dryRun: true, operation, plan }, null, 2));
    const written = await writeSaveFixture(saveDir, fixtureName, fixture);
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, written }, null, 2));
  }

  if (operation === 'write_fixture') {
    const fixtureName = safeSaveFixtureName(args.fixture);
    const rawSaveString = String(args.saveString || '');
    if (!rawSaveString) throw new Error('write_fixture requires saveString.');
    const header = await validateSaveStringInSession(session, rawSaveString);
    const fixture = fixtureForSaveString({
      fixtureName,
      saveString: rawSaveString,
      header,
      notes: args.notes || '',
      source: { type: 'provided', sessionId: session.id },
    });
    const plan = {
      fixture: redactSaveFixture(fixture),
      saveDir: resolveSaveFixturesDir(saveDir),
      targetPath: saveFixturePath(saveDir, fixtureName).filePath,
    };
    if (!args.apply) return textContent(JSON.stringify({ ok: true, sessionId: session.id, dryRun: true, operation, plan }, null, 2));
    const written = await writeSaveFixture(saveDir, fixtureName, fixture);
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, written }, null, 2));
  }

  if (operation === 'import_fixture' || operation === 'load_fixture') {
    if (!Number.isInteger(targetSlot)) throw new Error(`${operation} requires targetSlot or MELVOR_TEST_CHARACTER_SLOT.`);
    const { filePath, fixture } = await readSaveFixture(saveDir, args.fixture);
    const header = await validateSaveStringInSession(session, fixture.saveString);
    const plan = {
      fixturePath: filePath,
      fixture: redactSaveFixture({ ...fixture, header }),
      targetSlot,
      overwriteLocalSlot: Boolean(args.overwriteLocalSlot),
      loadAfterImport: operation === 'load_fixture' || args.loadAfterImport === true,
    };
    if (!args.apply) return textContent(JSON.stringify({ ok: true, sessionId: session.id, dryRun: true, operation, plan }, null, 2));
    const imported = await writeSaveStringToLocalSlot(session, fixture.saveString, targetSlot, args.overwriteLocalSlot);
    let loaded = null;
    if (operation === 'load_fixture' || args.loadAfterImport === true) {
      loaded = await reloadAndLoadSaveSlot(session, { ...args, saveSource: 'local', saveSlot: targetSlot });
    }
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, imported, loaded }, null, 2));
  }

  if (operation === 'load_slot') {
    if (!Number.isInteger(saveSlot)) throw new Error('load_slot requires saveSlot or MELVOR_TEST_CHARACTER_SLOT.');
    const plan = { saveSource, saveSlot, reload: args.reload !== false };
    if (!args.apply) return textContent(JSON.stringify({ ok: true, sessionId: session.id, dryRun: true, operation, plan }, null, 2));
    const loaded = await reloadAndLoadSaveSlot(session, { ...args, saveSource, saveSlot });
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, loaded }, null, 2));
  }

  throw new Error(`Unsupported game_session_save operation: ${operation}`);
}

async function toolGameSessionLocalMod(args = {}) {
  const session = await getGameSession(browserSessionId(args));
  const operation = args.operation || 'status';
  if (session.profile?.active && !args.allowDuringProfile && ['install_generated', 'install_path', 'remove', 'cleanup'].includes(operation)) {
    throw new Error('Refusing to change Creator Toolkit local mods while live profiling is active. Stop profiling first or pass allowDuringProfile=true.');
  }

  if (!session.localModInstalls) session.localModInstalls = new Map();

  if (operation === 'status') {
    const status = await manageLiveCreatorToolkitLocalMods(session, { ...args, operation: 'status' }, null);
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, sessionLocalMods: [...session.localModInstalls.values()], status }, null, 2));
  }

  if (operation === 'cleanup') {
    const targets = [...session.localModInstalls.values()];
    if (!args.apply) {
      return textContent(JSON.stringify({ ok: true, sessionId: session.id, dryRun: true, operation, targets }, null, 2));
    }
    const removed = [];
    for (const target of targets) {
      const result = await manageLiveCreatorToolkitLocalMods(
        session,
        { ...args, operation: 'remove', localModId: target.id, apply: true },
        null
      ).catch((error) => ({ ok: false, target, error: error instanceof Error ? error.message : String(error) }));
      removed.push(result);
      if (result.localMod?.id !== undefined) session.localModInstalls.delete(Number(result.localMod.id));
    }
    const reload = args.reload === false ? null : await reloadGameSessionForModProfile(session, args);
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, removed, reload }, null, 2));
  }

  if (operation === 'remove') {
    const result = await manageLiveCreatorToolkitLocalMods(session, { ...args, operation: 'remove' }, null);
    if (!args.apply) return textContent(JSON.stringify({ ok: true, sessionId: session.id, dryRun: true, operation, result }, null, 2));
    if (result.localMod?.id !== undefined) session.localModInstalls.delete(Number(result.localMod.id));
    const reload = args.reload === false ? null : await reloadGameSessionForModProfile(session, args);
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, result, reload }, null, 2));
  }

  if (!['install_generated', 'install_path'].includes(operation)) {
    throw new Error(`Unsupported game_session_local_mod operation: ${operation}`);
  }

  const localInput = operation === 'install_generated' ? await buildGeneratedLocalModInput(args) : await buildPathLocalModInput(args);
  const result = await manageLiveCreatorToolkitLocalMods(session, { ...args, operation: 'install' }, localInput);
  if (!args.apply) {
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, dryRun: true, operation, localInput: {
      kind: localInput.kind,
      manifest: localInput.manifest || null,
      packageName: localInput.packageName,
      fileCount: localInput.files?.length ?? null,
      size: localInput.size ?? null,
      sourcePath: localInput.sourcePath || null,
    }, result }, null, 2));
  }

  const installed = result.localMod || null;
  if (installed?.id !== undefined && installed.id !== null) {
    session.localModInstalls.set(Number(installed.id), {
      id: Number(installed.id),
      name: installed.name || installed.mod?.name || null,
      namespace: installed.mod?.namespace || null,
      installedAt: new Date().toISOString(),
      operation,
    });
  }

  const reload = args.reload === false ? null : await reloadGameSessionForModProfile(session, args);
  const verification =
    args.verify === false
      ? null
      : await waitForLiveLocalModVerification(
          session,
          {
            localModId: installed?.id ?? null,
            localModName: installed?.name || installed?.mod?.name || localInput.requestedName || null,
            namespace: installed?.mod?.namespace || localInput.manifest?.namespace || null,
          },
          args
        );

  return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, result, reload, verification }, null, 2));
}

async function toolGameSessionModProfile(args = {}) {
  const session = await getGameSession(browserSessionId(args));
  const operation = args.operation || 'status';
  const snapshotKey = normalizeSnapshotKey(args.snapshotKey);
  if (session.profile?.active && !args.allowDuringProfile && ['load_only', 'load_with_dependencies', 'load_set', 'restore'].includes(operation)) {
    throw new Error('Refusing to change Mod Manager profile while live profiling is active. Stop profiling first or pass allowDuringProfile=true.');
  }

  const before = await readLiveModProfileState(session);

  if (operation === 'status') {
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, state: before }, null, 2));
  }

  if (operation === 'snapshot') {
    const snapshot = storeModProfileSnapshot(session, snapshotKey, before);
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, snapshotKey, snapshot }, null, 2));
  }

  if (operation === 'restore') {
    const snapshot = session.modProfileSnapshots?.get(snapshotKey);
    if (!snapshot) throw new Error(`No Mod Manager profile snapshot named "${snapshotKey}" exists for session "${session.id}".`);
    const plan = {
      operation,
      snapshotKey,
      restoreValues: snapshot.rawValues,
      reload: args.reload !== false,
      loadSave: args.loadSave === undefined ? Boolean(session.options.loadSave) : args.loadSave !== false,
    };
    if (!args.apply) {
      return textContent(JSON.stringify({ ok: true, sessionId: session.id, dryRun: true, plan, before }, null, 2));
    }
    const write =
      args.reload === false ? await restoreModProfileSnapshotValues(session, snapshot) : await writeTemporaryModProfileValues(session, snapshot.rawValues);
    const reload = args.reload === false ? null : await reloadGameSessionForModProfile(session, args);
    const clearedOverride = args.reload === false ? null : await clearTemporaryModProfileOverride(session);
    const after = await readLiveModProfileState(session);
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, snapshotKey, write, reload, clearedOverride, before, after }, null, 2));
  }

  if (!['load_only', 'load_with_dependencies', 'load_set'].includes(operation)) {
    throw new Error(`Unsupported game_session_mod_profile operation: ${operation}`);
  }

  const snapshot = storeModProfileSnapshot(session, snapshotKey, before);
  const plan = computeModProfilePlan(before, { ...args, operation });
  if (!plan.canApply) {
    const message = `Cannot apply temporary Mod Manager profile; unresolved dependencies: ${plan.unresolvedDependencies
      .map((dependency) => dependency.id)
      .join(', ')}`;
    if (args.apply) throw new Error(message);
  }

  if (!args.apply) {
    return textContent(JSON.stringify({ ok: true, sessionId: session.id, dryRun: true, snapshotKey, snapshot, plan, before }, null, 2));
  }

  const write = await writeTemporaryModProfileValues(session, plan.nextValues);
  const reload = args.reload === false ? null : await reloadGameSessionForModProfile(session, args);
  const after = reload?.modProfileState || (await readLiveModProfileState(session));
  return textContent(JSON.stringify({ ok: true, sessionId: session.id, operation, snapshotKey, snapshot, plan, write, reload, before, after }, null, 2));
}

async function toolGameSessionDebugProbe(args = {}) {
  const session = await getGameSession(browserSessionId(args));
  const maxItems = numeric(args.maxItems, 5, 0, 1000);
  const maxText = numeric(args.maxText, 160, 0, 10000);
  const defaultGlobalNames = [
    'game',
    'mod',
    'changePage',
    'isLoaded',
    'inCharacterSelection',
    'currentCharacter',
    'bankTabMenu',
    'Swal',
    'PlayFabClientSDK',
    'nativeManager',
  ];
  const defaultSelectors = [
    '.swal2-popup',
    '.swal2-confirm',
    '#bank-tab-menu',
    'bank-tab-menu',
    'bank-options-menu',
  ];
  const globalNames = Array.isArray(args.globalNames) && args.globalNames.length > 0
    ? args.globalNames.map(String)
    : defaultGlobalNames;
  const selectors = Array.isArray(args.selectors) && args.selectors.length > 0
    ? args.selectors.map(String)
    : defaultSelectors;

  const debug = await session.page.evaluate(({ globalNames, selectors, maxItems, maxText }) => {
    const limit = (items) => maxItems === 0 ? items : items.slice(0, maxItems);
    const limitText = (text) => {
      const value = String(text ?? '');
      return maxText === 0 || value.length <= maxText ? value : `${value.slice(0, maxText)}...`;
    };
    const isIdentifier = (value) => /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(value);
    const summarizeValue = (value) => {
      if (value === undefined) return { available: false, type: 'undefined' };
      if (value === null) return { available: true, type: 'object', isNull: true };
      const type = typeof value;
      const summary = {
        available: true,
        type,
        constructorName: value?.constructor?.name || null,
      };
      if (type === 'function') {
        summary.name = value.name || '';
        summary.length = value.length;
        return summary;
      }
      if (type !== 'object') {
        summary.value = type === 'string'
          ? limitText(value)
          : type === 'number' || type === 'boolean'
            ? value
            : String(value);
        return summary;
      }
      if (Array.isArray(value)) {
        summary.length = value.length;
        summary.sample = limit(value).map((item) => {
          if (item && typeof item === 'object') return item.id || item.name || item.constructor?.name || '[object]';
          return item;
        });
        return summary;
      }
      if (value instanceof Map || value instanceof Set) summary.size = value.size;
      summary.keys = limit(Object.keys(value));
      if ('id' in value) summary.id = String(value.id);
      if ('name' in value) summary.name = String(value.name);
      return summary;
    };
    const readBareGlobal = (name) => {
      if (!isIdentifier(name)) return { validIdentifier: false, value: undefined };
      try {
        return {
          validIdentifier: true,
          value: Function(`return typeof ${name} !== "undefined" ? ${name} : undefined`)(),
        };
      } catch (error) {
        return {
          validIdentifier: true,
          value: undefined,
          error: error?.message || String(error),
        };
      }
    };
    const elementSample = (element) => {
      const style = window.getComputedStyle(element);
      return {
        tagName: element.tagName,
        id: element.id || '',
        className: typeof element.className === 'string' ? element.className : '',
        text: limitText(element.textContent?.replace(/\s+/g, ' ').trim() || ''),
        html: limitText(element.outerHTML || ''),
        visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0,
      };
    };

    const modal = document.querySelector('.swal2-popup');
    const modalStyle = modal ? window.getComputedStyle(modal) : null;
    const modalVisible = Boolean(modal && modalStyle?.display !== 'none' && modalStyle?.visibility !== 'hidden');
    const globals = {};
    for (const name of globalNames) {
      const bare = readBareGlobal(name);
      const globalThisValue = isIdentifier(name) ? globalThis[name] : undefined;
      globals[name] = {
        validIdentifier: bare.validIdentifier,
        bare: summarizeValue(bare.value),
        globalThis: summarizeValue(globalThisValue),
        bareOnly: bare.value !== undefined && globalThisValue === undefined,
        error: bare.error || null,
      };
    }

    const selectorResults = selectors.map((selector) => {
      try {
        const matches = Array.from(document.querySelectorAll(selector));
        return {
          selector,
          count: matches.length,
          samples: limit(matches).map(elementSample),
        };
      } catch (error) {
        return {
          selector,
          error: error?.message || String(error),
        };
      }
    });

    const loadedMods = typeof mod !== 'undefined' ? mod.manager?.getLoadedModList?.() || [] : [];
    const warnings = [];
    for (const [name, info] of Object.entries(globals)) {
      if (info.bareOnly) warnings.push(`${name} is available as a bare global but not as globalThis.${name}.`);
    }
    if (modalVisible) warnings.push('A SweetAlert modal is visible and may block clicks or page interactions.');

    return {
      location: location.href,
      title: document.title,
      modal: modalVisible
        ? {
            title: document.querySelector('.swal2-title')?.textContent?.trim() || '',
            text: document.querySelector('.swal2-html-container')?.textContent?.replace(/\s+/g, ' ').trim() || '',
          }
        : null,
      game: {
        loaded: typeof isLoaded !== 'undefined' ? Boolean(isLoaded) : false,
        inCharacterSelection: typeof inCharacterSelection !== 'undefined' ? Boolean(inCharacterSelection) : null,
        currentCharacter: typeof currentCharacter !== 'undefined' ? currentCharacter : null,
        characterName: typeof game !== 'undefined' ? game.characterName || null : null,
        activePage: typeof game !== 'undefined' ? game.activePage?.id || game.activeActionPage?.id || null : null,
        activeAction: typeof game !== 'undefined' ? game.activeAction?.id || game.activeAction?.name || null : null,
        enableRendering: typeof game !== 'undefined' ? game.enableRendering ?? null : null,
      },
      modManager: {
        enabled: Boolean(typeof mod !== 'undefined' && mod.manager?.isEnabled?.()),
        processing: Boolean(typeof mod !== 'undefined' && mod.manager?.isProcessing?.()),
        loadedMods,
      },
      globals,
      selectors: selectorResults,
      warnings,
    };
  }, { globalNames, selectors, maxItems, maxText });

  return textContent(JSON.stringify({ ok: true, sessionId: session.id, debug }, null, 2));
}

async function toolGameSessionTimeSkip(args = {}) {
  const session = await getGameSession(browserSessionId(args));
  const maxHours = numericFloat(args.maxHours, 24, 0.000001, 720);
  const hours = numericFloat(args.hours, 1, 0.000001, maxHours);
  const timeoutMs = numeric(args.timeoutMs, 120000, 1000);
  const result = await session.page.evaluate(
    async ({ hours, timeoutMs, waitForExit, requireActiveAction, allowCombatWithoutOfflineSetting, dismissModals }) => {
      if (typeof game === 'undefined') throw new Error('game is not available in the page.');
      if (typeof isLoaded !== 'undefined' && !isLoaded) throw new Error('No character save is loaded.');
      if (typeof game.testForOffline !== 'function') throw new Error('game.testForOffline(hours) is not available.');
      if (!Number.isFinite(hours) || hours <= 0) throw new Error(`Invalid offline hours: ${hours}`);
      if (game.isGolbinRaid) throw new Error('Offline time skip is not supported during Golbin Raid.');

      const summarizeAction = (action) => {
        if (action === undefined || action === null) return null;
        return {
          id: action.id || null,
          name: action.name || null,
          media: action.media || null,
          isCombat: action === game.combat,
          isThieving: action === game.thieving,
        };
      };
      const modalSummary = () => {
        const modal = document.querySelector('.swal2-popup');
        if (!modal) return null;
        const style = window.getComputedStyle(modal);
        const visible = style.display !== 'none' && style.visibility !== 'hidden';
        if (!visible) return null;
        return {
          title: document.querySelector('.swal2-title')?.textContent?.trim() || '',
          text: document.querySelector('.swal2-html-container')?.textContent?.replace(/\s+/g, ' ').trim() || '',
        };
      };
      const before = {
        activeAction: summarizeAction(game.activeAction),
        isInOnlineLoop: game._isInOnlineLoop,
        tickTimestamp: game.tickTimestamp,
        saveTimestamp: game.saveTimestamp,
        enableRendering: game.enableRendering,
        loadingOfflineProgress: typeof loadingOfflineProgress !== 'undefined' ? Boolean(loadingOfflineProgress) : null,
        offlineCombatEnabled: Boolean(game.settings?.boolData?.enableOfflineCombat?.currentValue ?? game.settings?.enableOfflineCombat),
      };

      if (requireActiveAction && before.activeAction === null) {
        throw new Error('No active action is running. Start a skill or combat before triggering offline processing.');
      }
      if (
        !allowCombatWithoutOfflineSetting &&
        before.activeAction &&
        (before.activeAction.isCombat || before.activeAction.isThieving) &&
        !before.offlineCombatEnabled
      ) {
        throw new Error('Offline combat/thieving is disabled. Enable it in game settings or pass allowCombatWithoutOfflineSetting=true.');
      }

      const events = [];
      const startedAt = performance.now();
      const waitForEvent = () =>
        new Promise((resolve) => {
          let done = false;
          const cleanup = () => {
            try {
              game.off?.('offlineLoopEntered', onEntered);
              game.off?.('offlineLoopExited', onExited);
            } catch {}
            clearTimeout(timer);
          };
          const finish = (value) => {
            if (done) return;
            done = true;
            cleanup();
            resolve(value);
          };
          const onEntered = () => {
            events.push({ type: 'entered', atMs: Math.max(0, performance.now() - startedAt), atIso: new Date().toISOString() });
          };
          const onExited = () => {
            events.push({ type: 'exited', atMs: Math.max(0, performance.now() - startedAt), atIso: new Date().toISOString() });
            finish({ completed: true, timedOut: false });
          };
          const timer = setTimeout(() => {
            finish({
              completed: false,
              timedOut: true,
              stillInOfflineLoop: game._isInOnlineLoop === false,
            });
          }, timeoutMs);
          game.on?.('offlineLoopEntered', onEntered);
          game.on?.('offlineLoopExited', onExited);
        });

      const waitPromise = waitForExit ? waitForEvent() : null;
      await game.testForOffline(hours);
      const wait = waitForExit
        ? await waitPromise
        : {
            completed: false,
            timedOut: false,
            skipped: true,
            stillInOfflineLoop: game._isInOnlineLoop === false,
          };

      let dismissedModal = null;
      if (dismissModals) {
        const beforeDismiss = modalSummary();
        const confirm = document.querySelector('.swal2-confirm');
        if (confirm) {
          confirm.click();
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        dismissedModal = {
          before: beforeDismiss,
          clickedConfirm: Boolean(confirm),
          after: modalSummary(),
        };
      }

      const after = {
        activeAction: summarizeAction(game.activeAction),
        isInOnlineLoop: game._isInOnlineLoop,
        tickTimestamp: game.tickTimestamp,
        saveTimestamp: game.saveTimestamp,
        enableRendering: game.enableRendering,
        loadingOfflineProgress: typeof loadingOfflineProgress !== 'undefined' ? Boolean(loadingOfflineProgress) : null,
        offlineInfo: game._offlineInfo
          ? {
              startTime: game._offlineInfo.startTime ?? null,
              timeProcessed: game._offlineInfo.timeProcessed ?? null,
              tickRate: game._offlineInfo.tickRate ?? null,
            }
          : null,
        modal: modalSummary(),
      };

      return {
        method: 'game.testForOffline',
        hours,
        simulatedMs: hours * 60 * 60 * 1000,
        elapsedMs: Math.max(0, performance.now() - startedAt),
        before,
        after,
        wait,
        events,
        dismissedModal,
      };
    },
    {
      hours,
      timeoutMs,
      waitForExit: args.waitForExit !== false,
      requireActiveAction: args.requireActiveAction !== false,
      allowCombatWithoutOfflineSetting: Boolean(args.allowCombatWithoutOfflineSetting),
      dismissModals: Boolean(args.dismissModals),
    }
  );
  const state = await collectGameSessionState(session, { maxBrowserEvents: 50 });
  return textContent(JSON.stringify({ ok: true, sessionId: session.id, result, state }, null, 2));
}

async function toolGameSessionScreenshot(args = {}) {
  const session = await getGameSession(browserSessionId(args));
  const reportDir = await newReportDir(args.reportDir || DEFAULT_REPORTS_DIR, `game-session-${session.id}`);
  const screenshotPath = path.join(reportDir, 'page.png');
  await session.page.screenshot({ path: screenshotPath, fullPage: args.fullPage !== false });
  const state = await collectGameSessionState(session, { maxBrowserEvents: 50 });
  const report = {
    ok: true,
    sessionId: session.id,
    state,
    reportDir,
    screenshotPath,
    capturedAt: new Date().toISOString(),
  };
  await fsp.writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return textContent(JSON.stringify(report, null, 2));
}

async function toolGameSessionStop(args = {}) {
  const session = await getGameSession(browserSessionId(args));
  const state = await collectGameSessionState(session, { maxBrowserEvents: 50 }).catch(() => null);
  const stoppedProfile = await closeGameSession(session);
  return textContent(JSON.stringify({ ok: true, sessionId: session.id, stoppedProfile, finalState: state }, null, 2));
}

async function startGameProfile(session, args = {}) {
  if (session.profile?.active) throw new Error(`Profile "${session.profile.label}" is already active for session "${session.id}".`);
  const trace = args.trace !== false;
  const cpuProfile = args.cpuProfile !== false;
  const browserMetrics = args.browserMetrics !== false;
  const samplingIntervalMicros = numeric(args.samplingIntervalMicros, 1000, 100, 100000);
  const label = String(args.label || 'profile');
  if (trace) {
    await session.context.tracing.start({
      screenshots: args.screenshots !== false,
      snapshots: args.snapshots !== false,
      sources: args.sources !== false,
    });
  }

  const inPage = await session.page.evaluate(
    ({ label, instrumentQuerySelectorAll }) => {
      if (globalThis.__mcpProfile?.active) throw new Error(`MCP profile already active: ${globalThis.__mcpProfile.label}`);
      const profile = {
        active: true,
        label,
        startedAt: performance.now(),
        startedAtIso: new Date().toISOString(),
        stoppedAtIso: null,
        marks: [],
        longTasks: [],
        qsa: {
          instrumented: false,
          originalName: document.querySelectorAll?.name || '',
          count: 0,
          totalMs: 0,
          maxMs: 0,
          slow: [],
        },
        offlineEvents: [],
      };
      globalThis.__mcpProfile = profile;

      if (!globalThis.__mcpProfileOfflineHooksInstalled && typeof game !== 'undefined' && typeof game.on === 'function') {
        game.on('offlineLoopEntered', () => {
          if (globalThis.__mcpProfile?.active) globalThis.__mcpProfile.offlineEvents.push({ type: 'entered', at: performance.now(), atIso: new Date().toISOString() });
        });
        game.on('offlineLoopExited', () => {
          if (globalThis.__mcpProfile?.active) globalThis.__mcpProfile.offlineEvents.push({ type: 'exited', at: performance.now(), atIso: new Date().toISOString() });
        });
        globalThis.__mcpProfileOfflineHooksInstalled = true;
      }

      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            profile.longTasks.push({
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration,
            });
            if (profile.longTasks.length > 500) profile.longTasks.shift();
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
        profile.longTaskObserver = observer;
      } catch {
        profile.longTaskObserver = null;
      }

      if (instrumentQuerySelectorAll && !globalThis.__mcpProfileOriginalQSA) {
        const original = document.querySelectorAll;
        globalThis.__mcpProfileOriginalQSA = original;
        document.querySelectorAll = function mcpProfiledQuerySelectorAll(selector) {
          const start = performance.now();
          try {
            return original.call(this, selector);
          } finally {
            const cost = performance.now() - start;
            const qsa = globalThis.__mcpProfile?.qsa;
            if (qsa) {
              qsa.instrumented = true;
              qsa.count += 1;
              qsa.totalMs += cost;
              qsa.maxMs = Math.max(qsa.maxMs, cost);
              if (cost >= 1) {
                qsa.slow.push({ selector: String(selector), cost, at: performance.now() });
                if (qsa.slow.length > 100) qsa.slow.shift();
              }
            }
          }
        };
      }

      return {
        label,
        startedAtIso: profile.startedAtIso,
        instrumentedQuerySelectorAll: Boolean(instrumentQuerySelectorAll && globalThis.__mcpProfileOriginalQSA),
      };
    },
    { label, instrumentQuerySelectorAll: Boolean(args.instrumentQuerySelectorAll) }
  );

  let cdpSession = null;
  const cdpWarnings = [];
  let browserProfileStart = null;
  let cpuProfileActive = false;
  let browserMetricsActive = false;

  if (cpuProfile || browserMetrics) {
    try {
      cdpSession = await session.context.newCDPSession(session.page);
      if (browserMetrics) {
        try {
          await cdpSession.send('Performance.enable');
          browserProfileStart = await readCdpPerformanceSnapshot(cdpSession);
          browserMetricsActive = true;
        } catch (error) {
          cdpWarnings.push(`Performance metrics unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (cpuProfile) {
        try {
          await cdpSession.send('Profiler.enable');
          await cdpSession.send('Profiler.setSamplingInterval', { interval: samplingIntervalMicros });
          await cdpSession.send('Profiler.start');
          cpuProfileActive = true;
        } catch (error) {
          cdpWarnings.push(`CPU profile unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!cpuProfileActive && !browserMetricsActive) {
        await cdpSession.detach().catch(() => {});
        cdpSession = null;
      }
    } catch (error) {
      cdpWarnings.push(`CDP profiling unavailable: ${error instanceof Error ? error.message : String(error)}`);
      cdpSession = null;
    }
  }

  session.profile = {
    active: true,
    label,
    trace,
    cpuProfile: cpuProfileActive,
    browserMetrics: browserMetricsActive,
    samplingIntervalMicros: cpuProfileActive ? samplingIntervalMicros : null,
    cdpSession,
    cdpWarnings,
    browserProfileStart,
    browserProfileStop: null,
    cpuProfileStop: null,
    browserEventStartIndex: session.browserEvents.length,
    startedAt: new Date().toISOString(),
  };
  return {
    ...inPage,
    trace,
    cpuProfile: cpuProfileActive,
    browserMetrics: browserMetricsActive,
    samplingIntervalMicros: cpuProfileActive ? samplingIntervalMicros : null,
    cdpWarnings,
    browserProfileStart,
  };
}

async function readGameProfile(session, args = {}) {
  const maxLongTasks = numeric(args.maxLongTasks, 50, 0);
  const browserEventStartIndex = session.profile?.browserEventStartIndex ?? 0;
  const maxBrowserEvents = numeric(args.maxBrowserEvents, 50, 0);
  const profile = await session.page.evaluate(({ maxLongTasks }) => {
    const activeProfile = globalThis.__mcpProfile || null;
    const navigation = performance.getEntriesByType('navigation')[0]?.toJSON?.() || null;
    const resources = performance.getEntriesByType('resource');
    const resourceSummary = resources.reduce(
      (summary, entry) => {
        summary.count += 1;
        summary.totalDurationMs += entry.duration || 0;
        summary.totalTransferSize += entry.transferSize || 0;
        const key = entry.initiatorType || 'unknown';
        summary.byInitiator[key] = (summary.byInitiator[key] || 0) + 1;
        return summary;
      },
      { count: 0, totalDurationMs: 0, totalTransferSize: 0, byInitiator: {} }
    );
    const memory = performance.memory
      ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        }
      : null;
    return {
      active: Boolean(activeProfile?.active),
      label: activeProfile?.label || null,
      startedAtIso: activeProfile?.startedAtIso || null,
      stoppedAtIso: activeProfile?.stoppedAtIso || null,
      durationMs: activeProfile ? Math.max(0, performance.now() - activeProfile.startedAt) : null,
      longTasks: activeProfile?.longTasks?.slice(maxLongTasks === 0 ? activeProfile.longTasks.length : -maxLongTasks) || [],
      longTaskCount: activeProfile?.longTasks?.length || 0,
      qsa: activeProfile?.qsa || null,
      offlineEvents: activeProfile?.offlineEvents || [],
      marks: activeProfile?.marks || [],
      navigation,
      resources: resourceSummary,
      memory,
      querySelectorAllName: document.querySelectorAll?.name || '',
    };
  }, { maxLongTasks });
  const browserProfile = await readBrowserProfileSnapshot(session).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  const state = await collectGameSessionState(session, { maxBrowserEvents: 0 });
  const browserEvents = session.browserEvents
    .slice(browserEventStartIndex)
    .slice(maxBrowserEvents === 0 ? session.browserEvents.length : -maxBrowserEvents)
    .map(({ dedupeKey, ...event }) => event);
  return {
    sessionId: session.id,
    profile,
    browserProfile,
    traceActive: Boolean(session.profile?.trace && session.profile.active),
    state: {
      game: state.game,
      optimizer: state.optimizer,
      readOnlySaveWritesBlocked: state.readOnlySaveWritesBlocked,
      readOnlySaveWriteSummary: state.readOnlySaveWriteSummary,
      modal: state.modal,
    },
    browserEvents,
  };
}

async function markGameProfile(session, args = {}) {
  if (!session.profile?.active) throw new Error(`No active profile for session "${session.id}".`);
  const label = String(args.label || '').trim();
  if (!label) throw new Error('game_profile_mark requires label.');
  const detail = args.detail === undefined ? null : String(args.detail);
  return await session.page.evaluate(
    ({ label, detail }) => {
      const activeProfile = globalThis.__mcpProfile;
      if (!activeProfile?.active) throw new Error('No active in-page MCP profile.');
      if (!Array.isArray(activeProfile.marks)) activeProfile.marks = [];
      const now = performance.now();
      const mark = {
        label,
        detail,
        at: now,
        sinceStartMs: Math.max(0, now - activeProfile.startedAt),
        atIso: new Date().toISOString(),
      };
      activeProfile.marks.push(mark);
      try {
        performance.mark(`mcp:${label}`);
      } catch {}
      return mark;
    },
    { label, detail }
  );
}

async function stopGameProfile(session, args = {}) {
  if (!session.profile?.active) throw new Error(`No active profile for session "${session.id}".`);
  const reportDir = await newReportDir(args.reportDir || DEFAULT_REPORTS_DIR, `game-profile-${session.id}-${session.profile.label}`);
  const maxCpuFunctions = numeric(args.maxCpuFunctions, 25, 0, 500);
  let tracePath = null;
  let cpuProfile = null;
  let browserProfileStop = null;
  let browserMetricsPath = null;
  const cdpWarnings = [...(session.profile.cdpWarnings || [])];

  if (session.profile.cdpSession) {
    if (session.profile.cpuProfile) {
      try {
        const result = await session.profile.cdpSession.send('Profiler.stop');
        const rawProfile = result.profile || result;
        const cpuProfilePath = path.join(reportDir, 'cpu-profile.cpuprofile');
        await fsp.writeFile(cpuProfilePath, `${JSON.stringify(rawProfile, null, 2)}\n`);
        cpuProfile = {
          path: cpuProfilePath,
          summary: summarizeCpuProfile(rawProfile, maxCpuFunctions),
        };
      } catch (error) {
        cdpWarnings.push(`CPU profile stop failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (session.profile.browserMetrics) {
      try {
        browserProfileStop = await readCdpPerformanceSnapshot(session.profile.cdpSession);
        browserMetricsPath = path.join(reportDir, 'browser-metrics.json');
        await fsp.writeFile(
          browserMetricsPath,
          `${JSON.stringify(
            {
              start: session.profile.browserProfileStart,
              stop: browserProfileStop,
              metricDeltas: metricDeltas(browserProfileStop.metrics, session.profile.browserProfileStart?.metrics || {}),
            },
            null,
            2
          )}\n`
        );
      } catch (error) {
        cdpWarnings.push(`Browser metric stop failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await session.profile.cdpSession.detach().catch(() => {});
    session.profile.cdpSession = null;
  }

  if (session.profile.trace) {
    tracePath = path.join(reportDir, 'trace.zip');
    await session.context.tracing.stop({ path: tracePath });
  }
  const profile = await session.page.evaluate(() => {
    const activeProfile = globalThis.__mcpProfile;
    if (!activeProfile) return null;
    activeProfile.active = false;
    activeProfile.stoppedAtIso = new Date().toISOString();
    try {
      activeProfile.longTaskObserver?.disconnect?.();
    } catch {}
    if (globalThis.__mcpProfileOriginalQSA) {
      document.querySelectorAll = globalThis.__mcpProfileOriginalQSA;
      delete globalThis.__mcpProfileOriginalQSA;
    }
    return {
      label: activeProfile.label,
      startedAtIso: activeProfile.startedAtIso,
      stoppedAtIso: activeProfile.stoppedAtIso,
      durationMs: Math.max(0, performance.now() - activeProfile.startedAt),
      longTaskCount: activeProfile.longTasks?.length || 0,
      qsa: activeProfile.qsa || null,
      offlineEvents: activeProfile.offlineEvents || [],
      marks: activeProfile.marks || [],
    };
  });
  session.profile.active = false;
  session.profile.tracePath = tracePath;
  session.profile.cpuProfileStop = cpuProfile;
  session.profile.browserProfileStop = browserProfileStop;
  session.profile.cdpWarnings = cdpWarnings;
  const summary = await readGameProfile(session, args).catch(() => null);
  const report = {
    ok: true,
    sessionId: session.id,
    profile,
    summary,
    tracePath,
    cpuProfile,
    browserProfile: browserProfileStop
      ? {
          start: session.profile.browserProfileStart,
          stop: browserProfileStop,
          metricDeltas: metricDeltas(browserProfileStop.metrics, session.profile.browserProfileStart?.metrics || {}),
          path: browserMetricsPath,
          warnings: cdpWarnings,
        }
      : {
          warnings: cdpWarnings,
        },
    reportDir,
    capturedAt: new Date().toISOString(),
  };
  await fsp.writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function toolGameProfileStart(args = {}) {
  const session = await getGameSession(browserSessionId(args));
  const profile = await startGameProfile(session, args);
  return textContent(JSON.stringify({ ok: true, sessionId: session.id, profile }, null, 2));
}

async function toolGameProfileRead(args = {}) {
  const session = await getGameSession(browserSessionId(args));
  const profile = await readGameProfile(session, args);
  return textContent(JSON.stringify({ ok: true, ...profile }, null, 2));
}

async function toolGameProfileMark(args = {}) {
  const session = await getGameSession(browserSessionId(args));
  const mark = await markGameProfile(session, args);
  return textContent(JSON.stringify({ ok: true, sessionId: session.id, mark }, null, 2));
}

async function toolGameProfileStop(args = {}) {
  const session = await getGameSession(browserSessionId(args));
  const profile = await stopGameProfile(session, args);
  return textContent(JSON.stringify(profile, null, 2));
}

async function toolModManagerLoaded(args = {}) {
  const commandArgs = [];
  appendModManagerArgs(commandArgs, args, 'list');
  const output = run(process.execPath, commandArgs);
  return textContent(output);
}

async function toolModManagerFetchSources(args = {}) {
  const commandArgs = [];
  appendModManagerArgs(commandArgs, args, 'fetch');
  const output = run(process.execPath, commandArgs);
  return textContent(output);
}

async function toolModManagerConfigure(args = {}) {
  const commandArgs = [];
  appendModManagerArgs(commandArgs, args, 'profile');
  commandArgs.push('--operation', args.operation || 'enable');
  commandArgs.push('--mod-id', String(numeric(args.modId, undefined, 1)));
  if (args.profileId) commandArgs.push('--profile-id', String(args.profileId));
  if (args.apply) commandArgs.push('--apply');
  if (args.persist === false) commandArgs.push('--no-persist');
  const output = run(process.execPath, commandArgs);
  return textContent(output);
}

async function toolCreatorToolkitLocalMods(args = {}) {
  const commandArgs = [];
  appendModManagerArgs(commandArgs, args, 'local');
  commandArgs.push('--operation', args.operation || 'list');
  if (args.modPath) commandArgs.push('--mod-path', String(args.modPath));
  if (args.name) commandArgs.push('--name', String(args.name));
  if (args.localModId !== undefined) commandArgs.push('--local-mod-id', String(numeric(args.localModId, undefined, 1)));
  if (args.linkedModId !== undefined) commandArgs.push('--linked-mod-id', String(numeric(args.linkedModId, undefined, 1)));
  if (args.directoryPath) commandArgs.push('--directory-path', String(args.directoryPath));
  if (args.disabled) commandArgs.push('--disabled');
  if (args.replace) commandArgs.push('--replace');
  if (args.cleanup === false) commandArgs.push('--no-cleanup');
  if (args.apply) commandArgs.push('--apply');
  const output = run(process.execPath, commandArgs);
  return textContent(output);
}


async function toolModReleaseStatus(args = {}) {
  const context = resolveReleaseContext(args);
  const mapping = await readJsonFileIfExists(context.mappingFile);
  const mods = await releaseModNames(context, mapping, args);
  const summaries = [];
  for (const mod of mods) summaries.push(await releaseSummary(context, mapping, mod, args));
  return textContent(JSON.stringify({
    ok: true,
    context: {
      workspaceRoot: context.workspaceRoot,
      modsRoot: context.modsRoot,
      mappingFile: fs.existsSync(context.mappingFile) ? context.mappingFile : null,
      envFile: context.envFile,
      gameId: context.gameId,
      apiBase: context.apiBase,
      hasApiKey: Boolean(context.apiKey),
      hasAccessToken: Boolean(context.accessToken),
    },
    mods: summaries,
  }, null, 2));
}

async function toolModReleasePackage(args = {}) {
  if (!args.mod) throw new Error('melvor_mod_release_package requires mod.');
  const context = resolveReleaseContext(args);
  const mapping = await readJsonFileIfExists(context.mappingFile);
  const summary = await releaseSummary(context, mapping, String(args.mod), args);
  assertCanPackage(summary);
  const zip = args.build === false
    ? { path: path.resolve(args.outDir || path.dirname(summary.releaseZip || ''), path.basename(summary.releaseZip || '')), bytes: fs.existsSync(summary.releaseZip || '') ? fs.statSync(summary.releaseZip).size : null }
    : await packageModRelease(context, summary, args);
  return textContent(JSON.stringify({ ok: true, built: args.build !== false, zip, summary }, null, 2));
}

async function toolModioUpload(args = {}) {
  if (!args.mod) throw new Error('melvor_modio_upload requires mod.');
  const context = resolveReleaseContext(args);
  const mapping = await readJsonFileIfExists(context.mappingFile);
  const summary = await releaseSummary(context, mapping, String(args.mod), args);
  assertCanUpload(summary);

  const zip = args.build === true
    ? await packageModRelease(context, summary, args)
    : { path: path.resolve(args.zipPath || summary.releaseZip), bytes: null };
  if (!fs.existsSync(zip.path)) throw new Error(`Release zip does not exist: ${zip.path}. Run melvor_mod_release_package first or pass build=true.`);
  zip.bytes = fs.statSync(zip.path).size;

  const requiredConfirm = `upload ${summary.mod} ${summary.manifest.version} to mod.io ${summary.configuredModio.id}`;
  const plan = {
    ok: true,
    apply: Boolean(args.apply),
    requiredConfirm,
    zip,
    upload: {
      mod: summary.mod,
      role: summary.policy.role,
      localVersion: summary.manifest.version,
      modioId: summary.configuredModio.id,
      endpoint: `${context.apiBase}/games/${context.gameId}/mods/${summary.configuredModio.id}/files`,
      currentModio: summary.currentModio,
      versionRelation: summary.versionRelation,
      fields: {
        file: args.fileField || DEFAULT_MODIO_FILE_FIELD,
        version: summary.manifest.version,
        changelog: args.changelog ? 'provided' : null,
        metadata_blob: args.metadataBlob ? 'provided' : null,
        active: args.active === undefined ? null : Boolean(args.active),
      },
    },
  };

  if (!args.apply) return textContent(JSON.stringify(plan, null, 2));
  if (args.confirm !== requiredConfirm) {
    throw new Error(`Confirmation mismatch. Pass confirm exactly: ${requiredConfirm}`);
  }

  const uploaded = await uploadModfile(context, summary, zip.path, args);
  return textContent(JSON.stringify({ ...plan, uploaded }, null, 2));
}

async function toolGameSaveTest(args = {}) {
  const commandArgs = [];
  appendModManagerArgs(commandArgs, args, 'game');
  if (args.saveSlot !== undefined) commandArgs.push('--save-slot', String(numeric(args.saveSlot, undefined, 0)));
  if (args.saveSource) commandArgs.push('--save-source', String(args.saveSource));
  if (args.gameAction) commandArgs.push('--game-action', String(args.gameAction));
  if (args.actionSelector) commandArgs.push('--action-selector', String(args.actionSelector));
  if (args.actionPage) commandArgs.push('--action-page', String(args.actionPage));
  if (args.readOnly === false) commandArgs.push('--allow-save-writes');
  if (args.durationMs !== undefined) commandArgs.push('--duration-ms', String(numeric(args.durationMs, 5000, 0)));
  const output = run(process.execPath, commandArgs);
  return textContent(output);
}

async function toolModSmoke(args = {}) {
  const commandArgs = [
    path.join(REPO_ROOT, 'scripts/mod-test.mjs'),
    '--mode',
    'smoke',
    '--url',
    args.url || 'https://melvoridle.com/index_game.php',
    '--timeout-ms',
    String(numeric(args.timeoutMs, 45000, 1000)),
    '--wait-ms',
    String(numeric(args.waitMs, 5000, 0)),
    '--report-dir',
    args.reportDir || DEFAULT_REPORTS_DIR,
  ];
  if (args.modPath) commandArgs.push('--mod-path', args.modPath);
  const output = run(process.execPath, commandArgs);
  return textContent(output);
}

async function toolModProfile(args = {}) {
  const commandArgs = [
    path.join(REPO_ROOT, 'scripts/mod-test.mjs'),
    '--mode',
    'profile',
    '--url',
    args.url || 'https://melvoridle.com/index_game.php',
    '--timeout-ms',
    String(numeric(args.timeoutMs, 45000, 1000)),
    '--duration-ms',
    String(numeric(args.durationMs, 15000, 1000)),
    '--report-dir',
    args.reportDir || DEFAULT_REPORTS_DIR,
  ];
  if (args.modPath) commandArgs.push('--mod-path', args.modPath);
  const output = run(process.execPath, commandArgs);
  return textContent(output);
}

async function callTool(name, args) {
  try {
    if (name === 'melvor_mcp_context') return await toolMcpContext(args);
    if (name === 'game_source_search') return await toolSearch(args);
    if (name === 'game_source_read') return await toolRead(args);
    if (name === 'game_source_manifest') return await toolManifest(args);
    if (name === 'game_source_branches') return await toolBranches(args);
    if (name === 'game_source_download') return await toolDownload(args);
    if (name === 'game_source_beautify') return await toolBeautify(args);
    if (name === 'melvor_modding_guides_list') return await toolGuidesList(args);
    if (name === 'melvor_modding_guides_read') return await toolGuidesRead(args);
    if (name === 'melvor_modding_guides_search') return await toolGuidesSearch(args);
    if (name === 'mod_manager_loaded_mods') return await toolModManagerLoaded(args);
    if (name === 'mod_manager_fetch_sources') return await toolModManagerFetchSources(args);
    if (name === 'mod_source_search') return await toolModSourceSearch(args);
    if (name === 'mod_source_read') return await toolModSourceRead(args);
    if (name === 'mod_manager_configure_mod') return await toolModManagerConfigure(args);
    if (name === 'creator_toolkit_local_mods') return await toolCreatorToolkitLocalMods(args);
    if (name === 'melvor_mod_release_status') return await toolModReleaseStatus(args);
    if (name === 'melvor_mod_release_package') return await toolModReleasePackage(args);
    if (name === 'melvor_modio_upload') return await toolModioUpload(args);
    if (name === 'mod_test_browser_check') return await toolBrowserCheck(args);
    if (name === 'game_save_test') return await toolGameSaveTest(args);
    if (name === 'game_session_start') return await toolGameSessionStart(args);
    if (name === 'game_session_action') return await toolGameSessionAction(args);
    if (name === 'game_session_state') return await toolGameSessionState(args);
    if (name === 'game_session_save') return await toolGameSessionSave(args);
    if (name === 'game_session_local_mod') return await toolGameSessionLocalMod(args);
    if (name === 'game_session_mod_profile') return await toolGameSessionModProfile(args);
    if (name === 'game_session_debug_probe') return await toolGameSessionDebugProbe(args);
    if (name === 'game_session_time_skip') return await toolGameSessionTimeSkip(args);
    if (name === 'game_session_screenshot') return await toolGameSessionScreenshot(args);
    if (name === 'game_session_stop') return await toolGameSessionStop(args);
    if (name === 'game_profile_start') return await toolGameProfileStart(args);
    if (name === 'game_profile_read') return await toolGameProfileRead(args);
    if (name === 'game_profile_mark') return await toolGameProfileMark(args);
    if (name === 'game_profile_stop') return await toolGameProfileStop(args);
    if (name === 'mod_test_smoke') return await toolModSmoke(args);
    if (name === 'mod_profile_runtime') return await toolModProfile(args);
    throw new ProtocolError(-32602, `Unknown tool: ${name}`);
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    return errorContent(error);
  }
}

class ProtocolError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

function response(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, error) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: error.code || -32603,
      message: error.message || 'Internal error',
      ...(error.data === undefined ? {} : { data: error.data }),
    },
  };
}

async function handleRequest(message) {
  if (!message || message.jsonrpc !== '2.0') {
    throw new ProtocolError(-32600, 'Invalid JSON-RPC message');
  }

  if (message.id === undefined) {
    if (message.method === 'notifications/initialized' || message.method?.startsWith('notifications/')) {
      return null;
    }
    return null;
  }

  if (message.method === 'initialize') {
    const requested = message.params?.protocolVersion;
    return response(message.id, {
      protocolVersion: requested || DEFAULT_PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: 'melvor-game-source-tools',
        version: SERVER_VERSION,
      },
      instructions: MCP_SERVER_INSTRUCTIONS,
    });
  }

  if (message.method === 'ping') {
    return response(message.id, {});
  }

  if (message.method === 'tools/list') {
    return response(message.id, { tools: TOOLS });
  }

  if (message.method === 'tools/call') {
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    if (!name) throw new ProtocolError(-32602, 'Missing tool name');
    return response(message.id, await callTool(name, args));
  }

  throw new ProtocolError(-32601, `Method not found: ${message.method}`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleMessage(input) {
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    send(errorResponse(null, new ProtocolError(-32700, `Parse error: ${error.message}`)));
    return;
  }

  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const responses = [];
  for (const message of messages) {
    try {
      const result = await handleRequest(message);
      if (result) responses.push(result);
    } catch (error) {
      responses.push(errorResponse(message?.id ?? null, error));
    }
  }

  if (Array.isArray(parsed)) {
    if (responses.length > 0) send(responses);
  } else if (responses.length > 0) {
    send(responses[0]);
  }
}

if (!fs.existsSync(path.join(REPO_ROOT, 'scripts/search-game-source.mjs'))) {
  process.stderr.write('Missing scripts/search-game-source.mjs next to MCP server.\n');
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  handleMessage(line).catch((error) => {
    send(errorResponse(null, error));
  });
});

async function closeAllGameSessions() {
  await Promise.all(
    [...gameSessions.values()].map(async (session) => {
      try {
        await closeGameSession(session);
      } catch {
        await session.context?.close?.().catch(() => {});
        await session.browser?.close?.().catch(() => {});
      }
    })
  );
}

rl.on('close', () => {
  closeAllGameSessions().finally(() => process.exit(0));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    closeAllGameSessions().finally(() => process.exit(0));
  });
}
