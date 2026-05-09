#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const DEFAULT_URL = 'https://melvoridle.com/index_game.php';
const DEFAULT_REPORTS_DIR = 'reports';

function parseArgs(argv) {
  const options = {
    durationMs: 15000,
    mode: 'smoke',
    modPath: '',
    reportDir: DEFAULT_REPORTS_DIR,
    timeoutMs: 45000,
    url: DEFAULT_URL,
    waitMs: 5000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };

    if (arg === '--duration-ms') options.durationMs = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--duration-ms=')) options.durationMs = Number.parseInt(arg.slice('--duration-ms='.length), 10);
    else if (arg === '--mode') options.mode = nextValue();
    else if (arg.startsWith('--mode=')) options.mode = arg.slice('--mode='.length);
    else if (arg === '--mod-path') options.modPath = nextValue();
    else if (arg.startsWith('--mod-path=')) options.modPath = arg.slice('--mod-path='.length);
    else if (arg === '--report-dir') options.reportDir = nextValue();
    else if (arg.startsWith('--report-dir=')) options.reportDir = arg.slice('--report-dir='.length);
    else if (arg === '--timeout-ms') options.timeoutMs = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = Number.parseInt(arg.slice('--timeout-ms='.length), 10);
    else if (arg === '--url') options.url = nextValue();
    else if (arg.startsWith('--url=')) options.url = arg.slice('--url='.length);
    else if (arg === '--wait-ms') options.waitMs = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--wait-ms=')) options.waitMs = Number.parseInt(arg.slice('--wait-ms='.length), 10);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!['check', 'smoke', 'profile'].includes(options.mode)) throw new Error(`Unknown mode: ${options.mode}`);
  for (const key of ['durationMs', 'timeoutMs', 'waitMs']) {
    if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error(`${key} must be zero or greater`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/mod-test.mjs --mode <check|smoke|profile> [options]

Options:
  --url <url>          Melvor URL to open. Defaults to ${DEFAULT_URL}
  --mod-path <path>    Mod directory or JS/MJS file to inject.
  --report-dir <dir>   Output directory for ignored reports. Defaults to ${DEFAULT_REPORTS_DIR}
  --timeout-ms <n>     Navigation timeout. Defaults to 45000.
  --wait-ms <n>        Smoke-test settle wait. Defaults to 5000.
  --duration-ms <n>    Profile duration. Defaults to 15000.
`);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function collectModScripts(modPath) {
  if (!modPath) return [];
  const absolute = path.resolve(modPath);
  const stat = await fs.stat(absolute);
  if (stat.isFile()) return [absolute];

  const manifestPath = path.join(absolute, 'manifest.json');
  if (await exists(manifestPath)) {
    const manifest = await readJson(manifestPath);
    const candidates = [
      ...asArray(manifest.setup),
      ...asArray(manifest.load),
      ...asArray(manifest.main),
      ...asArray(manifest.script),
      ...asArray(manifest.scripts),
      ...asArray(manifest.js),
      ...asArray(manifest.files),
    ].filter((file) => typeof file === 'string' && /\.(?:m?js|cjs)$/i.test(file));
    if (candidates.length > 0) return candidates.map((file) => path.resolve(absolute, file));
  }

  const entries = await fs.readdir(absolute);
  return entries
    .filter((file) => /\.(?:m?js|cjs)$/i.test(file))
    .sort()
    .map((file) => path.join(absolute, file));
}

async function newReportDir(root, mode) {
  const dir = path.resolve(root, `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function checkBrowser() {
  const browser = await chromium.launch();
  await browser.close();
  return { ok: true, browser: 'chromium' };
}

async function runPage(options, profile = false) {
  const reportDir = await newReportDir(options.reportDir, profile ? 'profile' : 'smoke');
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
        location: message.location(),
      });
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      failure: request.failure()?.errorText ?? null,
      resourceType: request.resourceType(),
    });
  });

  const tracePath = path.join(reportDir, 'trace.zip');
  if (profile) {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  }

  const startedAt = Date.now();
  try {
    await page.goto(options.url, {
      timeout: options.timeoutMs,
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle', { timeout: options.timeoutMs }).catch(() => {});

    const scripts = await collectModScripts(options.modPath);
    for (const scriptPath of scripts) {
      await page.addScriptTag({ path: scriptPath });
    }

    await page.waitForTimeout(profile ? options.durationMs : options.waitMs);
    await page.screenshot({ path: path.join(reportDir, 'page.png'), fullPage: true }).catch(() => {});

    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        title: document.title,
        location: location.href,
        navigation: nav ? nav.toJSON() : null,
        resourceCount: performance.getEntriesByType('resource').length,
      };
    });

    if (profile) await context.tracing.stop({ path: tracePath });

    const report = {
      ok: pageErrors.length === 0,
      mode: profile ? 'profile' : 'smoke',
      url: options.url,
      modPath: options.modPath || null,
      durationMs: Date.now() - startedAt,
      reportDir,
      tracePath: profile ? tracePath : null,
      metrics,
      consoleMessages,
      pageErrors,
      failedRequests,
    };
    await fs.writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    if (profile) {
      await context.tracing.stop({ path: tracePath }).catch(() => {});
    }
    await browser.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let result;
  if (options.mode === 'check') result = await checkBrowser();
  else if (options.mode === 'profile') result = await runPage(options, true);
  else result = await runPage(options, false);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
