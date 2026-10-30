import { testDataDir } from './env';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connect } from './fakes';
import { TOOL_NAMES } from '../src/mcp/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Follows relative imports from a file and returns every reachable project module. */
function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|import\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const base = path.resolve(path.dirname(file), spec);
      const resolved = [base, `${base}.ts`, path.join(base, 'index.ts')].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
      if (resolved) visit(resolved);
    }
  };
  visit(entry);
  return seen;
}

describe('11. MCP server does not start the bot or the scheduler', () => {
  test('mcp.ts never imports the gateway bot, scheduler, or app entry', () => {
    const graph = [...importGraph(path.join(root, 'src/mcp.ts'))].map((f) => path.relative(root, f));
    for (const forbidden of ['src/discord/bot.ts', 'src/workers/scheduler.ts', 'src/index.ts', 'src/scripts/register-commands.ts'])
      assert.ok(!graph.includes(forbidden), `${forbidden} must not be reachable from src/mcp.ts`);
    assert.ok(graph.includes('src/integrations/discord-rest.ts'));
    const rest = fs.readFileSync(path.join(root, 'src/integrations/discord-rest.ts'), 'utf8');
    assert.doesNotMatch(rest, /new Client\(|\.login\(|node-cron/, 'REST module must not open a gateway or schedule jobs');
  });

  test('stdio launch: clean protocol on stdout, tools listed, exits on stdin close', async () => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'src/mcp.ts')], {
      cwd: '/', // clients launch from other directories; config must still resolve
      env: { PATH: process.env.PATH ?? '', DATA_DIR: testDataDir, DISCORD_TOKEN: '', CLICKUP_TOKEN: '', OLLAMA_URL: 'http://127.0.0.1:9' },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    const waitFor = (pred: () => boolean, ms = 20_000) => new Promise<void>((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => { if (pred()) { clearInterval(iv); res(); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(`timeout; stderr: ${err}`)); } }, 50);
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    await waitFor(() => out.includes('"id":1'));
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await waitFor(() => out.includes('"id":2'));
    const exited = new Promise<number | null>((res) => child.on('exit', res));
    child.stdin.end();
    assert.equal(await exited, 0);
    const lines = out.trim().split('\n');
    for (const l of lines) assert.doesNotThrow(() => JSON.parse(l), `non-JSON on stdout: ${l}`);
    assert.equal(JSON.parse(lines[1]).result.tools.length, TOOL_NAMES.length);
    assert.match(err, /ready on stdio/);
    assert.doesNotMatch(err, /Logged in as|Scheduler started/);
  });
});

describe('10. missing credentials -> clear errors, no crash (real modules)', () => {
  test('every tool answers cleanly with nothing configured', async () => {
    const { realDeps } = await import('../src/mcp/deps');
    const { call, close } = await connect(realDeps());
    const status = await call('assistant_status');
    assert.equal(status.isError, false);
    assert.equal(status.data.clickup.configured, false);
    assert.equal(status.data.gmail.configured, false);
    assert.equal(status.data.discord.configured, false);
    assert.equal(status.data.ollama.reachable, false);
    const expectations: [string, Record<string, unknown>, RegExp][] = [
      ['clickup_list_tasks', {}, /CLICKUP_TOKEN/],
      ['clickup_get_task', { task: 'abc' }, /CLICKUP_TOKEN/],
      ['clickup_find_list', {}, /CLICKUP_TOKEN/],
      ['clickup_find_user', {}, /CLICKUP_TOKEN/],
      ['clickup_add_comment', { task: 'abc', comment: 'hi' }, /CLICKUP_TOKEN/],
      ['clickup_create_task', { list_id: '1', name: 'x' }, /CLICKUP_TOKEN/],
      ['clickup_update_task', { task: 'abc', status: 'done' }, /CLICKUP_TOKEN/],
      ['gmail_prepare_send', { draft_id: 'r12345678' }, /gmail:auth/],
      ['gmail_send_confirmed_draft', { confirmation_ref: 'dmc_0000000000' }, /gmail:auth/],
      ['gmail_search_emails', { query: 'x' }, /gmail:auth/],
      ['gmail_get_email', { message_id: 'abcdef12' }, /gmail:auth/],
      ['gmail_create_draft', { to: 'a@b.com', subject: 's', body: 'b' }, /gmail:auth/],
      ['discord_list_team_members', {}, /DISCORD_TOKEN/],
      ['discord_find_member', { name: 'x' }, /DISCORD_TOKEN/],
      ['discord_prepare_message', { recipient_user_id: '300000000000000001', message: 'hi' }, /DISCORD_TOKEN/],
      ['discord_send_confirmed_message', { confirmation_ref: 'dmc_0000000000' }, /DISCORD_TOKEN/],
    ];
    for (const [tool, args, re] of expectations) {
      const r = await call(tool, args);
      assert.equal(r.isError, true, tool);
      assert.match(r.data.error, re, tool);
    }
    await close();
  });
});
