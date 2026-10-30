// Demo backend: runs in the visitor's browser with sample data and never sends anything.
// If the deployment has a free AI key (api/ai.js), AI answers are generated live; otherwise pre-written ones are used.
import {
  DEMO_DRAFTS, DEMO_EMAILS, DEMO_INFO, demoBreakdown, demoCompose, demoLog, demoNotifications, demoPlan, demoTasks, demoTriage,
} from './demo-data.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const thinking = () => wait(600 + Math.random() * 700);
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const isWorkingOn = (t) => !/^(to ?do|open|backlog|new|not started|planned)$/i.test(t.status);

function bucket(tasks, now = Date.now()) {
  const b = { overdue: [], today: [], week: [], later: [], none: [] };
  for (const t of tasks) {
    if (!t.due) b.none.push(t);
    else if (sameDay(t.due, now)) b.today.push(t);
    else if (t.due < now) b.overdue.push(t);
    else if (t.due - now < 7 * 86_400_000) b.week.push(t);
    else b.later.push(t);
  }
  for (const k of Object.keys(b)) b[k].sort((x, y) => (x.due ?? 0) - (y.due ?? 0));
  return b;
}

let aiEnabled = null;
async function liveAi(payload) {
  if (aiEnabled === null) {
    try {
      const r = await fetch('/api/ai');
      aiEnabled = r.ok && (await r.json()).enabled === true;
    } catch { aiEnabled = false; }
  }
  if (!aiEnabled) return null;
  try {
    const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) return null; // rate-limited or provider error: fall back to the pre-written answer
    return await r.json();
  } catch { return null; }
}

async function ai(payload, fallback) {
  const live = await liveAi(payload);
  if (live?.text) return live.text;
  await thinking();
  return fallback();
}

