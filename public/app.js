import { md } from './render.js';
import { createDemoApi } from './demo-api.js';

// ---------- API ----------
function createLiveApi() {
  const req = async (method, path, body) => {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
    return data;
  };
  return {
    mode: 'live',
    session: () => req('GET', '/api/session'),
    status: () => req('GET', '/api/status'),
    tasks: () => req('GET', '/api/tasks'),
    breakdown: (id) => req('POST', '/api/tasks/breakdown', { id }),
    inbox: () => req('GET', '/api/inbox'),
    triage: () => req('POST', '/api/inbox/triage', {}),
    summary: (n) => req('POST', '/api/inbox/summary', { n }),
    draft: (n, instructions) => req('POST', '/api/inbox/draft', { n, instructions }),
    compose: (to, about, cc) => req('POST', '/api/compose', { to, about, cc }),
    outbox: () => req('GET', '/api/outbox'),
    send: (draftId) => req('POST', '/api/outbox/send', { draftId }),
    discard: (draftId) => req('POST', '/api/outbox/discard', { draftId }),
    today: () => req('GET', '/api/today'),
    refreshToday: () => req('POST', '/api/today', {}),
    chat: (text) => req('POST', '/api/chat', { text }),
    resetChat: () => req('POST', '/api/chat/reset', {}),
    activity: () => req('GET', '/api/activity'),
    logs: () => req('GET', '/api/logs'),
  };
}

/** Short-lived cache for reads, so the sidebar badges and the overview don't hit Gmail/ClickUp twice. */
function withCache(raw) {
  const TTL = 30_000;
  const cache = new Map();
  const cached = (name) => (force = false) => {
    const hit = cache.get(name);
    if (!force && hit && Date.now() - hit.at < TTL) return hit.promise;
    const promise = raw[name]();
    cache.set(name, { at: Date.now(), promise });
    promise.catch(() => cache.delete(name));
    return promise;
  };
  const invalidate = (...names) => { for (const n of names.length ? names : [...cache.keys()]) cache.delete(n); };
  const thenInvalidate = (fn, ...names) => async (...args) => { const r = await fn(...args); invalidate(...names); return r; };
  return {
    ...raw,
    invalidate,
    status: cached('status'),
    tasks: cached('tasks'),
    inbox: cached('inbox'),
    outbox: cached('outbox'),
    activity: cached('activity'),
    send: thenInvalidate(raw.send, 'outbox'),
    discard: thenInvalidate(raw.discard, 'outbox'),
    compose: thenInvalidate(raw.compose, 'outbox'),
    draft: thenInvalidate(raw.draft, 'outbox'),
    chat: thenInvalidate(raw.chat, 'outbox'),
  };
}

/** Live API when served by your Mac, demo when deployed as a static site (or with ?demo). */
async function pickApi() {
  const local = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  if (!local || new URLSearchParams(location.search).has('demo')) return createDemoApi();
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin' });
    if (res.status === 401) return 'locked';
    if (res.ok && (await res.json())?.mode === 'live') return createLiveApi();
  } catch { /* static hosting: no API */ }
  return createDemoApi();
}

// ---------- DOM helpers ----------
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // only ever given md() output or static icons
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const mdBlock = (text, cls = '') => h('div', { class: `md ${cls}`, html: md(text) });
const $ = (id) => document.getElementById(id);
const icon = (name, cls = '') => h('span', { class: `icon ${cls}`, html: ICONS[name] ?? '' });

const svg = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  today: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  tasks: svg('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  inbox: svg('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>'),
  compose: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  outbox: svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
  chat: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  activity: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  zap: svg('<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>'),
  alert: svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>'),
  calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  clock: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  mail: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>'),
  sparkle: svg('<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 3v4M17 5h4"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>'),
  close: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  send: svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  heart: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  bell: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  check: svg('<path d="M20 6L9 17l-5-5"/>'),
  terminal: svg('<path d="M4 17l6-5-6-5"/><path d="M12 19h8"/>'),
  shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'),
  eye: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>'),
  server: svg('<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>'),
};

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (ms) => new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
function dueLabel(due) {
  if (!due) return 'No due date';
  const now = Date.now();
  if (new Date(due).toDateString() === new Date(now).toDateString()) return `Due today ${fmtTime(due)}`;
  if (due < now) { const d = Math.max(1, Math.round((now - due) / 86_400_000)); return `${d} day${d > 1 ? 's' : ''} overdue`; }
  const tomorrow = new Date(now + 86_400_000).toDateString() === new Date(due).toDateString();
  return tomorrow ? `Due tomorrow ${fmtTime(due)}` : `Due ${fmtDay(due)}`;
}
const dueTone = (due) => (!due ? '' : due < Date.now() && new Date(due).toDateString() !== new Date().toDateString() ? 'red' : due - Date.now() < 86_400_000 * 1.5 ? 'orange' : '');
const senderName = (from) => from.replace(/<.*>/, '').trim().replace(/^"|"$/g, '') || from;

function avatar(name, cls = '') {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % 360;
  const el = h('span', { class: `avatar ${cls}` }, (name.trim()[0] ?? '?').toUpperCase());
  el.style.setProperty('--h', String(hash));
  return el;
}

function toast(text, kind = 'info') {
  const el = h('div', { class: `toast ${kind}` }, text);
  $('toasts').append(el);
  setTimeout(() => el.classList.add('hide'), 4200);
  setTimeout(() => el.remove(), 4800);
}

const spinner = (label = 'Loading…') => h('div', { class: 'loading' }, h('span', { class: 'spin' }), label);
const skeleton = (lines = 3) => h('div', { class: 'skeleton-group' }, Array.from({ length: lines }, (_, i) => h('div', { class: `skeleton${i === lines - 1 ? ' short' : ''}` })));
const empty = (title, text) => h('div', { class: 'empty' }, h('strong', null, title), text ? h('p', null, text) : null);
const errorBox = (e) => h('div', { class: 'error-box' }, e?.message ?? String(e));
const AI_WAIT = () => (api.mode === 'live' ? 'Thinking… the local AI model can take up to a minute.' : 'Thinking…');

