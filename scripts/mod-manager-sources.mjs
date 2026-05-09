#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_URL = 'https://melvoridle.com/index_game.php';
const DEFAULT_OUT_DIR = 'mod-sources';

function loadDotEnv(filePath) {
  if (!fsSync.existsSync(filePath)) return;
  const lines = fsSync.readFileSync(filePath, 'utf8').split(/\r?\n/);
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

function parseArgs(argv) {
  const options = {
    headful: false,
    includeDisabled: false,
    mode: 'list',
    outDir: process.env.MELVOR_MOD_SOURCES_DIR || path.join(REPO_ROOT, DEFAULT_OUT_DIR),
    password: process.env.MELVOR_CLOUD_PASSWORD || '',
    storageState: process.env.MELVOR_BROWSER_STORAGE_STATE || '',
    timeoutMs: 90000,
    url: DEFAULT_URL,
    username: process.env.MELVOR_CLOUD_USERNAME || '',
    waitMs: 10000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };

    if (arg === '--headful') options.headful = true;
    else if (arg === '--include-disabled') options.includeDisabled = true;
    else if (arg === '--mode') options.mode = nextValue();
    else if (arg.startsWith('--mode=')) options.mode = arg.slice('--mode='.length);
    else if (arg === '--out') options.outDir = nextValue();
    else if (arg.startsWith('--out=')) options.outDir = arg.slice('--out='.length);
    else if (arg === '--password') options.password = nextValue();
    else if (arg.startsWith('--password=')) options.password = arg.slice('--password='.length);
    else if (arg === '--storage-state') options.storageState = nextValue();
    else if (arg.startsWith('--storage-state=')) options.storageState = arg.slice('--storage-state='.length);
    else if (arg === '--timeout-ms') options.timeoutMs = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = Number.parseInt(arg.slice('--timeout-ms='.length), 10);
    else if (arg === '--url') options.url = nextValue();
    else if (arg.startsWith('--url=')) options.url = arg.slice('--url='.length);
    else if (arg === '--username') options.username = nextValue();
    else if (arg.startsWith('--username=')) options.username = arg.slice('--username='.length);
    else if (arg === '--wait-ms') options.waitMs = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--wait-ms=')) options.waitMs = Number.parseInt(arg.slice('--wait-ms='.length), 10);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!['list', 'fetch'].includes(options.mode)) throw new Error(`Unknown mode: ${options.mode}`);
  for (const key of ['timeoutMs', 'waitMs']) {
    if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error(`${key} must be zero or greater`);
  }

  options.outDir = path.resolve(options.outDir);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/mod-manager-sources.mjs --mode <list|fetch> [options]

Options:
  --url <url>              Melvor URL to open. Defaults to ${DEFAULT_URL}
  --out <dir>              Output directory for fetched mod source. Defaults to ${DEFAULT_OUT_DIR}/
  --username <username>    Melvor Cloud username. Defaults to MELVOR_CLOUD_USERNAME.
  --password <password>    Melvor Cloud password. Defaults to MELVOR_CLOUD_PASSWORD.
  --storage-state <file>   Optional Playwright storage state file to reuse/save login.
  --include-disabled       Fetch installed mods even if they did not load.
  --headful                Show Chromium while logging in.
  --timeout-ms <n>         Navigation/login timeout. Defaults to 90000.
  --wait-ms <n>            Extra settle time after Mod Manager appears. Defaults to 10000.
`);
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

async function waitForModManager(page, options) {
  await gotoAndSettle(page, options.url, options.timeoutMs);
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
  await page
    .waitForFunction(() => typeof mod === 'undefined' || !mod.manager?.isProcessing?.(), undefined, {
      timeout: Math.min(options.timeoutMs, 30000),
    })
    .catch(() => {});
  if (options.waitMs > 0) await page.waitForTimeout(options.waitMs);
}

async function collectModManagerState(page, includeResources) {
  return await page.evaluate(async ({ includeResources }) => {
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
          getAll.onsuccess = () => resolve(getAll.result || []);
        };
      });
    }

    function blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onloadend = () => {
          const result = String(reader.result || '');
          resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
        };
        reader.readAsDataURL(blob);
      });
    }

    function contextExists(namespace) {
      if (!namespace || typeof mod === 'undefined' || !mod.getContext) return false;
      try {
        mod.getContext(namespace);
        return true;
      } catch {
        return false;
      }
    }

    const manager = typeof mod !== 'undefined' ? mod.manager : null;
    const loadedNames = manager?.getLoadedModList?.() || [];
    const activeProfile = manager?.activeProfile || null;
    const activeProfileModIds = new Set((activeProfile?.mods || []).map((id) => String(id)));
    const storedMods = await getAllFromIndexedDB('melvordb', 'mods');

    const mods = [];
    for (const stored of storedMods) {
      const resourceNames = Object.keys(stored.resources || {}).sort();
      const loaded = contextExists(stored.namespace) || loadedNames.includes(stored.name);
      const mod = {
        id: stored.id,
        name: stored.name,
        namespace: stored.namespace || null,
        version: stored.version,
        author: stored.author || null,
        description: stored.description || null,
        tags: stored.tags || null,
        modioUrl: stored.modioUrl || null,
        homepageUrl: stored.homepageUrl || null,
        dependencies: stored.dependencies || [],
        installed: stored.installed || null,
        updated: stored.updated || null,
        setup: stored.setup || null,
        load: stored.load || null,
        icon: stored.icon || null,
        loaded,
        inActiveProfile: activeProfileModIds.has(String(stored.id)),
        resourceCount: resourceNames.length,
        resources: resourceNames,
      };

      if (includeResources) {
        mod.resourceBlobs = [];
        for (const resourcePath of resourceNames) {
          const blob = stored.resources[resourcePath];
          if (!blob) continue;
          mod.resourceBlobs.push({
            path: resourcePath,
            type: blob.type || '',
            size: blob.size || 0,
            base64: await blobToBase64(blob),
          });
        }
      }

      mods.push(mod);
    }

    return {
      location: location.href,
      title: document.title,
      isLoggedIn: Boolean(manager?.isLoggedIn?.()),
      isEnabled: Boolean(manager?.isEnabled?.()),
      isProcessing: Boolean(manager?.isProcessing?.()),
      activeProfile,
      loadedNames,
      installedCount: storedMods.length,
      mods,
    };
  }, { includeResources });
}

function slug(value) {
  return (
    String(value || 'mod')
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'mod'
  );
}

function safeResourcePath(value) {
  const normalized = path.posix.normalize(String(value || '').replace(/\\/g, '/'));
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error(`Unsafe mod resource path: ${value}`);
  }
  return normalized;
}

async function writeFetchedSources(state, options) {
  const outRoot = options.outDir;
  await fs.mkdir(outRoot, { recursive: true });
  const exportedMods = [];

  for (const mod of state.mods) {
    if (!options.includeDisabled && !mod.loaded) continue;
    const dir = path.join(outRoot, `${String(mod.id)}-${slug(mod.name)}`);
    await fs.mkdir(dir, { recursive: true });
    const files = [];
    let bytes = 0;

    for (const resource of mod.resourceBlobs || []) {
      const relativePath = safeResourcePath(resource.path);
      const filePath = path.join(dir, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const buffer = Buffer.from(resource.base64, 'base64');
      await fs.writeFile(filePath, buffer);
      files.push({ path: relativePath, type: resource.type, bytes: buffer.length });
      bytes += buffer.length;
    }

    const metadata = {
      id: mod.id,
      name: mod.name,
      namespace: mod.namespace,
      version: mod.version,
      author: mod.author,
      modioUrl: mod.modioUrl,
      homepageUrl: mod.homepageUrl,
      loaded: mod.loaded,
      inActiveProfile: mod.inActiveProfile,
      setup: mod.setup,
      load: mod.load,
      icon: mod.icon,
      dependencies: mod.dependencies,
      exportedAt: new Date().toISOString(),
      files,
    };
    await fs.writeFile(path.join(dir, 'mod-source.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    exportedMods.push({ id: mod.id, name: mod.name, namespace: mod.namespace, version: mod.version, dir, files: files.length, bytes });
  }

  return { outDir: outRoot, exportedMods };
}

async function run(options) {
  const browser = await chromium.launch({ headless: !options.headful });
  const contextOptions = {};
  if (options.storageState && fsSync.existsSync(options.storageState)) contextOptions.storageState = options.storageState;
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    await gotoAndSettle(page, options.url, options.timeoutMs);
    const login = await loginIfNeeded(page, options);
    await waitForModManager(page, options);
    if (options.storageState) {
      await fs.mkdir(path.dirname(path.resolve(options.storageState)), { recursive: true });
      await context.storageState({ path: options.storageState });
    }

    const state = await collectModManagerState(page, options.mode === 'fetch');
    const visibleState = {
      ...state,
      mods: state.mods.map(({ resourceBlobs, ...mod }) => mod),
    };

    if (options.mode === 'list') {
      return { ok: true, mode: options.mode, login, ...visibleState };
    }

    const exported = await writeFetchedSources(state, options);
    return { ok: true, mode: options.mode, login, ...visibleState, exported };
  } finally {
    await browser.close();
  }
}

const options = parseArgs(process.argv.slice(2));
run(options)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
