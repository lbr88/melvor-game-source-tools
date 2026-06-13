import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(REPO_ROOT, 'scripts/game-source-mcp.mjs');
const MOD_SOURCES_FIXTURE = path.join(REPO_ROOT, 'tests/fixtures/mod-sources');
const FORBIDDEN_TOP_LEVEL_SCHEMA_KEYS = ['oneOf', 'anyOf', 'allOf', 'enum', 'not'];

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function startServer(t, options = {}) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = readline.createInterface({ input: child.stdout });
  const stderr = [];
  const pending = new Map();
  let nextId = 1;

  child.stderr.on('data', (chunk) => {
    stderr.push(String(chunk));
  });

  child.on('exit', (code, signal) => {
    for (const [id, request] of pending.entries()) {
      clearTimeout(request.timeout);
      request.reject(new Error(`MCP server exited before response ${id}: code=${code} signal=${signal}`));
    }
    pending.clear();
  });

  stdout.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error(`MCP server emitted invalid JSON: ${line}`));
      }
      pending.clear();
      return;
    }

    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(message.id);
    request.resolve(message);
  });

  t.after(() => {
    stdout.close();
    child.stdin.end();
    child.kill();
  });

  return {
    stderr,
    request(method, params) {
      const id = nextId;
      nextId += 1;
      const payload = {
        jsonrpc: '2.0',
        id,
        method,
        ...(params === undefined ? {} : { params }),
      };

      const response = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method}. stderr: ${stderr.join('')}`));
        }, 3000);
        pending.set(id, { resolve, reject, timeout });
      });

      child.stdin.write(`${JSON.stringify(payload)}\n`);
      return response;
    },
  };
}

async function initialize(client) {
  const response = await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: {
      name: 'mcp-schema-test',
      version: '0.0.0',
    },
  });

  assert.equal(response.error, undefined);
  assert.equal(response.result.serverInfo.name, 'melvor-game-source-tools');
  assert.match(response.result.instructions, /melvor_mcp_context/);
  assert.match(response.result.instructions, /mod_source_search/);
}

test('MCP tool schemas are OpenAI-compatible at the top level', async (t) => {
  const client = startServer(t);
  await initialize(client);

  const response = await client.request('tools/list');
  assert.equal(response.error, undefined);

  const tools = response.result.tools;
  assert.ok(Array.isArray(tools));
  assert.ok(tools.length > 0);
  const toolNames = new Set(tools.map((tool) => tool.name));
  assert.ok(toolNames.has('melvor_mcp_context'));
  assert.ok(toolNames.has('mod_manager_configure_mod'));
  assert.ok(toolNames.has('creator_toolkit_local_mods'));
  assert.ok(toolNames.has('melvor_mod_release_status'));
  assert.ok(toolNames.has('melvor_mod_release_package'));
  assert.ok(toolNames.has('melvor_modio_upload'));
  assert.ok(toolNames.has('game_save_test'));
  assert.ok(toolNames.has('game_session_start'));
  assert.ok(toolNames.has('game_session_action'));
  assert.ok(toolNames.has('game_session_debug_probe'));
  assert.ok(toolNames.has('game_session_time_skip'));
  assert.ok(toolNames.has('mod_source_search'));
  assert.ok(toolNames.has('mod_source_read'));
  assert.ok(toolNames.has('game_profile_start'));
  assert.ok(toolNames.has('game_profile_read'));
  assert.ok(toolNames.has('game_profile_mark'));
  assert.ok(toolNames.has('game_profile_stop'));
  assert.ok(
    tools.find((tool) => tool.name === 'game_session_action')?.inputSchema?.properties?.action?.enum?.includes('dismiss_modals')
  );
  assert.match(
    tools.find((tool) => tool.name === 'game_session_debug_probe')?.description || '',
    /live-session diagnostics/
  );
  assert.match(
    tools.find((tool) => tool.name === 'game_session_time_skip')?.description || '',
    /game\.testForOffline/
  );
  assert.match(
    tools.find((tool) => tool.name === 'game_profile_start')?.description || '',
    /CDP browser CPU profiling/
  );
  assert.equal(
    tools.find((tool) => tool.name === 'game_profile_start')?.inputSchema?.properties?.cpuProfile?.default,
    true
  );
  assert.ok(
    tools.find((tool) => tool.name === 'game_profile_stop')?.inputSchema?.properties?.maxCpuFunctions
  );
  assert.match(
    tools.find((tool) => tool.name === 'melvor_modding_guides_list')?.description || '',
    /packaged Melvor modding documentation index/
  );
  assert.match(
    tools.find((tool) => tool.name === 'melvor_modding_guides_search')?.description || '',
    /bank\/UI rendering/
  );
  assert.match(
    tools.find((tool) => tool.name === 'melvor_mcp_context')?.description || '',
    /game internals/
  );

  const failures = [];
  for (const tool of tools) {
    const schema = tool.inputSchema;
    if (!schema || schema.type !== 'object') {
      failures.push(`${tool.name}: inputSchema.type must be object`);
      continue;
    }

    for (const key of FORBIDDEN_TOP_LEVEL_SCHEMA_KEYS) {
      if (hasOwn(schema, key)) failures.push(`${tool.name}: top-level ${key} is not allowed`);
    }
  }

  assert.deepEqual(failures, []);
});

test('game_source_search validates query or preset at tool-call time', async (t) => {
  const client = startServer(t);
  await initialize(client);

  const response = await client.request('tools/call', {
    name: 'game_source_search',
    arguments: {},
  });

  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /query or preset/i);
});

test('mutation tools fail before browser launch when required mutation inputs are missing', async (t) => {
  const client = startServer(t);
  await initialize(client);

  const profileResponse = await client.request('tools/call', {
    name: 'mod_manager_configure_mod',
    arguments: {
      operation: 'enable',
    },
  });
  assert.equal(profileResponse.error, undefined);
  assert.equal(profileResponse.result.isError, true);
  assert.match(profileResponse.result.content[0].text, /Expected integer/i);

  const localResponse = await client.request('tools/call', {
    name: 'creator_toolkit_local_mods',
    arguments: {
      operation: 'add',
    },
  });
  assert.equal(localResponse.error, undefined);
  assert.equal(localResponse.result.isError, true);
  assert.match(localResponse.result.content[0].text, /mod-path/i);
});

test('local modding docs are readable through guide tools', async (t) => {
  const client = startServer(t);
  await initialize(client);

  const overviewResponse = await client.request('tools/call', {
    name: 'melvor_modding_guides_read',
    arguments: {
      page: 'README',
      maxChars: 0,
    },
  });

  assert.equal(overviewResponse.error, undefined);
  assert.equal(overviewResponse.result.isError, false);
  const overview = JSON.parse(overviewResponse.result.content[0].text);
  assert.equal(overview.source, 'local');
  assert.match(overview.text, /packaged documentation corpus/);
  assert.match(overview.text, /melvor_mcp_context/);
  assert.match(overview.text, /game-internals-overview\.md/);
  assert.match(overview.text, /local-mod-writing-patterns\.md/);
  assert.match(overview.text, /live-debugging-patterns\.md/);

  const internalsResponse = await client.request('tools/call', {
    name: 'melvor_modding_guides_read',
    arguments: {
      page: 'game-internals-overview',
      maxChars: 0,
    },
  });

  assert.equal(internalsResponse.error, undefined);
  assert.equal(internalsResponse.result.isError, false);
  const internals = JSON.parse(internalsResponse.result.content[0].text);
  assert.equal(internals.source, 'local');
  assert.match(internals.text, /Mental Model/);
  assert.match(internals.text, /Game Loop And Offline Processing/);
  assert.match(internals.text, /game_session_time_skip/);
  assert.match(internals.text, /cpu-profile\.cpuprofile/);
  assert.match(internals.text, /Items, Bank, Equipment, And Shop/);

  const response = await client.request('tools/call', {
    name: 'melvor_modding_guides_read',
    arguments: {
      page: 'Local/Creator Toolkit Local Mods',
      maxChars: 0,
    },
  });

  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, false);
  const doc = JSON.parse(response.result.content[0].text);
  assert.equal(doc.source, 'local');
  assert.match(doc.text, /mct_i--loading-mod/);
  assert.match(doc.text, /Linked Mod\.io Mods/);

  const sectionResponse = await client.request('tools/call', {
    name: 'melvor_modding_guides_read',
    arguments: {
      page: 'creator-toolkit-local-mods',
      section: 'local-storage-guard',
      maxChars: 0,
    },
  });

  assert.equal(sectionResponse.error, undefined);
  assert.equal(sectionResponse.result.isError, false);
  const section = JSON.parse(sectionResponse.result.content[0].text);
  assert.equal(section.source, 'local');
  assert.equal(section.section.anchor, 'local-storage-guard');
  assert.match(section.text, /mct_i--loading-mod/);
  assert.doesNotMatch(section.text, /Linked Mod\.io Mods/);

  const debugResponse = await client.request('tools/call', {
    name: 'melvor_modding_guides_read',
    arguments: {
      page: 'live-debugging-patterns',
      maxChars: 0,
    },
  });

  assert.equal(debugResponse.error, undefined);
  assert.equal(debugResponse.result.isError, false);
  const debugDoc = JSON.parse(debugResponse.result.content[0].text);
  assert.equal(debugDoc.source, 'local');
  assert.match(debugDoc.text, /bare globals/i);
  assert.match(debugDoc.text, /dismiss_modals/);
});

test('MCP context exposes a broad discovery map', async (t) => {
  const client = startServer(t);
  await initialize(client);

  const contextResponse = await client.request('tools/call', {
    name: 'melvor_mcp_context',
    arguments: {},
  });

  assert.equal(contextResponse.error, undefined);
  assert.equal(contextResponse.result.isError, false);
  const context = JSON.parse(contextResponse.result.content[0].text);
  assert.match(context.purpose, /Melvor Game Source MCP/);
  assert.match(context.purpose, /works internally/);
  assert.ok(context.startHere.find((entry) => entry.tool === 'melvor_modding_guides_search'));
  assert.ok(context.startHere.find((entry) => entry.tool === 'mod_source_search'));
  assert.ok(context.gameInternals.find((entry) => entry.docs.includes('game-internals-overview')));
  assert.ok(context.gameInternals.find((entry) => /Items, bank, equipment, and combat/.test(entry.area)));
  assert.ok(context.searchStarters.includes('mod_manager_fetch_sources mod_source_search installed mods'));
  assert.ok(context.searchStarters.includes('game.testForOffline Time Skip offline processing'));
  assert.ok(context.searchStarters.includes('CDP CPU profile browser metrics long tasks heap trace'));
  assert.ok(context.searchStarters.includes('how Melvor works boot registries game loop render queue'));

  const listResponse = await client.request('tools/call', {
    name: 'melvor_modding_guides_list',
    arguments: {},
  });

  assert.equal(listResponse.error, undefined);
  assert.equal(listResponse.result.isError, false);
  const list = JSON.parse(listResponse.result.content[0].text);
  assert.equal(list.overview.contextTool.tool, 'melvor_mcp_context');
  assert.ok(list.overview.gameInternals.find((entry) => /Mod loader/.test(entry.area)));
  assert.ok(list.packagedDocs.find((entry) => entry.page === 'game-internals-overview'));
  assert.ok(list.overview.searchStarters.includes('Bank bankTabMenu bank items tabs'));
});

test('fetched installed mod sources are searchable and readable', async (t) => {
  const client = startServer(t);
  await initialize(client);

  const searchResponse = await client.request('tools/call', {
    name: 'mod_source_search',
    arguments: {
      query: 'bankTabMenu',
      outDir: MOD_SOURCES_FIXTURE,
      modName: 'optimizer',
      maxResults: 5,
    },
  });

  assert.equal(searchResponse.error, undefined);
  assert.equal(searchResponse.result.isError, false);
  const search = JSON.parse(searchResponse.result.content[0].text);
  assert.equal(search.searchedMods.length, 1);
  assert.equal(search.searchedMods[0].id, 123456);
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].path, 'setup.mjs');
  assert.match(search.results[0].text, /bankTabMenu/);

  const readResponse = await client.request('tools/call', {
    name: 'mod_source_read',
    arguments: {
      modId: 123456,
      path: 'setup.mjs',
      outDir: MOD_SOURCES_FIXTURE,
      maxLines: 20,
    },
  });

  assert.equal(readResponse.error, undefined);
  assert.equal(readResponse.result.isError, false);
  const read = JSON.parse(readResponse.result.content[0].text);
  assert.equal(read.mod.name, 'Test Optimizer');
  assert.match(read.text, /ctx\.patch/);
  assert.match(read.text, /bankTabMenu/);
});

test('packaged assets JS documentation is searchable through guide tools', async (t) => {
  const client = startServer(t);
  await initialize(client);

  const readResponse = await client.request('tools/call', {
    name: 'melvor_modding_guides_read',
    arguments: {
      page: 'game-source-assets-js',
      maxChars: 0,
    },
  });

  assert.equal(readResponse.error, undefined);
  assert.equal(readResponse.result.isError, false);
  const doc = JSON.parse(readResponse.result.content[0].text);
  assert.equal(doc.source, 'local');
  assert.match(doc.title, /Melvor Idle Web Game JS Assets Catalog/);
  assert.match(doc.text, /Compiled core game logic & UI modules/);

  const searchResponse = await client.request('tools/call', {
    name: 'melvor_modding_guides_search',
    arguments: {
      query: 'Compiled core game logic & UI modules',
      maxResults: 1,
    },
  });

  assert.equal(searchResponse.error, undefined);
  assert.equal(searchResponse.result.isError, false);
  const search = JSON.parse(searchResponse.result.content[0].text);
  const result = search.results.find((entry) => entry.title === doc.title && entry.source === 'local');
  assert.ok(result);
  assert.equal(result.section.anchor, 'directory-layout');
  assert.deepEqual(result.read, {
    page: 'game-source-assets-js',
    section: 'directory-layout',
  });
  assert.ok(result.snippet.length < doc.text.length / 2);
});

test('guide search returns mod-writing chunks instead of whole docs', async (t) => {
  const client = startServer(t);
  await initialize(client);

  const searchResponse = await client.request('tools/call', {
    name: 'melvor_modding_guides_search',
    arguments: {
      query: 'ctx.patch before after replace',
      maxResults: 1,
      includeOfficial: false,
    },
  });

  assert.equal(searchResponse.error, undefined);
  assert.equal(searchResponse.result.isError, false);
  const search = JSON.parse(searchResponse.result.content[0].text);
  assert.equal(search.results.length, 1);
  const [result] = search.results;
  assert.match(result.title, /Local Mod Writing Patterns/);
  assert.ok(result.section.anchor);
  assert.equal(result.read.page, 'local-mod-writing-patterns');
  assert.equal(result.read.section, result.section.anchor);
  assert.match(result.snippet, /ctx\.patch/);
  assert.ok(result.matchedTerms.includes('ctx.patch'));
  assert.ok(result.score > 0);

  const readResponse = await client.request('tools/call', {
    name: 'melvor_modding_guides_read',
    arguments: {
      page: result.read.page,
      section: result.read.section,
      maxChars: 0,
    },
  });

  assert.equal(readResponse.error, undefined);
  assert.equal(readResponse.result.isError, false);
  const doc = JSON.parse(readResponse.result.content[0].text);
  assert.equal(doc.section.anchor, result.section.anchor);
  assert.match(doc.text, /ctx\.patch/);
  assert.ok(doc.text.length < 4000);
});


test('release upload dry-run validates local policy before mutation', async (t) => {
  const client = startServer(t);
  await initialize(client);

  const response = await client.request('tools/call', {
    name: 'melvor_modio_upload',
    arguments: {
      mod: 'missing-mod',
      workspaceRoot: REPO_ROOT,
    },
  });

  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /missing manifest|missing mod directory/i);
});
