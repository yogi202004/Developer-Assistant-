import fs from 'node:fs';
import * as A from '../agent';
import * as cu from '../integrations/clickup';
import type { EmailSummary } from '../integrations/gmail';
import { config } from '../config';
import { clearHistory, kvGet, listJobs, listNotifications } from '../db';
import { ollamaHealth } from '../llm/ollama';
import { int, optStr, str, type Routes } from './http';

export interface LiveExtras { discordReady: () => boolean; startedAt: number }

const taskView = (t: cu.Task) => ({
  id: t.id,
  customId: t.custom_id ?? null,
  name: t.name,
  status: t.status.status,
  workingOn: cu.isWorkingOn(t),
  priority: t.priority?.priority ?? null,
  due: t.due_date ? Number(t.due_date) : null,
  url: t.url,
  list: t.list?.name ?? null,
});

const prView = (p: A.PrView) => ({
  id: p.id,
  repo: p.repo,
  number: p.number,
  title: p.title,
  url: p.url,
  draft: p.draft,
  updatedAt: p.updatedAt,
  comments: p.comments,
  labels: p.labels,
  review: {
    state: p.review.state,
    changesBy: p.review.changesBy,
    approvedBy: p.review.approvedBy,
    changes: p.review.changes.map((r) => ({ user: r.user, body: r.body.slice(0, 600), at: r.submittedAt, url: r.url })),
  },
});

const emailView = (e: EmailSummary, i: number) => ({ n: i + 1, from: e.from, subject: e.subject, snippet: e.snippet, date: e.date, link: e.link });

/** Last ~64 KB of the background-service log. */
function tailLog(maxLines = 200): string {
  try {
    const fd = fs.openSync(config.logFile, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 64 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return buf.toString('utf8').split('\n').slice(-maxLines).join('\n');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

/** The dashboard API for your real assistant. Every route reuses the same functions as the Discord bot. */
export function liveRoutes(x: LiveExtras): Routes {
  return {
    'GET /api/session': () => ({ mode: 'live', name: config.signature || null }),

    'GET /api/status': async () => ({
      model: config.ollama.model,
      ollama: await ollamaHealth(),
      clickup: A.clickupOn(),
      gmail: A.gmailOn(),
      github: A.githubOn(),
      discord: x.discordReady(),
      timezone: config.timezone,
      quietHours: config.quietHours,
      digestCron: config.schedule.digestCron,
      startedAt: x.startedAt,
      jobs: listJobs(),
    }),

    'GET /api/tasks': async () => {
      if (!A.clickupOn()) return { configured: false, working: [], buckets: null, counts: null };
      const tasks = await cu.listMyOpenTasks();
      const { working, notStarted } = A.splitTasks(tasks);
      const all = A.bucketTasks(tasks);
      return {
        configured: true,
        working: working.map(taskView),
        buckets: Object.fromEntries(Object.entries(notStarted).map(([k, list]) => [k, list.map(taskView)])),
        counts: { total: tasks.length, working: working.length, overdue: all.overdue.length, today: all.today.length, week: all.week.length },
      };
    },
    'POST /api/tasks/breakdown': async (b) => ({ text: await A.taskBreakdown(str(b.id, 'Task id', 300)) }),

    'GET /api/inbox': async () => {
      if (!A.gmailOn()) return { configured: false, query: config.gmail.query, emails: [] };
      return { configured: true, query: config.gmail.query, emails: (await A.refreshInbox()).map(emailView) };
    },
    'POST /api/inbox/triage': async () => ({ text: await A.triageEmails(JSON.parse(kvGet('lastInbox') ?? '[]') as EmailSummary[]) }),
    'POST /api/inbox/summary': async (b) => ({ text: await A.summarizeEmail(int(b.n, 'Email number')) }),
    'POST /api/inbox/draft': async (b) => A.draftReply(int(b.n, 'Email number'), optStr(b.instructions, 2000)),

    'POST /api/compose': async (b) => A.composeEmail(str(b.to, 'To', 1000), str(b.about, 'About'), optStr(b.cc, 1000)),

    'GET /api/outbox': () => ({ pending: A.listPending() }),
    'POST /api/outbox/send': async (b) => A.sendPending(str(b.draftId, 'Draft id', 200)),
    'POST /api/outbox/discard': async (b) => A.discardPending(str(b.draftId, 'Draft id', 200)),

    'GET /api/github': async () => {
      if (!A.githubOn()) return { configured: false, user: config.github.user || null, repos: config.github.repos, open: [], merged: [], counts: null };
      const { author, open, merged } = await A.myPullRequests();
      const count = (s: string) => open.filter((p) => p.review.state === s).length;
      return {
        configured: true,
        user: author,
        repos: config.github.repos,
        open: open.map(prView),
        merged: merged.map(({ id, repo, number, title, url, mergedAt }) => ({ id, repo, number, title, url, mergedAt })),
        counts: { open: open.length, changes: count('changes_requested'), approved: count('approved'), waiting: open.length - count('changes_requested') - count('approved'), merged: merged.length },
        fetchedAt: Date.now(),
      };
    },

    'GET /api/today': () => ({ plan: A.lastPlan() }),
    'POST /api/today': async () => {
      await A.todayPlan();
      return { plan: A.lastPlan() };
    },

    'POST /api/chat': async (b) => A.agentChat(str(b.text, 'Message')),
    'POST /api/chat/reset': () => {
      clearHistory();
      return { ok: true };
    },

    'GET /api/activity': () => ({ items: listNotifications(100) }),
    'GET /api/logs': () => ({ path: config.logFile, text: tailLog() }),
  };
}
