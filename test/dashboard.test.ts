import './env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDashboardServer } from '../src/dashboard/server';
import { HttpError, type Routes } from '../src/dashboard/http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'k'.repeat(43);

interface Res { status: number; headers: http.IncomingHttpHeaders; body: string; json: () => any }

function request(port: number, opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path ?? '/', headers: { Host: `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body) }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe('13. dashboard server security', () => {
  let server: http.Server;
  let port: number;
  const calls: unknown[] = [];
  const routes: Routes = {
    'GET /api/session': () => ({ mode: 'live' }),
    'POST /api/echo': (b) => { calls.push(b); return { got: b }; },
    'POST /api/bad': () => { throw new HttpError(400, 'Email number must be a positive whole number.'); },
  };
  const cookie = `da_key=${KEY}`;
  const origin = () => `http://127.0.0.1:${port}`;

  before(async () => {
    server = createDashboardServer({ routes, key: KEY, publicDir: path.join(root, 'public') });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  test('API is locked without the key cookie', async () => {
    const r = await request(port, { path: '/api/session' });
    assert.equal(r.status, 401);
    assert.match(r.json().error, /npm run dashboard/);
  });

  test('the key link sets an HttpOnly SameSite=Strict cookie; a wrong key does not', async () => {
    const good = await request(port, { path: `/?key=${KEY}` });
    assert.equal(good.status, 302);
    assert.equal(good.headers.location, '/');
    assert.match(String(good.headers['set-cookie']), /da_key=.+HttpOnly; SameSite=Strict/);
    const bad = await request(port, { path: '/?key=wrong' });
    assert.equal(bad.status, 302);
    assert.equal(bad.headers['set-cookie'], undefined);
  });

  test('with the cookie, GET works', async () => {
    const r = await request(port, { path: '/api/session', headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { mode: 'live' });
    assert.match(String(r.headers['content-security-policy']), /default-src 'self'/);
  });

  test('foreign Host headers are refused (DNS rebinding)', async () => {
    const r = await request(port, { path: '/api/session', headers: { Host: `evil.example:${port}`, Cookie: cookie } });
    assert.equal(r.status, 421);
  });

  test('writes need the dashboard origin and a JSON body (CSRF)', async () => {
    const body = JSON.stringify({ a: 1 });
    const noOrigin = await request(port, { method: 'POST', path: '/api/echo', body, headers: { Cookie: cookie, 'Content-Type': 'application/json' } });
    assert.equal(noOrigin.status, 403);
    const evil = await request(port, { method: 'POST', path: '/api/echo', body, headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    const form = await request(port, { method: 'POST', path: '/api/echo', body: 'a=1', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin() } });
    assert.equal(form.status, 415);
    assert.equal(calls.length, 0, 'no handler ran for a blocked request');
    const ok = await request(port, { method: 'POST', path: '/api/echo', body, headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: origin() } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json(), { got: { a: 1 } });
  });

  test('bad input returns the handler\'s status; unknown routes 404', async () => {
    const r = await request(port, { method: 'POST', path: '/api/bad', body: '{}', headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: origin() } });
    assert.equal(r.status, 400);
    assert.match(r.json().error, /positive whole number/);
    const missing = await request(port, { path: '/api/nope', headers: { Cookie: cookie } });
    assert.equal(missing.status, 404);
    const badJson = await request(port, { method: 'POST', path: '/api/echo', body: '{oops', headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: origin() } });
    assert.equal(badJson.status, 400);
  });

  test('static files are served, nothing outside public/ is', async () => {
    const index = await request(port, { path: '/' });
    assert.equal(index.status, 200);
    assert.match(index.body, /<script type="module" src="\/app.js">/);
    for (const p of ['/..%2fpackage.json', '/%2e%2e/.env', '/../data/dashboard.key'])
      assert.equal((await request(port, { path: p })).status, 404, p);
  });
});

describe('16. "working on" means started, not just assigned', () => {
  const task = (id: string, status: string, type?: string, due: number | null = null) =>
    ({ id, name: `Task ${id}`, status: { status, ...(type ? { type } : {}) }, priority: null, due_date: due === null ? null : String(due), url: `https://app.clickup.com/t/${id}` });

  test('every started task is listed under "Working on now"; the rest by due date', async () => {
    const { formatTasks, splitTasks } = await import('../src/agent');
    const tasks = [
      task('qa', 'in progress', 'custom', Date.now() + 86_400_000),
      task('outlook', 'in progress', 'custom'),
      task('square', 'testing', 'custom'),
      task('mindbody', 'in progress', 'custom'),
      task('rate', 'to do', 'open', Date.now() - 2 * 86_400_000),
      task('flags', 'backlog'),
    ];
    const { working, notStarted } = splitTasks(tasks as never);
    assert.deepEqual(working.map((t) => t.id), ['qa', 'outlook', 'square', 'mindbody']);
    assert.deepEqual(notStarted.overdue.map((t) => t.id), ['rate']);
    assert.deepEqual(notStarted.none.map((t) => t.id), ['flags']);

    const text = formatTasks(tasks as never);
    assert.match(text, /4 you're working on, 2 not started/);
    const workingSection = text.split('__Not started yet__')[0];
    for (const id of ['qa', 'outlook', 'square', 'mindbody']) assert.match(workingSection, new RegExp(`Task ${id}`));
    assert.doesNotMatch(workingSection, /Task rate|Task flags/);
  });

  test('without status types, common "not started" names are recognised', async () => {
    const { isWorkingOn } = await import('../src/integrations/clickup');
    for (const s of ['to do', 'TODO', 'Open', 'backlog']) assert.equal(isWorkingOn(task('x', s) as never), false, s);
    for (const s of ['in progress', 'testing', 'review', 'blocked']) assert.equal(isWorkingOn(task('x', s) as never), true, s);
    assert.equal(isWorkingOn(task('x', 'complete', 'closed') as never), false);
  });
});

describe('14. live dashboard API (real modules, nothing configured)', () => {
  test('reports missing integrations instead of crashing', async () => {
    const { liveRoutes } = await import('../src/dashboard/live-api');
    const r = liveRoutes({ discordReady: () => false, startedAt: 1 });
    assert.deepEqual(await r['GET /api/tasks']({}), { configured: false, working: [], buckets: null, counts: null });
    assert.equal((await r['GET /api/inbox']({}) as { configured: boolean }).configured, false);
    const s = await r['GET /api/status']({}) as { ollama: string | null; clickup: boolean; discord: boolean };
    assert.match(String(s.ollama), /Can't reach Ollama/);
    assert.equal(s.clickup, false);
    assert.equal(s.discord, false);
    await assert.rejects(async () => r['POST /api/inbox/summary']({ n: 'x' }), /positive whole number/);
    await assert.rejects(async () => r['POST /api/compose']({ to: '', about: 'x' }), /To is required/);
  });

  test('outbox shares the Discord pending store; send is single-use and never fakes success', async () => {
    const { liveRoutes } = await import('../src/dashboard/live-api');
    const { savePending } = await import('../src/agent');
    const r = liveRoutes({ discordReady: () => true, startedAt: 1 });
    savePending({ draftId: 'dash1', to: 'a@x.com', subject: 'Hello', body: 'Body' });
    const listed = (await r['GET /api/outbox']({}) as { pending: { draftId: string; body?: string }[] }).pending;
    assert.ok(listed.some((p) => p.draftId === 'dash1' && p.body === 'Body'));

    const failed = await r['POST /api/outbox/send']({ draftId: 'dash1' }) as { outcome: string; text: string };
    assert.equal(failed.outcome, 'failed', 'Gmail is not configured, so the send must fail');
    assert.match(failed.text, /Send failed/);
    assert.ok((await r['GET /api/outbox']({}) as { pending: { draftId: string }[] }).pending.some((p) => p.draftId === 'dash1'), 'kept for retry');

    assert.equal((await r['POST /api/outbox/discard']({ draftId: 'dash1' }) as { outcome: string }).outcome, 'discarded');
    assert.equal((await r['POST /api/outbox/discard']({ draftId: 'dash1' }) as { outcome: string }).outcome, 'missing');
    assert.equal((await r['POST /api/outbox/send']({ draftId: 'dash1' }) as { outcome: string }).outcome, 'missing');
  });

  test('alerts and job runs show up in the dashboard', async () => {
    const { liveRoutes } = await import('../src/dashboard/live-api');
    const { addNotification, recordJob } = await import('../src/db');
    addNotification('🆕 **New task assigned to you**');
    recordJob('ClickUp check', false, 'ClickUp 401');
    const r = liveRoutes({ discordReady: () => true, startedAt: 1 });
    const { items } = await r['GET /api/activity']({}) as { items: { text: string }[] };
    assert.equal(items[0].text, '🆕 **New task assigned to you**');
    const { jobs } = await r['GET /api/status']({}) as { jobs: { name: string; ok: boolean; error?: string }[] };
    assert.deepEqual(jobs.map(({ name, ok, error }) => ({ name, ok, error })), [{ name: 'ClickUp check', ok: false, error: 'ClickUp 401' }]);
  });
});

// Plain-JS browser/Vercel modules: imported through a variable so TypeScript treats them as untyped.
const load = (rel: string): Promise<any> => import(pathToFileURL(path.join(root, rel)).href);

describe('15. public demo', () => {
  test('markdown renderer escapes HTML and only links http(s)', async () => {
    const { md } = await load('public/render.js');
    const html: string = md('<script>alert(1)</script> **bold** [x](javascript:alert(1)) <https://ok.example/a?b=1&c=2> `<b>`\n```\n<img onerror=x>\n```');
    assert.doesNotMatch(html, /<script|<img|href="javascript/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /href="https:\/\/ok\.example\/a\?b=1&amp;c=2"/);
    assert.match(html, /<code>&lt;b&gt;<\/code>/);
    assert.match(html, /data-copy/);
  });

  test('demo API uses sample data and never sends', async () => {
    const { createDemoApi } = await load('public/demo-api.js');
    const api = createDemoApi();
    const t = await api.tasks();
    assert.ok(t.counts.overdue >= 1 && t.counts.today >= 1);
    assert.deepEqual(t.working.map((x: { status: string }) => x.status).sort(), ['in progress', 'in progress', 'review']);
    assert.ok(Object.values(t.buckets).flat().every((x: any) => !['in progress', 'review'].includes(x.status)), 'date columns only hold tasks not started');
    const inbox = await api.inbox();
    assert.ok(inbox.emails.length >= 5);
    assert.equal(inbox.emails[0].body, undefined, 'list view does not ship bodies');
    const c = await api.compose('ravi@acme.com', 'the demo is ready, ask for a call Thursday', '');
    assert.equal(c.pending.length, 1);
    const sent = await api.send(c.pending[0].draftId);
    assert.equal(sent.outcome, 'sent');
    assert.match(sent.text, /Nothing was actually sent/);
    assert.equal((await api.send(c.pending[0].draftId)).outcome, 'missing');
    await assert.rejects(() => api.compose('not-an-email', 'x', ''), /valid email/);
  });

  test('demo AI endpoint: off without a key, limited and sandboxed with one', async () => {
    const mod = await load('api/ai.js');
    const handler = mod.default;
    const call = (method: string, body?: unknown, fetchImpl?: unknown, ip = '1.2.3.4') => new Promise<{ status: number; data: any }>((resolve) => {
      const res = { statusCode: 0, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; }, end(s: string) { resolve({ status: this.statusCode, data: JSON.parse(s) }); } };
      handler({ method, body, headers: { 'x-forwarded-for': ip }, socket: {} }, res, fetchImpl);
    });

    delete process.env.GROQ_API_KEY; delete process.env.GEMINI_API_KEY;
    assert.deepEqual((await call('GET')).data, { enabled: false });
    assert.equal((await call('POST', { kind: 'plan' })).status, 501);

    process.env.GROQ_API_KEY = 'test-key';
    try {
      mod._internals.reset();
      const sentPrompts: string[] = [];
      const fakeFetch = async (_url: string, init: { body: string }) => {
        sentPrompts.push(init.body);
        const reply = JSON.parse(init.body).response_format ? '{"subject":"Demo ready","body":"Hi Ravi"}' : '**Top 3 priorities**';
        return { ok: true, json: async () => ({ choices: [{ message: { content: reply } }] }) };
      };
      assert.deepEqual((await call('GET')).data, { enabled: true });
      const plan = await call('POST', { kind: 'plan' }, fakeFetch);
      assert.equal(plan.status, 200);
      assert.equal(plan.data.text, '**Top 3 priorities**');
      assert.match(sentPrompts[0], /Fix OAuth token refresh on Android/, 'answers come from sample data');
      const compose = await call('POST', { kind: 'compose', to: 'ravi@acme.com', about: 'demo is ready' }, fakeFetch);
      assert.deepEqual(compose.data, { subject: 'Demo ready', body: 'Hi Ravi' });

      assert.equal((await call('POST', { kind: 'chat', text: 'x'.repeat(301) }, fakeFetch)).status, 400, 'long prompts are refused');
      assert.equal((await call('POST', { kind: 'anything' }, fakeFetch)).status, 400, 'only known request kinds');
      assert.equal((await call('POST', { kind: 'summary', n: 99 }, fakeFetch)).status, 400);

      const before = sentPrompts.length;
      let last = 200;
      for (let i = 0; i < 20; i++) last = (await call('POST', { kind: 'triage' }, fakeFetch, '9.9.9.9')).status;
      assert.equal(last, 429, 'each visitor is rate-limited');
      assert.equal(sentPrompts.length - before, 15);
    } finally {
      delete process.env.GROQ_API_KEY;
    }
  });
});
