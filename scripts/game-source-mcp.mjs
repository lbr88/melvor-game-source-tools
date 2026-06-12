#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
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
const DEFAULT_MODIO_GAME_ID = process.env.MODIO_GAME_ID || '2869';
const DEFAULT_MODIO_GAME_API_BASE_URL = process.env.MODIO_GAME_API_BASE_URL || `https://g-${DEFAULT_MODIO_GAME_ID}.modapi.io/v1`;
const DEFAULT_MODIO_FILE_FIELD = process.env.MODIO_FILE_FIELD || 'filedata';
const DEFAULT_GUIDES_API_URL = process.env.MELVOR_GUIDES_API_URL || 'https://wiki.melvoridle.com/api.php';
const DEFAULT_GUIDES_BASE_URL = process.env.MELVOR_GUIDES_BASE_URL || 'https://wiki.melvoridle.com/w/';
const DEFAULT_GUIDES_PREFIX = process.env.MELVOR_GUIDES_PREFIX || 'Mod Creation';
const DEFAULT_LOCAL_GUIDES_DIR = process.env.MELVOR_LOCAL_GUIDES_DIR || path.join(REPO_ROOT, 'docs', 'modding');
const LOCAL_SOURCES = ['web', 'android-loaded'];
const DEFAULT_MELVOR_URL = 'https://melvoridle.com/index_game.php';
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
    name: 'game_source_search',
    title: 'Search Melvor Game Source',
    description: 'Search an ignored local source store or an optional external git-backed Melvor game-source checkout.',
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
    description: 'Create a readable copy of raw fetched source under ignored game-source-readable/. Raw fetched source is left unchanged.',
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
    description: 'Discover the packaged Melvor modding documentation index and official wiki guide pages. Use this first when a client needs to know what mod-development docs are available.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'melvor_modding_guides_read',
    title: 'Read Melvor Modding Guide',
    description: 'Read a packaged Melvor modding doc or official wiki guide. Packaged docs include the overview, source asset catalog, local mod-writing patterns, Creator Toolkit notes, browser sessions, and save-test notes.',
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
    description: 'Search packaged Melvor modding docs plus official wiki guides. Use for mod-development questions about ctx.patch, lifecycle hooks, settings, templates, Creator Toolkit local mods, offline processing, source assets, browser sessions, and save tests.',
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
        action: { type: 'string', enum: ['wait', 'click_selector', 'fill_selector', 'press', 'open_page', 'evaluate'] },
        selector: { type: 'string', description: 'CSS selector for click_selector, fill_selector, or press.' },
        text: { type: 'string', description: 'Text for fill_selector.' },
        key: { type: 'string', description: 'Keyboard key for press.' },
        pageId: { type: 'string', description: 'Melvor page id for open_page, for example melvorD:Woodcutting.' },
        script: { type: 'string', description: 'JavaScript expression or async function body to evaluate in the page for action=evaluate.' },
        durationMs: { type: 'integer', minimum: 0, default: 1000 },
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
    description: 'Start Playwright tracing and in-page performance collection on an existing persistent Melvor game session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        label: { type: 'string', default: 'profile' },
        trace: { type: 'boolean', default: true },
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
    description: 'Read current performance counters, long tasks, Optimizer state, and browser events from an active or recently stopped profile.',
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
    name: 'game_profile_stop',
    title: 'Stop Live Game Profiling',
    description: 'Stop profiling on an existing persistent game session, write a trace artifact when enabled, and keep the browser open.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', default: 'default' },
        reportDir: { type: 'string', description: 'Output directory for trace/report artifacts. Defaults to ignored reports/.' },
        maxLongTasks: { type: 'integer', minimum: 0, default: 50 },
        maxBrowserEvents: { type: 'integer', minimum: 0, default: 50 },
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
  const apiBase = String(args.apiBase || process.env.MODIO_GAME_API_BASE_URL || DEFAULT_MODIO_GAME_API_BASE_URL).replace(/\/+$/, '');

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

function isoFromUnix(value) {
  if (!value) return null;
  return new Date(Number(value) * 1000).toISOString();
}

function sanitizeModioRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name || null,
    name_id: record.name_id || null,
    profile_url: record.profile_url || null,
    author: record.submitted_by?.username || record.submitted_by?.display_name || record.submitted_by?.id || null,
    date_updated: isoFromUnix(record.date_updated),
    modfile: record.modfile
      ? {
          id: record.modfile.id || null,
          version: record.modfile.version || null,
          filename: record.modfile.filename || null,
          date_added: isoFromUnix(record.modfile.date_added),
        }
      : null,
  };
}