/** Disables the button and shows a spinner while fn runs; errors become a toast. */
async function busy(btn, label, fn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.replaceChildren(h('span', { class: 'spin' }), label);
  try { return await fn(); } catch (e) { toast(e.message ?? String(e), 'error'); return undefined; } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

function openModal(title, body) {
  $('modal-title').textContent = title;
  $('modal-body').replaceChildren(body);
  $('modal').hidden = false;
}
function closeModal() { $('modal').hidden = true; }

function cardHead(title, iconName, ...extra) {
  return h('header', { class: 'card-head' }, h('h3', null, iconName ? icon(iconName) : null, title), h('div', { class: 'row' }, ...extra));
}

// ---------- Shared pieces ----------
function pendingCard(p, compact = false) {
  const card = h('article', { class: `card pending${compact ? ' compact' : ''}` });
  const result = h('div');
  const sendBtn = h('button', { class: 'btn primary small', type: 'button' }, icon('send'), 'Send');
  const discardBtn = h('button', { class: 'btn ghost small', type: 'button' }, 'Discard');
  const finish = (r) => {
    card.classList.add('done');
    card.replaceChildren(mdBlock(r.text));
    refreshBadges();
  };
  sendBtn.addEventListener('click', () => {
    if (!confirm(`Send this email to ${p.to}${p.cc ? ` (cc ${p.cc})` : ''}?`)) return;
    busy(sendBtn, 'Sending…', async () => {
      const r = await api.send(p.draftId);
      if (r.outcome === 'failed') { result.replaceChildren(mdBlock(r.text)); return; }
      finish(r);
    });
  });
  discardBtn.addEventListener('click', () => busy(discardBtn, 'Discarding…', async () => finish(await api.discard(p.draftId))));
  card.append(
    h('div', { class: 'pending-head' },
      h('span', { class: 'chip warn' }, icon('clock'), 'Waiting for you'),
      p.createdAt ? h('span', { class: 'muted small' }, ago(p.createdAt)) : null),
    h('dl', { class: 'meta' },
      h('dt', null, 'To'), h('dd', null, p.to),
      p.cc ? [h('dt', null, 'Cc'), h('dd', null, p.cc)] : null,
      h('dt', null, 'Subject'), h('dd', null, p.subject)),
    p.body ? h('pre', { class: 'email-body' }, p.body) : h('p', { class: 'muted' }, 'Open Gmail Drafts to see the full text.'),
    h('p', { class: 'muted small' }, api.mode === 'demo'
      ? 'Demo: clicking Send does not send anything.'
      : 'Saved as a Gmail draft. You can edit it in Gmail first; Send uses your latest edits.'),
    result,
    h('div', { class: 'row' }, sendBtn, discardBtn),
  );
  return card;
}

function replyBlock(r, compact = false) {
  const wrap = h('div', { class: 'stack' });
  if (r.text && !r.pending?.length) wrap.append(mdBlock(r.text));
  for (const p of r.pending ?? []) wrap.append(pendingCard(p, compact));
  return wrap;
}

async function openBreakdown(t) {
  const body = h('div', null, h('p', { class: 'muted small' }, AI_WAIT()), skeleton(6));
  openModal(t.name, body);
  try { body.replaceChildren(mdBlock((await api.breakdown(t.id)).text)); } catch (e) { body.replaceChildren(errorBox(e)); }
}

function setBadge(name, count) {
  const badge = document.querySelector(`[data-badge="${name}"]`);
  if (!badge) return;
  badge.textContent = count > 99 ? '99+' : String(count || '');
  badge.hidden = !count;
}

async function refreshBadges() {
  api.outbox().then((r) => setBadge('outbox', r.pending.length)).catch(() => {});
  api.tasks().then((r) => setBadge('tasks', r.configured ? r.counts.working : 0)).catch(() => {});
  api.inbox().then((r) => setBadge('inbox', r.configured ? r.emails.length : 0)).catch(() => {});
}

// ---------- Overview ----------
function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Working late' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}

async function viewToday(view, actions) {
  const planBtn = h('button', { class: 'btn primary', type: 'button' }, icon('sparkle'), 'Plan my day');
  actions.append(planBtn);

  const summary = h('p', { class: 'hero-summary' }, 'Loading your day…');
  const hero = h('section', { class: 'hero' },
    h('div', { class: 'hero-text' },
      h('p', { class: 'eyebrow' }, new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })),
      h('h2', null, `${greeting()}, ${session.name || 'there'}`),
      summary),
    h('div', { class: 'hero-actions' },
      h('a', { class: 'btn light', href: '#compose' }, icon('compose'), 'Write an email'),
      h('button', { class: 'btn glass', type: 'button', onclick: () => chat.open() }, icon('chat'), 'Ask assistant')));

  const stat = (key, label, iconName, tone, href) => {
    const value = h('span', { class: 'stat-value' }, h('span', { class: 'skeleton inline' }));
    const hint = h('span', { class: 'stat-hint' }, '');
    const el = h('a', { class: `stat ${tone}`, href },
      h('span', { class: 'stat-icon' }, icon(iconName)),
      h('span', { class: 'stat-body' }, value, h('span', { class: 'stat-label' }, label), hint));
    return { key, el, value, hint };
  };
  const stats = {
    working: stat('working', 'Working on', 'zap', 'purple', '#tasks'),
    overdue: stat('overdue', 'Overdue', 'alert', 'red', '#tasks'),
    today: stat('today', 'Due today', 'calendar', 'orange', '#tasks'),
    week: stat('week', 'Next 7 days', 'clock', 'yellow', '#tasks'),
    mail: stat('mail', 'Unread emails', 'mail', 'blue', '#inbox'),
    drafts: stat('drafts', 'Drafts waiting', 'outbox', 'green', '#outbox'),
  };

  const focus = h('div', null, skeleton(4));
  const mail = h('div', null, skeleton(4));
  const planBody = h('div', null, skeleton(6));
  const health = h('div', null, skeleton(2));
  const recent = h('div', null, skeleton(4));
  const counts = { focus: h('span', { class: 'panel-count' }), mail: h('span', { class: 'panel-count' }), recent: h('span', { class: 'panel-count' }), plan: h('span', { class: 'panel-meta' }), health: h('span', { class: 'panel-meta' }) };
  const more = (href, label) => h('a', { class: 'link-more', href }, label, icon('arrow'));

  view.append(
    hero,
    h('div', { class: 'stats' }, Object.values(stats).map((s) => s.el)),
    h('div', { class: 'bento' },
      panel('Focus now', 'zap', 'purple', focus, counts.focus, more('#tasks', 'All tasks')),
      panel('Inbox', 'mail', 'blue', mail, counts.mail, more('#inbox', 'Open inbox')),
      panel('Today\'s plan', 'sparkle', 'yellow', planBody, counts.plan),
      panel('Recent alerts', 'bell', 'orange', recent, counts.recent, more('#activity', 'Activity'))),
    panel('Assistant health', 'heart', 'green', health, counts.health, null, 'health-panel'),
  );

  const showPlan = (plan) => {
    counts.plan.textContent = plan ? `Generated ${ago(plan.ts)}` : '';
    planBody.replaceChildren(plan
      ? mdBlock(plan.text.replace(/^☀️ \*\*Plan for[^\n]*\n+/u, ''))
      : empty('No plan yet', 'Your plan arrives every weekday morning. Click "Plan my day" to make one now.'));
  };
  planBtn.addEventListener('click', () => busy(planBtn, 'Planning…', async () => {
    planBody.replaceChildren(h('p', { class: 'muted small' }, AI_WAIT()), skeleton(6));
    try { showPlan((await api.refreshToday()).plan); } catch (e) { planBody.replaceChildren(errorBox(e)); }
  }));

  const tasksP = api.tasks();
  const inboxP = api.inbox();
  const outboxP = api.outbox();

  api.today().then((r) => showPlan(r.plan)).catch((e) => planBody.replaceChildren(errorBox(e)));

  tasksP.then((r) => {
    if (!r.configured) {
      for (const k of ['working', 'overdue', 'today', 'week']) stats[k].value.textContent = '–';
      stats.working.hint.textContent = 'ClickUp not connected';
      focus.replaceChildren(empty('ClickUp is not connected', 'Add CLICKUP_TOKEN to .env.'));
      return;
    }
    for (const k of ['working', 'overdue', 'today', 'week']) stats[k].value.textContent = r.counts[k];
    stats.working.hint.textContent = `of ${r.counts.total} open`;
    counts.focus.textContent = String(r.working.length);
    const row = (t) => h('li', null,
      h('span', { class: `prio-dot ${t.priority ?? 'none'}`, title: t.priority ? `${t.priority} priority` : 'no priority' }),
      h('div', { class: 'grow' },
        h('a', { class: 'focus-name', href: t.url, target: '_blank', rel: 'noopener noreferrer', title: t.name }, t.name),
        h('div', { class: 'focus-meta' }, h('span', { class: 'chip' }, t.status), h('span', { class: `due ${dueTone(t.due)}` }, dueLabel(t.due)), t.list ? h('span', { class: 'muted' }, t.list) : null)),
      h('button', { class: 'btn small ghost icon-only', type: 'button', title: 'Break down into a checklist and a Cursor prompt', 'aria-label': `Break down ${t.name}`, onclick: () => openBreakdown(t) }, icon('sparkle')));
    const b = r.buckets ?? {};
    const upNext = [...(b.overdue ?? []), ...(b.today ?? []), ...(b.week ?? []), ...(b.later ?? [])].slice(0, 3);
    focus.replaceChildren(
      r.working.length ? h('ul', { class: 'focus-list' }, r.working.map(row)) : empty('Nothing in progress', 'Tasks you start in ClickUp show up here.'),
      upNext.length ? h('p', { class: 'list-label' }, 'Up next · not started') : null,
      upNext.length ? h('ul', { class: 'focus-list next' }, upNext.map(row)) : null);
  }).catch((e) => focus.replaceChildren(errorBox(e)));

  inboxP.then((r) => {
    stats.mail.value.textContent = r.configured ? r.emails.length : '–';
    if (!r.configured) { mail.replaceChildren(empty('Gmail is not connected', 'Run npm run gmail:auth.')); return; }
    counts.mail.textContent = String(r.emails.length);
    mail.replaceChildren(r.emails.length
      ? h('ul', { class: 'mail-list' }, r.emails.slice(0, 12).map((e) => h('li', null,
        h('a', { href: '#inbox', class: 'mail-row' },
          avatar(senderName(e.from), 'small'),
          h('div', { class: 'grow' },
            h('div', { class: 'mail-top' }, h('strong', { class: 'ellipsis' }, senderName(e.from)), h('span', { class: 'muted small' }, `#${e.n}`)),
            h('div', { class: 'mail-subject' }, e.subject))))))
      : empty('Inbox zero', 'No unread email right now.'));
    if (r.emails.length > 12) mail.append(h('a', { class: 'link-more more', href: '#inbox' }, `+ ${r.emails.length - 12} more in Inbox`));
  }).catch((e) => mail.replaceChildren(errorBox(e)));

  outboxP.then((r) => { stats.drafts.value.textContent = r.pending.length; stats.drafts.hint.textContent = r.pending.length ? 'need your Send' : 'all clear'; }).catch(() => {});

  Promise.allSettled([tasksP, inboxP, outboxP]).then(([t, i, o]) => {
    const parts = [];
    if (t.value?.configured) {
      const c = t.value.counts;
      parts.push(`You're working on ${c.working} task${c.working === 1 ? '' : 's'}`);
      if (c.overdue) parts.push(`${c.overdue} overdue`);
      if (c.today) parts.push(`${c.today} due today`);
    }
    if (i.value?.configured) parts.push(`${i.value.emails.length} unread email${i.value.emails.length === 1 ? '' : 's'}`);
    if (o.value?.pending.length) parts.push(`${o.value.pending.length} draft${o.value.pending.length === 1 ? '' : 's'} waiting for you`);
    summary.textContent = parts.length ? `${parts.join(' · ')}.` : 'Connect ClickUp and Gmail to see your day here.';
  });

  api.status().then((s) => {
    counts.health.textContent = `Running since ${ago(s.startedAt)} · quiet hours ${s.quietHours} · ${s.timezone}`;
    health.replaceChildren(healthTiles(s));
  }).catch((e) => health.replaceChildren(errorBox(e)));
  api.activity().then(({ items }) => {
    counts.recent.textContent = String(items.length);
    recent.replaceChildren(items.length
      ? h('ul', { class: 'recent-list' }, items.slice(0, 15).map((i) => {
        const cat = categorize(i.text);
        const alarming = /^(🔴|⚠️)/u.test(i.text.trimStart());
        return h('li', { class: `cat-${cat}${alarming ? ' alarming' : ''}` },
          h('span', { class: 'recent-icon' }, icon(alarming ? 'alert' : CATEGORIES[cat].icon)),
          h('div', { class: 'grow' },
            mdBlock(i.text.split('\n')[0].replace(LEADING_EMOJI, ''), 'recent-title'),
            h('span', { class: 'muted small' }, `${CATEGORIES[cat].label} · ${ago(i.ts)}`)));
      }))
      : empty('No alerts yet', 'New tasks, due dates and emails appear here.'));
  }).catch((e) => recent.replaceChildren(errorBox(e)));
}

