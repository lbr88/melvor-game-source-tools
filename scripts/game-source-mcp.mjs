#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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
const DEFAULT_GUIDES_API_URL = process.env.MELVOR_GUIDES_API_URL || 'https://wiki.melvoridle.com/api.php';
const DEFAULT_GUIDES_BASE_URL = process.env.MELVOR_GUIDES_BASE_URL || 'https://wiki.melvoridle.com/w/';
const DEFAULT_GUIDES_PREFIX = process.env.MELVOR_GUIDES_PREFIX || 'Mod Creation';
const DEFAULT_LOCAL_GUIDES_DIR = process.env.MELVOR_LOCAL_GUIDES_DIR || path.join(REPO_ROOT, 'docs', 'modding');
const LOCAL_SOURCES = ['web', 'android-loaded'];

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
    title: 'Download Source Snapshot',
    description: 'Download desktop/web or Android-loaded source into the ignored local game-source store. This writes local files only and does not commit or push source.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['web', 'android'], default: 'web' },
        repo: { type: 'string', description: 'Local ignored source store path. Defaults to ./game-source beside the MCP server.' },
        outDir: { type: 'string', description: 'Output directory. Defaults to snapshots/<timestamp>.' },
        install: { type: 'boolean', default: true, description: 'Promote the staged snapshot into game-source/web or game-source/android-loaded.' },
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
    description: 'List official Melvor Idle wiki Mod Creation guide pages plus local repo modding notes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'melvor_modding_guides_read',
    title: 'Read Melvor Modding Guide',
    description: 'Read an official Melvor Idle wiki Mod Creation guide page or local repo modding note as plain text or wikitext.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'string', default: 'Mod Creation', description: 'Guide title, for example "Mod Creation/Essentials".' },
        format: { type: 'string', enum: ['text', 'wikitext'], default: 'text' },
        maxChars: { type: 'integer', minimum: 0, default: 30000, description: '0 means unlimited.' },
      },
    },
  },
  {
    name: 'melvor_modding_guides_search',
    title: 'Search Melvor Modding Guides',
    description: 'Search official Melvor Idle wiki Mod Creation guides plus local repo modding notes.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        regex: { type: 'boolean', default: false },
        ignoreCase: { type: 'boolean', default: true },
        format: { type: 'string', enum: ['text', 'wikitext'], default: 'text' },
        contextChars: { type: 'integer', minimum: 0, default: 240 },
        maxResults: { type: 'integer', minimum: 1, default: 20 },
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
        operation: { type: 'string', enum: ['list', 'add', 'remove', 'enable', 'disable'], default: 'list' },
        modPath: { type: 'string', description: 'Local mod directory containing manifest.json, or a .zip modfile, for operation=add.' },
        name: { type: 'string', description: 'Optional Creator Toolkit display name for operation=add.' },
        localModId: { type: 'integer', minimum: 1, description: 'Creator Toolkit localMods IndexedDB id for enable/disable/remove or targeted replacement.' },
        linkedModId: { type: 'integer', minimum: 1, description: 'Optional mod.io id to link the local mod to.' },
        directoryPath: { type: 'string', description: 'Optional directory-link path to preserve in Creator Toolkit metadata. Browser automation packages the directory once; Steam does live directory re-zipping.' },
        disabled: { type: 'boolean', default: false, description: 'When adding, store the local mod disabled.' },
        replace: { type: 'boolean', default: false, description: 'When adding, replace an existing local mod with the same namespace, linked mod id, or name.' },
        apply: { type: 'boolean', default: false, description: 'Persist the change. Defaults to dry-run.' },
        url: { type: 'string', default: 'https://melvoridle.com/index_game.php' },
        timeoutMs: { type: 'integer', minimum: 1000, default: 90000 },
        waitMs: { type: 'integer', minimum: 0, default: 10000 },
        headful: { type: 'boolean', default: false },
        screenshot: { type: 'boolean', default: true, description: 'Save a Playwright page screenshot and JSON report.' },
        reportDir: { type: 'string', description: 'Output directory for screenshots and JSON reports. Defaults to ignored reports/.' },
        storageState: { type: 'string', description: 'Optional Playwright storage state file to reuse/save login.' },
      },
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
    sections.push({
      level: String(match[1].length),
      line: match[2].trim(),
      index: String(sections.length + 1),
      anchor: match[2].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    });
  }
  return sections;
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
      relativePath,
      format: 'text',
      sections: localGuideSections(text),
      text,
    });
  }
  return docs;
}

