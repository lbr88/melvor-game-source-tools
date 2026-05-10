#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
loadDotEnv(path.join(REPO_ROOT, '.env'));

const DEFAULT_SOURCE = defaultSourceDir();
const DEFAULT_OUT = path.join(REPO_ROOT, 'docs', 'modding', 'generated-source-reference.md');
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

const CONCEPTS = [
  {
    id: 'mod-loader-context-api',
    title: 'Mod Loader And Context API',
    summary: 'Entry points and helpers exposed to mods, including context lookup, resource loading, settings, storage, and APIs.',
    patterns: [
      /\bgetContext\b/,
      /\bcontextApi\b/i,
      /\bload(?:Module|Script|Templates|Stylesheet|Data)\b/,
      /\bcharacterStorage\b/,
      /\baccountStorage\b/,
      /\bsettings\b/,
      /\bapi\s*[:(=]/,
      /\bmodManager\b/i,
      /\bModManager\b/,
    ],
  },
  {
    id: 'patching',
    title: 'Patching',
    summary: 'Symbols related to the mod patcher: additive hooks, replacements, and patch detection.',
    patterns: [
      /\bpatch\s*\(/,
      /\bisPatched\b/,
      /\.before\s*\(/,
      /\.after\s*\(/,
      /\.replace\s*\(/,
      /\bpatchMap\b/,
      /\bblacklist\b/i,
    ],
  },
  {
    id: 'lifecycle-hooks',
    title: 'Lifecycle Hooks',
    summary: 'Lifecycle callbacks mods use to run after mod loading, character selection, character load, and interface readiness.',
    patterns: [
      /\bonModsLoaded\b/,
      /\bonCharacterSelectionLoaded\b/,
      /\bonInterfaceAvailable\b/,
      /\bonCharacterLoaded\b/,
      /\bonInterfaceReady\b/,
      /\bmodsLoaded\b/,
    ],
  },
  {
    id: 'offline-processing',
    title: 'Offline Processing',
    summary: 'Offline progress UI and loop events that performance-sensitive mods commonly need to observe or avoid disrupting.',
    patterns: [
      /\bOfflineLoadingElement\b/,
      /\bOfflineProgressElement\b/,
      /\bofflineLoopEntered\b/,
      /\bofflineLoopExited\b/,
      /\bloadingOfflineProgress\b/,
      /\bprocessOffline\b/,
      /\bofflineAction\b/,
    ],
  },
  {
    id: 'ui-custom-elements',
    title: 'UI And Custom Elements',
    summary: 'Custom elements, templates, and DOM lifecycle methods that mods can inspect or mount near.',
    patterns: [
      /\bcustomElements\.define\b/,
      /\bHTMLElement\b/,
      /\bconnectedCallback\b/,
      /\bdisconnectedCallback\b/,
      /\btemplate\b/i,
      /\bui\.create\b/,
      /\bcreateElement\b/,
    ],
  },
  {
    id: 'rendering',
    title: 'Rendering',
    summary: 'Rendering flags, render methods, and render queues that can be expensive during offline progress or UI updates.',
    patterns: [
      /\benableRendering\b/,
      /\brequiredRender\b/,
      /\brenderQueue\b/,
      /\brender\s*\(/,
      /\bupdateForRender\b/,
    ],
  },
  {
    id: 'events',
    title: 'Game Events',
    summary: 'Event emitters and event names useful for cache invalidation, profiling, and cross-system observation.',
    patterns: [
      /\.on\s*\(/,
      /\.off\s*\(/,
      /\.emit\s*\(/,
      /\bmitt\b/,
      /\bEventEmitter\b/,
      /\bitemChanged\b/,
      /\bmasteryLevelChanged\b/,
      /\blevelChanged\b/,
    ],
  },
];

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

function defaultSourceDir() {
  if (process.env.GAME_SOURCE_DOC_SOURCE) return process.env.GAME_SOURCE_DOC_SOURCE;
  const readableWeb = path.join(REPO_ROOT, 'game-source-readable', 'web');
  if (fs.existsSync(readableWeb)) return readableWeb;
  return path.join(REPO_ROOT, 'game-source', 'web');
}

function parseArgs(argv) {
  const options = {
    source: DEFAULT_SOURCE,
    out: DEFAULT_OUT,
    check: false,
    json: false,
    maxBytes: DEFAULT_MAX_BYTES,
    maxMatchesPerConcept: 80,
    maxClasses: 200,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };

    if (arg === '--source') options.source = nextValue();
    else if (arg.startsWith('--source=')) options.source = arg.slice('--source='.length);
    else if (arg === '--out') options.out = nextValue();
    else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
    else if (arg === '--check') options.check = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--max-bytes') options.maxBytes = parsePositiveInteger(nextValue(), '--max-bytes');
    else if (arg.startsWith('--max-bytes=')) options.maxBytes = parsePositiveInteger(arg.slice('--max-bytes='.length), '--max-bytes');
    else if (arg === '--max-matches') options.maxMatchesPerConcept = parsePositiveInteger(nextValue(), '--max-matches');
    else if (arg.startsWith('--max-matches=')) options.maxMatchesPerConcept = parsePositiveInteger(arg.slice('--max-matches='.length), '--max-matches');
    else if (arg === '--max-classes') options.maxClasses = parsePositiveInteger(nextValue(), '--max-classes');
    else if (arg.startsWith('--max-classes=')) options.maxClasses = parsePositiveInteger(arg.slice('--max-classes='.length), '--max-classes');
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function parsePositiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/extract-modding-docs.mjs [options]

Generate a compact, searchable modding source reference from this repo's local Melvor source store.

Options:
  --source <dir>       Source directory. Defaults to GAME_SOURCE_DOC_SOURCE, ./game-source-readable/web, or ./game-source/web.
  --out <file>         Markdown output. Defaults to docs/modding/generated-source-reference.md.
  --check              Print summary without writing output.
  --json               Print machine-readable summary.
  --max-bytes <n>      Skip individual JS files larger than this. Defaults to ${DEFAULT_MAX_BYTES}.
  --max-matches <n>    Cap matches per concept. Defaults to 80.
  --max-classes <n>    Cap selected class entries. Defaults to 200.
`);
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root) {
  const files = [];
  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git'].includes(entry.name)) continue;
        await walk(entryPath);
      } else if (entry.isFile() && isCandidateSourceFile(entryPath, root)) {
        files.push(entryPath);
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function displayRepoPath(filePath) {
  const resolved = path.resolve(filePath);
  const relative = normalizePath(path.relative(REPO_ROOT, resolved));
  if (relative && !relative.startsWith('../') && relative !== '..' && !path.isAbsolute(relative)) return relative;
  if (!relative) return '.';
  return resolved;
}

function isCandidateSourceFile(filePath, root) {
  const rel = normalizePath(path.relative(root, filePath));
  if (!rel.endsWith('.js') && !rel.endsWith('.mjs')) return false;
  if (rel.includes('/plugins/') || rel.includes('/pages/')) return false;
  if (rel.endsWith('.min.js')) return false;
  if (/(?:^|\/)(?:Sortable|basis|dagre|dexie|fflate|fuse|jquery|mitt|oneui|petite-vue|pixi|popper|toastify|viewport|tippy)/i.test(rel)) return false;
  return rel.includes('/assets/js/built/')
    || rel.includes('/assets/js/game/')
    || rel.endsWith('assets/js/built/mod.js')
    || rel.endsWith('built/mod.js');
}

function lineNumberAt(text, index) {
  if (index <= 0) return 1;
  return text.slice(0, index).split(/\r?\n/).length;
}

function trimSnippet(line) {
  return line.trim().replace(/\s+/g, ' ').slice(0, 220);
}

function extractSymbol(line) {
  const custom = line.match(/customElements\.define\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z_$][\w$]*)/);
  if (custom) return `${custom[1]} -> ${custom[2]}`;
  const cls = line.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
  if (cls) return cls[1];
  const fn = line.match(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
  if (fn) return `${fn[1]}()`;
  const method = line.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/);
  if (method) return `${method[1]}()`;
  const property = line.match(/\b([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/);
  if (property) return `${property[1]}()`;
  const identifier = line.match(/\b(on[A-Z][A-Za-z0-9_$]*|Offline[A-Za-z0-9_$]*|[A-Za-z0-9_$]*Storage|isPatched|patch)\b/);
  return identifier?.[1] || '';
}

function addMatch(matches, seen, concept, file, relativePath, lineNumber, line, maxMatches) {
  if (matches[concept.id].length >= maxMatches) return;
  const snippet = trimSnippet(line);
  if (!snippet) return;
  const key = `${concept.id}:${relativePath}:${lineNumber}:${snippet}`;
  if (seen.has(key)) return;
  seen.add(key);
  matches[concept.id].push({
    file: relativePath,
    line: lineNumber,
    symbol: extractSymbol(line),
    snippet,
  });
}

function shouldIncludeClass(name, parent) {
  return /(?:Mod|Patch|Context|Setting|Storage|Offline|Element|Menu|Manager|Skill|Page|Render|Notification|Sidebar|Bank|Combat|Save|Cloud|Native)/.test(name)
    || /(?:HTMLElement|Element|Manager|Skill)/.test(parent || '');
}

async function analyzeFile(file, sourceRoot, options, state) {
  const stat = await fsp.stat(file);
  if (stat.size > options.maxBytes) {
    state.skipped.push({ file: normalizePath(path.relative(sourceRoot, file)), reason: `larger than ${options.maxBytes} bytes` });
    return;
  }

  const text = await fsp.readFile(file, 'utf8');
  const relativePath = normalizePath(path.relative(sourceRoot, file));
  const lines = text.split(/\r?\n/);
  state.scannedFiles.push(relativePath);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    for (const concept of CONCEPTS) {
      if (concept.patterns.some((pattern) => pattern.test(line))) {
        addMatch(state.matches, state.seenMatches, concept, file, relativePath, lineNumber, line, options.maxMatchesPerConcept);
      }
    }
  }

  const classPattern = /\bclass\s+([A-Za-z_$][\w$]*)\s*(?:extends\s+([A-Za-z_$][\w$.\[\]]+))?/g;
  let match;
  while (state.classes.length < options.maxClasses && (match = classPattern.exec(text)) !== null) {
    const name = match[1];
    const parent = match[2] || '';
    if (!shouldIncludeClass(name, parent)) continue;
    state.classes.push({
      name,
      extends: parent,
      file: relativePath,
      line: lineNumberAt(text, match.index),
    });
  }

  const definePattern = /customElements\.define\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z_$][\w$]*)/g;
  while ((match = definePattern.exec(text)) !== null) {
    state.customElements.push({
      tag: match[1],
      className: match[2],
      file: relativePath,
      line: lineNumberAt(text, match.index),
    });
  }
}

function markdownEscape(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderMatchList(matches) {
  if (matches.length === 0) return '_No matches found._\n';
  return matches.map((match) => {
    const symbol = match.symbol ? ` \`${markdownEscape(match.symbol)}\`` : '';
    return `- \`${match.file}:${match.line}\`${symbol} - ${markdownEscape(match.snippet)}`;
  }).join('\n') + '\n';
}

function renderMarkdown(state, options) {
  const generatedAt = new Date().toISOString();
  const source = displayRepoPath(options.source);
  const out = displayRepoPath(options.out);
  const conceptSections = CONCEPTS.map((concept) => `## ${concept.title}

${concept.summary}

${renderMatchList(state.matches[concept.id])}`).join('\n');

  const classLines = state.classes.length === 0
    ? '_No selected classes found._\n'
    : state.classes
      .map((entry) => `- \`${entry.name}${entry.extends ? ` extends ${entry.extends}` : ''}\` - \`${entry.file}:${entry.line}\``)
      .join('\n') + '\n';

  const elementLines = state.customElements.length === 0
    ? '_No custom elements found._\n'
    : state.customElements
      .map((entry) => `- \`<${entry.tag}>\` -> \`${entry.className}\` - \`${entry.file}:${entry.line}\``)
      .join('\n') + '\n';

  const skippedLines = state.skipped.length === 0
    ? '_No files skipped._\n'
    : state.skipped.map((entry) => `- \`${entry.file}\` - ${entry.reason}`).join('\n') + '\n';

  return `# Generated Melvor Modding Source Reference

Generated at: ${generatedAt}

Source root: \`${source}\`

Output path: \`${out}\`

This document is generated from local Melvor client source. It is intentionally compact: it points mod authors and AI agents at high-signal files, symbols, events, and snippets instead of copying large client files.

Regenerate with:

\`\`\`bash
npm run source:docs
\`\`\`

## Scan Summary

- Files scanned: ${state.scannedFiles.length}
- Files skipped: ${state.skipped.length}
- Selected classes: ${state.classes.length}
- Custom elements: ${state.customElements.length}

## Selected Classes

${classLines}
## Custom Elements

${elementLines}
${conceptSections}
## Skipped Files

${skippedLines}
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(options.source);
  if (!(await exists(sourceRoot))) throw new Error(`Source directory does not exist: ${sourceRoot}`);

  const files = await listFiles(sourceRoot);
  const state = {
    scannedFiles: [],
    skipped: [],
    classes: [],
    customElements: [],
    matches: Object.fromEntries(CONCEPTS.map((concept) => [concept.id, []])),
    seenMatches: new Set(),
  };

  for (const file of files) {
    await analyzeFile(file, sourceRoot, options, state);
  }

  const markdown = renderMarkdown(state, options);
  const summary = {
    source: sourceRoot,
    out: path.resolve(options.out),
    check: options.check,
    scannedFiles: state.scannedFiles.length,
    skippedFiles: state.skipped.length,
    selectedClasses: state.classes.length,
    customElements: state.customElements.length,
    concepts: Object.fromEntries(CONCEPTS.map((concept) => [concept.id, state.matches[concept.id].length])),
  };

  if (!options.check) {
    await fsp.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
    await fsp.writeFile(path.resolve(options.out), markdown);
  }

  console.log(options.json ? JSON.stringify(summary, null, 2) : `${options.check ? 'Checked' : 'Wrote'} ${summary.out}
Scanned ${summary.scannedFiles} files, selected ${summary.selectedClasses} classes, found ${summary.customElements} custom elements.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
