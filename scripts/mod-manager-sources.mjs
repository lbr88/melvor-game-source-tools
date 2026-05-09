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
const DEFAULT_REPORTS_DIR = 'reports';

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
    apply: false,
    directoryPath: '',
    disabled: false,
    durationMs: 5000,
    gameAction: 'snapshot',
    headful: false,
    includeDisabled: false,
    actionPage: '',
    actionSelector: '',
    linkedModId: null,
    localModId: null,
    modioRecovery: 'local',
    modId: null,
    modPath: '',
    mode: 'list',
    name: '',
    operation: 'list',
    outDir: process.env.MELVOR_MOD_SOURCES_DIR || path.join(REPO_ROOT, DEFAULT_OUT_DIR),
    password: process.env.MELVOR_CLOUD_PASSWORD || '',
    persist: true,
    profileId: '',
    reportDir: process.env.MELVOR_REPORTS_DIR || path.join(REPO_ROOT, DEFAULT_REPORTS_DIR),
    replace: false,
    cleanup: true,
    readOnly: true,
    saveSlot: process.env.MELVOR_TEST_CHARACTER_SLOT ? Number.parseInt(process.env.MELVOR_TEST_CHARACTER_SLOT, 10) : null,
    saveSource: 'cloud',
    screenshot: true,
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
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--directory-path') options.directoryPath = nextValue();
    else if (arg.startsWith('--directory-path=')) options.directoryPath = arg.slice('--directory-path='.length);
    else if (arg === '--disabled') options.disabled = true;
    else if (arg === '--duration-ms') options.durationMs = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--duration-ms=')) options.durationMs = Number.parseInt(arg.slice('--duration-ms='.length), 10);
    else if (arg === '--enabled') options.disabled = false;
    else if (arg === '--game-action') options.gameAction = nextValue();
    else if (arg.startsWith('--game-action=')) options.gameAction = arg.slice('--game-action='.length);
    else if (arg === '--linked-mod-id') options.linkedModId = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--linked-mod-id=')) options.linkedModId = Number.parseInt(arg.slice('--linked-mod-id='.length), 10);
    else if (arg === '--local-mod-id') options.localModId = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--local-mod-id=')) options.localModId = Number.parseInt(arg.slice('--local-mod-id='.length), 10);
    else if (arg === '--modio-recovery') options.modioRecovery = nextValue();
    else if (arg.startsWith('--modio-recovery=')) options.modioRecovery = arg.slice('--modio-recovery='.length);
    else if (arg === '--mod-id') options.modId = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--mod-id=')) options.modId = Number.parseInt(arg.slice('--mod-id='.length), 10);
    else if (arg === '--mod-path') options.modPath = nextValue();
    else if (arg.startsWith('--mod-path=')) options.modPath = arg.slice('--mod-path='.length);
    else if (arg === '--mode') options.mode = nextValue();
    else if (arg.startsWith('--mode=')) options.mode = arg.slice('--mode='.length);
    else if (arg === '--name') options.name = nextValue();
    else if (arg.startsWith('--name=')) options.name = arg.slice('--name='.length);
    else if (arg === '--operation') options.operation = nextValue();
    else if (arg.startsWith('--operation=')) options.operation = arg.slice('--operation='.length);
    else if (arg === '--out') options.outDir = nextValue();
    else if (arg.startsWith('--out=')) options.outDir = arg.slice('--out='.length);
    else if (arg === '--password') options.password = nextValue();
    else if (arg.startsWith('--password=')) options.password = arg.slice('--password='.length);
    else if (arg === '--no-persist') options.persist = false;
    else if (arg === '--profile-id') options.profileId = nextValue();
    else if (arg.startsWith('--profile-id=')) options.profileId = arg.slice('--profile-id='.length);
    else if (arg === '--report-dir') options.reportDir = nextValue();
    else if (arg.startsWith('--report-dir=')) options.reportDir = arg.slice('--report-dir='.length);
    else if (arg === '--replace') options.replace = true;
    else if (arg === '--allow-save-writes') options.readOnly = false;
    else if (arg === '--no-cleanup') options.cleanup = false;
    else if (arg === '--no-screenshot') options.screenshot = false;
    else if (arg === '--save-slot') options.saveSlot = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--save-slot=')) options.saveSlot = Number.parseInt(arg.slice('--save-slot='.length), 10);
    else if (arg === '--save-source') options.saveSource = nextValue();
    else if (arg.startsWith('--save-source=')) options.saveSource = arg.slice('--save-source='.length);
    else if (arg === '--action-page') options.actionPage = nextValue();
    else if (arg.startsWith('--action-page=')) options.actionPage = arg.slice('--action-page='.length);
    else if (arg === '--action-selector') options.actionSelector = nextValue();
    else if (arg.startsWith('--action-selector=')) options.actionSelector = arg.slice('--action-selector='.length);
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

  if (!['list', 'fetch', 'profile', 'local', 'game'].includes(options.mode)) throw new Error(`Unknown mode: ${options.mode}`);
  if (!['snapshot', 'wait', 'click_selector', 'open_page'].includes(options.gameAction)) throw new Error(`Unknown game action: ${options.gameAction}`);
  if (!['fail', 'local', 'reload'].includes(options.modioRecovery)) throw new Error(`Unknown mod.io recovery mode: ${options.modioRecovery}`);
  if (!['cloud', 'local'].includes(options.saveSource)) throw new Error(`Unknown save source: ${options.saveSource}`);
  for (const key of ['timeoutMs', 'waitMs']) {
    if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error(`${key} must be zero or greater`);
  }
  if (!Number.isFinite(options.durationMs) || options.durationMs < 0) throw new Error('durationMs must be zero or greater');
  for (const key of ['linkedModId', 'localModId', 'modId']) {
    if (options[key] !== null && (!Number.isInteger(options[key]) || options[key] <= 0)) {
      throw new Error(`${key} must be a positive integer`);
    }
  }

  options.outDir = path.resolve(options.outDir);
  options.reportDir = path.resolve(options.reportDir);
  if (options.modPath) options.modPath = path.resolve(options.modPath);
  if (options.directoryPath) options.directoryPath = path.resolve(options.directoryPath);
  if (options.saveSlot !== null && (!Number.isInteger(options.saveSlot) || options.saveSlot < 0)) {
    throw new Error('saveSlot must be zero or greater.');
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/mod-manager-sources.mjs --mode <list|fetch|profile|local|game> [options]

Options:
  --url <url>              Melvor URL to open. Defaults to ${DEFAULT_URL}
  --out <dir>              Output directory for fetched mod source. Defaults to ${DEFAULT_OUT_DIR}/
  --operation <name>       Operation for profile/local modes.
  --mod-id <id>            Mod.io id for profile operations.
  --profile-id <id>        Profile id for profile operations. Defaults to active profile.
  --local-mod-id <id>      Creator Toolkit local mod id for local enable/disable/remove.
  --mod-path <path>        Local mod directory or zip for Creator Toolkit add.
  --name <name>            Display name for Creator Toolkit local mod add.
  --linked-mod-id <id>     Optional mod.io id linked to a Creator Toolkit local mod.
  --directory-path <path>  Preserve a directory-link path in Creator Toolkit metadata.
  --modio-recovery <mode>  Handle mod.io unreachable prompts: local, reload, or fail. Default: local.
  --save-slot <n>          Save slot for game mode. Defaults to MELVOR_TEST_CHARACTER_SLOT.
  --save-source <source>   Save source for game mode: cloud or local. Default: cloud.
  --game-action <action>   Game action after loading save: snapshot, wait, click_selector, open_page.
  --action-selector <css>  CSS selector for game-action=click_selector.
  --action-page <page-id>  Page id for game-action=open_page, such as melvorD:Woodcutting.
  --duration-ms <n>        Settle/play duration after loading the save or action. Defaults to 5000.
  --allow-save-writes      Allow game mode to write local/cloud saves. Defaults to read-only guard.
  --apply                  Persist the requested mutation. Without this, mutations are dry-run.
  --no-persist             Update browser localStorage only instead of PlayFab account data.
  --report-dir <dir>       Output directory for screenshots/reports. Defaults to ${DEFAULT_REPORTS_DIR}/
  --replace                Replace matching local mod when adding.
  --no-cleanup             Keep test local mod after verify_load.
  --no-screenshot          Do not save a Playwright page screenshot/report.
  --disabled               Add a Creator Toolkit local mod disabled.
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

  const action = options.modioRecovery;
  const event = {
    action,
    title: prompt.title,
    text: prompt.text,
    observedAt: new Date().toISOString(),
  };
  options.modioRecoveryActions = [...(options.modioRecoveryActions || []), event];

  if (action === 'fail') {
    throw new Error(`mod.io unreachable prompt is open: ${prompt.text}`);
  }

  const buttonSelector = action === 'reload' ? '.swal2-confirm' : '.swal2-deny';
  await page.locator(buttonSelector).click({ timeout: 5000 });
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

function isNavigationContextError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Cannot find context with specified id|navigation/i.test(message);
}

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

