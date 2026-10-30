import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Show what I can do'),
  new SlashCommandBuilder().setName('status').setDescription('Check model and integrations'),
  new SlashCommandBuilder().setName('today').setDescription('Plan my day from tasks + emails'),
  new SlashCommandBuilder().setName('tasks').setDescription('Show my open ClickUp tasks'),
  new SlashCommandBuilder().setName('task').setDescription('Checklist, tests and a Cursor/Claude prompt for a task')
    .addStringOption((o) => o.setName('id').setDescription('Task id, custom id (DEV-12) or URL').setRequired(true)),
  new SlashCommandBuilder().setName('inbox').setDescription('List and triage unread emails'),
  new SlashCommandBuilder().setName('email').setDescription('Summarize one email from /inbox')
    .addIntegerOption((o) => o.setName('number').setDescription('Number from /inbox').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('compose').setDescription('Write a new email — you confirm with a Send button')
    .addStringOption((o) => o.setName('to').setDescription('Recipient email(s), comma-separated').setRequired(true))
    .addStringOption((o) => o.setName('about').setDescription('What the email should say').setRequired(true))
    .addStringOption((o) => o.setName('cc').setDescription('Optional Cc email(s)')),
  new SlashCommandBuilder().setName('draft').setDescription('Write a reply to an email from /inbox — you confirm with a Send button')
    .addIntegerOption((o) => o.setName('number').setDescription('Number from /inbox').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('instructions').setDescription('What the reply should say')),
  new SlashCommandBuilder().setName('plan').setDescription('Turn your priorities into a work plan')
    .addStringOption((o) => o.setName('priorities').setDescription('What you want to get done').setRequired(true)),
  new SlashCommandBuilder().setName('ask').setDescription('Ask the assistant anything (can look up tasks/emails)')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true)),
  new SlashCommandBuilder().setName('reset').setDescription('Clear chat memory'),
].map((c) => c.toJSON());

export const HELP = `🤖 **Developer Assistant**
\`/today\` — day plan from tasks + emails
\`/tasks\` — open ClickUp tasks by due date
\`/task id:\` — checklist, tests + ready-to-paste Cursor/Claude prompt
\`/inbox\` — unread emails + triage
\`/email number:\` — summarize one email
\`/compose to: about: cc:\` — write a new email → tap 📤 Send
\`/draft number: instructions:\` — write a reply → tap 📤 Send
\`/plan priorities:\` — turn priorities into a plan
\`/ask question:\` — free question (looks up tasks/emails itself)
\`/status\` · \`/reset\`

💬 You can also just **DM me** in plain language, e.g. _"email ravi@acme.com that the demo is ready for Thursday"_.
📤 I never send on my own — every email waits for your **Send** tap (edit it in Gmail Drafts first if you like).
🔔 I'll DM you about new task assignments, due/overdue tasks, new emails and a morning plan.`;