/** Uniform card: icon + title + optional count/meta on the left, links on the right, scrolling body. */
function panel(title, iconName, tone, body, meta, link, cls = '') {
  return h('article', { class: `panel tone-${tone} ${cls}` },
    h('header', { class: 'panel-head' },
      h('span', { class: 'panel-icon' }, icon(iconName)),
      h('h3', null, title), meta,
      link ? h('span', { class: 'panel-link' }, link) : null),
    h('div', { class: 'panel-body' }, body));
}

function healthTiles(s) {
  const tile = (iconName, label, ok, detail) => h('div', { class: `health-tile ${ok ? 'ok' : 'bad'}` },
    h('span', { class: 'health-icon' }, icon(iconName)),
    h('div', { class: 'grow' }, h('strong', null, label), h('span', { class: 'small' }, h('span', { class: `dot ${ok ? 'ok' : 'bad'}` }), detail)));
  const jobs = s.jobs ?? [];
  return h('div', null,
    h('p', { class: 'list-label first' }, 'Connections'),
    h('div', { class: 'health-grid' },
      tile('sparkle', 'AI model', !s.ollama, s.ollama ? 'Not reachable' : `${s.model} · local`),
      tile('tasks', 'ClickUp', s.clickup, s.clickup ? 'Connected' : 'Not connected'),
      tile('mail', 'Gmail', s.gmail, s.gmail ? 'Connected' : 'Not connected'),
      tile('chat', 'Discord bot', s.discord, s.discord ? 'Online' : 'Offline')),
    jobs.length ? h('p', { class: 'list-label' }, 'Background checks') : null,
    jobs.length ? h('div', { class: 'health-grid' }, jobs.map((j) => tile(j.ok ? 'refresh' : 'alert', j.name, j.ok, `${j.ok ? 'OK' : 'Failed'} · ${ago(j.lastRun)}`))) : null,
    s.ollama ? h('p', { class: 'error-box small' }, s.ollama) : null,
    ...(s.jobs ?? []).filter((j) => !j.ok && j.error).map((j) => h('p', { class: 'error-box small' }, `${j.name}: ${j.error}`)));
}

