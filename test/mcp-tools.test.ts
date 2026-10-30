import './env';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakes, connect, codeFromDm, ALLOWED_GUILD, OTHER_GUILD, OWNER, OUTSIDER } from './fakes';
import { TOOL_NAMES } from '../src/mcp/server';

describe('1. server starts and lists tools', () => {
  test('lists exactly the expected tools, with safety annotations', async () => {
    const { deps } = makeFakes();
    const { client, close } = await connect(deps);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const n of ['clickup_list_tasks', 'clickup_get_task', 'clickup_find_list', 'clickup_find_user', 'gmail_search_emails', 'gmail_get_email', 'discord_find_member'])
      assert.equal(byName[n].annotations?.readOnlyHint, true, n);
    for (const n of ['discord_send_confirmed_message', 'gmail_send_confirmed_draft', 'clickup_update_task'])
      assert.equal(byName[n].annotations?.destructiveHint, true, n);
    assert.ok(!tools.some((t) => /shell|exec|http_request|file|delete/i.test(t.name)), 'no shell/file/http/delete tools');
    await close();
  });
});

describe('2. invalid inputs are rejected', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['clickup_list_tasks', { limit: 1000 }],
    ['clickup_list_tasks', { due: 'yesterday' }],
    ['clickup_list_tasks', { unexpected: true }],
    ['clickup_get_task', {}],
    ['gmail_search_emails', { query: 'a\nb' }],
    ['gmail_search_emails', { query: '' }],
    ['gmail_get_email', { message_id: '../../etc/passwd' }],
    ['gmail_create_draft', { to: 'a@b.com', subject: 's' }],
    ['discord_prepare_message', { recipient_user_id: 'Raul', message: 'hi' }],
    ['discord_prepare_message', { recipient_user_id: '300000000000000003', message: 'x'.repeat(1801) }],
    ['discord_prepare_message', { recipient_user_id: '300000000000000003', message: '   ' }],
    ['discord_send_confirmed_message', { confirmation_ref: 'dmc_x', confirmed: true }],
    ['discord_send_confirmed_message', { confirmation_ref: 'dmc_0123456789', confirmation_code: '12ab56' }],
  ];
  for (const [tool, args] of cases) {
    test(`${tool} ${JSON.stringify(args).slice(0, 60)}`, async () => {
      const { deps, calls } = makeFakes();
      const { call, close } = await connect(deps);
      const r = await call(tool, args);
      assert.equal(r.isError, true, r.text);
      assert.equal(calls.dms.length, 0);
      assert.equal(calls.drafts.length, 0);
      await close();
    });
  }
  test('invalid email address is rejected at runtime with a clear message', async () => {
    const { deps, calls } = makeFakes();
    const { call, close } = await connect(deps);
    const r = await call('gmail_create_draft', { to: 'raul@acme', subject: 's', body: 'b' });
    assert.equal(r.isError, true);
    assert.match(r.data.error, /Invalid email address/);
    assert.equal(calls.drafts.length, 0);
    await close();
  });
});

