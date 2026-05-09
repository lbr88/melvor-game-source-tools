#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import prettier from 'prettier';

const DEFAULT_SOURCE = process.env.GAME_SOURCE_READ_SOURCE || path.join('game-source', 'web');
const DEFAULT_OUT = process.env.GAME_SOURCE_READABLE_OUT || path.join('game-source-readable', 'web');
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const FORMAT_EXTENSIONS = new Map([
  ['.js', 'babel'],
  ['.mjs', 'babel'],
  ['.cjs', 'babel'],
  ['.css', 'css'],
  ['.html', 'html'],
  ['.htm', 'html'],
  ['.php', 'html'],
  ['.json', 'json'],
]);

function parseArgs(argv) {
  const options = {
    source: DEFAULT_SOURCE,
    out: DEFAULT_OUT,
    check: false,
    maxBytes: DEFAULT_MAX_BYTES,
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
    else if (arg === '--max-bytes') options.maxBytes = Number.parseInt(nextValue(), 10);
    else if (arg.startsWith('--max-bytes=')) options.maxBytes = Number.parseInt(arg.slice('--max-bytes='.length), 10);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.maxBytes) || options.maxBytes < 1) {
    throw new Error('--max-bytes must be a positive integer');
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/beautify-game-source.mjs [options]

Options:
  --source <dir>     Raw source directory. Defaults to ${DEFAULT_SOURCE}
  --out <dir>        Readable output directory. Defaults to ${DEFAULT_OUT}
  --check            Report what would be formatted without writing output.
  --max-bytes <n>    Skip files larger than this size. Defaults to ${DEFAULT_MAX_BYTES}
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

async function listFiles(root) {
  const files = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  await walk(root);
  return files;
}

function parserFor(filePath) {
  return FORMAT_EXTENSIONS.get(path.extname(filePath).toLowerCase()) || null;
}

async function formatFile(filePath, sourceRoot, outRoot, options) {
  const relativePath = path.relative(sourceRoot, filePath);
  const targetPath = path.join(outRoot, relativePath);
  const stat = await fs.stat(filePath);
  const parser = parserFor(filePath);

  if (!parser || stat.size > options.maxBytes) {
    if (!options.check) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(filePath, targetPath);
    }
    return { copied: 1, formatted: 0, skipped: 0 };
  }

  try {
    const source = await fs.readFile(filePath, 'utf8');
    const formatted = await prettier.format(source, {
      parser,
      printWidth: 120,
      tabWidth: 2,
      singleQuote: true,
      trailingComma: 'es5',
    });

    if (!options.check) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, formatted);
    }
    return { copied: 0, formatted: 1, skipped: 0 };
  } catch (error) {
    if (!options.check) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(filePath, targetPath);
    }
    return { copied: 1, formatted: 0, skipped: 1, warning: `${relativePath}: ${error.message}` };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(options.source);
  const outRoot = path.resolve(options.out);

  if (!(await exists(sourceRoot))) throw new Error(`Source directory does not exist: ${sourceRoot}`);
  if (!options.check) {
    await fs.rm(outRoot, { recursive: true, force: true });
    await fs.mkdir(outRoot, { recursive: true });
  }

  const files = await listFiles(sourceRoot);
  const totals = { copied: 0, formatted: 0, skipped: 0, files: files.length, warnings: [] };
  for (const file of files) {
    const result = await formatFile(file, sourceRoot, outRoot, options);
    totals.copied += result.copied;
    totals.formatted += result.formatted;
    totals.skipped += result.skipped;
    if (result.warning) totals.warnings.push(result.warning);
  }

  console.log(JSON.stringify({
    source: sourceRoot,
    out: outRoot,
    check: options.check,
    ...totals,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
