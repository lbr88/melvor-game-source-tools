#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

loadDotEnv(path.resolve('.env'));

const DEFAULT_REPO = process.env.GAME_SOURCE_REPO || process.env.MELVOR_GAME_SOURCE_REPO || 'game-source';
const DEFAULT_MAX_LINES = 120;
const LOCAL_SOURCES = ['web', 'android-loaded'];

const PRESETS = {
  classes: String.raw`\bclass\s+[A-Za-z_$][\w$]*`,
  cloud: String.raw`\b(?:cloudManager|CloudManager|PlayFab|saveCloud|login)\b`,
  elements: String.raw`\b(?:customElements\.define|HTMLElement|connectedCallback|disconnectedCallback)\b`,
  functions: String.raw`\b(?:function\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)`,
  items: String.raw`\b(?:Item|EquipmentItem|FoodItem|DropTable|itemRegistry|items)\b`,
  'mod-loader': String.raw`\b(?:modManager|ModManager|modContext|mod\.io|modio|modApi|Modding|modsLoaded)\b`,
  native: String.raw`\b(?:nativeManager|nativeApp|NativeManager|Android|ios|mobile|isAndroid)\b`,
  offline: String.raw`\b(?:OfflineProgress|offlineMode|offline|Offline|processOffline)\b`,
  rendering: String.raw`\b(?:renderQueue|render|requiredRender|renderProgress|template|updateForRender)\b`,
};

function parseInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be zero or greater`);
  return parsed;
}

function parseArgs(argv) {
  const options = {
    branch: 'working',
    context: 2,
    filesOnly: false,
    ignoreCase: false,
    json: false,
    listPresets: false,
    maxLines: DEFAULT_MAX_LINES,
    pathspec: '.',
    preset: '',
    repo: DEFAULT_REPO,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };

    if (arg === '--branch') options.branch = nextValue();
    else if (arg.startsWith('--branch=')) options.branch = arg.slice('--branch='.length);
    else if (arg === '--context') options.context = parseInteger(nextValue(), '--context');
    else if (arg.startsWith('--context=')) options.context = parseInteger(arg.slice('--context='.length), '--context');
    else if (arg === '--files') options.filesOnly = true;
    else if (arg === '--ignore-case' || arg === '-i') options.ignoreCase = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--list-presets') options.listPresets = true;
    else if (arg === '--max') options.maxLines = parseInteger(nextValue(), '--max');
    else if (arg.startsWith('--max=')) options.maxLines = parseInteger(arg.slice('--max='.length), '--max');
    else if (arg === '--path') options.pathspec = nextValue();
    else if (arg.startsWith('--path=')) options.pathspec = arg.slice('--path='.length);
    else if (arg === '--preset') options.preset = nextValue();
    else if (arg.startsWith('--preset=')) options.preset = arg.slice('--preset='.length);
    else if (arg === '--repo') options.repo = nextValue();
    else if (arg.startsWith('--repo=')) options.repo = arg.slice('--repo='.length);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else positional.push(arg);
  }

  return { ...options, pattern: positional.join(' ') };
}

function printHelp() {
  console.log(`Usage: npm run source:search -- [options] [pattern]

Search a local game-source store with rg, or a git-backed source repo with git grep.

Options:
  --branch <name>    Search working, web, android-loaded, master, or all. Defaults to working.
  --context <n>      Context lines around each match. Defaults to 2.
  --files            Print only matching file names.
  --ignore-case, -i  Case-insensitive search.
  --json             Print machine-readable JSON.
  --list-presets     Show built-in search presets.
  --max <n>          Maximum output lines per searched branch. 0 means unlimited.
  --path <path>      Limit search to a file or directory inside game-source.
  --preset <name>    Use a built-in regex preset instead of writing one.
  --repo <dir>       Source root/repo path. Defaults to ${DEFAULT_REPO}.

Presets:
  ${Object.keys(PRESETS).join(', ')}

Examples:
  npm run source:search -- "OfflineProgressElement"
  npm run source:search -- --preset mod-loader --branch all
  npm run source:search -- --branch android-loaded --path android.melvoridle.com/offlineClientStage3/assets/js/built nativeManager