async function retryAfterNavigation(page, options, callback) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await withTimeout(callback(), Math.min(options.timeoutMs, 30000), 'Browser page operation');
    } catch (error) {
      if (!isNavigationContextError(error)) throw error;
      lastError = error;
      await page.waitForTimeout(1000).catch(() => {});
      await waitForModManager(page, options, { navigate: false });
    }
  }
  throw lastError;
}

async function waitForLoadedModName(page, options, modName, label = modName, timeoutMs = Math.min(options.timeoutMs, 60000)) {
  const deadline = Date.now() + timeoutMs;
  let lastLoadedNames = [];
  while (Date.now() < deadline) {
    const recovery = await handleModioUnreachablePrompt(page, options);
    if (recovery?.action === 'reload') await waitForModManager(page, options, { navigate: false });
    const state = await page
      .evaluate((name) => {
        const loadedNames = typeof mod !== 'undefined' ? mod.manager?.getLoadedModList?.() || [] : [];
        return { loaded: loadedNames.includes(name), loadedNames };
      }, modName)
      .catch(() => ({ loaded: false, loadedNames: [] }));
    lastLoadedNames = state.loadedNames;
    if (state.loaded) return state;
    await page.waitForTimeout(1000).catch(() => {});
  }
  throw new Error(`Timed out waiting for ${label} to load. Loaded mods: ${lastLoadedNames.join(', ') || '(none)'}`);
}

async function waitForCreatorToolkitForVerify(page, options, label) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await waitForLoadedModName(page, options, 'Creator Toolkit', `${label} (attempt ${attempt + 1})`, Math.min(options.timeoutMs, 30000));
    } catch (error) {
      lastError = error;
      if (attempt >= 2) break;
      options.verifyLoadRetries = [
        ...(options.verifyLoadRetries || []),
        {
          label,
          attempt: attempt + 1,
          reason: error instanceof Error ? error.message : String(error),
          retriedAt: new Date().toISOString(),
        },
      ];
      await waitForModManager(page, { ...options, waitMs: Math.max(options.waitMs, 5000) });
    }
  }
  throw lastError;
}

async function waitForLocalModSignal(page, options, { localModName, namespace }, timeoutMs = Math.min(options.timeoutMs, 60000)) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    const recovery = await handleModioUnreachablePrompt(page, options);
    if (recovery?.action === 'reload') await waitForModManager(page, options, { navigate: false });
    lastState = await page
      .evaluate(
        ({ localModName, namespace }) => {
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
          const marker = globalThis.__mcpLocalModSmokeLoaded || null;
          const loadedByName = localModName ? loadedNames.includes(localModName) : false;
          const loadedByNamespace = contextExists(namespace);
          const loadedByMarker = marker && (!namespace || marker.namespace === namespace);
          return {
            loaded: Boolean(loadedByMarker || loadedByNamespace || loadedByName),
            loadedByMarker: Boolean(loadedByMarker),
            loadedByNamespace,
            loadedByName,
            loadedNames,
            marker,
          };
        },
        { localModName, namespace }
      )
      .catch(() => ({ loaded: false, loadedNames: [], marker: null }));
    if (lastState.loaded) return lastState;
    await page.waitForTimeout(1000).catch(() => {});
  }
  return lastState || { loaded: false, loadedNames: [], marker: null };
}