export function createDemoApi() {
  const startedAt = Date.now() - 9 * 3_600_000;
  const tasks = demoTasks();
  const notifications = demoNotifications();
  let pending = [];
  let plan = { text: `☀️ **Plan for today**\n\n${demoPlan()}`, ts: Date.now() - 2 * 3_600_000 };
  let nextDraft = 1;

  const addPending = (p) => {
    const item = { draftId: `demo-${nextDraft++}`, createdAt: Date.now(), ...p };
    pending = [item, ...pending];
    return item;
  };
  const emailAt = (n) => {
    const e = DEMO_EMAILS[Number(n) - 1];
    if (!e) throw new Error('Unknown email number.');
    return e;
  };
  const replyTo = (e) => (/<([^>]+)>/.exec(e.from)?.[1] ?? e.from);
  pending = DEMO_DRAFTS.map((d, i) => ({ draftId: `demo-${nextDraft++}`, ...d, createdAt: Date.now() - (i + 1) * 23 * 60_000 }));

  return {
    mode: 'demo',
    info: DEMO_INFO,

    async session() { return { mode: 'demo', name: DEMO_INFO.ownerName }; },

    async status() {
      const now = Date.now();
      return {
        model: 'qwen3:8b', ollama: null, clickup: true, gmail: true, discord: true,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, quietHours: '22-8', digestCron: '0 9 * * 1-5', startedAt,
        jobs: [
          { name: 'ClickUp check', lastRun: now - 2 * 60_000, ok: true },
          { name: 'Gmail check', lastRun: now - 60_000, ok: true },
          { name: 'Daily plan', lastRun: plan.ts, ok: true },
        ],
      };
    },

    async tasks() {
      const working = tasks.filter(isWorkingOn).sort((x, y) => (x.due ?? Infinity) - (y.due ?? Infinity));
      const all = bucket(tasks);
      return {
        configured: true,
        working,
        buckets: bucket(tasks.filter((t) => !isWorkingOn(t))),
        counts: { total: tasks.length, working: working.length, overdue: all.overdue.length, today: all.today.length, week: all.week.length },
      };
    },

    async breakdown(id) {
      const t = tasks.find((x) => x.id === id);
      if (!t) throw new Error('Unknown task.');
      const text = await ai({ kind: 'breakdown', id }, () => demoBreakdown(t));
      return { text: `🧩 **${t.name}** — <${t.url}>\n\n${text}` };
    },

    async inbox() { return { configured: true, query: 'in:inbox is:unread newer_than:2d', emails: DEMO_EMAILS.map(({ body, summary, reply, needsReply, ...e }) => e) }; },
    async triage() { return { text: await ai({ kind: 'triage' }, demoTriage) }; },

    async summary(n) {
      const e = emailAt(n);
      const text = await ai({ kind: 'summary', n: Number(n) }, () => e.summary);
      return { text: `✉️ **${e.subject}** — ${e.from}\n\n${text}` };
    },

    async draft(n, instructions) {
      const e = emailAt(n);
      const fallback = () => e.reply ?? `Hi,\n\nThanks for the update. ${instructions ? `${instructions.trim().replace(/[.!]?$/, '.')} ` : ''}I will follow up shortly.\n\nBest,\n${DEMO_INFO.ownerName}`;
      const body = await ai({ kind: 'draft', n: Number(n), instructions }, fallback);
      const subject = /^re:/i.test(e.subject) ? e.subject : `Re: ${e.subject}`;
      const p = addPending({ to: replyTo(e), subject, body });
      return { text: 'Reply ready. Nothing is sent until you click Send.', pending: [p] };
    },

    async compose(to, about, cc) {
      if (!/\S+@\S+\.\S+/.test(to)) throw new Error('Enter a valid email address in "To".');
      if (!about.trim()) throw new Error('Describe what the email should say.');
      const live = await liveAi({ kind: 'compose', to, about });
      if (!live) await thinking();
      const { subject, body } = live?.subject && live?.body ? live : demoCompose(to, about);
      const p = addPending({ to, cc: cc || undefined, subject, body });
      return { text: 'Email ready. Nothing is sent until you click Send.', pending: [p] };
    },

    async outbox() { return { pending }; },

    async send(draftId) {
      const p = pending.find((x) => x.draftId === draftId);
      if (!p) return { outcome: 'missing', text: 'That email was already sent or discarded.' };
      pending = pending.filter((x) => x !== p);
      await wait(500);
      return { outcome: 'sent', text: `✅ **Demo:** this would now be sent to ${p.to} from your Gmail. Nothing was actually sent.` };
    },

    async discard(draftId) {
      const p = pending.find((x) => x.draftId === draftId);
      if (!p) return { outcome: 'missing', text: 'That email was already sent or discarded.' };
      pending = pending.filter((x) => x !== p);
      return { outcome: 'discarded', text: `🗑️ Discarded — "${p.subject}"` };
    },

    async today() { return { plan }; },
    async refreshToday() {
      const text = await ai({ kind: 'plan' }, demoPlan);
      plan = { text: `☀️ **Plan for ${new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}**\n\n${text}`, ts: Date.now() };
      return { plan };
    },

    async chat(text) {
      const q = text.toLowerCase();
      const b = bucket(tasks);
      const fallback = () => {
        if (/working|progress|doing|current/.test(q)) {
          const working = tasks.filter(isWorkingOn);
          return `**🔨 Working on now (${working.length})**\n${working.map((t) => `- **${t.name}** — _${t.status}_ · ${t.list}`).join('\n')}`;
        }
        if (/overdue|late|behind/.test(q)) return `You have ${b.overdue.length} overdue task:\n${b.overdue.map((t) => `- **${t.name}** (${t.list}) — ${t.priority}`).join('\n')}\n\nWant a checklist and a Cursor prompt for it? Open it from the Tasks tab and click **Break down**.`;
        if (/plan|today|priorit|focus/.test(q)) return demoPlan();
        if (/email|inbox|mail|reply/.test(q)) return demoTriage();
        if (/task|todo|work/.test(q)) return `You have ${tasks.length} open tasks: ${b.overdue.length} overdue, ${b.today.length} due today, ${b.week.length} in the next 7 days. The most urgent is **${b.overdue[0]?.name ?? b.today[0]?.name}**.`;
        return 'In this demo I answer from sample data. Try:\n- "What\'s overdue?"\n- "Plan my day"\n- "Which emails need a reply?"\n\nIn the real app, I can also draft emails for you and look up any ClickUp task.';
      };
      return { text: await ai({ kind: 'chat', text }, fallback), pending: [] };
    },
    async resetChat() { return { ok: true }; },

    async activity() { return { items: notifications }; },
    async logs() { return { path: 'data/logs/assistant.log', text: demoLog(startedAt) }; },
  };
}
