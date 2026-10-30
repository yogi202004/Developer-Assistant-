import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, Events, GatewayIntentBits, MessageFlags, Partials,
  type ButtonInteraction, type ChatInputCommandInteraction,
} from 'discord.js';
import { discordConfig } from '../config';
import * as A from '../agent';
import { clearHistory } from '../db';
import { errMsg, splitMessage } from '../util';
import { HELP } from './commands';

const dc = discordConfig();

// No privileged intents needed: we only read message text in DMs.
export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

/** Push a notification to the owner by DM. */
export async function notify(text: string) {
  try {
    const user = await client.users.fetch(dc.ownerId);
    for (const chunk of splitMessage(text)) await user.send(chunk);
  } catch (e) {
    console.error('[notify] failed:', errMsg(e));
  }
}

// ---------- Send / Discard buttons ----------
function emailButtons(draftId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`send:${draftId}`).setLabel('Send').setEmoji('📤').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`discard:${draftId}`).setLabel('Discard').setEmoji('🗑️').setStyle(ButtonStyle.Secondary),
  );
}
const confirmLine = (p: A.PendingEmail) => `✉️ **To:** ${p.to}${p.cc ? ` · **Cc:** ${p.cc}` : ''} — "${p.subject}"`;

/** Post a Reply: the text, then one message with Send/Discard buttons per prepared email. */
async function postReply(send: (msg: { content: string; components?: ActionRowBuilder<ButtonBuilder>[] }) => Promise<unknown>, reply: A.Reply) {
  for (const chunk of splitMessage(reply.text)) await send({ content: chunk });
  for (const p of reply.pending ?? []) await send({ content: confirmLine(p), components: [emailButtons(p.draftId)] });
}

async function handleButton(i: ButtonInteraction) {
  if (i.user.id !== dc.ownerId) {
    await i.reply({ content: 'This is a private assistant.', flags: MessageFlags.Ephemeral });
    return;
  }
  const [action, draftId] = i.customId.split(':');
  if (!draftId || (action !== 'send' && action !== 'discard')) return;

  await i.deferUpdate();
  const r = action === 'send' ? await A.sendPending(draftId) : await A.discardPending(draftId);
  if (r.outcome === 'missing') {
    await i.editReply({ components: [] }).catch(() => {});
    await i.followUp({ content: r.text, flags: MessageFlags.Ephemeral });
  } else if (r.outcome === 'failed') {
    await i.followUp({ content: r.text, flags: MessageFlags.Ephemeral });
  } else {
    await i.editReply({ content: r.text, components: [] });
  }
}

// ---------- Slash commands ----------
async function runCommand(i: ChatInputCommandInteraction): Promise<A.Reply> {
  const text = (t: string): A.Reply => ({ text: t });
  switch (i.commandName) {
    case 'help': return text(HELP);
    case 'status': return text(await A.statusText());
    case 'today': return text(await A.todayPlan());
    case 'tasks': return text(await A.tasksText());
    case 'task': return text(await A.taskBreakdown(i.options.getString('id', true)));
    case 'inbox': return text(await A.inboxText());
    case 'email': return text(await A.summarizeEmail(i.options.getInteger('number', true)));
    case 'draft': return A.draftReply(i.options.getInteger('number', true), i.options.getString('instructions') ?? '');
    case 'compose': return A.composeEmail(i.options.getString('to', true), i.options.getString('about', true), i.options.getString('cc') ?? '');
    case 'plan': return text(await A.plan(i.options.getString('priorities', true)));
    case 'ask': return A.agentChat(i.options.getString('question', true));
    case 'reset': clearHistory(); return text('🧹 Chat memory cleared.');
    default: return text('Unknown command.');
  }
}

client.on(Events.InteractionCreate, async (i) => {
  if (i.isButton()) {
    await handleButton(i).catch((e) => console.error('[button]', e));
    return;
  }
  if (!i.isChatInputCommand()) return;
  if (i.user.id !== dc.ownerId) {
    await i.reply({ content: 'This is a private assistant.', flags: MessageFlags.Ephemeral });
    return;
  }
  await i.deferReply();
  try {
    const reply = await runCommand(i);
    let first = true;
    await postReply(async (msg) => {
      if (first) { first = false; return i.editReply(msg); }
      return i.followUp(msg);
    }, reply);
  } catch (e) {
    console.error(`[/${i.commandName}]`, e);
    await i.editReply(`⚠️ ${truncateErr(e)}`).catch(() => {});
  }
});

// ---------- Plain DMs ----------
client.on(Events.MessageCreate, async (m) => {
  if (m.author.bot || m.author.id !== dc.ownerId || m.channel.type !== ChannelType.DM) return;
  const channel = m.channel;
  const typing = setInterval(() => channel.sendTyping().catch(() => {}), 8000);
  await channel.sendTyping().catch(() => {});
  try {
    await postReply((msg) => channel.send(msg), await A.agentChat(m.content));
  } catch (e) {
    await channel.send(`⚠️ ${truncateErr(e)}`);
  } finally {
    clearInterval(typing);
  }
});

const truncateErr = (e: unknown) => errMsg(e).slice(0, 1500);
