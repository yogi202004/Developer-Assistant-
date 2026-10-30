import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve .env and ./data from the project root, not the current working directory,
// because MCP clients (Cursor, Claude Code) launch the server from other directories.
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });

const opt = (name: string, def = '') => process.env[name]?.trim() || def;
const num = (name: string, def: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
};
function required(name: string): string {
  const v = opt(name);
  if (!v) throw new Error(`Missing required env var ${name} — copy .env.example to .env and fill it in.`);
  return v;
}

const dataDir = path.resolve(projectRoot, opt('DATA_DIR', './data'));
fs.mkdirSync(dataDir, { recursive: true });

const thinkRaw = opt('OLLAMA_THINK');

export const config = {
  dataDir,
  timezone: opt('TIMEZONE', Intl.DateTimeFormat().resolvedOptions().timeZone),
  signature: opt('SIGNATURE'),
  quietHours: opt('QUIET_HOURS', '22-8'),
  ollama: {
    url: opt('OLLAMA_URL', 'http://127.0.0.1:11434'),
    model: opt('OLLAMA_MODEL', 'qwen3:8b'),
    think: thinkRaw === '' ? undefined : thinkRaw === 'true',
    numCtx: num('OLLAMA_NUM_CTX', 8192),
  },
  clickup: {
    token: opt('CLICKUP_TOKEN'),
    teamId: opt('CLICKUP_TEAM_ID'),
    pollMinutes: num('CLICKUP_POLL_MINUTES', 5),
  },
  gmail: {
    credentialsPath: path.join(dataDir, 'google-credentials.json'),
    tokenPath: path.join(dataDir, 'google-token.json'),
    query: opt('GMAIL_QUERY', 'in:inbox category:primary is:unread newer_than:2d'),
    pollMinutes: num('GMAIL_POLL_MINUTES', 3),
    summarizeNew: opt('GMAIL_SUMMARIZE_NEW', 'true') === 'true',
  },
  schedule: {
    digestCron: opt('DIGEST_CRON', '0 9 * * 1-5'),
  },
  dashboard: {
    enabled: opt('DASHBOARD_ENABLED', 'true') !== 'false',
    port: num('DASHBOARD_PORT', 4747),
  },
  logFile: path.join(dataDir, 'logs', 'assistant.log'),
};

// Discord settings are read lazily so helper scripts (e.g. gmail:auth) don't need them.
export function discordConfig() {
  return {
    token: required('DISCORD_TOKEN'),
    appId: required('DISCORD_APP_ID'),
    guildId: required('DISCORD_GUILD_ID'),
    ownerId: required('DISCORD_OWNER_ID'),
  };
}

export type ConfirmMode = 'dm_code' | 'host_approval';

/**
 * Discord settings for the MCP server. Nothing here throws: missing values are reported by
 * the tools as "not configured". The MCP server never logs in to the Discord gateway.
 */
export function discordMcpConfig() {
  // MCP_CONFIRM_MODE applies to Discord DMs and email sends; the older name still works.
  const mode = opt('MCP_CONFIRM_MODE', opt('MCP_DISCORD_CONFIRM_MODE', 'dm_code'));
  return {
    token: opt('DISCORD_TOKEN'),
    ownerId: opt('DISCORD_OWNER_ID'),
    allowedGuildId: opt('DISCORD_ALLOWED_GUILD_ID'),
    confirmMode: (mode === 'host_approval' ? 'host_approval' : 'dm_code') as ConfirmMode,
    confirmTtlMinutes: Math.min(num('MCP_CONFIRM_TTL_MINUTES', 10), 60),
  };
}

/** Kill switches for MCP write capabilities (both on unless set to "false").
 *  Re-reads `.env` so flips take effect without restarting Cursor's MCP process.
 *  Only these two keys are refreshed from disk; other env stays as loaded at startup.
 */
export function mcpPermissions() {
  try {
    const envPath = path.join(projectRoot, '.env');
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq < 0) continue;
        const key = t.slice(0, eq).trim();
        if (key !== 'MCP_ALLOW_EMAIL_SEND' && key !== 'MCP_ALLOW_CLICKUP_WRITES') continue;
        let val = t.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        } else {
          const hash = val.search(/(^|\s)#/);
          if (hash >= 0) val = val.slice(0, hash).trim();
        }
        process.env[key] = val;
      }
    }
  } catch { /* keep previously loaded values */ }
  return {
    allowEmailSend: opt('MCP_ALLOW_EMAIL_SEND', 'true') !== 'false',
    allowClickUpWrites: opt('MCP_ALLOW_CLICKUP_WRITES', 'true') !== 'false',
  };
}
