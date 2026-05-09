import { chromium, devices } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_URL = 'https://melvoridle.com/index_game.php';
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_SETTLE_MS = 3000;
const DEFAULT_MAX_ASSETS = 500;

const CODE_RESOURCE_TYPES = new Set(['document', 'script', 'stylesheet', 'xhr', 'fetch']);
const CODE_EXTENSIONS = /\.(?:html?|php|js|mjs|cjs|css|json|map|wasm|txt|xml)(?:[?#]|$)/i;
const SKIP_EXTENSIONS = /\.(?:png|jpe?g|webp|gif|ico|avif|mp3|ogg|wav|m4a|mp4|webm|woff2?|ttf|otf)(?:[?#]|$)/i;
const CODE_CONTENT_TYPES = /(?:javascript|ecmascript|css|json|html|xml|wasm|text\/plain)/i;

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    outDir: '',
    device: '',
    sourceName: '',
    tagQualifier: '',
    includeAll: false,
    hashQueryFilenames: false,
    manifestOnly: false,
    maxAssets: DEFAULT_MAX_ASSETS,
    settleMs: DEFAULT_SETTLE_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const nextValue = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    if (arg === '--all') options.includeAll = true;
    else if (arg === '--hash-query-filenames') options.hashQueryFilenames = true;
    else if (arg === '--manifest-only') options.manifestOnly = true;
    else if (arg === '--device') options.device = nextValue();
    else if (arg.startsWith('--device=')) options.device = arg.slice('--device='.length);
    else if (arg === '--source-name') options.sourceName = nextValue();
    else if (arg.startsWith('--source-name=')) options.sourceName = arg.slice('--source-name='.length);
    else if (arg === '--tag-qualifier') options.tagQualifier = nextValue();
    else if (arg.startsWith('--tag-qualifier=')) options.tagQualifier = arg.slice('--tag-qualifier='.length);
    else if (arg === '--url') options.url = nextValue();
    else if (arg.startsWith('--url=')) options.url = arg.slice('--url='.length);
    else if (arg === '--out') options.outDir = nextValue();
    else if (arg.startsWith('--out=')) options.outDir = arg.slice('--out='.length);
    else if (arg === '--max-assets') options.maxAssets = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--max-assets=')) options.maxAssets = Number.parseInt(arg.slice('--max-assets='.length), 10);
    else if (arg === '--settle-ms') options.settleMs = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--settle-ms=')) options.settleMs = Number.parseInt(arg.slice('--settle-ms='.length), 10);
    else if (arg === '--timeout-ms') options.timeoutMs = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = Number.parseInt(arg.slice('--timeout-ms='.length), 10);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.maxAssets) || options.maxAssets < 1) {
    throw new Error('--max-assets must be a positive integer');
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error('--timeout-ms must be at least 1000');
  }
  if (!Number.isFinite(options.settleMs) || options.settleMs < 0) {
    throw new Error('--settle-ms must be zero or greater');
  }
  if (options.device && !devices[options.device]) {
    throw new Error(`Unknown Playwright device: ${options.device}`);
  }

  if (!options.outDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    options.outDir = path.join('snapshots', stamp);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/refresh-game-source.mjs [options]

Options:
  --url <url>          Page to inspect. Defaults to ${DEFAULT_URL}
  --out <dir>          Output directory. Defaults to snapshots/<timestamp>
  --manifest-only      Record metadata and asset URLs without saving asset bodies.
  --device <name>      Emulate a Playwright device, such as "Pixel 5".
  --source-name <name> Label the source in the manifest, such as "web" or "android-loaded".
  --tag-qualifier <q>  Tag qualifier between file version and date. Defaults to "observed".
  --all                Save all HTTP responses instead of likely source assets only.
  --hash-query-filenames
                       Include a short query-string hash in downloaded filenames.
  --max-assets <n>     Maximum assets to save. Defaults to ${DEFAULT_MAX_ASSETS}
  --timeout-ms <n>     Navigation timeout. Defaults to ${DEFAULT_TIMEOUT_MS}
  --settle-ms <n>      Extra wait after network idle attempt. Defaults to ${DEFAULT_SETTLE_MS}
`);
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function shouldCaptureAsset({ url, resourceType, contentType }, includeAll) {
  if (!isHttpUrl(url)) return false;
  if (includeAll) return true;
  if (SKIP_EXTENSIONS.test(url)) return false;
  return CODE_EXTENSIONS.test(url)
    || CODE_CONTENT_TYPES.test(contentType ?? '')
    || CODE_RESOURCE_TYPES.has(resourceType);
}

function safeSegment(value) {
  return decodeURIComponent(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'index';
}

function shortHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function normalizeGameVersion(value) {
  if (!value) return null;
  const match = String(value).match(/v?(\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?)/i);
  return match?.[1] ?? null;
}

function normalizeFileVersion(value) {
  if (!value) return null;
  const cleaned = String(value).trim().replace(/^[?&]+/, '');
  if (!cleaned || !/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(cleaned)) return null;
  return cleaned;
}

function mostCommon(values) {
  if (values.length === 0) return null;
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function extractAssetQueryVersion(assetUrls) {
  const versions = [];
  for (const assetUrl of assetUrls) {
    try {
      const version = normalizeFileVersion(new URL(assetUrl).search);
      if (version) versions.push(version);
    } catch {
      // Ignore malformed URLs from synthetic requests or browser noise.
    }
  }
  return mostCommon(versions);
}

function extractAssetPathVersion(assetUrls) {
  const versions = [];
  for (const assetUrl of assetUrls) {
    try {
      const pathname = new URL(assetUrl).pathname;
      for (const match of pathname.matchAll(/\.v([0-9A-Za-z][0-9A-Za-z._-]*)\.[^/.?#]+/g)) {
        const version = normalizeFileVersion(match[1]);
        if (version) versions.push(version);
      }
    } catch {
      // Ignore malformed URLs from synthetic requests or browser noise.
    }
  }
  return mostCommon(versions);
}

function extractFileVersionFromText(text) {
  if (!text) return null;
  const patterns = [
    /const\s+gameFileVersion\s*=\s*['"]\?([^'"]+)['"]/i,
    /\bSCRIPT_VERSION\s*=\s*['"]?([0-9A-Za-z._-]+)['"]?\s*;/i,
    /checkFileVersion\(\s*['"]\?([^'"]+)['"]\s*\)/i,
    /v\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?\s+\?([0-9A-Za-z._-]+)/i,
    /gameFileVersion[^?]{0,80}\?([0-9A-Za-z._-]+)/i,
    /\.v([0-9A-Za-z][0-9A-Za-z._-]*)\.(?:js|mjs|cjs|css)\b/i,
  ];

  for (const pattern of patterns) {
    const version = normalizeFileVersion(text.match(pattern)?.[1]);
    if (version) return version;
  }
  return null;
}

function normalizeTagPart(value) {
  return String(value)
    .trim()
    .replace(/^[?&]+/, '')
    .toLowerCase()
    .replace(/[^0-9a-z._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildSourceVersion({ pageInfo, renderedHtml, assetUrls, generatedAt, sourceName, tagQualifier }) {
  const titleVersion = normalizeGameVersion(pageInfo.title);
  const htmlVersion = normalizeGameVersion(
    renderedHtml.match(/Melvor Idle ::\s*v?([^<"']+)/i)?.[1]
  );
  const globalFileVersion = normalizeFileVersion(pageInfo.globals?.gameFileVersion);
  const htmlFileVersion = extractFileVersionFromText(renderedHtml);
  const assetPathVersion = extractAssetPathVersion(assetUrls);
  const assetQueryVersion = extractAssetQueryVersion(assetUrls);
  const gameVersion = normalizeGameVersion(pageInfo.globals?.gameVersion) ?? titleVersion ?? htmlVersion;
  const fileVersion = globalFileVersion ?? htmlFileVersion ?? assetPathVersion ?? assetQueryVersion;
  const observedDate = generatedAt.slice(0, 10);
  const qualifier = normalizeTagPart(tagQualifier || 'observed');
  const tag = [
    'melvor',
    gameVersion ? `v${normalizeTagPart(gameVersion)}` : 'unknown-version',
    fileVersion ? `file-${normalizeTagPart(fileVersion)}` : null,
    qualifier,
    observedDate,
  ].filter(Boolean).join('-');

  return {
    gameVersion,
    gameFileVersion: fileVersion ? `?${fileVersion}` : null,
    cacheVersion: fileVersion,
    observedDate,
    tag,
    source: {
      name: sourceName || null,
      url: pageInfo.location,
      tagQualifier: qualifier,
    },
    sources: {
      title: pageInfo.title,
      titleVersion,
      htmlVersion,
      globalFileVersion,
      htmlFileVersion,
      assetPathVersion,
      assetQueryVersion,
    },
  };
}

function getDeviceContextOptions(deviceName) {
  if (!deviceName) return {};
  const { defaultBrowserType, ...contextOptions } = devices[deviceName];
  return contextOptions;
}

function outputPathForUrl(assetUrl, outDir, hashQueryFilenames) {
  const parsed = new URL(assetUrl);
  const segments = parsed.pathname.split('/').filter(Boolean).map(safeSegment);
  const originalFile = segments.pop() ?? 'index.html';
  const ext = path.extname(originalFile);
  const stem = ext ? originalFile.slice(0, -ext.length) : originalFile;
  const fileName = parsed.search && hashQueryFilenames
    ? `${stem}.${shortHash(parsed.search)}${ext || '.txt'}`
    : originalFile;

  return path.join(outDir, 'assets', safeSegment(parsed.hostname), ...segments, fileName);
}

function mergeAsset(assets, url, details) {
  const previous = assets.get(url) ?? {};
  assets.set(url, { ...previous, ...details, url });
}

async function prepareOutDir(outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const entries = await fs.readdir(outDir);
  if (entries.length > 0) {
    throw new Error(`Output directory is not empty: ${outDir}`);
  }
}

async function saveResponseBody(response, outDir, hashQueryFilenames) {
  const body = await response.body();
  const targetPath = outputPathForUrl(response.url(), outDir, hashQueryFilenames);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, body);
  return {
    bytes: body.length,
    path: path.relative(outDir, targetPath),
  };
}

async function saveRequestBody(requestContext, assetUrl, outDir, hashQueryFilenames) {
  const response = await requestContext.get(assetUrl, {
    headers: { 'cache-control': 'no-cache' },
    timeout: DEFAULT_TIMEOUT_MS,
  });

  if (!response.ok()) {
    return {
      downloadError: `HTTP ${response.status()}`,
      status: response.status(),
    };
  }

  const body = await response.body();
  const targetPath = outputPathForUrl(assetUrl, outDir, hashQueryFilenames);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, body);
  return {
    bytes: body.length,
    contentType: response.headers()['content-type'] ?? '',
    path: path.relative(outDir, targetPath),
    status: response.status(),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(options.outDir);
  await prepareOutDir(outDir);

  const assets = new Map();
  const responseTasks = [];
  let savedAssetCount = 0;

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      ...getDeviceContextOptions(options.device),
      extraHTTPHeaders: { 'cache-control': 'no-cache' },
      serviceWorkers: 'block',
    });
    const page = await context.newPage();

    page.on('response', (response) => {
      const task = (async () => {
        const request = response.request();
        const url = response.url();
        const headers = response.headers();
        const resourceType = request.resourceType();
        const contentType = headers['content-type'] ?? '';
        const status = response.status();
        const capture = shouldCaptureAsset({ url, resourceType, contentType }, options.includeAll);

        mergeAsset(assets, url, {
          capture,
          contentType,
          resourceType,
          source: 'network',
          status,
        });

        if (!capture || options.manifestOnly || status < 200 || status >= 300) return;
        if (savedAssetCount >= options.maxAssets) return;

        savedAssetCount += 1;
        try {
          const saved = await saveResponseBody(response, outDir, options.hashQueryFilenames);
          mergeAsset(assets, url, saved);
        } catch (error) {
          mergeAsset(assets, url, { downloadError: error.message });
        }
      })();

      responseTasks.push(task);
    });

    await page.goto(options.url, {
      timeout: options.timeoutMs,
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle', { timeout: options.timeoutMs }).catch(() => {});
    if (options.settleMs > 0) await page.waitForTimeout(options.settleMs);
    await Promise.allSettled(responseTasks);
    const renderedHtml = await page.content();

    const pageInfo = await page.evaluate(() => {
      const readGlobal = (key) => {
        const value = globalThis[key];
        if (value === undefined || value === null) return null;
        if (typeof value === 'object') return '[object]';
        return String(value);
      };

      return {
        location: globalThis.location.href,
        title: document.title,
        globals: {
          gameVersion: readGlobal('gameVersion'),
          gameFileVersion: readGlobal('gameFileVersion'),
          nativeAppVersion: readGlobal('nativeAppVersion'),
        },
        links: Array.from(document.querySelectorAll('link[href]'), (node) => node.href).filter(Boolean),
        scripts: Array.from(document.querySelectorAll('script[src]'), (node) => node.src).filter(Boolean),
      };
    });

    for (const assetUrl of [...pageInfo.scripts, ...pageInfo.links]) {
      if (!assets.has(assetUrl)) {
        mergeAsset(assets, assetUrl, {
          capture: shouldCaptureAsset({ url: assetUrl, resourceType: 'dom', contentType: '' }, options.includeAll),
          contentType: '',
          resourceType: 'dom',
          source: 'dom',
          status: null,
        });
      }
    }

    if (!options.manifestOnly) {
      for (const [assetUrl, asset] of assets.entries()) {
        if (!asset.capture || asset.path || asset.downloadError) continue;
        if (savedAssetCount >= options.maxAssets) break;
        savedAssetCount += 1;
        try {
          const saved = await saveRequestBody(context.request, assetUrl, outDir, options.hashQueryFilenames);
          mergeAsset(assets, assetUrl, saved);
        } catch (error) {
          mergeAsset(assets, assetUrl, { downloadError: error.message });
        }
      }

      await fs.writeFile(path.join(outDir, 'page-dom.html'), renderedHtml);
    }

    const generatedAt = new Date().toISOString();
    const sourceVersion = buildSourceVersion({
      pageInfo,
      renderedHtml,
      assetUrls: Array.from(assets.keys()),
      generatedAt,
      sourceName: options.sourceName,
      tagQualifier: options.tagQualifier,
    });

    const manifest = {
      generatedAt,
      options: {
        hashQueryFilenames: options.hashQueryFilenames,
        device: options.device || null,
        includeAll: options.includeAll,
        manifestOnly: options.manifestOnly,
        maxAssets: options.maxAssets,
        sourceName: options.sourceName || null,
        tagQualifier: options.tagQualifier || null,
        settleMs: options.settleMs,
        timeoutMs: options.timeoutMs,
        url: options.url,
      },
      outDir,
      page: pageInfo,
      sourceVersion,
      summary: {
        capturedAssetCount: Array.from(assets.values()).filter((asset) => asset.capture).length,
        downloadedAssetCount: Array.from(assets.values()).filter((asset) => asset.path).length,
        observedAssetCount: assets.size,
      },
      userAgent: await page.evaluate(() => navigator.userAgent),
      assets: Array.from(assets.values()).sort((a, b) => a.url.localeCompare(b.url)),
    };

    await fs.writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    console.log(`Wrote source snapshot manifest: ${path.relative(process.cwd(), path.join(outDir, 'manifest.json'))}`);
    console.log(`Observed ${manifest.summary.observedAssetCount} assets; captured ${manifest.summary.capturedAssetCount}; downloaded ${manifest.summary.downloadedAssetCount}.`);
    console.log(`Detected source tag: ${sourceVersion.tag}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