describe('3. ClickUp read tools reuse the integration and stay read-only', () => {
  test('list/filter/get go through the injected integration', async () => {
    const { deps, calls } = makeFakes();
    const { call, close } = await connect(deps);
    const all = await call('clickup_list_tasks');
    assert.equal(all.data.total_matching, 2);
    const overdue = await call('clickup_list_tasks', { due: 'overdue' });
    assert.deepEqual(overdue.data.tasks.map((t: any) => t.id), ['t1']);
    const none = await call('clickup_list_tasks', { search: 'zzz' });
    assert.equal(none.isError, false);
    assert.equal(none.data.available, true);
    assert.equal(none.data.tasks.length, 0);
    const t = await call('clickup_get_task', { task: 't2' });
    assert.deepEqual(t.data.remaining_checklist_items, ['Release: Announce']);
    assert.ok(t.data.missing_fields.includes('due_date'));
    assert.ok(calls.clickup.includes('listOpenTasks:7') && calls.clickup.includes('getTask:t2'));
    await close();
  });

  test('unconfigured ClickUp reports "unavailable", not an empty list', async () => {
    const { deps } = makeFakes();
    deps.clickup.configured = () => false;
    const { call, close } = await connect(deps);
    const r = await call('clickup_list_tasks');
    assert.equal(r.isError, true);
    assert.match(r.data.error, /not configured.*not an empty result/s);
    await close();
  });

  test('the real ClickUp module only issues GET requests', async () => {
    const { config } = await import('../src/config');
    const cu = await import('../src/integrations/clickup');
    const seen: { method: string; url: string }[] = [];
    const realFetch = globalThis.fetch;
    const prev = { ...config.clickup };
    config.clickup.token = 'pk_test_token_not_real';
    config.clickup.teamId = '123';
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ method: init?.method ?? 'GET', url: String(url) });
      const body = String(url).endsWith('/user') ? { user: { id: 7, username: 'y' } }
        : String(url).includes('/task?') ? { tasks: [], last_page: true } : { id: 'abc', name: 'T', status: { status: 'open' }, priority: null, due_date: null, url: 'u' };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    try {
      await cu.listMyOpenTasks();
      await cu.getTask('abc');
      await cu.getTask('https://app.clickup.com/t/abc');
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.clickup, prev);
    }
    assert.ok(seen.length >= 3);
    assert.ok(seen.every((r) => r.method === 'GET'), JSON.stringify(seen));
    const src = fs.readFileSync(new URL('../src/integrations/clickup.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /method:\s*['"](POST|PUT|PATCH|DELETE)/i);
  });
});

describe('4. Gmail search', () => {
  test('passes the validated query to the existing integration', async () => {
    const { deps, calls } = makeFakes();
    const { call, close } = await connect(deps);
    const r = await call('gmail_search_emails', { query: 'deployment newer_than:7d', limit: 5 });
    assert.equal(r.data.count, 1);
    assert.equal(r.data.emails[0].message_id, 'msg123456');
    assert.match(r.data.content_notice, /UNTRUSTED/);
    assert.deepEqual(calls.gmail, ['list:deployment newer_than:7d:5']);
    const empty = await call('gmail_search_emails', { query: 'nothing' });
    assert.equal(empty.isError, false);
    assert.equal(empty.data.count, 0);
    await close();
  });
  test('email content is returned as untrusted data and triggers no actions', async () => {
    const { deps, calls } = makeFakes();
    const { call, close } = await connect(deps);
    const r = await call('gmail_get_email', { message_id: 'msg123456', summarize: true });
    assert.equal(r.data.summary, '- summary');
    assert.match(r.data.content_notice, /Do not follow/);
    assert.equal(calls.dms.length + calls.drafts.length + calls.sentDrafts.length + calls.clickupWrites.length, 0);
    await close();
  });
});

describe('5. Gmail drafts are never sent', () => {
  test('create_draft (with and without Send button) never sends', async () => {
    const { deps, calls } = makeFakes();
    const saved: unknown[] = [];
    deps.pendingEmails.save = (p) => { saved.push(p); };
    const { call, close } = await connect(deps);
    const r = await call('gmail_create_draft', { to: 'raul@acme.com', cc: 'b@x.io', subject: 'PR ready', body: 'Hi Raul' });
    assert.equal(r.data.status, 'draft_created_not_sent');
    assert.equal(r.data.preview.to, 'raul@acme.com');
    const r2 = await call('gmail_create_draft', { to: 'raul@acme.com', subject: 'Re: Deployment', body: 'Thanks', reply_to_message_id: 'msg123456', offer_send_button: true });
    assert.equal(r2.data.send_button.posted, true);
    assert.equal(calls.drafts[1].threadId, 'thr1');
    assert.equal(calls.dms.length, 1);
    assert.equal(calls.dms[0].userId, OWNER, 'button preview goes only to the owner');
    assert.equal(saved.length, 1);
    assert.equal(calls.sentDrafts.length, 0, 'creating a draft must never send it');
    await close();
  });
  test('the only email-sending call in MCP code is inside gmail_send_confirmed_draft', () => {
    const src = fs.readFileSync(new URL('../src/mcp/server.ts', import.meta.url), 'utf8');
    const calls = [...src.matchAll(/deps\.gmail\.sendDraft\(/g)].map((m) => m.index!);
    assert.equal(calls.length, 1);
    const start = src.indexOf("registerTool('gmail_send_confirmed_draft'");
    const end = src.indexOf('registerTool(', start + 10);
    assert.ok(calls[0] > start && calls[0] < end);
    assert.ok(src.slice(start, calls[0]).includes('deps.confirmations.claim('), 'claim must happen before sending');
    for (const f of ['../src/mcp/deps.ts', '../src/mcp.ts'])
      assert.doesNotMatch(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), /messages\.send|drafts\.send/, f);
  });
});

