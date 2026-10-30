import './env';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakes, connect, codeFromDm, OWNER } from './fakes';

async function draft(call: Awaited<ReturnType<typeof connect>>['call']) {
  const r = await call('gmail_create_draft', { to: 'raul@acme.com', subject: 'PR ready', body: 'Hi Raul, the PR is ready.' });
  return r.data.draft_id as string;
}

describe('email sending (draft → prepare → confirmed send)', () => {
  test('prepare never sends; code goes only to the owner and is hidden from the model', async () => {
    const { deps, calls } = makeFakes();
    const { call, close } = await connect(deps);
    const id = await draft(call);
    const p = await call('gmail_prepare_send', { draft_id: id });
    assert.equal(p.data.status, 'prepared_not_sent', p.text);
    assert.equal(p.data.email.to, 'raul@acme.com');
    assert.equal(calls.sentDrafts.length, 0);
    assert.equal(calls.dms.length, 1);
    assert.equal(calls.dms[0].userId, OWNER);
    const code = codeFromDm(calls.dms[0].content)!;
    assert.ok(!p.text.includes(code));
    await close();
  });

  test('requires the code; sends exactly once; disables the Discord Send button; audited', async () => {
    const { deps, calls } = makeFakes();
    const { call, close } = await connect(deps);
    const id = await draft(call);
    const ref = (await call('gmail_prepare_send', { draft_id: id })).data.confirmation_ref;
    const code = codeFromDm(calls.dms[0].content)!;
    assert.equal((await call('gmail_send_confirmed_draft', { confirmation_ref: ref })).data.reason, 'bad_code');
    assert.equal(calls.sentDrafts.length, 0);
    const ok = await call('gmail_send_confirmed_draft', { confirmation_ref: ref, confirmation_code: code });
    assert.equal(ok.data.status, 'sent', ok.text);
    assert.deepEqual(calls.sentDrafts, [id]);
    assert.deepEqual(calls.removedPending, [id]);
    assert.equal((await call('gmail_send_confirmed_draft', { confirmation_ref: ref, confirmation_code: code })).data.reason, 'used');
    assert.equal(calls.sentDrafts.length, 1);
    assert.ok(calls.audit.some((a) => a.startsWith('gmail_send_confirmed_draft')));
    await close();
  });

  test('draft edited after confirmation -> not sent', async () => {
    const { deps, calls, draftStore } = makeFakes();
    const { call, close } = await connect(deps);
    const id = await draft(call);
    const ref = (await call('gmail_prepare_send', { draft_id: id })).data.confirmation_ref;
    draftStore.get(id)!.to = 'attacker@evil.com';
    const r = await call('gmail_send_confirmed_draft', { confirmation_ref: ref, confirmation_code: codeFromDm(calls.dms[0].content) });
    assert.equal(r.isError, true);
    assert.match(r.data.error, /changed after it was confirmed/);
    assert.equal(calls.sentDrafts.length, 0);
    await close();
  });

  test('draft already sent/deleted -> clear error', async () => {
    const { deps, calls, draftStore } = makeFakes();
    const { call, close } = await connect(deps);
    const id = await draft(call);
    const ref = (await call('gmail_prepare_send', { draft_id: id })).data.confirmation_ref;
    draftStore.delete(id);
    const r = await call('gmail_send_confirmed_draft', { confirmation_ref: ref, confirmation_code: codeFromDm(calls.dms[0].content) });
    assert.match(r.data.error, /no longer exists/);
    await close();
  });

  test('expired reference and a Discord reference cannot send email', async () => {
    const { deps, calls, clock } = makeFakes();
    const { call, close } = await connect(deps);
    const dm = await call('discord_prepare_message', { recipient_user_id: '300000000000000003', message: 'hi' });
    const dmCode = codeFromDm(calls.dms[0].content);
    assert.equal((await call('gmail_send_confirmed_draft', { confirmation_ref: dm.data.confirmation_ref, confirmation_code: dmCode })).data.reason, 'invalid');
    const id = await draft(call);
    const ref = (await call('gmail_prepare_send', { draft_id: id })).data.confirmation_ref;
    clock.advance(11 * 60_000);
    assert.equal((await call('gmail_send_confirmed_draft', { confirmation_ref: ref, confirmation_code: codeFromDm(calls.dms[1].content) })).data.reason, 'expired');
    assert.equal(calls.sentDrafts.length, 0);
    await close();
  });

  test('host_approval mode needs no code; kill switch and missing Discord give clear errors', async () => {
    const f = makeFakes();
    f.deps.discord.confirmMode = 'host_approval';
    const c = await connect(f.deps);
    const id = await draft(c.call);
    const ref = (await c.call('gmail_prepare_send', { draft_id: id })).data.confirmation_ref;
    assert.equal(f.calls.dms.length, 0);
    assert.equal((await c.call('gmail_send_confirmed_draft', { confirmation_ref: ref })).data.status, 'sent');
    await c.close();

    const g = makeFakes();
    g.deps.gmail.sendEnabled = false;
    const c2 = await connect(g.deps);
    assert.match((await c2.call('gmail_prepare_send', { draft_id: await draft(c2.call) })).data.error, /MCP_ALLOW_EMAIL_SEND=false/);
    await c2.close();

    const h = makeFakes();
    h.deps.discord.token = '';
    const c3 = await connect(h.deps);
    assert.match((await c3.call('gmail_prepare_send', { draft_id: await draft(c3.call) })).data.error, /DISCORD_OWNER_ID|host_approval/);
    await c3.close();
  });
});