`);
}

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr || `${command} exited with status ${result.status}`);
  }

  const stdout = result.stdout?.replace(/\n$/, '') ?? '';
  return stdout ? stdout.split('\n') : [];
}

function truncate(lines, maxLines) {
  if (maxLines === 0 || lines.length <= maxLines) {
    return { lines, truncated: false, totalLines: lines.length };
  }
  return { lines: lines.slice(0, maxLines), truncated: true, totalLines: lines.length };
}

function resolvePattern(options) {
  if (options.listPresets) return '';
  if (options.preset) {
    const preset = PRESETS[options.preset];
    if (!preset) {
      throw new Error(`Unknown preset "${options.preset}". Use --list-presets to see available presets.`);
    }
    return preset;
  }
  if (!options.pattern) throw new Error('Missing search pattern. Pass a pattern or --preset <name>.');
  return options.pattern;
}

function searchWorking(repoPath, options, pattern) {
  const args = [
    '--line-number',
    '--column',
    '--no-heading',
    '--color',
    'never',
    '--max-columns',
    '240',
    '--max-columns-preview',
    '--glob',
    '!snapshots/**',
    '-I',
  ];

  if (options.context > 0 && !options.filesOnly) args.push('--context', String(options.context));
  if (options.filesOnly) args.push('--files-with-matches');
  if (options.ignoreCase) args.push('--ignore-case');
  args.push('--', pattern, options.pathspec);

  return run('rg', args, repoPath);
}

function searchBranch(repoPath, branch, options, pattern) {
  const args = ['-C', repoPath, 'grep', '-n', '-I', '-P'];
  if (options.context > 0 && !options.filesOnly) args.push('-C', String(options.context));
  if (options.filesOnly) args.push('-l');
  if (options.ignoreCase) args.push('-i');
  args.push('-e', pattern, branch, '--', options.pathspec);
  return run('git', args);
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

function existingLocalSources(repoPath) {
  return LOCAL_SOURCES.filter((source) => fs.existsSync(path.join(repoPath, source)));
}

function localSourceFor(repoPath, value) {
  if (fs.existsSync(path.join(repoPath, value))) return value;
  if (value === 'master' && fs.existsSync(path.join(repoPath, 'web'))) return 'web';
  return null;
}

function branchesFor(repoPath, value) {
  if (value === 'all') {
    const sources = existingLocalSources(repoPath);
    if (sources.length > 0) return sources;
    return ['master', 'android-loaded'];
  }
  if (value === 'current') return ['working'];
  return [value];
}

function searchTarget(repoPath, branch, options, pattern) {
  if (branch === 'working') {
    return searchWorking(repoPath, options, pattern);
  }

  const localSource = localSourceFor(repoPath, branch);
  if (localSource) {
    return searchWorking(path.join(repoPath, localSource), options, pattern);
  }

  if (isGitRepo(repoPath)) {
    return searchBranch(repoPath, branch, options, pattern);
  }

  throw new Error(`No local source directory or git ref found for "${branch}" in ${repoPath}`);
}

function printPresets(json) {
  if (json) {
    console.log(JSON.stringify(PRESETS, null, 2));
    return;
  }
  for (const [name, pattern] of Object.entries(PRESETS)) {
    console.log(`${name}\t${pattern}`);
  }
}

function printTextResult(result) {
  console.log(`## ${result.branch}`);
  console.log(`pattern: ${result.patternLabel}`);
  console.log(`path: ${result.pathspec}`);
  if (result.totalLines === 0) {
    console.log('No matches.');
    return;
  }

  console.log(`matches: ${result.lines.length}${result.truncated ? ` shown of ${result.totalLines}` : ''}`);
  console.log('');
  console.log(result.lines.join('\n'));
  if (result.truncated) console.log(`\n... truncated after ${result.lines.length} lines; rerun with --max 0 for all matches.`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.listPresets) {
    printPresets(options.json);
    return;
  }

  const repoPath = path.resolve(options.repo);
  const pattern = resolvePattern(options);
  const patternLabel = options.preset ? `preset:${options.preset}` : pattern;
  const results = [];

  for (const branch of branchesFor(repoPath, options.branch)) {
    const lines = searchTarget(repoPath, branch, options, pattern);
    results.push({
      branch,
      pathspec: options.pathspec,
      pattern: options.json ? pattern : undefined,
      patternLabel,
      ...truncate(lines, options.maxLines),
    });
  }

  if (options.json) {
    console.log(JSON.stringify({ repo: repoPath, results }, null, 2));
    return;
  }

  results.forEach((result, index) => {
    if (index > 0) console.log('\n');
    printTextResult(result);
  });
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