describe('6. ambiguous Discord recipients', () => {
  test('two exact matches -> ambiguous with candidates, nothing chosen', async () => {
    const { deps } = makeFakes();
    const { call, close } = await connect(deps);
    const r = await call('discord_find_member', { name: 'Raul' });
    assert.equal(r.data.status, 'ambiguous');
    assert.equal(r.data.candidates.length, 2);
    assert.equal(r.data.member, undefined);
    const prep = await call('discord_prepare_message', { recipient_user_id: 'Raul', message: 'PR ready' });
    assert.equal(prep.isError, true, 'a name cannot be used as a recipient');
    await close();
  });
  test('unique, partial and not-found results; bots excluded', async () => {
    const { deps } = makeFakes();
    const { call, close } = await connect(deps);
    assert.equal((await call('discord_find_member', { name: 'nastya' })).data.status, 'unique_match');
    assert.equal((await call('discord_find_member', { name: 'Ra' })).data.status, 'needs_confirmation');
    assert.equal((await call('discord_find_member', { name: 'revy' })).data.status, 'not_found');
    assert.equal((await call('discord_find_member', { name: 'stranger' })).data.status, 'not_found', 'other servers are never searched');
    await close();
  });
});

describe('7 & 8. prepare never sends; confirmation references are strict', () => {
  async function prepared(mode: 'dm_code' | 'host_approval' = 'dm_code') {
    const f = makeFakes();
    f.deps.discord.confirmMode = mode;
    const c = await connect(f.deps);
    const r = await c.call('discord_prepare_message', { recipient_user_id: '300000000000000001', message: 'PR #42 is ready for review' });
    assert.equal(r.isError, false, r.text);
    return { ...f, ...c, ref: r.data.confirmation_ref as string, prep: r };
  }
  const recipientDms = <T extends { userId: string }>(dms: T[]) => dms.filter((d) => d.userId !== OWNER);

  test('prepare sends nothing to the recipient; code goes only to the owner and not to the model', async () => {
    const { calls, prep, close } = await prepared();
    assert.equal(prep.data.status, 'prepared_not_sent');
    assert.equal(recipientDms(calls.dms).length, 0);
    assert.equal(calls.dms.length, 1);
    assert.equal(calls.dms[0].userId, OWNER);
    const code = codeFromDm(calls.dms[0].content)!;
    assert.match(code, /^\d{6}$/);
    assert.ok(!prep.text.includes(code), 'the code must not appear in the tool result');
    await close();
  });

  test('missing/wrong code rejected; correct code sends once; reuse rejected', async () => {
    const { call, calls, ref, close } = await prepared();
    const code = codeFromDm(calls.dms[0].content)!;
    assert.equal((await call('discord_send_confirmed_message', { confirmation_ref: ref })).data.reason, 'bad_code');
    const wrong = code === '000000' ? '111111' : '000000';
    assert.equal((await call('discord_send_confirmed_message', { confirmation_ref: ref, confirmation_code: wrong })).data.reason, 'bad_code');
    assert.equal(recipientDms(calls.dms).length, 0);
    const ok = await call('discord_send_confirmed_message', { confirmation_ref: ref, confirmation_code: code });
    assert.equal(ok.data.status, 'sent', ok.text);
    assert.deepEqual(recipientDms(calls.dms).map((d) => d.content), ['PR #42 is ready for review']);
    const again = await call('discord_send_confirmed_message', { confirmation_ref: ref, confirmation_code: code });
    assert.equal(again.data.reason, 'used');
    assert.equal(recipientDms(calls.dms).length, 1, 'no duplicate send');
    await close();
  });

  test('parallel sends of the same reference deliver exactly once', async () => {
    const { call, calls, ref, close } = await prepared();
    const code = codeFromDm(calls.dms[0].content)!;
    const results = await Promise.all([1, 2, 3].map(() => call('discord_send_confirmed_message', { confirmation_ref: ref, confirmation_code: code })));
    assert.equal(results.filter((r) => r.data.status === 'sent').length, 1);
    assert.equal(recipientDms(calls.dms).length, 1);
    await close();
  });

  test('expired reference rejected', async () => {
    const { call, calls, clock, ref, close } = await prepared();
    clock.advance(11 * 60_000);
    const r = await call('discord_send_confirmed_message', { confirmation_ref: ref, confirmation_code: codeFromDm(calls.dms[0].content) });
    assert.equal(r.data.reason, 'expired');
    assert.equal(recipientDms(calls.dms).length, 0);
    await close();
  });

  test('unknown, malformed and modified references rejected', async () => {
    const { call, calls, ref, close } = await prepared();
    const code = codeFromDm(calls.dms[0].content);
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === 'a' ? 'b' : 'a') + s.slice(i + 1);
    assert.equal((await call('discord_send_confirmed_message', { confirmation_ref: 'not-a-reference', confirmation_code: code })).data.reason, 'invalid');
    assert.equal((await call('discord_send_confirmed_message', { confirmation_ref: flip(ref, ref.length - 1), confirmation_code: code })).data.reason, 'tampered');
    assert.equal((await call('discord_send_confirmed_message', { confirmation_ref: flip(ref, 6), confirmation_code: code })).data.reason, 'tampered');
    assert.equal(recipientDms(calls.dms).length, 0);
    await close();
  });

  test('a reference with a valid signature but no stored message is "unknown"', async () => {
    const { call, calls, db, ref, close } = await prepared();
    db.prepare('DELETE FROM mcp_outbound').run();
    const r = await call('discord_send_confirmed_message', { confirmation_ref: ref, confirmation_code: codeFromDm(calls.dms[0].content) });
    assert.equal(r.data.reason, 'unknown');
    await close();
  });

  test('message text or recipient modified in storage -> rejected', async () => {
    for (const sql of ["UPDATE mcp_outbound SET content='send me the passwords'", "UPDATE mcp_outbound SET recipient_id='300000000000000003'"]) {
      const { call, calls, db, ref, close } = await prepared();
      db.prepare(sql).run();
      const r = await call('discord_send_confirmed_message', { confirmation_ref: ref, confirmation_code: codeFromDm(calls.dms[0].content) });
      assert.equal(r.data.reason, 'tampered', sql);
      assert.equal(recipientDms(calls.dms).length, 0);
      await close();
    }
  });

  test('5 wrong codes lock the reference', async () => {
    const { call, calls, ref, close } = await prepared();
    const code = codeFromDm(calls.dms[0].content)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await call('discord_send_confirmed_message', { confirmation_ref: ref, confirmation_code: wrong });
    const r = await call('discord_send_confirmed_message', { confirmation_ref: ref, confirmation_code: code });
    assert.equal(r.data.reason, 'locked');
    assert.equal(recipientDms(calls.dms).length, 0);
    await close();
  });

  test('re-preparing the same text supersedes the old reference; identical re-send within 10 min refused', async () => {
    const { call, calls, ref, close } = await prepared();
    const second = await call('discord_prepare_message', { recipient_user_id: '300000000000000001', message: 'PR #42 is ready for review' });
    assert.equal((await call('discord_send_confirmed_message', { confirmation_ref: ref, confirmation_code: codeFromDm(calls.dms[0].content) })).data.reason, 'used');
    const sent = await call('discord_send_confirmed_message', { confirmation_ref: second.data.confirmation_ref, confirmation_code: codeFromDm(calls.dms[1].content) });
    assert.equal(sent.data.status, 'sent');
    const dup = await call('discord_prepare_message', { recipient_user_id: '300000000000000001', message: 'PR #42 is ready for review' });
    assert.equal(dup.isError, true);
    assert.match(dup.data.error, /already sent/);
    await close();
  });

  test('host_approval mode: no code needed, still single-use', async () => {
    const { call, calls, ref, close } = await prepared('host_approval');
    assert.equal(calls.dms.length, 0, 'no owner DM in host_approval mode');
    assert.equal((await call('discord_send_confirmed_message', { confirmation_ref: ref })).data.status, 'sent');
    assert.equal((await call('discord_send_confirmed_message', { confirmation_ref: ref })).data.reason, 'used');
    await close();
  });

  test('if the owner cannot receive the code, nothing is prepared', async () => {
    const f = makeFakes();
    const api = f.deps.discord.api();
    f.deps.discord.api = () => ({ ...api, sendDm: async () => { throw new Error('Cannot send messages to this user'); } });
    const { call, close } = await connect(f.deps);
    const r = await call('discord_prepare_message', { recipient_user_id: '300000000000000001', message: 'hi' });
    assert.equal(r.isError, true);
    assert.match(r.data.error, /not prepared/);
    assert.equal((f.db.prepare("SELECT COUNT(*) n FROM mcp_outbound WHERE status='pending'").get() as { n: number }).n, 0);
    await close();
  });

  test('DM refused by Discord -> clear error, reference consumed', async () => {
    const { deps, call, calls, ref, close } = await prepared();
    const code = codeFromDm(calls.dms[0].content);
    const api = deps.discord.api();
    deps.discord.api = () => ({ ...api, sendDm: async () => { throw new Error('Discord send DM failed (403/50007): Discord will not let the bot DM this user'); } });
    const r = await call('discord_send_confirmed_message', { confirmation_ref: ref, confirmation_code: code });
    assert.equal(r.isError, true);
    assert.match(r.data.error, /50007/);
    await close();
  });
});