describe('ClickUp write tools', () => {
  test('add comment (by custom id) posts once and is audited', async () => {
    const { deps, calls } = makeFakes();
    const { call, close } = await connect(deps);
    const r = await call('clickup_add_comment', { task: 'DEV-1', comment: 'PR #42 opened' });
    assert.equal(r.data.status, 'comment_added', r.text);
    assert.deepEqual(calls.clickupWrites, [{ op: 'comment', id: 't1', payload: { text: 'PR #42 opened', notifyAll: false } }]);
    assert.ok(calls.audit[0].startsWith('clickup_add_comment'));
    await close();
  });

  test('create task: list must be in the workspace, assignees must be members, fields mapped', async () => {
    const { deps, calls } = makeFakes();
    const { call, close } = await connect(deps);
    assert.match((await call('clickup_create_task', { list_id: '12345', name: 'X' })).data.error, /not in the configured ClickUp workspace/);
    assert.match((await call('clickup_create_task', { list_id: '901', name: 'X', assignee_user_ids: [99] })).data.error, /Not members/);
    assert.equal(calls.clickupWrites.length, 0);
    const r = await call('clickup_create_task', { list_id: '901', name: 'Write tests', priority: 'high', due_date: '2026-11-03', assignee_user_ids: [8], assign_to_me: true });
    assert.equal(r.data.status, 'task_created', r.text);
    const p = calls.clickupWrites[0].payload as any;
    assert.equal(p.priority, 2);
    assert.equal(new Date(p.due_date).toISOString(), '2026-11-03T12:00:00.000Z');
    assert.deepEqual(p.assignees.sort(), [7, 8]);
    assert.match(r.data.task.list, /Engineering \/ Sprints \/ Sprint 12/);
    await close();
  });

  test('update task returns previous values; "none" clears; empty update rejected', async () => {
    const { deps, calls } = makeFakes();
    const { call, close } = await connect(deps);
    assert.match((await call('clickup_update_task', { task: 't1' })).data.error, /Nothing to change/);
    const r = await call('clickup_update_task', { task: 't1', status: 'review', priority: 'none', due_date: 'none', add_assignee_user_ids: [8] });
    assert.equal(r.data.status, 'task_updated', r.text);
    assert.equal(r.data.previous.status, 'in progress');
    assert.equal(r.data.previous.priority, 'high');
    const p = calls.clickupWrites[0].payload as any;
    assert.equal(p.priority, null);
    assert.equal(p.due_date, null);
    assert.deepEqual(p.add_assignees, [8]);
    await close();
  });

  test('invalid write inputs rejected without writing', async () => {
    const { deps, calls } = makeFakes();
    const { call, close } = await connect(deps);
    for (const [tool, args] of [
      ['clickup_create_task', { list_id: 'abc', name: 'x' }],
      ['clickup_create_task', { list_id: '901', name: 'x', priority: 'critical' }],
      ['clickup_create_task', { list_id: '901', name: 'x', due_date: 'next friday' }],
      ['clickup_update_task', { task: 't1', delete: true }],
      ['clickup_add_comment', { task: 't1', comment: '' }],
      ['clickup_add_comment', { task: 't1', comment: 'x'.repeat(10_001) }],
    ] as const) {
      assert.equal((await call(tool, args)).isError, true, `${tool} ${JSON.stringify(args).slice(0, 50)}`);
    }
    assert.equal(calls.clickupWrites.length, 0);
    await close();
  });

  test('kill switch blocks all ClickUp writes but not reads', async () => {
    const { deps, calls } = makeFakes();
    deps.clickupWrite.enabled = false;
    const { call, close } = await connect(deps);
    assert.match((await call('clickup_add_comment', { task: 't1', comment: 'x' })).data.error, /MCP_ALLOW_CLICKUP_WRITES=false/);
    assert.equal((await call('clickup_list_tasks')).isError, false);
    assert.equal(calls.clickupWrites.length, 0);
    await close();
  });

  test('find list / find user flag ambiguity instead of guessing', async () => {
    const { deps } = makeFakes();
    const { call, close } = await connect(deps);
    assert.equal((await call('clickup_find_list', { name: 'sprint 12' })).data.status, 'unique_match');
    assert.equal((await call('clickup_find_list', { name: 'engineering' })).data.status, 'candidates');
    assert.equal((await call('clickup_find_user', { name: 'raul' })).data.users[0].user_id, 8);
    assert.equal((await call('clickup_find_user', { name: 'r' })).data.status, 'needs_confirmation');
    await close();
  });
});

