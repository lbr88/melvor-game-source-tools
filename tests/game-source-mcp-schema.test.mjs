import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(REPO_ROOT, 'scripts/game-source-mcp.mjs');
const FORBIDDEN_TOP_LEVEL_SCHEMA_KEYS = ['oneOf', 'anyOf', 'allOf', 'enum', 'not'];

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function startServer(t) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: REPO_ROOT,
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
  assert.ok(toolNames.has('mod_manager_configure_mod'));
  assert.ok(toolNames.has('creator_toolkit_local_mods'));

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
});