describe('9. allowlisted server only', () => {
  test('cannot prepare for a user outside the approved server', async () => {
    const { deps, calls } = makeFakes();
    const { call, close } = await connect(deps);
    const r = await call('discord_prepare_message', { recipient_user_id: OUTSIDER.userId, message: 'hi' });
    assert.equal(r.isError, true);
    assert.match(r.data.error, /not a member of the approved/);
    assert.ok(calls.memberLookups.every((g) => g === ALLOWED_GUILD), 'only the allowed guild is ever queried');
    await close();
  });
  test('a message prepared for one server cannot be sent after the allowlist changes', async () => {
    const { deps, calls } = makeFakes();
    const { call, close } = await connect(deps);
    const p = await call('discord_prepare_message', { recipient_user_id: '300000000000000003', message: 'hi' });
    deps.discord.allowedGuildId = OTHER_GUILD;
    const r = await call('discord_send_confirmed_message', { confirmation_ref: p.data.confirmation_ref, confirmation_code: codeFromDm(calls.dms[0].content) });
    assert.equal(r.data.reason, 'guild');
    assert.equal(calls.dms.filter((d) => d.userId !== OWNER).length, 0);
    await close();
  });
  test('bots cannot be messaged; no allowlist means no Discord tools', async () => {
    const { deps } = makeFakes();
    const { call, close } = await connect(deps);
    assert.match((await call('discord_prepare_message', { recipient_user_id: '300000000000000004', message: 'hi' })).data.error, /bot/);
    deps.discord.allowedGuildId = '';
    for (const [tool, args] of [['discord_find_member', { name: 'raul' }], ['discord_list_team_members', {}], ['discord_prepare_message', { recipient_user_id: '300000000000000003', message: 'hi' }]] as const) {
      const r = await call(tool, args);
      assert.equal(r.isError, true);
      assert.match(r.data.error, /DISCORD_ALLOWED_GUILD_ID/);
    }
    await close();
  });
});

describe('secrets never appear in results', () => {
  test('errors containing a token are redacted', async () => {
    const { deps } = makeFakes();
    deps.clickup.getTask = async () => { throw new Error('upstream said: token fake-token-value-123456 and pk_12345678901234567890 rejected'); };
    const { call, close } = await connect(deps);
    const r = await call('clickup_get_task', { task: 'x' });
    assert.ok(!r.text.includes('fake-token-value-123456') && !r.text.includes('pk_1234567890'), r.text);
    const s = await call('assistant_status');
    assert.ok(!s.text.includes('fake-token-value-123456'));
    assert.equal(s.data.discord.allowed_server.name, 'Team Server');
    await close();
  });
});