describe('real ClickUp write module', () => {
  test('uses POST/PUT only, never DELETE; refuses tasks from another workspace', async () => {
    const { config } = await import('../src/config');
    const w = await import('../src/integrations/clickup-write');
    const seen: { method: string; url: string; body: any }[] = [];
    const realFetch = globalThis.fetch;
    const prev = { ...config.clickup };
    Object.assign(config.clickup, { token: 'pk_test_token_not_real', teamId: '123' });
    let taskTeam = '123';
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const body = String(url).includes('/task/abc?') ? { id: 'abc', name: 'T', status: { status: 'open' }, priority: null, due_date: null, url: 'u', team_id: taskTeam }
        : { id: 'x1', name: 'N', status: { status: 'open' }, priority: null, due_date: null, url: 'u' };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    try {
      const t = await w.resolveTask('abc');
      await w.addComment(t.id, 'hello', false);
      await w.createTask('901', { name: 'N', priority: 2, due_date: 1, assignees: [7] });
      await w.updateTask('abc', { status: 'done', due_date: null, add_assignees: [8] });
      taskTeam = '999';
      await assert.rejects(w.resolveTask('abc'), /different ClickUp workspace/);
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.clickup, prev);
    }
    const writes = seen.filter((r) => r.method !== 'GET');
    assert.deepEqual(writes.map((r) => `${r.method} ${new URL(r.url).pathname}`), [
      'POST /api/v2/task/abc/comment', 'POST /api/v2/list/901/task', 'PUT /api/v2/task/abc',
    ]);
    assert.deepEqual(writes[0].body, { comment_text: 'hello', notify_all: false });
    assert.deepEqual(writes[2].body, { status: 'done', due_date: null, due_date_time: false, assignees: { add: [8], rem: [] } });
    const src = fs.readFileSync(new URL('../src/integrations/clickup-write.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /DELETE/);
  });
});