async function fetchModioRecord(context, modId) {
  if (!modId) return null;
  return sanitizeModioRecord(await modioJson(context, `/games/${context.gameId}/mods/${modId}`));
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
          profile_url: configuredModio.profile_url || null,
          author: configuredModio.author || null,
          version: configuredModio.version || null,
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
  if (summary.policy.role === 'owned_public_mod' && !summary.configuredModio?.id) summary.issues.push('owned public mod has no mod.io id');
  if (summary.git.isRepo && summary.git.dirty) summary.issues.push('git working tree is dirty');

  if (args.refreshModio !== false) {
    try {
      if (summary.configuredModio?.id) {
        summary.currentModio = await fetchModioRecord(context, summary.configuredModio.id);
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
    summary.policy.role === 'owned_public_mod'
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
  if (summary.policy.role !== 'owned_public_mod') throw new Error(`${summary.mod} is not mapped as an owned public mod.`);
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
  'game-source-assets-js.md': 'Assets/js architecture catalog: bundled files, built modules, mod loader location, and runtime libraries.',
  'generated-source-reference.md': 'Generated source reference: extracted modding-relevant classes, custom elements, lifecycle hooks, patching, offline processing, and file/line snippets.',
  'local-mod-writing-patterns.md': 'Practical mod implementation patterns: lifecycle hooks, ctx.patch, offline guards, templates, settings, APIs, DOM observers, and caching.',
  'creator-toolkit-local-mods.md': 'Creator Toolkit local mods: IndexedDB shape, linked mod.io behavior, load guards, .modignore, and MCP verification.',
  'live-game-sessions.md': 'Persistent browser sessions, read-only save guards, screenshots, live state reads, and profiling.',
  'game-save-browser-tests.md': 'One-shot save/browser regression checks and generated reports.',
};

const GUIDE_USE_CASES = [
  { question: 'What docs are available?', tool: 'melvor_modding_guides_list', page: 'README' },
  { question: 'How should a Melvor mod patch game behavior?', tool: 'melvor_modding_guides_search', query: 'ctx.patch before after replace' },
  { question: 'Where is a modding API symbol in source?', tool: 'melvor_modding_guides_search', query: 'generated source reference patching lifecycle offline custom elements' },
  { question: 'Which lifecycle hook should a mod use?', tool: 'melvor_modding_guides_search', query: 'onCharacterLoaded onInterfaceReady' },
  { question: 'How should a mod handle offline processing?', tool: 'melvor_modding_guides_search', query: 'offlineLoopEntered loadingOfflineProgress OfflineLoadingElement' },
  { question: 'How do local Creator Toolkit mods load?', tool: 'melvor_modding_guides_read', page: 'creator-toolkit-local-mods' },
  { question: 'How do I test a mod safely in the browser?', tool: 'melvor_modding_guides_read', page: 'live-game-sessions' },
];

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
      startHere: {
        title: 'Local/Melvor Modding Docs Overview',
        page: 'README',
      },
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

    const storageSetItem = Storage.prototype.setItem;
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

  session.profile = {
    active: true,
    label,
    trace,
    browserEventStartIndex: session.browserEvents.length,
    startedAt: new Date().toISOString(),
  };
  return inPage;
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
      navigation,
      resources: resourceSummary,
      memory,
      querySelectorAllName: document.querySelectorAll?.name || '',
    };
  }, { maxLongTasks });
  const state = await collectGameSessionState(session, { maxBrowserEvents: 0 });
  const browserEvents = session.browserEvents
    .slice(browserEventStartIndex)
    .slice(maxBrowserEvents === 0 ? session.browserEvents.length : -maxBrowserEvents)
    .map(({ dedupeKey, ...event }) => event);
  return {
    sessionId: session.id,
    profile,
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

async function stopGameProfile(session, args = {}) {
  if (!session.profile?.active) throw new Error(`No active profile for session "${session.id}".`);
  const reportDir = await newReportDir(args.reportDir || DEFAULT_REPORTS_DIR, `game-profile-${session.id}-${session.profile.label}`);
  let tracePath = null;
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
    };
  });
  session.profile.active = false;
  session.profile.tracePath = tracePath;
  const summary = await readGameProfile(session, args).catch(() => null);
  const report = {
    ok: true,
    sessionId: session.id,
    profile,
    summary,
    tracePath,
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
    if (name === 'game_session_screenshot') return await toolGameSessionScreenshot(args);
    if (name === 'game_session_stop') return await toolGameSessionStop(args);
    if (name === 'game_profile_start') return await toolGameProfileStart(args);
    if (name === 'game_profile_read') return await toolGameProfileRead(args);
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