// ---------- Tasks ----------
async function viewTasks(view, actions) {
  const search = h('input', { type: 'search', placeholder: 'Filter tasks…', class: 'search', 'aria-label': 'Filter tasks' });
  const reload = h('button', { class: 'btn ghost icon-btn', type: 'button', title: 'Refresh', 'aria-label': 'Refresh' }, icon('refresh'));
  actions.append(h('label', { class: 'search-wrap' }, icon('search'), search), reload);
  const note = h('p', { class: 'muted small' });
  const board = h('div', { class: 'board' }, skeleton(5));
  view.append(note, board);

  const columns = [
    ['working', 'Working on', 'purple'],
    ['overdue', 'Overdue', 'red'], ['today', 'Due today', 'orange'], ['week', 'Next 7 days', 'yellow'], ['later', 'Later', 'gray'], ['none', 'No due date', 'gray'],
  ];
  const taskCard = (t) => h('article', { class: `task prio-${t.priority ?? 'none'}` },
    h('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer', class: 'task-name' }, t.name),
    h('div', { class: 'task-meta' },
      t.priority ? h('span', { class: `chip prio-${t.priority}` }, t.priority) : null,
      h('span', { class: 'chip' }, t.status),
      t.list ? h('span', { class: 'muted small' }, t.list) : null),
    h('div', { class: 'task-foot' },
      h('span', { class: `due ${dueTone(t.due)}` }, icon('clock'), dueLabel(t.due)),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => openBreakdown(t) }, icon('sparkle'), 'Break down')));

  let data = null;
  const render = () => {
    if (!data) return;
    const q = search.value.trim().toLowerCase();
    const match = (t) => !q || t.name.toLowerCase().includes(q) || (t.list ?? '').toLowerCase().includes(q);
    const lists = Object.fromEntries(Object.entries({ working: data.working, ...data.buckets }).map(([k, v]) => [k, v.filter(match)]));
    const notStarted = data.counts.total - data.counts.working;
    note.textContent = `${data.counts.total} open tasks assigned to you: ${data.counts.working} you're working on and ${notStarted} not started yet. The date columns only show tasks you haven't started.`;
    board.replaceChildren(...columns
      .filter(([k]) => k === 'working' || lists[k].length || (!q && notStarted && ['overdue', 'today', 'week'].includes(k)))
      .map(([k, label, color]) => h('section', { class: `column${k === 'working' ? ' working' : ''}` },
        h('header', null, h('span', { class: `dot ${color}` }), label, h('span', { class: 'count' }, lists[k].length)),
        lists[k].length ? lists[k].map(taskCard) : h('p', { class: 'muted small pad' }, k === 'working' ? (q ? 'No match.' : 'Nothing in progress.') : 'Nothing here.'))));
  };

  const load = async (force = false) => {
    board.replaceChildren(skeleton(5));
    try {
      const r = await api.tasks(force);
      if (!r.configured) { board.replaceChildren(empty('ClickUp is not connected', 'Add CLICKUP_TOKEN to .env and restart the assistant.')); return; }
      data = r;
      render();
    } catch (e) { board.replaceChildren(errorBox(e)); }
  };
  search.addEventListener('input', render);
  reload.addEventListener('click', () => load(true));
  await load();
}

// ---------- Inbox ----------
async function viewInbox(view, actions) {
  const triageBtn = h('button', { class: 'btn primary', type: 'button' }, icon('sparkle'), 'AI triage');
  const reload = h('button', { class: 'btn ghost icon-btn', type: 'button', title: 'Refresh', 'aria-label': 'Refresh' }, icon('refresh'));
  actions.append(triageBtn, reload);
  const triageBox = h('div');
  const list = h('div', { class: 'stack' }, skeleton(5));
  view.append(triageBox, list);

  triageBtn.addEventListener('click', () => busy(triageBtn, 'Reading your inbox…', async () => {
    const r = await api.triage();
    triageBox.replaceChildren(h('article', { class: 'card highlight' }, cardHead('AI triage', 'sparkle'), mdBlock(r.text)));
  }));

  const emailRow = (e) => {
    const out = h('div');
    const name = senderName(e.from);
    const sumBtn = h('button', { class: 'btn small ghost', type: 'button' }, 'Summarize');
    const replyBtn = h('button', { class: 'btn small ghost', type: 'button' }, 'Draft reply');
    sumBtn.addEventListener('click', () => busy(sumBtn, 'Reading…', async () => {
      out.replaceChildren(mdBlock((await api.summary(e.n)).text, 'inset'));
    }));
    replyBtn.addEventListener('click', () => {
      const input = h('input', { type: 'text', placeholder: 'How should I reply? e.g. "say yes, Friday works" (optional)', maxlength: '2000' });
      const go = h('button', { class: 'btn primary small', type: 'submit' }, 'Write reply');
      const form = h('form', { class: 'inline-form' }, input, go);
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        busy(go, AI_WAIT(), async () => { out.replaceChildren(replyBlock(await api.draft(e.n, input.value))); refreshBadges(); });
      });
      out.replaceChildren(form);
      input.focus();
    });
    return h('article', { class: 'card email' },
      h('div', { class: 'email-head' },
        avatar(name),
        h('div', { class: 'grow' },
          h('div', { class: 'email-from' }, h('strong', null, name), h('span', { class: 'muted small' }, `#${e.n}`)),
          h('div', { class: 'email-subject' }, e.subject),
          h('div', { class: 'muted small clamp' }, e.snippet))),
      h('div', { class: 'row' }, sumBtn, replyBtn,
        api.mode === 'live' ? h('a', { class: 'btn ghost small', href: e.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open in Gmail') : null),
      out);
  };

  const load = async (force = false) => {
    list.replaceChildren(skeleton(5));
    try {
      const r = await api.inbox(force);
      if (!r.configured) { list.replaceChildren(empty('Gmail is not connected', 'Run npm run gmail:auth on your Mac, then restart the assistant.')); return; }
      list.replaceChildren(...(r.emails.length ? r.emails.map(emailRow) : [empty('Inbox zero', `No emails match "${r.query}".`)]));
    } catch (e) { list.replaceChildren(errorBox(e)); }
  };
  reload.addEventListener('click', () => load(true));
  await load();
}

// ---------- Compose & Outbox ----------
async function viewCompose(view) {
  const to = h('input', { type: 'text', placeholder: 'ravi@acme.com', required: true, maxlength: '1000', autocomplete: 'off' });
  const cc = h('input', { type: 'text', placeholder: 'optional', maxlength: '1000', autocomplete: 'off' });
  const about = h('textarea', { rows: '5', required: true, maxlength: '4000', placeholder: 'Tell him the demo is ready and ask for a 30-minute call on Thursday.' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, icon('sparkle'), 'Write email');
  const out = h('div', { class: 'stack' }, h('div', { class: 'card ghost-card' }, empty('Your draft appears here', 'Review it, then click Send. Nothing is sent before that.')));
  const form = h('form', { class: 'card form' },
    cardHead('New email', 'compose'),
    h('label', null, 'To', to), h('label', null, 'Cc', cc), h('label', null, 'What should it say?', about),
    h('div', { class: 'row' }, submit, h('span', { class: 'muted small' }, 'The AI writes it; you approve it.')));
  let first = true;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(submit, AI_WAIT(), async () => {
      const block = replyBlock(await api.compose(to.value, about.value, cc.value));
      if (first) { out.replaceChildren(); first = false; }
      out.prepend(block);
      refreshBadges();
    });
  });
  view.append(h('div', { class: 'grid-2 even' }, form, out));
}

const handledDrafts = []; // emails sent or discarded during this visit, newest first

const refreshBtn = () => h('button', { class: 'btn ghost icon-btn', type: 'button', title: 'Refresh', 'aria-label': 'Refresh' }, icon('refresh'));

function emptyState(iconName, title, text, ...buttons) {
  return h('div', { class: 'empty-state' },
    h('span', { class: 'empty-icon' }, icon(iconName)),
    h('h3', null, title), h('p', { class: 'muted' }, text),
    buttons.length ? h('div', { class: 'row wrap center' }, ...buttons) : null);
}