async function collectModManagerState(page, includeResources) {
  return await page.evaluate(async ({ includeResources }) => {
    function getAllFromIndexedDB(dbName, storeName) {
      return new Promise((resolve, reject) => {
        let db;
        let settled = false;
        const timeout = setTimeout(() => finish(reject, new Error(`Timed out reading IndexedDB ${dbName}.${storeName}`)), 10000);
        function finish(callback, value) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          try {
            db?.close();
          } catch {}
          callback(value);
        }

        const request = indexedDB.open(dbName);
        request.onerror = () => finish(reject, request.error);
        request.onblocked = () => finish(reject, new Error(`Blocked opening IndexedDB ${dbName}.${storeName}`));
        request.onsuccess = () => {
          db = request.result;
          db.onversionchange = () => db.close();
          let tx;
          try {
            tx = db.transaction(storeName, 'readonly');
          } catch (error) {
            finish(reject, error);
            return;
          }
          const store = tx.objectStore(storeName);
          const getAll = store.getAll();
          getAll.onerror = () => finish(reject, getAll.error);
          getAll.onsuccess = () => finish(resolve, getAll.result || []);
          tx.onabort = () => finish(reject, tx.error || new Error(`Aborted reading IndexedDB ${dbName}.${storeName}`));
          tx.onerror = () => finish(reject, tx.error);
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

function modResourceType(resourcePath) {
  const lower = resourcePath.toLowerCase();
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript';
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return '';
}

function shouldSkipLocalModPath(relativePath) {
  const parts = relativePath.split('/');
  return (
    parts.includes('.git') ||
    parts.includes('node_modules') ||
    parts.includes('.DS_Store') ||
    relativePath === '.modignore'
  );
}

async function readModIgnore(root) {
  const ignorePath = path.join(root, '.modignore');
  if (!fsSync.existsSync(ignorePath)) return [];
  const text = await fs.readFile(ignorePath, 'utf8');
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
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = safeResourcePath(path.relative(root, absolutePath).replace(/\\/g, '/'));
    if (shouldSkipLocalModPath(relativePath) || patterns.some((pattern) => matchesIgnorePattern(relativePath, pattern))) {
      continue;
    }

    if (entry.isDirectory()) {
      await collectLocalModFiles(root, absolutePath, patterns, files);
      continue;
    }

    if (!entry.isFile()) continue;
    const buffer = await fs.readFile(absolutePath);
    files.push({
      path: relativePath,
      type: modResourceType(relativePath),
      size: buffer.length,
      base64: buffer.toString('base64'),
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function newReportDir(root, mode) {
  const dir = path.resolve(root, `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function attachBrowserReport(page, result, options) {
  if (!options.screenshot) return result;
  const reportDir = await newReportDir(options.reportDir, `mod-manager-${options.mode}`);
  const screenshotPath = path.join(reportDir, 'page.png');
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  if (result?.gameTest?.state) {
    const readOnlySaveState = await page
      .evaluate(() => ({
        readOnlySaveWritesBlocked: globalThis.__mcpBlockedSaveWrites || [],
        readOnlySaveWriteSummary: Object.values(globalThis.__mcpBlockedSaveWriteSummary || {}),
      }))
      .catch(() => ({
        readOnlySaveWritesBlocked: result.gameTest.state.readOnlySaveWritesBlocked || [],
        readOnlySaveWriteSummary: result.gameTest.state.readOnlySaveWriteSummary || [],
      }));
    result = {
      ...result,
      gameTest: {
        ...result.gameTest,
        state: {
          ...result.gameTest.state,
          ...readOnlySaveState,
        },
      },
    };
  }
  const report = {
    ...result,
    browserEvents: options.browserEvents || [],
    reportDir,
    screenshotPath,
    capturedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function captureFailureScreenshot(page, options, error) {
  if (!options.screenshot || !page) return null;
  const reportDir = await newReportDir(options.reportDir, `mod-manager-${options.mode}-error`);
  const screenshotPath = path.join(reportDir, 'page.png');
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  await fs.writeFile(
    path.join(reportDir, 'report.json'),
    `${JSON.stringify({
      ok: false,
      mode: options.mode,
      error: error instanceof Error ? error.message : String(error),
      browserEvents: options.browserEvents || [],
      reportDir,
      screenshotPath,
      capturedAt: new Date().toISOString(),
    }, null, 2)}\n`
  );
  return screenshotPath;
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
  if (manifest.setup && !(typeof manifest.setup === 'string' && (manifest.setup.endsWith('.js') || manifest.setup.endsWith('.mjs')))) {
    throw new Error('manifest.setup must be a .js or .mjs resource.');
  }
  const validLoadResource = (resource) =>
    typeof resource === 'string' &&
    (resource.endsWith('.js') ||
      resource.endsWith('.mjs') ||
      resource.endsWith('.css') ||
      resource.endsWith('.json') ||
      resource.endsWith('.html'));
  if (manifest.load && !(typeof manifest.load === 'string' ? validLoadResource(manifest.load) : Array.isArray(manifest.load) && manifest.load.every(validLoadResource))) {
    throw new Error('manifest.load must be a valid resource path or array of resource paths.');
  }
  if (manifest.icon && !(typeof manifest.icon === 'string' && (manifest.icon.endsWith('.png') || manifest.icon.endsWith('.svg')))) {
    throw new Error('manifest.icon must be a .png or .svg resource.');
  }
}

async function buildLocalModInput(options) {
  if (!options.modPath) throw new Error('Creator Toolkit add requires --mod-path.');
  const stat = await fs.stat(options.modPath).catch(() => null);
  if (!stat) throw new Error(`Local mod path does not exist: ${options.modPath}`);

  const common = {
    directoryPath: options.directoryPath || '',
    disabled: Boolean(options.disabled),
    linkedModId: options.linkedModId,
    localModId: options.localModId,
    replace: Boolean(options.replace),
    requestedName: options.name || '',
    sourcePath: options.modPath,
  };

  if (stat.isDirectory()) {
    const manifestPath = path.join(options.modPath, 'manifest.json');
    if (!fsSync.existsSync(manifestPath)) throw new Error(`Local mod directory has no manifest.json: ${options.modPath}`);
    const manifest = parseManifestText(await fs.readFile(manifestPath, 'utf8'), manifestPath);
    validateLocalManifest(manifest);
    const patterns = await readModIgnore(options.modPath);
    const files = await collectLocalModFiles(options.modPath, options.modPath, patterns);
    if (!files.some((file) => file.path === 'manifest.json')) throw new Error('Local mod package must include manifest.json.');
    return {
      ...common,
      kind: 'directory',
      files,
      manifest,
      packageName: `${slug(options.name || path.basename(options.modPath))}.zip`,
    };
  }

  if (!stat.isFile()) throw new Error(`Local mod path must be a directory or zip file: ${options.modPath}`);
  if (path.extname(options.modPath).toLowerCase() !== '.zip') throw new Error('Creator Toolkit modfile input must be a .zip file.');
  const buffer = await fs.readFile(options.modPath);
  return {
    ...common,
    kind: 'zip',
    packageBase64: buffer.toString('base64'),
    packageName: path.basename(options.modPath),
    size: buffer.length,
  };
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

async function configureProfileMod(page, options) {
  const operationAliases = {
    add: 'enable',
    add_to_profile: 'enable',
    disable: 'disable',
    enable: 'enable',
    prefer_latest: 'prefer_latest',
    prefer_live: 'prefer_live',
    remove: 'disable',
    remove_from_profile: 'disable',
  };
  const operation = operationAliases[options.operation];
  if (!operation) throw new Error(`Unknown profile operation: ${options.operation}`);
  if (!Number.isInteger(options.modId)) throw new Error('Profile operations require --mod-id.');

  return await page.evaluate(
    async ({ apply, modId, operation, persist, profileId }) => {
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
          if (!Number.isInteger(parsed) || seen.has(parsed)) continue;
          seen.add(parsed);
          output.push(parsed);
        }
        return output;
      }

      function isPlayFabLoggedIn() {
        return Boolean(
          (typeof PlayFabClientSDK !== 'undefined' && PlayFabClientSDK.IsClientLoggedIn?.()) ||
            (typeof PlayFab !== 'undefined' && PlayFab.ClientApi?.IsClientLoggedIn?.())
        );
      }

      function getLocalValues(keys) {
        const values = {};
        for (const key of keys) values[key] = localStorage.getItem(key);
        return values;
      }

      function getUserData(keys) {
        if (typeof PlayFab === 'undefined' || !PlayFab.ClientApi?.GetUserData || !isPlayFabLoggedIn()) {
          return Promise.resolve(getLocalValues(keys));
        }
        return new Promise((resolve) => {
          PlayFab.ClientApi.GetUserData({ Keys: keys }, (res, err) => {
            if (err || !res?.data?.Data) {
              resolve(getLocalValues(keys));
              return;
            }
            const values = {};
            for (const key of keys) {
              const value = res.data.Data[key]?.Value ?? null;
              values[key] = value;
              if (value === null) localStorage.removeItem(key);
              else localStorage.setItem(key, value);
            }
            resolve(values);
          });
        });
      }

      function updateUserData(data, warnings) {
        for (const [key, value] of Object.entries(data)) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
        if (!persist) {
          warnings.push('Updated localStorage only because persist=false.');
          return Promise.resolve({ persisted: false });
        }
        if (typeof PlayFab === 'undefined' || !PlayFab.ClientApi?.UpdateUserData || !isPlayFabLoggedIn()) {
          warnings.push('PlayFab account persistence was unavailable; updated localStorage only.');
          return Promise.resolve({ persisted: false });
        }
        return new Promise((resolve, reject) => {
          PlayFab.ClientApi.UpdateUserData({ Data: data }, (_res, err) => {
            if (err) reject(new Error(`PlayFab UpdateUserData failed: ${PlayFab.GenerateErrorReport?.(err) || JSON.stringify(err)}`));
            else resolve({ persisted: true });
          });
        });
      }

      const keys = ['modProfiles', 'modLoadOrder', 'modPreferLatest'];
      const manager = typeof mod !== 'undefined' ? mod.manager : null;
      const activeProfile = manager?.activeProfile ? JSON.parse(JSON.stringify(manager.activeProfile)) : null;
      const userData = await getUserData(keys);
      const storedMods = await getAllFromIndexedDB('melvordb', 'mods');
      const installedMod = storedMods.find((entry) => Number(entry.id) === modId) || null;
      const installedIds = uniqueNumbers(storedMods.map((entry) => entry.id));
      const warnings = [];

      let profiles = parseJsonValue(userData.modProfiles, null);
      if (!Array.isArray(profiles)) profiles = activeProfile ? [activeProfile] : [];
      profiles = profiles.map((profile) => ({
        ...profile,
        mods: uniqueNumbers(profile.mods || []),
        autoEnable: Boolean(profile.autoEnable),
      }));

      let loadOrder = uniqueNumbers(parseJsonValue(userData.modLoadOrder, []));
      let latestPreferred = uniqueNumbers(parseJsonValue(userData.modPreferLatest, []));
      const targetProfile =
        profiles.find((profile) => profileId && String(profile.id) === String(profileId)) ||
        profiles.find((profile) => activeProfile && String(profile.id) === String(activeProfile.id)) ||
        profiles[0] ||
        null;

      const before = {
        activeProfileId: activeProfile?.id ?? null,
        targetProfile: targetProfile
          ? { id: targetProfile.id, name: targetProfile.name, mods: [...targetProfile.mods] }
          : null,
        loadOrder: [...loadOrder],
        latestPreferred: [...latestPreferred],
        installed: Boolean(installedMod),
      };
      const touched = {};
      const changes = [];

      if (operation === 'enable' || operation === 'disable') {
        if (!targetProfile) throw new Error('No Mod Manager profile was found.');
        const knownModId = Boolean(installedMod) || loadOrder.includes(modId) || profiles.some((profile) => profile.mods.includes(modId));
        if (operation === 'enable' && !knownModId) {
          throw new Error(`Mod ${modId} was not found in installed mods, profiles, or load order; refusing to add an unknown id.`);
        }
        if (!installedMod) {
          warnings.push('The mod was not present in the current browser IndexedDB snapshot; profile membership can still be persisted by id.');
        }
        const hadMod = targetProfile.mods.includes(modId);
        if (operation === 'enable' && !hadMod) {
          targetProfile.mods.push(modId);
          touched.modProfiles = JSON.stringify(profiles);
          changes.push(`Enabled mod ${modId} in profile ${targetProfile.name || targetProfile.id}.`);
        }
        if (operation === 'disable' && hadMod) {
          targetProfile.mods = targetProfile.mods.filter((id) => id !== modId);
          touched.modProfiles = JSON.stringify(profiles);
          changes.push(`Disabled mod ${modId} in profile ${targetProfile.name || targetProfile.id}.`);
        }
        if (operation === 'enable' && !loadOrder.includes(modId)) {
          loadOrder = [...loadOrder, modId];
          touched.modLoadOrder = JSON.stringify(loadOrder);
          changes.push(`Added mod ${modId} to the end of load order.`);
        }
      } else if (operation === 'prefer_latest') {
        if (!latestPreferred.includes(modId)) {
          latestPreferred = [...latestPreferred, modId];
          touched.modPreferLatest = JSON.stringify(latestPreferred);
          changes.push(`Set mod ${modId} to prefer latest uploaded modfile.`);
        }
        warnings.push('This persists the version preference; Mod Manager performs any download/update work on its next reconciliation.');
      } else if (operation === 'prefer_live') {
        if (latestPreferred.includes(modId)) {
          latestPreferred = latestPreferred.filter((id) => id !== modId);
          touched.modPreferLatest = JSON.stringify(latestPreferred);
          changes.push(`Set mod ${modId} to prefer live modfile.`);
        }
      }

      let persistResult = { persisted: false };
      if (apply && Object.keys(touched).length > 0) persistResult = await updateUserData(touched, warnings);
      if (!apply && Object.keys(touched).length > 0) warnings.push('Dry run only. Pass apply=true to persist this change.');
      if (Object.keys(touched).length === 0) changes.push('No change was needed.');

      const after = {
        targetProfile: targetProfile
          ? { id: targetProfile.id, name: targetProfile.name, mods: [...targetProfile.mods] }
          : null,
        loadOrder,
        latestPreferred,
      };

      return {
        apply,
        changed: Object.keys(touched).length > 0,
        changes,
        installedMod: installedMod
          ? { id: installedMod.id, name: installedMod.name, namespace: installedMod.namespace || null, version: installedMod.version || null }
          : null,
        installedIds,
        operation,
        persist,
        persisted: persistResult.persisted,
        reloadRequired: Object.keys(touched).length > 0,
        warnings,
        before,
        after,
      };
    },
    {
      apply: Boolean(options.apply),
      modId: options.modId,
      operation,
      persist: options.persist !== false,
      profileId: options.profileId || '',
    }
  );
}

async function manageCreatorToolkitLocalMods(page, options, localInput = null) {
  const operationAliases = {
    add: 'add',
    disable: 'disable',
    enable: 'enable',
    list: 'list',
    remove: 'remove',
    verify_load: 'verify_load',
  };
  const operation = operationAliases[options.operation];
  if (!operation) throw new Error(`Unknown Creator Toolkit local mod operation: ${options.operation}`);
  if (['add', 'verify_load'].includes(operation) && !localInput) throw new Error(`Creator Toolkit ${operation} requires --mod-path.`);
  if (operation === 'verify_load' && !options.apply) throw new Error('Creator Toolkit verify_load requires --apply because it writes a temporary local mod.');
  if (['enable', 'disable', 'remove'].includes(operation) && !Number.isInteger(options.localModId)) {
    throw new Error(`Creator Toolkit ${operation} requires --local-mod-id.`);
  }

  return await page.evaluate(
    async ({ apply, localInput, localModId, operation }) => {
      function getAllFromIndexedDB(dbName, storeName) {
        return new Promise((resolve, reject) => {
          let db;
          let settled = false;
          const timeout = setTimeout(() => finish(reject, new Error(`Timed out reading IndexedDB ${dbName}.${storeName}`)), 10000);
          function finish(callback, value) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try {
              db?.close();
            } catch {}
            callback(value);
          }

          const request = indexedDB.open(dbName);
          request.onerror = () => finish(reject, request.error);
          request.onblocked = () => finish(reject, new Error(`Blocked opening IndexedDB ${dbName}.${storeName}`));
          request.onsuccess = () => {
            db = request.result;
            db.onversionchange = () => db.close();
            let tx;
            try {
              tx = db.transaction(storeName, 'readonly');
            } catch (error) {
              finish(reject, error);
              return;
            }
            const store = tx.objectStore(storeName);
            const getAll = store.getAll();
            getAll.onerror = () => finish(reject, getAll.error);
            getAll.onsuccess = () => {
              finish(resolve, getAll.result || []);
            };
            tx.onabort = () => finish(reject, tx.error || new Error(`Aborted reading IndexedDB ${dbName}.${storeName}`));
            tx.onerror = () => finish(reject, tx.error);
          };
        });
      }

      function putInIndexedDB(dbName, storeName, value) {
        return new Promise((resolve, reject) => {
          let db;
          let result;
          let settled = false;
          const timeout = setTimeout(() => finish(reject, new Error(`Timed out writing IndexedDB ${dbName}.${storeName}`)), 15000);
          function finish(callback, output) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try {
              db?.close();
            } catch {}
            callback(output);
          }

          const request = indexedDB.open(dbName);
          request.onerror = () => finish(reject, request.error);
          request.onblocked = () => finish(reject, new Error(`Blocked opening IndexedDB ${dbName}.${storeName}`));
          request.onsuccess = () => {
            db = request.result;
            db.onversionchange = () => db.close();
            let tx;
            try {
              tx = db.transaction(storeName, 'readwrite');
            } catch (error) {
              finish(reject, error);
              return;
            }
            const store = tx.objectStore(storeName);
            const put = store.put(value);
            put.onerror = () => finish(reject, put.error);
            put.onsuccess = () => {
              result = put.result;
            };
            tx.oncomplete = () => finish(resolve, result);
            tx.onabort = () => finish(reject, tx.error || new Error(`Aborted writing IndexedDB ${dbName}.${storeName}`));
            tx.onerror = () => finish(reject, tx.error);
          };
        });
      }

      function deleteFromIndexedDB(dbName, storeName, key) {
        return new Promise((resolve, reject) => {
          let db;
          let settled = false;
          const timeout = setTimeout(() => finish(reject, new Error(`Timed out deleting from IndexedDB ${dbName}.${storeName}`)), 15000);
          function finish(callback, value) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try {
              db?.close();
            } catch {}
            callback(value);
          }

          const request = indexedDB.open(dbName);
          request.onerror = () => finish(reject, request.error);
          request.onblocked = () => finish(reject, new Error(`Blocked opening IndexedDB ${dbName}.${storeName}`));
          request.onsuccess = () => {
            db = request.result;
            db.onversionchange = () => db.close();
            let tx;
            try {
              tx = db.transaction(storeName, 'readwrite');
            } catch (error) {
              finish(reject, error);
              return;
            }
            const store = tx.objectStore(storeName);
            const deletion = store.delete(key);
            deletion.onerror = () => finish(reject, deletion.error);
            tx.oncomplete = () => finish(resolve, true);
            tx.onabort = () => finish(reject, tx.error || new Error(`Aborted deleting from IndexedDB ${dbName}.${storeName}`));
            tx.onerror = () => finish(reject, tx.error);
          };
        });
      }

      function bytesFromBase64(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
      }

      function textFromBytes(bytes) {
        return new TextDecoder().decode(bytes);
      }

      function resourceType(resourcePath) {
        const lower = resourcePath.toLowerCase();
        if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript';
        if (lower.endsWith('.html')) return 'text/html';
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

      function categorizeModIoTags(modIoData) {
        const platforms = new Set(['Android', 'Browser', 'Desktop', 'iOS']);
        const tags = (modIoData.tags || []).map((tag) => tag.name).filter(Boolean);
        return {
          supportedGameVersion: tags.find((tag) => /^\d+(?:\.\d+){1,2}$/.test(tag)) || '',
          platforms: tags.filter((tag) => platforms.has(tag)),
          types: tags.filter((tag) => !platforms.has(tag) && !/^\d+(?:\.\d+){1,2}$/.test(tag)),
        };
      }

      function localModfile(modId, packageBytes, packageName) {
        return {
          id: -1,
          mod_id: modId,
          date_added: 0,
          date_scanned: 0,
          virus_status: 0,
          virus_positive: 0,
          virustotal_hash: '',
          filesize: packageBytes.length,
          filehash: { md5: '' },
          filename: packageName,
          version: '0.0.0',
          changelog: '',
          metadata_blob: '',
          download: { binary_url: '', date_expires: 0 },
        };
      }

      async function fetchLinkedMod(linkedModId) {
        if (!Number.isInteger(linkedModId) || linkedModId <= 0) return null;
        const url = new URL(`https://g-2869.modapi.io/v1/games/2869/mods/${linkedModId}`);
        url.searchParams.set('api_key', '18d577bc8c3b77469850cf15d56cc97d');
        const response = await fetch(url.href, { headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`Failed to fetch linked mod.io mod ${linkedModId}: ${response.status} ${response.statusText}`);
        const linkedMod = await response.json();
        if (!linkedMod?.id) throw new Error(`mod.io did not return a mod for id ${linkedModId}.`);
        return linkedMod;
      }

      function normalizeUnpacked(entries) {
        let paths = Object.keys(entries).filter((entry) => entries[entry]?.length);
        if (entries['manifest.json']) return { entries, paths };
        const firstSegments = paths.map((entry) => entry.split('/')[0]).filter(Boolean);
        const firstSegment = firstSegments[0];
        if (firstSegment && firstSegments.every((segment) => segment === firstSegment)) {
          const normalized = {};
          for (const entry of paths) normalized[entry.slice(firstSegment.length + 1)] = entries[entry];
          paths = Object.keys(normalized).filter((entry) => normalized[entry]?.length);
          return { entries: normalized, paths };
        }
        return { entries, paths };
      }

      function summarizeLocalMod(record) {
        const resources = Object.keys(record.mod?.resources || {}).sort();
        return {
          id: record.id,
          name: record.name || record.mod?.name || null,
          disabled: Boolean(record.disabled),
          directoryPath: record.dir || null,
          loadPriority: record.loadPriority ?? null,
          released: Boolean(record.released),
          linkedModioUrl: record.mod?.modioUrl || null,
          package: record.package
            ? { name: record.package.name || null, size: record.package.size || 0, type: record.package.type || '' }
            : null,
          mod: {
            id: record.mod?.id ?? null,
            name: record.mod?.name || null,
            namespace: record.mod?.namespace || null,
            version: record.mod?.version || '',
            author: record.mod?.author || '',
            setup: record.mod?.setup || null,
            load: record.mod?.load || null,
            icon: record.mod?.icon || null,
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
          files = input.files.map((file) => ({ path: file.path, type: file.type || resourceType(file.path), bytes: bytesFromBase64(file.base64) }));
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
        const linkedMod = await fetchLinkedMod(input.linkedModId);
        const displayName = input.requestedName || linkedMod?.name || manifest.name || input.packageName.replace(/\.zip$/i, '');
        const nextPriority =
          existingLocalMods.reduce((max, record) => Math.max(max, Number(record.loadPriority) || 0), 0) + 1;
        const linkedModId = linkedMod?.id ?? -1;
        const linkedModfile = linkedMod ? localModfile(linkedMod.id, packageBytes, input.packageName) : null;
        const modRecord = {
          id: linkedModId > 0 ? linkedModId : -1,
          name: linkedMod?.name || displayName,
          namespace: manifest.namespace,
          version: linkedModfile?.version || '',
          tags: linkedMod ? categorizeModIoTags(linkedMod) : {
            supportedGameVersion: typeof gameVersion === 'string' ? gameVersion.substring(1) : '',
            platforms: [],
            types: [],
          },
          author: linkedMod?.submitted_by?.username || '',
          description: linkedMod?.summary || '',
          icon: manifest.icon,
          setup: manifest.setup,
          load: manifest.load,
          resources,
          modioUrl: linkedMod?.profile_url || '',
          homepageUrl: linkedMod?.homepage_url || '',
          dependencies: linkedMod?.dependencies || [],
          installed: Math.floor(Date.now() / 1000),
          updated: linkedModfile?.date_added || 0,
          changelog: linkedModfile?.changelog || '',
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

      if (operation === 'list') {
        return {
          apply,
          changed: false,
          creatorToolkitInstalled,
          creatorToolkitLoaded,
          loadingModGuard,
          localMods: localMods.map(summarizeLocalMod),
          operation,
          warnings,
        };
      }

      if (operation === 'remove') {
        const existing = localMods.find((record) => Number(record.id) === localModId);
        if (!existing) throw new Error(`Creator Toolkit local mod ${localModId} was not found.`);
        if (apply) await deleteFromIndexedDB('melvordb', 'localMods', localModId);
        return {
          apply,
          changed: true,
          creatorToolkitInstalled,
          creatorToolkitLoaded,
          loadingModGuard,
          operation,
          removed: summarizeLocalMod(existing),
          reloadRequired: true,
          warnings: apply ? warnings : [...warnings, 'Dry run only. Pass apply=true to remove this local mod.'],
        };
      }

      if (operation === 'enable' || operation === 'disable') {
        const existing = localMods.find((record) => Number(record.id) === localModId);
        if (!existing) throw new Error(`Creator Toolkit local mod ${localModId} was not found.`);
        const updated = { ...existing, disabled: operation === 'disable' };
        const changed = Boolean(existing.disabled) !== updated.disabled;
        if (apply && changed) await putInIndexedDB('melvordb', 'localMods', updated);
        return {
          apply,
          changed,
          creatorToolkitInstalled,
          creatorToolkitLoaded,
          loadingModGuard,
          localMod: summarizeLocalMod(updated),
          operation,
          reloadRequired: changed,
          warnings: !apply && changed ? [...warnings, 'Dry run only. Pass apply=true to persist this change.'] : warnings,
        };
      }

      const record = await buildLocalModRecord(localInput, localMods);
      const changed = true;
      const key = apply ? await putInIndexedDB('melvordb', 'localMods', record) : record.id ?? null;
      if (key !== null && key !== undefined) record.id = key;
      return {
        apply,
        changed,
        creatorToolkitInstalled,
        creatorToolkitLoaded,
        loadingModGuard,
        localMod: summarizeLocalMod(record),
        operation,
        reloadRequired: true,
        warnings: apply ? warnings : [...warnings, 'Dry run only. Pass apply=true to add/update this local mod.'],
      };
    },
    {
      apply: Boolean(options.apply),
      localInput,
      localModId: options.localModId,
      operation,
    }
  );
}

async function verifyCreatorToolkitLocalModLoad(page, options, localInput) {
  await waitForCreatorToolkitForVerify(page, options, 'Creator Toolkit before adding the local mod');
  const added = await retryAfterNavigation(page, options, () =>
    manageCreatorToolkitLocalMods(page, { ...options, operation: 'verify_load', apply: true }, localInput)
  );
  const localModId = added.localMod?.id;
  const localModName = added.localMod?.name || null;
  const namespace = added.localMod?.mod?.namespace || null;
  let cleanup = null;
  let verification = null;

  try {
    await waitForModManager(page, { ...options, waitMs: Math.max(options.waitMs, 5000) });
    await waitForCreatorToolkitForVerify(page, options, 'Creator Toolkit after reloading with the local mod');
    await waitForLocalModSignal(page, options, { localModName, namespace });
    verification = await retryAfterNavigation(page, options, () =>
      page.evaluate(
        async ({ localModId, localModName, namespace }) => {
          function getAllFromIndexedDB(dbName, storeName) {
            return new Promise((resolve, reject) => {
              let db;
              let settled = false;
              const timeout = setTimeout(() => finish(reject, new Error(`Timed out reading IndexedDB ${dbName}.${storeName}`)), 10000);
              function finish(callback, value) {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                try {
                  db?.close();
                } catch {}
                callback(value);
              }

              const request = indexedDB.open(dbName);
              request.onerror = () => finish(reject, request.error);
              request.onblocked = () => finish(reject, new Error(`Blocked opening IndexedDB ${dbName}.${storeName}`));
              request.onsuccess = () => {
                db = request.result;
                db.onversionchange = () => db.close();
                let tx;
                try {
                  tx = db.transaction(storeName, 'readonly');
                } catch (error) {
                  finish(reject, error);
                  return;
                }
                const store = tx.objectStore(storeName);
                const getAll = store.getAll();
                getAll.onerror = () => finish(reject, getAll.error);
                getAll.onsuccess = () => {
                  finish(resolve, getAll.result || []);
                };
                tx.onabort = () => finish(reject, tx.error || new Error(`Aborted reading IndexedDB ${dbName}.${storeName}`));
                tx.onerror = () => finish(reject, tx.error);
              };
            });
          }

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
          const marker = globalThis.__mcpLocalModSmokeLoaded || null;
          const localMods = await getAllFromIndexedDB('melvordb', 'localMods');
          const localRecord = localMods.find((record) => Number(record.id) === Number(localModId)) || null;
          const loadedByName = localModName ? loadedNames.includes(localModName) : false;
          const loadedByNamespace = contextExists(namespace);
          const loadedByMarker = marker && (!namespace || marker.namespace === namespace);
          return {
            loaded: Boolean(loadedByMarker || loadedByNamespace || loadedByName),
            loadedByMarker: Boolean(loadedByMarker),
            loadedByNamespace,
            loadedByName,
            marker,
            localStorageLoadingGuard: localStorage.getItem('mct_i--loading-mod'),
            loadedNames,
            localRecord: localRecord
              ? {
                  id: localRecord.id,
                  name: localRecord.name,
                  disabled: Boolean(localRecord.disabled),
                  namespace: localRecord.mod?.namespace || null,
                  modId: localRecord.mod?.id ?? null,
                }
              : null,
            title: document.title,
            location: location.href,
          };
        },
        { localModId, localModName, namespace }
      )
    );
  } finally {
    if (options.cleanup !== false && Number.isInteger(localModId)) {
      cleanup = await retryAfterNavigation(page, options, () =>
        manageCreatorToolkitLocalMods(page, { ...options, operation: 'remove', localModId, apply: true }, null)
      ).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      await page.evaluate(() => localStorage.removeItem('mct_i--loading-mod')).catch(() => {});
    }
  }

  const result = {
    apply: true,
    changed: true,
    cleanup,
    cleanupEnabled: options.cleanup !== false,
    creatorToolkitInstalled: added.creatorToolkitInstalled,
    creatorToolkitLoaded: added.creatorToolkitLoaded,
    localMod: added.localMod,
    operation: 'verify_load',
    reloadRequired: false,
    verification,
    verifyLoadRetries: options.verifyLoadRetries || [],
    warnings: [
      ...(added.warnings || []),
      ...(verification?.loaded ? [] : ['Local mod was added and reloaded, but no loaded marker/name/namespace was observed.']),
    ],
  };
  if (!verification?.loaded) {
    throw new Error(
      `Creator Toolkit verify_load failed for ${localModName || 'local mod'}: local mod did not appear in the loaded mod list, namespace context, or test marker after reload. ${result.warnings.join(' ')}`
    );
  }
  return result;
}

async function waitForSaveSelection(page, options) {
  await page.waitForFunction(
    (slot) =>
      Boolean(
        typeof loadCloudSave === 'function' &&
          typeof loadLocalSave === 'function' &&
          typeof cloudManager !== 'undefined' &&
          typeof mod !== 'undefined' &&
          typeof cloudSaveHeaders !== 'undefined' &&
          typeof localSaveHeaders !== 'undefined' &&
          Array.isArray(cloudSaveHeaders) &&
          Array.isArray(localSaveHeaders) &&
          cloudSaveHeaders.length > slot &&
          localSaveHeaders.length > slot
      ),
    options.saveSlot,
    { timeout: options.timeoutMs }
  );
}

async function installReadOnlySaveGuard(page) {
  return await page.evaluate(() => {
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
    const mark = Symbol.for('mcpReadOnlySaveGuardInstalled');
    if (globalThis[mark]) return { installed: false, alreadyInstalled: true };
    globalThis[mark] = true;

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
      const originalNativeSave = nativeManager.saveToNativeCloudBackup.bind(nativeManager);
      globalThis.__mcpOriginalNativeSaveToCloudBackup = originalNativeSave;
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

async function loadGameSave(page, options) {
  if (!Number.isInteger(options.saveSlot)) {
    throw new Error('Game mode requires --save-slot or MELVOR_TEST_CHARACTER_SLOT.');
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

async function runGameAction(page, options) {
  if (options.gameAction === 'snapshot') return { action: 'snapshot', changed: false };
  if (options.gameAction === 'wait') {
    await page.waitForTimeout(options.durationMs);
    return { action: 'wait', durationMs: options.durationMs, changed: false };
  }
  if (options.gameAction === 'click_selector') {
    if (!options.actionSelector) throw new Error('game-action=click_selector requires --action-selector.');
    await page.locator(options.actionSelector).first().click({ timeout: options.timeoutMs });
    await page.waitForTimeout(options.durationMs);
    return { action: 'click_selector', selector: options.actionSelector, durationMs: options.durationMs, changed: true };
  }
  if (options.gameAction === 'open_page') {
    if (!options.actionPage) throw new Error('game-action=open_page requires --action-page.');
    const opened = await page.evaluate((pageId) => {
      if (typeof changePage !== 'function') throw new Error('changePage was not available.');
      const page = typeof game !== 'undefined' ? game.pages?.getObjectByID?.(pageId) : null;
      if (!page) throw new Error(`Game page was not found: ${pageId}`);
      changePage(page);
      return { id: page.id, name: page.name || null };
    }, options.actionPage);
    await page.waitForTimeout(options.durationMs);
    return { action: 'open_page', page: opened, durationMs: options.durationMs, changed: true };
  }
  throw new Error(`Unsupported game action: ${options.gameAction}`);
}

async function collectGameTestState(page) {
  return await page.evaluate(() => {
    const loadedMods = typeof mod !== 'undefined' ? mod.manager?.getLoadedModList?.() || [] : [];
    let optimizerContext = null;
    try {
      optimizerContext = typeof mod !== 'undefined' ? mod.getContext?.('pavr_optimizer') || null : null;
    } catch {}
    const modal = document.querySelector('.swal2-popup');
    const modalStyle = modal ? window.getComputedStyle(modal) : null;
    const modalVisible = Boolean(modal && modalStyle?.display !== 'none' && modalStyle?.visibility !== 'hidden');
    const activePage = typeof game !== 'undefined' ? game.activePage?.id || game.activeActionPage?.id || null : null;
    const activeAction = typeof game !== 'undefined' ? game.activeAction?.id || game.activeAction?.name || null : null;
    return {
      loaded: typeof isLoaded !== 'undefined' ? Boolean(isLoaded) : false,
      inCharacterSelection: typeof inCharacterSelection !== 'undefined' ? Boolean(inCharacterSelection) : null,
      currentCharacter: typeof currentCharacter !== 'undefined' ? currentCharacter : null,
      characterName: typeof game !== 'undefined' ? game.characterName || null : null,
      gamemode: typeof game !== 'undefined' ? { id: game.currentGamemode?.id || null, name: game.currentGamemode?.name || null } : null,
      activePage,
      activeAction,
      gp: typeof game !== 'undefined' ? game.gp?.amount ?? null : null,
      bankItems: typeof game !== 'undefined' ? game.bank?.items?.length ?? null : null,
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
        querySelectorAllPatched: document.querySelectorAll?.name === 'patchedQuerySelectorAll',
      },
      readOnlySaveWritesBlocked: globalThis.__mcpBlockedSaveWrites || [],
      readOnlySaveWriteSummary: Object.values(globalThis.__mcpBlockedSaveWriteSummary || {}),
      modal: modalVisible
        ? {
            title: document.querySelector('.swal2-title')?.textContent?.trim() || '',
            text: document.querySelector('.swal2-html-container')?.textContent?.replace(/\s+/g, ' ').trim() || '',
          }
        : null,
    };
  });
}

async function runGameSaveTest(page, options) {
  const load = await loadGameSave(page, options);
  const action = await runGameAction(page, options);
  if (options.gameAction === 'snapshot') await page.waitForTimeout(options.durationMs);
  const state = await collectGameTestState(page);
  return {
    action,
    load,
    operation: 'load_save',
    readOnly: options.readOnly,
    saveSlot: options.saveSlot,
    saveSource: options.saveSource,
    state,
    warnings: state.modal ? [`A modal is open after loading the save: ${state.modal.title || state.modal.text}`] : [],
  };
}

async function run(options) {
  const localInput = options.mode === 'local' && ['add', 'verify_load'].includes(options.operation) ? await buildLocalModInput(options) : null;
  const browser = await chromium.launch({ headless: !options.headful });
  const contextOptions = {};
  if (options.storageState && fsSync.existsSync(options.storageState)) contextOptions.storageState = options.storageState;
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  options.browserEvents = [];
  const recordBrowserEvent = (event) => {
    const observedAt = new Date().toISOString();
    const dedupeKey = JSON.stringify({
      type: event.type || '',
      level: event.level || '',
      text: event.text || '',
      location: event.location || '',
      url: event.url || '',
      failure: event.failure || '',
    });
    const previous = options.browserEvents.at(-1);
    if (previous?.dedupeKey === dedupeKey) {
      previous.count = (previous.count || 1) + 1;
      previous.lastObservedAt = observedAt;
      return;
    }
    options.browserEvents.push({ ...event, observedAt, count: 1, dedupeKey });
    if (options.browserEvents.length > 200) options.browserEvents.shift();
  };
  page.on('console', (message) => {
    const location = message.location();
    recordBrowserEvent({
      type: 'console',
      level: message.type(),
      text: message.text(),
      location: location.url ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : '',
    });
  });
  page.on('pageerror', (error) => {
    recordBrowserEvent({
      type: 'pageerror',
      message: error.message,
      stack: error.stack || '',
    });
  });
  page.on('requestfailed', (request) => {
    recordBrowserEvent({
      type: 'requestfailed',
      url: request.url(),
      failure: request.failure()?.errorText || '',
    });
  });

  try {
    await gotoAndSettle(page, options.url, options.timeoutMs);
    const login = await loginIfNeeded(page, options);
    await waitForModManager(page, options);
    if (options.storageState) {
      await fs.mkdir(path.dirname(path.resolve(options.storageState)), { recursive: true });
      await context.storageState({ path: options.storageState });
    }

    const state = await retryAfterNavigation(page, options, () => collectModManagerState(page, options.mode === 'fetch'));
    const visibleState = {
      ...state,
      mods: state.mods.map(({ resourceBlobs, ...mod }) => mod),
    };
    const summaryState = {
      location: state.location,
      title: state.title,
      isLoggedIn: state.isLoggedIn,
      isEnabled: state.isEnabled,
      isProcessing: state.isProcessing,
      activeProfile: state.activeProfile,
      loadedNames: state.loadedNames,
      installedCount: state.installedCount,
      modioRecoveryActions: options.modioRecoveryActions || [],
    };

    if (options.mode === 'list') {
      return await attachBrowserReport(page, { ok: true, mode: options.mode, login, ...visibleState, modioRecoveryActions: options.modioRecoveryActions || [] }, options);
    }

    if (options.mode === 'profile') {
      const profile = await retryAfterNavigation(page, options, () => configureProfileMod(page, options));
      return await attachBrowserReport(
        page,
        { ok: true, mode: options.mode, login, ...summaryState, modioRecoveryActions: options.modioRecoveryActions || [], profile },
        options
      );
    }

    if (options.mode === 'local') {
      const creatorToolkit =
        options.operation === 'verify_load'
          ? await verifyCreatorToolkitLocalModLoad(page, options, localInput)
          : await retryAfterNavigation(page, options, () => manageCreatorToolkitLocalMods(page, options, localInput));
      return await attachBrowserReport(
        page,
        { ok: true, mode: options.mode, login, ...summaryState, modioRecoveryActions: options.modioRecoveryActions || [], creatorToolkit },
        options
      );
    }

    if (options.mode === 'game') {
      const gameTest = await runGameSaveTest(page, options);
      return await attachBrowserReport(
        page,
        { ok: true, mode: options.mode, login, ...summaryState, modioRecoveryActions: options.modioRecoveryActions || [], gameTest },
        options
      );
    }

    const exported = await writeFetchedSources(state, options);
    return await attachBrowserReport(
      page,
      { ok: true, mode: options.mode, login, ...visibleState, modioRecoveryActions: options.modioRecoveryActions || [], exported },
      options
    );
  } catch (error) {
    const screenshotPath = await captureFailureScreenshot(page, options, error).catch(() => null);
    if (screenshotPath && error instanceof Error) {
      error.message = `${error.message}\nScreenshot: ${screenshotPath}`;
    }
    throw error;
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