async function findLocalGuide(page) {
  const requested = String(page || '').replace(/^Local\//i, '').toLowerCase();
  const docs = await localGuideDocs();
  return docs.find((doc) => doc.title.toLowerCase() === String(page || '').toLowerCase())
    || docs.find((doc) => doc.title.replace(/^Local\//i, '').toLowerCase() === requested)
    || docs.find((doc) => doc.relativePath.replace(/\.md$/i, '').toLowerCase() === requested);
}

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

async function copyDir(source, target) {
  await fsp.mkdir(target, { recursive: true });
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await fsp.copyFile(sourcePath, targetPath);
    }
  }
}

async function promoteSnapshot(snapshotDir, sourceStore, source) {
  const assetsDir = path.join(snapshotDir, 'assets');
  const manifestPath = path.join(snapshotDir, 'manifest.json');
  const targetDir = path.join(sourceStore, source);

  if (!fs.existsSync(assetsDir)) throw new Error(`Snapshot has no assets directory: ${assetsDir}`);
  if (!fs.existsSync(manifestPath)) throw new Error(`Snapshot has no manifest.json: ${manifestPath}`);

  await fsp.rm(targetDir, { recursive: true, force: true });
  await fsp.mkdir(targetDir, { recursive: true });
  await copyDir(assetsDir, targetDir);
  await fsp.copyFile(manifestPath, path.join(targetDir, 'source-manifest.json'));

  const domPath = path.join(snapshotDir, 'page-dom.html');
  if (fs.existsSync(domPath)) {
    await fsp.copyFile(domPath, path.join(targetDir, 'page-dom.html'));
  }

  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  return {
    targetDir,
    sourceVersion: manifest.sourceVersion,
    summary: manifest.summary,
  };
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
    || path.join(REPO_ROOT, 'snapshots', `${new Date().toISOString().replace(/[:.]/g, '-')}-${normalizedSource}`);
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
  if (args.maxAssets) commandArgs.push('--max-assets', String(numeric(args.maxAssets, 500, 1)));
  if (args.timeoutMs) commandArgs.push('--timeout-ms', String(numeric(args.timeoutMs, 45000, 1000)));
  if (args.settleMs !== undefined) commandArgs.push('--settle-ms', String(numeric(args.settleMs, 3000, 0)));

  const output = run(process.execPath, commandArgs);
  let promoted = null;
  if (install) {
    promoted = await promoteSnapshot(outDir, sourceStore, normalizedSource);
  }

  return textContent(JSON.stringify({
    output,
    snapshotDir: outDir,
    installed: Boolean(promoted),
    promoted,
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
  return textContent(JSON.stringify({
    api: DEFAULT_GUIDES_API_URL,
    prefix: DEFAULT_GUIDES_PREFIX,
    localDocsDir: DEFAULT_LOCAL_GUIDES_DIR,
    pages: [
      ...pages.map((page) => ({
        title: page.title,
        pageid: page.pageid,
        source: 'official',
        url: guidePageUrl(page.title),
      })),
      ...localDocs.map((doc) => ({
        title: doc.title,
        source: 'local',
        path: doc.path,
      })),
    ],
  }, null, 2));
}

async function toolGuidesRead(args = {}) {
  const maxChars = numeric(args.maxChars, 30000, 0);
  const localDoc = await findLocalGuide(args.page || '');
  if (localDoc) {
    return textContent(JSON.stringify({
      title: localDoc.title,
      source: 'local',
      path: localDoc.path,
      format: args.format || 'text',
      sections: localDoc.sections,
      text: limitText(localDoc.text, maxChars),
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
  const flags = `g${args.ignoreCase === false ? '' : 'i'}`;
  const pattern = args.regex ? query : escapeRegExp(query);
  const matcher = new RegExp(pattern, flags);
  const [pages, localDocs] = await Promise.all([fetchGuidePages(), localGuideDocs()]);
  const results = [];

  for (const doc of localDocs) {
    if (results.length >= maxResults) break;
    let match;
    while (results.length < maxResults && (match = matcher.exec(doc.text)) !== null) {
      results.push({
        title: doc.title,
        source: 'local',
        path: doc.path,
        index: match.index,
        match: match[0],
        snippet: guideSnippet(doc.text, match.index, match[0].length, contextChars),
      });
      if (matcher.lastIndex === match.index) matcher.lastIndex += 1;
    }
  }

  for (const guide of pages) {
    if (results.length >= maxResults) break;
    const page = await fetchGuidePage(guide.title, format);
    let match;
    while (results.length < maxResults && (match = matcher.exec(page.text)) !== null) {
      results.push({
        title: page.title,
        source: 'official',
        url: page.url,
        index: match.index,
        match: match[0],
        snippet: guideSnippet(page.text, match.index, match[0].length, contextChars),
      });
      if (matcher.lastIndex === match.index) matcher.lastIndex += 1;
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
  commandArgs.push('--url', args.url || 'https://melvoridle.com/index_game.php');
  commandArgs.push('--timeout-ms', String(numeric(args.timeoutMs, 90000, 1000)));
  commandArgs.push('--wait-ms', String(numeric(args.waitMs, 10000, 0)));
  if (args.includeDisabled) commandArgs.push('--include-disabled');
  if (args.headful) commandArgs.push('--headful');
  if (args.screenshot === false) commandArgs.push('--no-screenshot');
  if (args.reportDir) commandArgs.push('--report-dir', args.reportDir);
  if (args.storageState) commandArgs.push('--storage-state', args.storageState);
  if (mode === 'fetch') commandArgs.push('--out', args.outDir || DEFAULT_MOD_SOURCES_DIR);
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
  if (args.apply) commandArgs.push('--apply');
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
    if (name === 'mod_test_browser_check') return await toolBrowserCheck(args);
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
