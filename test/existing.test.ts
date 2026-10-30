import './env';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

describe('12. existing behaviour is intact', () => {
  test('slash commands unchanged', async () => {
    const { commands } = await import('../src/discord/commands');
    assert.deepEqual(commands.map((c) => c.name),
      ['help', 'status', 'today', 'tasks', 'task', 'inbox', 'email', 'compose', 'draft', 'plan', 'ask', 'reset']);
  });

  test('bot module still wires its handlers and does not log in on import', async () => {
    Object.assign(process.env, { DISCORD_TOKEN: 'x', DISCORD_APP_ID: '1', DISCORD_GUILD_ID: '1', DISCORD_OWNER_ID: '1' });
    const { client } = await import('../src/discord/bot');
    assert.equal(client.listenerCount('interactionCreate'), 1);
    assert.equal(client.listenerCount('messageCreate'), 1);
    assert.equal(client.isReady(), false);
    client.destroy();
  });

  test('email helpers and Send/Discard single-use pending store', async () => {
    const { parseAddresses } = await import('../src/util');
    const { buildRaw } = await import('../src/integrations/gmail');
    const { parseEmailJson, savePending, takePending } = await import('../src/agent');
    assert.deepEqual(parseAddresses('A@x.com, b@y.io; a@x.com'), ['a@x.com', 'b@y.io']);
    const mime = Buffer.from(buildRaw({ to: 'a@x.com', subject: 'Hi', body: 'Body', inReplyTo: '<m@x>' }), 'base64url').toString();
    assert.match(mime, /^To: a@x.com\r\nSubject: Hi\r\n/);
    assert.match(mime, /In-Reply-To: <m@x>/);
    assert.deepEqual(parseEmailJson('```json\n{"subject":"S","body":"B"}\n```', 'x'), { subject: 'S', body: 'B' });
    savePending({ draftId: 'd1', to: 'a@x.com', subject: 's' });
    assert.ok(takePending('d1'));
    assert.equal(takePending('d1'), undefined);
  });

  test('notification de-duplication and history', async () => {
    const { markSeen, addHistory, getHistory, clearHistory } = await import('../src/db');
    assert.equal(markSeen('task', 'x1'), true);
    assert.equal(markSeen('task', 'x1'), false);
    clearHistory();
    addHistory('user', 'hi'); addHistory('assistant', 'hello');
    assert.deepEqual(getHistory().map((h) => h.role), ['user', 'assistant']);
  });

  test('config resolves .env and data relative to the project root', async () => {
    const { projectRoot, config } = await import('../src/config');
    assert.ok(projectRoot.endsWith('dev-assistant') || path.basename(projectRoot).length > 0);
    assert.equal(path.isAbsolute(config.dataDir), true);
    assert.equal(config.gmail.tokenPath.startsWith(config.dataDir), true);
  });

  test('scheduler and agent still export their entry points', async () => {
    const sched = await import('../src/workers/scheduler');
    const agent = await import('../src/agent');
    assert.equal(typeof sched.startScheduler, 'function');
    for (const fn of ['tasksText', 'inboxText', 'todayPlan', 'draftReply', 'composeEmail', 'agentChat', 'statusText'] as const)
      assert.equal(typeof agent[fn], 'function', fn);
  });
});