async function viewOutbox(view, actions) {
  const reload = refreshBtn();
  actions.append(reload);

  const steps = h('section', { class: 'flow' },
    ...[
      ['compose', 'Drafted', 'By you, the AI, Discord or Cursor. Saved in Gmail Drafts.'],
      ['eye', 'You review', 'Read it here, or edit it in Gmail first.'],
      ['shield', 'You send', 'Only when you click Send and confirm. Each draft sends once.'],
    ].map(([ic, title, text], i) => h('div', { class: 'flow-step' },
      h('span', { class: 'flow-num' }, icon(ic)),
      h('div', null, h('strong', null, `${i + 1}. ${title}`), h('p', { class: 'muted small' }, text)))));
  const body = h('div', null, h('div', { class: 'card' }, skeleton(5)));
  view.append(steps, body);

  let pending = [];
  let selected = null;

  const handledCard = () => (handledDrafts.length
    ? h('article', { class: 'card' }, cardHead('Handled this visit', 'check'),
      h('ul', { class: 'handled-list' }, handledDrafts.map((d) => h('li', null,
        h('span', { class: `chip ${d.sent ? 'ok' : ''}` }, d.sent ? 'Sent' : 'Discarded'),
        h('span', { class: 'grow ellipsis' }, h('strong', null, d.subject), h('span', { class: 'muted' }, ` · ${senderName(d.to)}`)),
        h('span', { class: 'muted small' }, fmtTime(d.at))))))
    : null);

  const handle = (p, r) => {
    handledDrafts.unshift({ subject: p.subject, to: p.to, sent: r.outcome === 'sent', at: Date.now() });
    pending = pending.filter((x) => x.draftId !== p.draftId);
    selected = pending[0]?.draftId ?? null;
    toast(r.outcome === 'sent' ? `Sent to ${senderName(p.to)}` : r.outcome === 'discarded' ? 'Draft discarded' : r.text.replace(/[*_`]/g, ''));
    refreshBadges();
    render();
  };

  const preview = (p) => {
    const result = h('div');
    const sendBtn = h('button', { class: 'btn primary', type: 'button' }, icon('send'), 'Send email');
    const discardBtn = h('button', { class: 'btn danger', type: 'button' }, icon('trash'), 'Discard');
    const copyBtn = h('button', { class: 'btn ghost', type: 'button' }, icon('copy'), 'Copy text');
    sendBtn.addEventListener('click', () => {
      if (!confirm(`Send this email to ${p.to}${p.cc ? ` (cc ${p.cc})` : ''}?`)) return;
      busy(sendBtn, 'Sending…', async () => {
        const r = await api.send(p.draftId);
        if (r.outcome === 'failed') result.replaceChildren(h('div', { class: 'error-box' }, r.text.replace(/[*_`]/g, '')));
        else handle(p, r);
      });
    });
    discardBtn.addEventListener('click', () => {
      if (!confirm('Discard this draft? It is also deleted from Gmail Drafts.')) return;
      busy(discardBtn, 'Discarding…', async () => handle(p, await api.discard(p.draftId)));
    });
    copyBtn.addEventListener('click', () => navigator.clipboard.writeText(p.body ?? '')
      .then(() => toast('Email text copied')).catch(() => toast('Copy failed', 'error')));

    return h('article', { class: 'card mail-preview' },
      h('header', { class: 'mail-preview-head' },
        h('div', { class: 'row' },
          h('span', { class: 'chip warn' }, icon('clock'), 'Waiting for you'),
          p.createdAt ? h('span', { class: 'muted small' }, `Drafted ${ago(p.createdAt)}`) : null),
        h('h2', null, p.subject || '(no subject)'),
        h('div', { class: 'mail-to' },
          avatar(senderName(p.to)),
          h('dl', { class: 'meta' },
            h('dt', null, 'To'), h('dd', null, p.to),
            p.cc ? [h('dt', null, 'Cc'), h('dd', null, p.cc)] : null,
            h('dt', null, 'From'), h('dd', null, api.mode === 'demo' ? 'you@example.com' : 'Your Gmail account')))),
      p.body
        ? h('div', { class: 'paper' }, p.body)
        : h('div', { class: 'paper muted' }, 'The full text is in Gmail Drafts.'),
      result,
      h('footer', { class: 'mail-preview-foot' },
        h('div', { class: 'row wrap' }, sendBtn, discardBtn, p.body ? copyBtn : null),
        h('p', { class: 'muted small' }, api.mode === 'demo'
          ? 'Demo: Send does not send anything.'
          : 'Edited it in Gmail? Send uses your latest version.')));
  };

  const render = () => {
    if (!pending.length) {
      body.replaceChildren(h('div', { class: 'stack' },
        h('article', { class: 'card' }, emptyState('check', 'Outbox is clear',
          'Emails you write from Compose, Inbox, the chat, Discord or Cursor wait here until you send or discard them.',
          h('a', { class: 'btn primary', href: '#compose' }, icon('compose'), 'Write an email'),
          h('a', { class: 'btn ghost', href: '#inbox' }, icon('inbox'), 'Open inbox'))),
        handledCard()));
      return;
    }
    const current = pending.find((p) => p.draftId === selected) ?? pending[0];
    selected = current.draftId;
    const list = h('div', { class: 'draft-list', role: 'list' }, pending.map((p) => h('button', {
      class: `draft${p.draftId === selected ? ' active' : ''}`, type: 'button', role: 'listitem',
      onclick: () => {
        selected = p.draftId;
        render();
        if (matchMedia('(max-width: 1100px)').matches) body.querySelector('.mail-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    },
    avatar(senderName(p.to), 'small'),
    h('span', { class: 'grow' },
      h('span', { class: 'draft-top' }, h('strong', { class: 'ellipsis' }, senderName(p.to)), p.createdAt ? h('span', { class: 'muted small' }, ago(p.createdAt)) : null),
      h('span', { class: 'draft-subject ellipsis' }, p.subject || '(no subject)'),
      p.body ? h('span', { class: 'draft-snippet ellipsis' }, p.body.replace(/\s+/g, ' ').slice(0, 120)) : null))));
    const oldest = Math.min(...pending.map((p) => p.createdAt ?? Date.now()));
    body.replaceChildren(h('div', { class: 'outbox-layout' },
      h('aside', { class: 'stack' },
        h('article', { class: 'card list-card' },
          cardHead(`${pending.length} waiting`, 'outbox', h('span', { class: 'muted small' }, `oldest ${ago(oldest)}`)),
          list),
        handledCard()),
      preview(current)));
  };

  const load = async (force = false) => {
    try {
      pending = (await api.outbox(force)).pending;
      render();
    } catch (e) { body.replaceChildren(h('div', { class: 'card' }, errorBox(e))); }
  };
  reload.addEventListener('click', () => load(true));
  await load();
}

// ---------- Activity ----------
const CATEGORIES = {
  task: { label: 'Tasks', icon: 'tasks' },
  email: { label: 'Email', icon: 'mail' },
  plan: { label: 'Plans', icon: 'sparkle' },
  system: { label: 'System', icon: 'server' },
};
const LEADING_EMOJI = /^\p{Extended_Pictographic}\uFE0F?\s*/u;

function categorize(text) {
  const first = text.trimStart();
  if (/^(📧|📬|📤)/u.test(first) || /more new emails/i.test(first)) return 'email';
  if (/^☀️/u.test(first) || /^\W*\*\*Plan for/i.test(first)) return 'plan';
  if (/^(🆕|⏳|🔴|✅)/u.test(first)) return 'task';
  return 'system';
}

function dayLabel(ts) {
  const d = new Date(ts).toDateString();
  if (d === new Date().toDateString()) return 'Today';
  if (d === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday';
  return new Date(ts).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

function eventItem(item) {
  const cat = categorize(item.text);
  const [first, ...rest] = item.text.split('\n');
  const alarming = /^(🔴|⚠️)/u.test(item.text.trimStart());
  const detail = rest.join('\n').trim();
  const more = detail.split('\n').length > 3 || detail.length > 260;
  const bodyEl = detail ? mdBlock(detail, `event-body${more ? ' collapsed' : ''}`) : null;
  const toggle = more ? h('button', { class: 'link-btn', type: 'button' }, 'Show more') : null;
  toggle?.addEventListener('click', () => {
    const open = bodyEl.classList.toggle('collapsed');
    toggle.textContent = open ? 'Show more' : 'Show less';
  });
  return h('li', { class: `event cat-${cat}${alarming ? ' alarming' : ''}` },
    h('span', { class: 'event-icon' }, icon(alarming ? 'alert' : CATEGORIES[cat].icon)),
    h('div', { class: 'event-main' },
      h('div', { class: 'event-head' },
        mdBlock(first.replace(LEADING_EMOJI, ''), 'event-title'),
        h('time', { class: 'muted small', title: new Date(item.ts).toLocaleString() }, fmtTime(item.ts))),
      bodyEl, toggle));
}

const ISO_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+/;

function logLine(line) {
  const cls = /error|fail|✖|ERR/i.test(line) ? 'err' : /warn|⚠/i.test(line) ? 'warn' : /online|starting|started|logged in|ok\b|✓|✅/i.test(line) ? 'good' : '';
  const m = ISO_PREFIX.exec(line);
  return h('div', { class: `log-line ${cls}` },
    m ? h('span', { class: 'log-ts', title: m[1] }, new Date(m[1]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })) : null,
    m ? line.slice(m[0].length) : line || ' ');
}

async function viewActivity(view, actions) {
  const reload = refreshBtn();
  actions.append(reload);

  const statEls = {};
  const miniStat = (key, label, iconName, tone) => {
    const value = h('strong', null, h('span', { class: 'skeleton inline' }));
    const hint = h('span', { class: 'muted small' }, '');
    statEls[key] = { value, hint };
    return h('div', { class: `mini-stat ${tone}` }, h('span', { class: 'stat-icon' }, icon(iconName)), h('div', null, value, h('span', { class: 'mini-label' }, label), hint));
  };
  let filter = 'all';
  let items = [];
  const filters = h('div', { class: 'filters', role: 'tablist' });
  const feed = h('div', { class: 'feed' }, skeleton(6));
  const jobsBody = h('div', null, skeleton(3));
  const logBody = h('div', { class: 'terminal-body' }, skeleton(4));
  let errorsOnly = false;
  let logText = '';
  const errorsBtn = h('button', { class: 'term-btn', type: 'button', 'aria-pressed': 'false' }, 'Errors only');
  const copyLog = h('button', { class: 'term-btn', type: 'button', title: 'Copy log' }, icon('copy'));

  view.append(
    h('div', { class: 'mini-stats' },
      miniStat('today', 'Alerts today', 'bell', 'purple'),
      miniStat('week', 'Last 7 days', 'calendar', 'blue'),
      miniStat('jobs', 'Background checks', 'shield', 'green'),
      miniStat('uptime', 'Running for', 'clock', 'yellow')),
    h('div', { class: 'grid-2' },
      h('article', { class: 'card' }, cardHead('Timeline', 'bell', filters), feed),
      h('div', { class: 'stack' },
        h('article', { class: 'card' }, cardHead('Background jobs', 'server'), jobsBody),
        h('article', { class: 'terminal' },
          h('header', { class: 'terminal-head' },
            h('span', { class: 'lights' }, h('i'), h('i'), h('i')),
            h('span', { class: 'grow terminal-title' }, icon('terminal'), 'assistant.log'),
            errorsBtn, copyLog),
          logBody))));

  const renderFeed = () => {
    const counts = { all: items.length };
    for (const i of items) { const c = categorize(i.text); counts[c] = (counts[c] ?? 0) + 1; }
    filters.replaceChildren(...[['all', 'All'], ...Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])]
      .map(([k, label]) => h('button', { class: `filter${filter === k ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(filter === k), onclick: () => { filter = k; renderFeed(); } },
        label, h('span', { class: 'filter-count' }, String(counts[k] ?? 0)))));
    const shown = items.filter((i) => filter === 'all' || categorize(i.text) === filter);
    if (!shown.length) {
      feed.replaceChildren(emptyState('bell', items.length ? 'Nothing in this category' : 'No alerts yet',
        'New tasks, due dates, important emails and your morning plan show up here as the assistant finds them.'));
      return;
    }
    const days = new Map();
    for (const i of shown) { const d = dayLabel(i.ts); if (!days.has(d)) days.set(d, []); days.get(d).push(i); }
    feed.replaceChildren(...[...days].map(([day, list]) => h('section', { class: 'day' },
      h('h4', { class: 'day-label' }, day, h('span', { class: 'muted' }, ` · ${list.length}`)),
      h('ol', { class: 'events' }, list.map(eventItem)))));
  };

  const renderLog = () => {
    const lines = logText.split('\n').slice(-400).filter((l) => !errorsOnly || /error|fail|warn|✖|⚠/i.test(l));
    logBody.replaceChildren(...(lines.length ? lines.map(logLine) : [h('div', { class: 'log-line' }, errorsOnly ? 'No errors or warnings. 🎉' : 'Empty log.')]));
    logBody.scrollTop = logBody.scrollHeight;
  };
  errorsBtn.addEventListener('click', () => {
    errorsOnly = !errorsOnly;
    errorsBtn.setAttribute('aria-pressed', String(errorsOnly));
    errorsBtn.classList.toggle('on', errorsOnly);
    renderLog();
  });
  copyLog.addEventListener('click', () => navigator.clipboard.writeText(logText)
    .then(() => toast('Log copied')).catch(() => toast('Copy failed', 'error')));

  const load = async (force = false) => {
    const [activity, status, logs] = await Promise.allSettled([api.activity(force), api.status(force), api.logs()]);
    if (activity.status === 'fulfilled') {
      const fresh = activity.value.items;
      const changed = fresh.map((i) => i.ts).join() !== items.map((i) => i.ts).join() || !feed.querySelector('.events, .empty-state');
      items = fresh;
      const dayStart = new Date().setHours(0, 0, 0, 0);
      statEls.today.value.textContent = String(items.filter((i) => i.ts >= dayStart).length);
      statEls.today.hint.textContent = items[0] ? `latest ${ago(items[0].ts)}` : 'none yet';
      statEls.week.value.textContent = String(items.filter((i) => i.ts >= Date.now() - 7 * 86_400_000).length);
      statEls.week.hint.textContent = `${items.filter((i) => categorize(i.text) === 'email').length} about email`;
      if (changed) renderFeed();
    } else feed.replaceChildren(errorBox(activity.reason));

    if (status.status === 'fulfilled') {
      const s = status.value;
      const jobs = s.jobs ?? [];
      const okCount = jobs.filter((j) => j.ok).length;
      statEls.jobs.value.textContent = jobs.length ? `${okCount}/${jobs.length}` : '–';
      statEls.jobs.hint.textContent = !jobs.length ? 'no runs yet' : okCount === jobs.length ? 'all healthy' : 'needs attention';
      statEls.uptime.value.textContent = ago(s.startedAt).replace(' ago', '').replace('just now', '<1 min');
      statEls.uptime.hint.textContent = `since ${fmtTime(s.startedAt)}`;
      jobsBody.replaceChildren(jobs.length
        ? h('ul', { class: 'jobs' }, jobs.map((j) => h('li', { class: j.ok ? 'ok' : 'bad' },
          h('span', { class: 'job-icon' }, icon(j.ok ? 'check' : 'alert')),
          h('div', { class: 'grow' },
            h('strong', null, j.name),
            h('span', { class: 'muted small' }, `${j.ok ? 'Last run' : 'Failed'} ${ago(j.lastRun)}`),
            !j.ok && j.error ? h('p', { class: 'job-error' }, j.error) : null),
          h('span', { class: `chip ${j.ok ? 'ok' : 'bad'}` }, j.ok ? 'Healthy' : 'Failed'))))
        : emptyState('server', 'No runs yet', 'ClickUp and Gmail checks appear here after their first run.'),
      h('p', { class: 'muted small jobs-foot' }, `Quiet hours ${s.quietHours} · ${s.timezone} · AI model ${s.model}${s.ollama ? ' (offline)' : ''}`));
    } else jobsBody.replaceChildren(errorBox(status.reason));

    if (logs.status === 'fulfilled' && logs.value?.text) {
      if (logs.value.text !== logText) { logText = logs.value.text; renderLog(); }
    } else if (logs.status === 'fulfilled') {
      logBody.replaceChildren(h('div', { class: 'log-line' }, `No log yet. It is written to ${logs.value?.path ?? 'data/logs/assistant.log'} once the background service runs (npm run service:install).`));
    } else logBody.replaceChildren(h('div', { class: 'log-line err' }, logs.reason?.message ?? 'Could not read the log.'));
  };
  reload.addEventListener('click', () => load(true));
  await load();
  return setInterval(() => load(true), 30_000);
}

// ---------- Floating chat widget ----------
function createChatWidget() {
  const STORE = `dev-assistant-chat-${api.mode}`;
  let messages = [];
  try { messages = JSON.parse(sessionStorage.getItem(STORE) ?? '[]'); } catch { messages = []; }
  const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-40))); } catch { /* storage full */ } };
  let isOpen = false;
  let sending = false;

  const unread = h('span', { class: 'launcher-dot', hidden: true });
  const launcher = h('button', { class: 'chat-launcher', type: 'button', 'aria-label': 'Open chat assistant', title: 'Ask your assistant (⌘K)' },
    h('span', { class: 'launcher-icon open-icon', html: ICONS.chat }), h('span', { class: 'launcher-icon close-icon', html: ICONS.close }), unread);
  const statusText = h('span', null, api.mode === 'demo' ? 'Demo · sample data' : 'Connecting…');
  const statusDot = h('span', { class: 'dot ok' });
  const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  const input = h('textarea', { rows: '1', maxlength: '4000', placeholder: 'Ask about your tasks, email or day…', 'aria-label': 'Message' });
  const sendBtn = h('button', { class: 'chat-send', type: 'submit', 'aria-label': 'Send', html: ICONS.send });
  const form = h('form', { class: 'chat-form' }, input, sendBtn);
  const suggestions = h('div', { class: 'chat-suggest' });
  const clearBtn = h('button', { class: 'chat-head-btn', type: 'button', title: 'Clear chat memory', 'aria-label': 'Clear chat memory', html: ICONS.trash });
  const closeBtn = h('button', { class: 'chat-head-btn', type: 'button', title: 'Close', 'aria-label': 'Close chat', html: ICONS.close });
  const panel = h('section', { class: 'chat-panel', role: 'dialog', 'aria-label': 'Chat with your assistant', hidden: true },
    h('header', { class: 'chat-head' },
      h('img', { src: '/favicon.svg', alt: '', class: 'chat-head-avatar', width: '38', height: '38' }),
      h('div', { class: 'grow' }, h('strong', null, 'Dev Assistant'), h('span', { class: 'chat-status' }, statusDot, statusText)),
      clearBtn, closeBtn),
    log, suggestions, form,
    h('p', { class: 'chat-foot' }, api.mode === 'demo' ? 'Demo: answers use sample data.' : 'Private · runs on your Mac · emails send only when you click Send'));
  document.body.append(panel, launcher);

  const SUGGEST = ['What am I working on?', 'Plan my day', 'Which emails need a reply?', 'What\'s overdue?'];
  const time = (ts) => (ts ? h('span', { class: 'msg-time' }, fmtTime(ts)) : null);
  const bubble = (m) => (m.role === 'user'
    ? h('div', { class: 'msg user' }, h('div', { class: 'msg-bubble' }, m.text), time(m.ts))
    : h('div', { class: 'msg assistant' }, h('img', { src: '/favicon.svg', alt: '', class: 'msg-avatar', width: '26', height: '26' }),
      h('div', { class: 'msg-col' }, h('div', { class: 'msg-bubble' }, replyBlock(m.reply, true)), time(m.ts))));
  const typing = () => h('div', { class: 'msg assistant' }, h('img', { src: '/favicon.svg', alt: '', class: 'msg-avatar', width: '26', height: '26' }),
    h('div', { class: 'msg-bubble typing' }, h('span'), h('span'), h('span')));

  const render = () => {
    const welcome = {
      role: 'assistant',
      reply: { text: `Hi ${session.name || 'there'} 👋 I can see your ClickUp tasks and Gmail. Ask me what you're working on, to plan your day, or to draft an email. You approve every email before it's sent.` },
    };
    log.replaceChildren(...[welcome, ...messages].map(bubble), ...(sending ? [typing()] : []));
    suggestions.replaceChildren(...(messages.length ? [] : SUGGEST.map((s) => h('button', { class: 'chip-btn', type: 'button', onclick: () => ask(s) }, s))));
    log.scrollTop = log.scrollHeight;
  };

  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; };

  async function ask(text) {
    text = text.trim();
    if (!text || sending) return;
    messages.push({ role: 'user', text, ts: Date.now() });
    sending = true;
    sendBtn.disabled = true;
    save();
    render();
    try {
      messages.push({ role: 'assistant', reply: await api.chat(text), ts: Date.now() });
    } catch (e) {
      messages.push({ role: 'assistant', reply: { text: `⚠️ ${e.message}` }, ts: Date.now() });
    }
    sending = false;
    sendBtn.disabled = false;
    save();
    render();
    refreshBadges();
    if (!isOpen) unread.hidden = false;
  }

  function open(prefill) {
    isOpen = true;
    panel.hidden = false;
    document.body.classList.add('chat-open');
    unread.hidden = true;
    render();
    if (prefill) input.value = prefill;
    grow();
    requestAnimationFrame(() => input.focus());
    refreshStatus();
  }
  function close() {
    isOpen = false;
    panel.hidden = true;
    document.body.classList.remove('chat-open');
    launcher.focus();
  }
  async function refreshStatus() {
    if (api.mode === 'demo') return;
    try {
      const s = await api.status();
      statusDot.className = `dot ${s.ollama ? 'bad' : 'ok'}`;
      statusText.textContent = s.ollama ? 'AI model offline' : `Online · local AI (${s.model})`;
    } catch { statusDot.className = 'dot bad'; statusText.textContent = 'Offline'; }
  }

  launcher.addEventListener('click', () => (isOpen ? close() : open()));
  closeBtn.addEventListener('click', close);
  clearBtn.addEventListener('click', async () => {
    try { await api.resetChat(); } catch (e) { toast(e.message, 'error'); return; }
    messages = [];
    save();
    render();
    toast('Chat memory cleared.');
  });
  form.addEventListener('submit', (ev) => { ev.preventDefault(); const t = input.value; input.value = ''; grow(); ask(t); });
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); form.requestSubmit(); }
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
  });
  document.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); isOpen ? close() : open(); }
  });

  return { open, close };
}

// ---------- App shell ----------
const VIEWS = {
  today: { group: 'Workspace', title: 'Overview', sub: 'Your day at a glance: what you\'re working on, what\'s due, and what needs a reply.', render: viewToday },
  tasks: { group: 'Workspace', title: 'Tasks', sub: 'Open ClickUp tasks assigned to you. Break any task down into a checklist and a Cursor prompt.', render: viewTasks },
  inbox: { group: 'Workspace', title: 'Inbox', sub: 'Unread email with AI triage, summaries and reply drafts.', render: viewInbox },
  compose: { group: 'Email', title: 'Compose', sub: 'Describe the email; the AI writes it; you approve it.', render: viewCompose },
  outbox: { group: 'Email', title: 'Outbox', sub: 'Review every email before it leaves. Nothing is sent until you click Send.', render: viewOutbox },
  activity: { group: 'System', title: 'Activity', sub: 'Everything the assistant noticed and told you, plus the health of the background service.', render: viewActivity },
};
const BADGES = { tasks: 'tasks', inbox: 'inbox', outbox: 'outbox' };

let api;
let session = { name: '' };
let chat;
let cleanup = null;

async function route() {
  let name = (location.hash.slice(1) || 'today').split('?')[0];
  if (name === 'chat') { // old links to the Chat tab open the floating chat instead
    history.replaceState(null, '', '#today');
    name = 'today';
    chat.open();
  }
  const key = VIEWS[name] ? name : 'today';
  const v = VIEWS[key];
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.view === key);
  if (cleanup) { clearInterval(cleanup); cleanup = null; }
  setDrawer(false);
  $('mobile-title').textContent = v.title;
  $('view-title').textContent = v.title;
  $('view-sub').textContent = v.sub;
  const actions = $('view-actions');
  const view = $('view');
  actions.replaceChildren();
  view.replaceChildren();
  view.classList.remove('enter');
  void view.offsetWidth; // restart the fade-in animation
  view.classList.add('enter');
  closeModal();
  window.scrollTo(0, 0);
  const timer = await v.render(view, actions);
  if (typeof timer === 'number') cleanup = timer;
}

/** Phone layout: the sidebar slides in from the left. */
function setDrawer(open) {
  document.body.classList.toggle('nav-open', open);
  $('menu-btn').setAttribute('aria-expanded', String(open));
  $('menu-btn').setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}

function buildNav() {
  $('menu-btn').addEventListener('click', () => setDrawer(!document.body.classList.contains('nav-open')));
  $('drawer-backdrop').addEventListener('click', () => setDrawer(false));
  $('drawer-close').addEventListener('click', () => setDrawer(false));
  $('nav').addEventListener('click', (ev) => { if (ev.target.closest('a')) setDrawer(false); });
  const groups = new Map();
  for (const [key, v] of Object.entries(VIEWS)) {
    if (!groups.has(v.group)) groups.set(v.group, []);
    groups.get(v.group).push(h('a', { href: `#${key}`, 'data-view': key },
      h('span', { class: 'nav-icon' }, icon(key)), h('span', { class: 'nav-label' }, v.title),
      BADGES[key] ? h('span', { class: `badge ${key}`, 'data-badge': BADGES[key], hidden: true }) : null));
  }
  $('nav').replaceChildren(...[...groups].map(([name, links]) => h('div', { class: 'nav-group' }, h('p', { class: 'nav-title' }, name), links)));
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  $('ask-btn').replaceChildren(h('span', { class: 'ask-icon' }, icon('sparkle')), h('span', { class: 'grow' }, 'Ask assistant'), h('kbd', null, mac ? '⌘K' : 'Ctrl K'));
  $('ask-btn').addEventListener('click', () => { setDrawer(false); chat.open(); });
}

function demoBanner() {
  const info = api.info ?? {};
  $('banner').replaceChildren(h('div', { class: 'banner' },
    h('div', null,
      h('strong', null, 'Live demo with sample data. '),
      h('span', null, `${info.tagline ?? ''} Nothing is sent and no real accounts are connected.`)),
    info.repoUrl ? h('a', { class: 'btn small light', href: info.repoUrl, target: '_blank', rel: 'noopener noreferrer' }, 'View on GitHub') : null));
}

async function sidebarStatus() {
  try {
    const s = await api.status(true);
    const ok = !s.ollama && s.discord && (s.jobs ?? []).every((j) => j.ok);
    const conn = (label, on) => h('span', { class: `conn${on ? ' on' : ''}`, title: `${label}: ${on ? 'connected' : 'not connected'}` }, h('span', { class: `dot ${on ? 'ok' : ''}` }), label);
    $('sidebar-foot').replaceChildren(
      h('div', { class: 'profile' },
        avatar(session.name || 'You', 'small'),
        h('div', { class: 'grow' },
          h('strong', null, session.name || 'You'),
          h('div', { class: 'status-line' }, h('span', { class: `dot ${ok ? 'ok' : 'bad'}` }),
            api.mode === 'demo' ? 'Demo mode' : ok ? `Running · ${ago(s.startedAt).replace(' ago', '')}` : 'Needs attention'))),
      h('div', { class: 'conns' }, conn('AI', !s.ollama), conn('ClickUp', s.clickup), conn('Gmail', s.gmail), conn('Discord', s.discord)));
  } catch { /* ignore */ }
}

function showLocked() {
  document.body.classList.add('locked-page');
  document.body.replaceChildren(h('main', { class: 'locked' },
    h('div', { class: 'card' },
      h('img', { src: '/favicon.svg', alt: '', width: '48', height: '48' }),
      h('h1', null, 'Dashboard locked'),
      h('p', null, 'This is your private assistant. On this Mac, run:'),
      h('pre', { class: 'email-body' }, 'npm run dashboard'),
      h('p', { class: 'muted' }, 'It opens the dashboard with your secret key. You only need to do this once per browser.'),
      h('a', { class: 'btn ghost', href: '/?demo' }, 'Or try the demo with sample data'))));
}

async function main() {
  const picked = await pickApi();
  if (picked === 'locked') { showLocked(); return; }
  api = withCache(picked);
  try { session = { ...session, ...(await api.session()) }; } catch { /* name stays empty */ }
  document.body.classList.toggle('demo', api.mode === 'demo');
  $('mode-pill').textContent = api.mode === 'demo' ? 'Demo' : 'Private';
  if (api.mode === 'demo') demoBanner();
  buildNav();
  chat = createChatWidget();
  window.addEventListener('hashchange', route);
  document.addEventListener('click', (ev) => {
    const copy = ev.target.closest?.('[data-copy]');
    if (copy) {
      navigator.clipboard.writeText(copy.parentElement.querySelector('pre').textContent)
        .then(() => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); })
        .catch(() => toast('Copy failed. Select the text and copy it manually.', 'error'));
    }
    if (ev.target.closest?.('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { closeModal(); setDrawer(false); } });
  await route();
  refreshBadges();
  sidebarStatus();
  setInterval(sidebarStatus, 60_000);
  setInterval(() => { api.invalidate('tasks', 'inbox', 'outbox'); refreshBadges(); }, 3 * 60_000);
}

main();
