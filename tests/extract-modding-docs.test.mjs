import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/extract-modding-docs.mjs');
const FIXTURE_SOURCE = path.join(REPO_ROOT, 'tests/fixtures/source-store');

test('extract-modding-docs generates a compact modding source reference', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'melvor-source-docs-'));
  const outPath = path.join(tempDir, 'generated-source-reference.md');

  const result = spawnSync(process.execPath, [
    SCRIPT_PATH,
    '--source',
    FIXTURE_SOURCE,
    '--out',
    outPath,
    '--json',
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.scannedFiles, 2);
  assert.ok(summary.selectedClasses >= 3);
  assert.equal(summary.customElements, 2);
  assert.ok(summary.concepts['mod-loader-context-api'] > 0);
  assert.ok(summary.concepts.patching > 0);
  assert.ok(summary.concepts['offline-processing'] > 0);

  const markdown = await fs.readFile(outPath, 'utf8');
  assert.match(markdown, /# Generated Melvor Modding Source Reference/);
  assert.match(markdown, /Source root: `tests\/fixtures\/source-store`/);
  assert.match(markdown, /## Mod Loader And Context API/);
  assert.match(markdown, /`ModContext`/);
  assert.match(markdown, /`offline-progress -> OfflineProgressElement`/);
  assert.match(markdown, /offlineLoopEntered/);
  assert.match(markdown, /## Patching/);
});

test('extract-modding-docs defaults to the docs source store instead of external source repo env', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'melvor-source-docs-default-'));
  const outPath = path.join(tempDir, 'generated-source-reference.md');

  const result = spawnSync(process.execPath, [
    SCRIPT_PATH,
    '--out',
    outPath,
    '--json',
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      GAME_SOURCE_DOC_SOURCE: FIXTURE_SOURCE,
      GAME_SOURCE_REPO: path.join(tempDir, 'missing-external-source'),
      MELVOR_GAME_SOURCE_REPO: path.join(tempDir, 'missing-external-source-alias'),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.scannedFiles, 2);

  const markdown = await fs.readFile(outPath, 'utf8');
  assert.match(markdown, /Source root: `tests\/fixtures\/source-store`/);
  assert.doesNotMatch(markdown, /missing-external-source/);
});
