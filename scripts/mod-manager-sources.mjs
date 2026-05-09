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
    apply: false,
    directoryPath: '',
    disabled: false,
    headful: false,
    includeDisabled: false,
    linkedModId: null,
    localModId: null,
    modId: null,
    modPath: '',
    mode: 'list',
    name: '',
    operation: 'list',
    outDir: process.env.MELVOR_MOD_SOURCES_DIR || path.join(REPO_ROOT, DEFAULT_OUT_DIR),
    password: process.env.MELVOR_CLOUD_PASSWORD || '',
    persist: true,
    profileId: '',
    replace: false,
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
    else if (arg === '--enabled') options.disabled = false;
    else if (arg === '--linked-mod-id') options.linkedModId = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--linked-mod-id=')) options.linkedModId = Number.parseInt(arg.slice('--linked-mod-id='.length), 10);
    else if (arg === '--local-mod-id') options.localModId = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--local-mod-id=')) options.localModId = Number.parseInt(arg.slice('--local-mod-id='.length), 10);
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
    else if (arg === '--replace') options.replace = true;
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

  if (!['list', 'fetch', 'profile', 'local'].includes(options.mode)) throw new Error(`Unknown mode: ${options.mode}`);
  for (const key of ['timeoutMs', 'waitMs']) {
    if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error(`${key} must be zero or greater`);
  }
  for (const key of ['linkedModId', 'localModId', 'modId']) {
    if (options[key] !== null && (!Number.isInteger(options[key]) || options[key] <= 0)) {
      throw new Error(`${key} must be a positive integer`);
    }
  }

  options.outDir = path.resolve(options.outDir);
  if (options.modPath) options.modPath = path.resolve(options.modPath);
  if (options.directoryPath) options.directoryPath = path.resolve(options.directoryPath);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/mod-manager-sources.mjs --mode <list|fetch|profile|local> [options]

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
  --apply                  Persist the requested mutation. Without this, mutations are dry-run.
  --no-persist             Update browser localStorage only instead of PlayFab account data.
  --replace                Replace matching local mod when adding.
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

function isNavigationContextError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Cannot find context with specified id|navigation/i.test(message);
}

async function retryAfterNavigation(page, options, callback) {
  try {
    return await callback();
  } catch (error) {
    if (!isNavigationContextError(error)) throw error;
    await waitForModManager(page, options);
    return await callback();
  }
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
  };
  const operation = operationAliases[options.operation];
  if (!operation) throw new Error(`Unknown Creator Toolkit local mod operation: ${options.operation}`);
  if (operation === 'add' && !localInput) throw new Error('Creator Toolkit add requires --mod-path.');
  if (['enable', 'disable', 'remove'].includes(operation) && !Number.isInteger(options.localModId)) {
    throw new Error(`Creator Toolkit ${operation} requires --local-mod-id.`);
  }

  return await page.evaluate(
    async ({ apply, localInput, localModId, operation }) => {
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
            put.onsuccess = () => resolve(put.result);
            tx.oncomplete = () => db.close();
            tx.onerror = () => reject(tx.error);
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
            const deletion = store.delete(key);
            deletion.onerror = () => reject(deletion.error);
            deletion.onsuccess = () => resolve(true);
            tx.oncomplete = () => db.close();
            tx.onerror = () => reject(tx.error);
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
          package: record.package
            ? { name: record.package.name || null, size: record.package.size || 0, type: record.package.type || '' }
            : null,
          mod: {
            id: record.mod?.id ?? null,
            name: record.mod?.name || null,
            namespace: record.mod?.namespace || null,
            version: record.mod?.version || '',
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
        const displayName = input.requestedName || manifest.name || input.packageName.replace(/\.zip$/i, '');
        const nextPriority =
          existingLocalMods.reduce((max, record) => Math.max(max, Number(record.loadPriority) || 0), 0) + 1;
        const linkedModId = Number.isInteger(input.linkedModId) ? input.linkedModId : -1;
        const modRecord = {
          id: linkedModId > 0 ? linkedModId : -1,
          name: displayName,
          namespace: manifest.namespace,
          version: '',
          tags: {
            supportedGameVersion: typeof gameVersion === 'string' ? gameVersion.substring(1) : '',
            platforms: [],
            types: [],
          },
          author: '',
          description: '',
          icon: manifest.icon,
          setup: manifest.setup,
          load: manifest.load,
          resources,
          modioUrl: '',
          homepageUrl: '',
          dependencies: [],
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

        return {
          id: existing ? existing.id : undefined,
          name: displayName,
          mod: modRecord,
          dir: input.directoryPath || '',
          package: new File([packageBytes], input.packageName, { type: 'application/zip' }),
          released: existing ? Boolean(existing.released) : false,
          loadPriority: existing?.loadPriority ?? nextPriority,
          disabled: Boolean(input.disabled),
        };
      }

      const localMods = await getAllFromIndexedDB('melvordb', 'localMods');
      const installedMods = await getAllFromIndexedDB('melvordb', 'mods');
      const loadedNames = typeof mod !== 'undefined' ? mod.manager?.getLoadedModList?.() || [] : [];
      const creatorToolkitInstalled = installedMods.some(
        (entry) => Number(entry.id) === 2419237 || entry.namespace === 'creatorToolkit' || entry.name === 'Creator Toolkit'
      );
      const creatorToolkitLoaded = loadedNames.includes('Creator Toolkit');
      const warnings = [];
      if (!creatorToolkitInstalled) warnings.push('Creator Toolkit is not installed in Mod Manager.');
      if (!creatorToolkitLoaded) warnings.push('Creator Toolkit is not loaded in the active profile; local mods will not load until it is enabled and the game reloads.');

      if (operation === 'list') {
        return {
          apply,
          changed: false,
          creatorToolkitInstalled,
          creatorToolkitLoaded,
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

async function run(options) {
  const localInput = options.mode === 'local' && options.operation === 'add' ? await buildLocalModInput(options) : null;
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
    };

    if (options.mode === 'list') {
      return { ok: true, mode: options.mode, login, ...visibleState };
    }

    if (options.mode === 'profile') {
      const profile = await retryAfterNavigation(page, options, () => configureProfileMod(page, options));
      return { ok: true, mode: options.mode, login, ...summaryState, profile };
    }

    if (options.mode === 'local') {
      const creatorToolkit = await retryAfterNavigation(page, options, () => manageCreatorToolkitLocalMods(page, options, localInput));
      return { ok: true, mode: options.mode, login, ...summaryState, creatorToolkit };
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
