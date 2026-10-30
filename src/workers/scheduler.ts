import cron from 'node-cron';
import * as cu from '../integrations/clickup';
import * as gm from '../integrations/gmail';
import { ask, clickupOn, gmailOn, todayPlan } from '../agent';
import { config } from '../config';
import { kvGet, kvSet, markSeen, pruneSeen, recordJob } from '../db';
import { dayKey, errMsg, isQuietHours, truncate } from '../util';

type Notify = (text: string) => Promise<void>;

const running = new Set<string>();
const lastErrorAlert = new Map<string, number>();

/** Prevents overlapping runs and rate-limits error alerts to one per job per hour. */
async function guard(name: string, notify: Notify, job: () => Promise<void>) {
  if (running.has(name)) return;
  running.add(name);
  try {
    await job();
    recordJob(name, true);
  } catch (e) {
    console.error(`[${name}]`, e);
    recordJob(name, false, truncate(errMsg(e), 400));
    const last = lastErrorAlert.get(name) ?? 0;
    if (Date.now() - last > 3_600_000) {
      lastErrorAlert.set(name, Date.now());
      await notify(`⚠️ **${name}** failed: ${truncate(errMsg(e), 400)}`);
    }
  } finally {
    running.delete(name);
  }
}

async function pollClickUp(notify: Notify) {
  const tasks = await cu.listMyOpenTasks();
  const seeded = kvGet('clickup_seeded') === '1';

  // 1) New assignments (first run only records existing tasks, so you aren't spammed)
  const fresh = tasks.filter((t) => markSeen('task', t.id));
  if (!seeded) kvSet('clickup_seeded', '1');
  else {
    for (const t of fresh) {
      const desc = t.text_content || t.description || '';
      await notify(`🆕 **New task assigned to you**\n${cu.taskLine(t)}${desc ? `\n> ${truncate(desc.replace(/\n+/g, ' '), 300)}` : ''}\n_Next: \`/task id:${t.id}\` for a checklist + Cursor prompt._`);
    }
  }

  // 2) Due-soon / overdue reminders (batched, de-duplicated, respect quiet hours)
  if (isQuietHours()) return;
  const now = Date.now();
  const today = dayKey();
  const overdue: cu.Task[] = [];
  const dueSoon: cu.Task[] = [];
  for (const t of tasks) {
    if (!t.due_date) continue;
    const due = Number(t.due_date);
    if (due < now) { if (markSeen('overdue', `${t.id}:${today}`)) overdue.push(t); }
    else if (due - now < 24 * 3_600_000) { if (markSeen('duesoon', `${t.id}:${t.due_date}`)) dueSoon.push(t); }
  }
  if (dueSoon.length) await notify(`⏳ **Due within 24h**\n${dueSoon.map(cu.taskLine).join('\n')}`);
  if (overdue.length) await notify(`🔴 **Overdue**\n${overdue.map(cu.taskLine).join('\n')}`);
}

async function pollGmail(notify: Notify) {
  const emails = await gm.listEmails(config.gmail.query, 20);
  const seeded = kvGet('gmail_seeded') === '1';
  const fresh = emails.filter((e) => markSeen('email', e.id));
  if (!seeded) { kvSet('gmail_seeded', '1'); return; }
  if (!fresh.length || isQuietHours()) return; // quiet-hours mail shows up in the morning plan

  for (const e of fresh.slice(0, 5)) {
    let triage = '';
    if (config.gmail.summarizeNew) {
      try {
        triage = await ask('In ONE short line: does this email need action from me? Start with "Action:" or "FYI:".', `From: ${e.from}\nSubject: ${e.subject}\nSnippet: ${e.snippet}`);
      } catch { /* alert still goes out without triage */ }
    }
    await notify(`📧 **${e.from}**\n**${e.subject}**\n> ${truncate(e.snippet, 200)}${triage ? `\n🤖 ${truncate(triage, 200)}` : ''}\n<${e.link}>`);
  }
  if (fresh.length > 5) await notify(`…and ${fresh.length - 5} more new emails. Use \`/inbox\`.`);
}

export function startScheduler(notify: Notify) {
  if (clickupOn()) {
    const run = () => guard('ClickUp check', notify, () => pollClickUp(notify));
    run();
    setInterval(run, config.clickup.pollMinutes * 60_000);
  }
  if (gmailOn()) {
    const run = () => guard('Gmail check', notify, () => pollGmail(notify));
    run();
    setInterval(run, config.gmail.pollMinutes * 60_000);
  }
  if (cron.validate(config.schedule.digestCron)) {
    cron.schedule(config.schedule.digestCron, () => guard('Daily plan', notify, async () => notify(await todayPlan())), { timezone: config.timezone });
  } else {
    console.warn(`Invalid DIGEST_CRON "${config.schedule.digestCron}" — daily plan disabled.`);
  }
  cron.schedule('0 3 * * *', () => pruneSeen(30), { timezone: config.timezone });
  console.log(`Scheduler started (ClickUp: ${clickupOn()}, Gmail: ${gmailOn()}).`);
}
