import fs from 'node:fs';
import { Events } from 'discord.js';
import { client, notify } from './discord/bot';
import { startScheduler } from './workers/scheduler';
import { statusText } from './agent';
import { ollamaHealth } from './llm/ollama';
import { config, discordConfig } from './config';
import { addNotification } from './db';
import { startDashboard } from './dashboard/server';

process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));

// The background service appends to this file forever; start fresh once it passes 5 MB.
try { if (fs.statSync(config.logFile).size > 5 * 1024 * 1024) fs.truncateSync(config.logFile, 0); } catch { /* no log yet */ }
console.log(`--- Dev Assistant starting ${new Date().toISOString()} ---`);

const problem = await ollamaHealth();
if (problem) console.warn(`⚠️  ${problem}`);

/** Every alert is kept for the dashboard's Activity tab, then sent to you on Discord. */
async function notifyAll(text: string) {
  try { addNotification(text); } catch (e) { console.error('[activity]', e); }
  await notify(text);
}

if (config.dashboard.enabled) await startDashboard({ discordReady: () => client.isReady(), startedAt: Date.now() });

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  startScheduler(notifyAll);
  await notifyAll(`🟢 **Assistant online**\n${await statusText()}\nType \`/help\` in your server or DM me.`);
});

await client.login(discordConfig().token);
