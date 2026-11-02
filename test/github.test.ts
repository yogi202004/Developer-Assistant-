import './env';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Set before the modules load their config. QUIET_HOURS=0-0 means "never quiet", so the test passes at any hour.
Object.assign(process.env, { GITHUB_TOKEN: 'ghp_test_token', GITHUB_USER: 'yogeshhh191', GITHUB_REPOS: '', QUIET_HOURS: '0-0' });

const ME = 'yogeshhh191';
const pr = (id: number, number: number, author = ME, extra: Record<string, unknown> = {}) => ({
  id, number, title: `PR ${number}`, html_url: `https://github.com/acme/api/pull/${number}`, repository_url: 'https://api.github.com/repos/acme/api',
  user: { login: author }, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-02T10:00:00Z', comments: 0, labels: [], draft: false, ...extra,
});
const review = (id: number, user: string, state: string, body = '') => ({ id, user: { login: user }, state, body, submitted_at: '2026-11-02T09:00:00Z', html_url: `https://github.com/acme/api/pull/1#review-${id}` });

let state: { open: unknown[]; merged: unknown[]; reviews: Record<number, unknown[]> };
const requests: { url: string; method: string; auth: string }[] = [];
const realFetch = globalThis.fetch;

function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = String(input);
  requests.push({ url, method: init?.method ?? 'GET', auth: String((init?.headers as Record<string, string>)?.Authorization ?? '') });
  const body = (() => {
    if (url.includes('/search/issues')) return { items: decodeURIComponent(url).includes('is:merged') ? state.merged : state.open };
    const m = /\/pulls\/(\d+)\/reviews/.exec(url);
    if (m) return state.reviews[Number(m[1])] ?? [];
    return null;
  })();
  if (!body) return Promise.resolve(new Response('not found', { status: 404 }));
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

describe('17. GitHub (read-only, your PRs only)', () => {
  beforeEach(() => {
    state = { open: [], merged: [], reviews: {} };
    requests.length = 0;
    globalThis.fetch = fakeFetch as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  test('review decision uses each reviewer\'s latest verdict and ignores your own reviews', async () => {
    const { summarizeReviews } = await import('../src/integrations/github');
    const r = (id: number, user: string, s: string) => ({ id, user, state: s, body: '', submittedAt: null, url: '' });
    assert.equal(summarizeReviews([], ME).state, 'pending');
    assert.equal(summarizeReviews([r(1, 'alice', 'COMMENTED')], ME).state, 'commented');
    assert.equal(summarizeReviews([r(1, 'alice', 'CHANGES_REQUESTED'), r(2, 'alice', 'APPROVED')], ME).state, 'approved');
    assert.equal(summarizeReviews([r(1, 'alice', 'CHANGES_REQUESTED'), r(2, 'alice', 'DISMISSED')], ME).state, 'pending');
    assert.equal(summarizeReviews([r(1, ME, 'CHANGES_REQUESTED')], ME).state, 'pending', 'your own review never counts');
    const mixed = summarizeReviews([r(1, 'alice', 'APPROVED'), r(2, 'bob', 'CHANGES_REQUESTED')], ME);
    assert.equal(mixed.state, 'changes_requested');
    assert.deepEqual(mixed.changesBy, ['bob']);
    assert.deepEqual(mixed.approvedBy, ['alice']);
  });

  test('searches by author, only sends GET requests, and drops PRs by anyone else', async () => {
    const { listMyOpenPrs } = await import('../src/integrations/github');
    state.open = [pr(1, 1), pr(2, 2, 'someone-else')];
    const list = await listMyOpenPrs();
    assert.deepEqual(list.map((p) => p.number), [1]);
    assert.equal(list[0].repo, 'acme/api');
    assert.match(decodeURIComponent(requests[0].url), /author:yogeshhh191/);
    assert.ok(requests.every((r) => r.method === 'GET'));
    assert.ok(requests.every((r) => r.auth === 'Bearer ghp_test_token'));
  });

  test('alerts once for a merge and once per change request; first run only records', async () => {
    const { pollGitHub } = await import('../src/workers/scheduler');
    const { kvSet } = await import('../src/db');
    kvSet('github_seeded', '0');
    const sent: string[] = [];
    const notify = async (t: string) => { sent.push(t); };

    state.open = [pr(10, 1)];
    state.reviews[1] = [review(100, 'alice', 'CHANGES_REQUESTED', 'old feedback')];
    state.merged = [pr(20, 5, ME, { pull_request: { merged_at: '2026-11-01T12:00:00Z' } })];
    await pollGitHub(notify);
    assert.equal(sent.length, 0, 'existing PRs and reviews are not announced on the first run');

    state.reviews[1] = [
      review(100, 'alice', 'CHANGES_REQUESTED', 'old feedback'),
      review(101, 'bob', 'CHANGES_REQUESTED', 'Please add tests for the refresh path'),
      review(102, ME, 'CHANGES_REQUESTED', 'note to self'),
      review(103, 'carol', 'APPROVED'),
    ];
    state.open = [{ ...pr(10, 1), updated_at: '2026-11-02T11:00:00Z' }, pr(11, 2, 'someone-else')];
    state.reviews[2] = [review(200, 'alice', 'CHANGES_REQUESTED')];
    state.merged = [...state.merged, pr(21, 6, ME, { pull_request: { merged_at: '2026-11-02T12:00:00Z' } }), pr(22, 7, 'someone-else')];
    await pollGitHub(notify);

    assert.equal(sent.length, 2, sent.join('\n---\n'));
    assert.match(sent.find((s) => s.includes('merged')) ?? '', /acme\/api#6/);
    const changes = sent.find((s) => s.includes('Changes requested')) ?? '';
    assert.match(changes, /@bob/);
    assert.match(changes, /Please add tests/);
    assert.ok(!sent.some((s) => /someone-else|#7|#2\b|note to self/.test(s)), 'only your PRs, never your own reviews');

    await pollGitHub(notify);
    assert.equal(sent.length, 2, 'nothing is announced twice');
  });

  test('dashboard route returns PRs with review state and counts', async () => {
    const { liveRoutes } = await import('../src/dashboard/live-api');
    state.open = [pr(30, 8, ME, { updated_at: '2026-11-02T12:30:00Z' }), pr(31, 9, ME, { updated_at: '2026-11-02T12:31:00Z' })];
    state.reviews[8] = [review(300, 'bob', 'CHANGES_REQUESTED', 'rename this')];
    state.reviews[9] = [review(301, 'alice', 'APPROVED')];
    const r = await liveRoutes({ discordReady: () => false, startedAt: 1 })['GET /api/github']({}) as any;
    assert.equal(r.configured, true);
    assert.equal(r.user, ME);
    assert.deepEqual(r.counts, { open: 2, changes: 1, approved: 1, waiting: 0, merged: 0 });
    assert.equal(r.open[0].review.changes[0].body, 'rename this');
  });
});
