// Sample data for the public demo. Nothing here is real: no real tasks, emails or people.
// Used by the browser demo (demo-api.js) and the optional free-AI endpoint (api/ai.js).

/** Shown in the demo banner. Set repoUrl to your GitHub repo before you deploy. */
export const DEMO_INFO = {
  ownerName: 'Yogesh',
  repoUrl: '',
  tagline: 'A free, private AI assistant for developers: ClickUp + Gmail + Discord, powered by a local AI model.',
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function todayAt(hour) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

export function demoTasks(now = Date.now()) {
  return [
    {
      id: '86c1a2b3', customId: 'MOB-214', name: 'Fix OAuth token refresh on Android', status: 'in progress', priority: 'urgent',
      due: now - 1 * DAY, list: 'Mobile App',
      description: 'Users on Android 14 get logged out after ~1 hour. The refresh token call returns 401 because the app sends the expired access token instead of the refresh token. Repro: log in, wait 60 min, open the app.\n\nAcceptance: users stay logged in for 30 days; refresh failures are logged to Sentry.',
    },
    {
      id: '86c1a2b4', customId: 'API-482', name: 'Review PR #482: payment retry with exponential backoff', status: 'review', priority: 'high',
      due: todayAt(17), list: 'Backend',
      description: 'Review the retry logic for failed Stripe charges. Check idempotency keys, max attempts (5), jitter, and that retries stop for card_declined errors.',
    },
    {
      id: '86c1a2b5', customId: 'WEB-131', name: 'Ship onboarding checklist v2', status: 'in progress', priority: 'high',
      due: todayAt(19), list: 'Web App',
      description: 'New 4-step onboarding checklist (connect workspace, invite team, create first project, enable notifications). Progress is saved per user. Behind the flag onboarding_v2. Demo to product on Friday.',
    },
    {
      id: '86c1a2b6', customId: 'API-501', name: 'Add rate limiting to the public API', status: 'to do', priority: 'high',
      due: now + 2 * DAY, list: 'Backend',
      description: 'Limit public API keys to 100 requests/min with a sliding window in Redis. Return 429 with Retry-After. Exempt internal service keys.',
    },
    {
      id: '86c1a2b7', customId: 'API-507', name: 'Write migration for the user_settings table', status: 'to do', priority: 'normal',
      due: now + 4 * DAY, list: 'Backend',
      description: 'Move notification preferences from users.preferences (JSON) into a new user_settings table. Must be reversible and run without downtime.',
    },
    {
      id: '86c1a2b8', customId: 'DOC-77', name: 'Update API docs for v3 webhooks', status: 'to do', priority: 'low',
      due: now + 6 * DAY, list: 'Docs',
      description: 'Document the new webhook signature header (X-Signature-256), retry schedule and the three new event types.',
    },
    {
      id: '86c1a2b9', customId: 'PLAT-12', name: 'Spike: evaluate edge caching for the dashboard', status: 'backlog', priority: 'normal',
      due: now + 12 * DAY, list: 'Platform',
      description: 'Time-boxed (1 day). Compare CDN edge caching vs. current server cache for dashboard API responses. Output: a short doc with numbers.',
    },
    {
      id: '86c1a2c0', customId: 'WEB-140', name: 'Clean up stale feature flags', status: 'to do', priority: null,
      due: null, list: 'Web App',
      description: 'Remove flags that have been at 100% for more than 30 days: new_nav, fast_search, billing_v2.',
    },
  ].map((t) => ({ ...t, url: `https://app.clickup.com/t/${t.id}` }));
}

export const DEMO_EMAILS = [
  {
    from: 'Ravi Kumar <ravi@lightspeed-retail.com>', subject: 'Webhook failures since yesterday',
    snippet: 'Hi, since yesterday ~6pm our order webhooks are failing with 401. Nothing changed on our side. Can you check urgently?',
    body: 'Hi,\n\nSince yesterday around 6pm our order webhooks are failing with HTTP 401. Nothing changed on our side as far as we know. This is blocking order sync for 40 stores.\n\nCan you check urgently and let us know an ETA?\n\nThanks,\nRavi',
    needsReply: true,
    summary: '- Lightspeed (client) says order webhooks fail with **HTTP 401** since yesterday ~6pm.\n- They changed nothing on their side.\n- Impact: order sync is blocked for **40 stores**.\n\n**Action items for you**\n- Check the webhook signing change that went out yesterday (likely the new X-Signature-256 header).\n- Reply with an acknowledgement and an ETA today.\n\n**Deadline:** urgent, today.',
    reply: 'Hi Ravi,\n\nThanks for flagging this, and sorry for the disruption. We released a change to webhook signing yesterday evening, and that is the most likely cause of the 401 errors. I am looking into it now and will send you an update with an ETA within the next 2 hours.\n\nBest,\nAlex',
  },
  {
    from: 'Priya Sharma <priya@acme.dev>', subject: 'Can we demo onboarding v2 on Friday?',
    snippet: 'Hey! Leadership wants to see the new onboarding checklist. Could you do a 15-min demo on Friday at 11?',
    body: 'Hey!\n\nLeadership wants to see the new onboarding checklist. Could you do a 15-minute demo on Friday at 11:00? Staging is fine.\n\nAlso, is the progress saving per user done?\n\nPriya',
    needsReply: true,
    summary: '- Priya (Product) asks for a **15-minute demo** of onboarding v2 for leadership.\n- Proposed time: **Friday 11:00**, on staging.\n- She asks whether per-user progress saving is finished.\n\n**Action items for you**\n- Confirm the Friday 11:00 slot.\n- Answer the progress-saving question.',
    reply: 'Hi Priya,\n\nFriday at 11:00 works for me. I will demo onboarding v2 on staging. Per-user progress saving is done and in review, so it will be part of the demo.\n\nBest,\nAlex',
  },
  {
    from: 'GitHub <notifications@github.com>', subject: '[acme/api] Review requested: payment retry with exponential backoff (#482)',
    snippet: 'sam-lee requested your review on pull request #482. 14 files changed, +412 −96.',
    body: 'sam-lee requested your review on this pull request.\n\n#482 payment retry with exponential backoff\n14 files changed, +412 −96.',
    needsReply: false,
    summary: '- Sam requested your review on **PR #482** (payment retries).\n- 14 files changed.\n\n**Action items for you**\n- Review it today; the matching ClickUp task is due today.',
  },
  {
    from: 'Sentry <noreply@sentry.io>', subject: 'New issue: TypeError: Cannot read properties of undefined (reading \'total\') in checkout.ts',
    snippet: '38 events in the last hour affecting 21 users. First seen 2 hours ago in release web@4.18.0.',
    body: 'New issue in web (production)\n\nTypeError: Cannot read properties of undefined (reading \'total\')\ncheckout.ts in calculateCart at line 88\n\n38 events in the last hour, 21 users affected. First seen 2 hours ago in release web@4.18.0.',
    needsReply: false,
    summary: '- New production error in **checkout.ts line 88** (cart total undefined).\n- 38 events / 21 users in the last hour, started with release **web@4.18.0**.\n\n**Action items for you**\n- Check whether 4.18.0 changed the cart shape; consider a quick fix or rollback.',
  },
  {
    from: 'Jordan Lee <jordan@acme.dev>', subject: 'Updated Figma for the settings page',
    snippet: 'I moved notification preferences into their own tab, link inside. Would love your eyes before Thursday.',
    body: 'Hi Alex,\n\nI moved notification preferences into their own tab in the settings page. Would love your eyes on it before Thursday, especially whether the new layout works with the user_settings migration.\n\nJordan',
    needsReply: true,
    summary: '- Jordan (Design) updated the settings page design: notification preferences now have their own tab.\n- Wants feedback **before Thursday**, especially on fit with the user_settings migration.\n\n**Action items for you**\n- Review the Figma and reply before Thursday.',
    reply: 'Hi Jordan,\n\nThanks, I will take a look today. The separate tab fits well with the user_settings migration, since those preferences are moving to their own table anyway. I will leave any comments in Figma by Wednesday.\n\nBest,\nAlex',
  },
  {
    from: 'Meera Iyer <meera@acme.dev>', subject: '1:1 moved to 4pm',
    snippet: 'Hi Alex, moving our 1:1 to 4pm today. Bring the Q4 roadmap notes if you can.',
    body: 'Hi Alex,\n\nMoving our 1:1 to 4pm today. Bring the Q4 roadmap notes if you can.\n\nMeera',
    needsReply: false,
    summary: '- Your 1:1 with Meera moved to **4pm today**.\n- Bring the Q4 roadmap notes.',
  },
  {
    from: 'People Team <people@acme.dev>', subject: 'Holiday calendar 2027 is live',
    snippet: 'The 2027 holiday calendar is now available on the intranet. Please plan your leave early.',
    body: 'Hi all,\n\nThe 2027 holiday calendar is now on the intranet. Please plan your leave early.\n\nPeople Team',
    needsReply: false,
    summary: '- The 2027 holiday calendar is published on the intranet. FYI only.',
  },
].map((e, i) => ({ ...e, n: i + 1, date: '', link: 'https://mail.google.com/' }));

export function demoNotifications(now = Date.now()) {
  const items = [
    [8 * HOUR + 50 * 60_000, '🟢 **Assistant online**\n🧠 Model: `qwen3:8b` — OK\n📋 ClickUp: connected\n📧 Gmail: connected'],
    [8 * HOUR, `☀️ **Plan for today**\n\n**Top 3 priorities**\n1. Fix OAuth token refresh on Android (overdue)\n2. Review PR #482 (due today)\n3. Ship onboarding checklist v2 (due today)`],
    [5 * HOUR, '🔴 **Overdue**\n• `urgent` Fix OAuth token refresh on Android — _in progress_ · Mobile App'],
    [3 * HOUR, '🆕 **New task assigned to you**\n• `high` Add rate limiting to the public API — _to do_ · Backend\n> Limit public API keys to 100 requests/min with a sliding window in Redis.'],
    [2 * HOUR, '📧 **Sentry**\n**New issue: TypeError in checkout.ts**\n> 38 events in the last hour affecting 21 users.\n🤖 Action: production error after release 4.18.0, check before it spreads.'],
    [75 * 60_000, '📧 **Ravi Kumar**\n**Webhook failures since yesterday**\n> Since yesterday ~6pm our order webhooks are failing with 401.\n🤖 Action: client is blocked, reply with an ETA today.'],
    [40 * 60_000, '⏳ **Due within 24h**\n• `high` Review PR #482: payment retry with exponential backoff — _review_ · Backend\n• `high` Ship onboarding checklist v2 — _in progress_ · Web App'],
    [12 * 60_000, '📧 **Priya Sharma**\n**Can we demo onboarding v2 on Friday?**\n> Leadership wants to see the new onboarding checklist.\n🤖 Action: confirm the Friday 11:00 demo slot.'],
  ];
  return items.map(([ago, text], i) => ({ id: i + 1, text, ts: now - ago })).reverse();
}

export const DEMO_DRAFTS = [
  {
    to: 'Ravi Kumar <ravi@lightspeed.example>',
    cc: '',
    subject: 'Re: Webhook failures since yesterday',
    body: `Hi Ravi,

Thanks for flagging this, and sorry for the trouble across your stores.

We traced the 401s to yesterday's webhook signing change: requests signed with the old secret are being rejected. We're rolling out a fix that accepts both secrets during the transition, and it should be live within the next two hours.

I'll confirm here as soon as it's deployed, and we'll replay the failed events from the last 24 hours so no orders are lost.

Best regards,
Alex`,
  },
  {
    to: 'Priya Sharma <priya@acme.example>',
    cc: 'design@acme.example',
    subject: 'Re: Can we demo onboarding v2 on Friday?',
    body: `Hi Priya,

Friday at 11:00 works. I'll walk through the new onboarding checklist end to end, including the progress tracking and the skip logic.

I'll share a staging link on Thursday evening so leadership can try it beforehand.

Thanks,
Alex`,
  },
];

export function demoLog(startedAt, now = Date.now()) {
  const lines = [
    [startedAt, '[start] Dev Assistant starting (pid 48211)'],
    [startedAt + 2_000, '[ollama] model qwen3:8b ok'],
    [startedAt + 3_000, '[dashboard] http://127.0.0.1:4747'],
    [startedAt + 4_000, '[discord] logged in as dev-assistant#4683'],
    [startedAt + 5_000, '[scheduler] ClickUp every 3 min, Gmail every 2 min, plan at 09:00'],
    [startedAt + 3 * HOUR + 30_000, '[gmail] warn: rate limited, retrying in 30s'],
    [now - 2 * HOUR, '[plan] daily plan sent'],
  ];
  for (let at = startedAt + 60_000, i = 0; at < now; at += 47 * 60_000, i++) {
    lines.push([at, '[clickup] checked 8 open tasks'], [at + 20_000, `[gmail] checked inbox, ${i % 3 ? 0 : 1} new important`]);
  }
  return lines.sort((a, b) => a[0] - b[0]).map(([ts, text]) => `${new Date(ts).toISOString()} ${text}`).join('\n');
}

// ---------- Pre-written AI answers (used when no free AI key is configured) ----------

export function demoPlan() {
  return `**Top 3 priorities**
1. **Fix OAuth token refresh on Android** — it's overdue and users are being logged out.
2. **Reply to Ravi (Lightspeed)** about the webhook 401s — a client is blocked across 40 stores; likely related to yesterday's webhook signing change.
3. **Review PR #482** and **ship onboarding checklist v2** — both are due today, and the onboarding demo is on Friday.

**Suggested order**
1. 09:30 — Reply to Ravi with an ETA, then check the webhook signing change (30 min).
2. 10:00 — OAuth refresh fix (2–3 h).
3. 14:00 — Review PR #482 (1 h).
4. 15:00 — Onboarding v2 final touches; 16:00 1:1 with Meera (bring Q4 notes).

**Emails to answer**
- #1 Ravi — webhook failures (urgent)
- #2 Priya — confirm Friday 11:00 demo
- #5 Jordan — settings page feedback before Thursday

**Risks / blockers**
- Sentry: new checkout.ts error since release 4.18.0 (21 users). Worth a quick look before it grows.
- Three high-priority items are due today, so the rate-limiting task may slip to tomorrow.`;
}

export function demoTriage() {
  return `**Needs action**
- **#1 Ravi Kumar** — client webhooks failing with 401: reply with an ETA today (urgent).
- **#2 Priya Sharma** — confirm the Friday 11:00 onboarding demo.
- **#4 Sentry** — new production error in checkout.ts: investigate.
- **#5 Jordan Lee** — review the settings page design before Thursday.
- **#3 GitHub** — review PR #482 (due today).

**FYI only:** #6 1:1 moved to 4pm, #7 holiday calendar 2027.`;
}

export function demoBreakdown(task) {
  return `**1. Objective**
${task.name}. ${task.description.split('\n')[0]}

**2. Acceptance criteria**
${task.description.includes('Acceptance:')
    ? task.description.split('Acceptance:')[1].trim().split(';').map((s) => `- ${s.trim()}`).join('\n')
    : `- The change described in the task works end to end\n- Covered by automated tests (assumed)\n- No regression in related features (assumed)`}

**3. Implementation checklist**
1. Reproduce the current behaviour and write a failing test.
2. Implement the change in the ${task.list} codebase.
3. Handle edge cases and errors; add logging where useful.
4. Update docs or feature flags if needed.
5. Open a PR and link it to ${task.customId}.

**4. Tests**
- Unit tests for the new logic
- One integration test for the main flow
- Manual check on staging

**5. Questions / risks**
- Are there other clients or services that depend on the current behaviour?
- Is a feature flag needed for a safe rollout?

**6. Prompt for Cursor / Claude**
\`\`\`
Context: ${task.list} codebase. Task ${task.customId}: "${task.name}".
${task.description}

Goal: implement this change with tests.
Constraints: keep the change small and focused, follow existing patterns, no unrelated refactors.
Acceptance: all existing tests pass, new tests cover the main flow and edge cases.
Start by finding the relevant code and explaining your plan before editing.
\`\`\``;
}

/** A plain-text email written from the visitor's instructions (no AI). */
export function demoCompose(to, about) {
  const name = (to.split(/[,;\s]+/)[0] || '').split('@')[0].split(/[._-]/)[0];
  const greeting = name ? `Hi ${name.charAt(0).toUpperCase()}${name.slice(1)},` : 'Hi,';
  const topic = about.trim().replace(/\s+/g, ' ');
  const short = topic.length > 60 ? `${topic.slice(0, 57)}…` : topic;
  const subject = short.charAt(0).toUpperCase() + short.slice(1);
  const body = `${greeting}\n\nI wanted to reach out about the following: ${topic.replace(/[.!]$/, '')}.\n\nLet me know if you have any questions or if a quick call would help.\n\nBest,\n${DEMO_INFO.ownerName}`;
  return { subject, body };
}
