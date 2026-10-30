import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as cu from '../integrations/clickup';
import * as gm from '../integrations/gmail';
import * as cuw from '../integrations/clickup-write';
import { createDiscordRest, type DiscordApi } from '../integrations/discord-rest';
import { ollamaHealth } from '../llm/ollama';
import { ask, savePending } from '../agent';
import { config, discordMcpConfig, mcpPermissions } from '../config';
import { db, kvDelete } from '../db';
import { ConfirmationStore } from './confirmations';
import type { McpDeps } from './server';

/** HMAC key for confirmation references, kept in the git-ignored data folder (owner-only permissions). */
function loadSecret(): Buffer {
  const file = path.join(config.dataDir, 'mcp-secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

/** Append-only log of every write action taken through MCP (table mcp_audit in data/assistant.db). */
function auditLog() {
  db.exec('CREATE TABLE IF NOT EXISTS mcp_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, tool TEXT NOT NULL, summary TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO mcp_audit (ts, tool, summary) VALUES (?, ?, ?)');
  return (tool: string, summary: string) => {
    try { insert.run(Date.now(), tool, summary.slice(0, 500)); } catch (e) { console.error('[mcp audit] write failed:', e); }
  };
}

export function realDeps(): McpDeps {
  const d = discordMcpConfig();
  let api: DiscordApi | null = null;
  const confirmations = new ConfirmationStore(db, loadSecret());
  confirmations.prune();
  return {
    clickup: {
      configured: () => !!config.clickup.token,
      getMe: cu.getMe,
      listOpenTasks: cu.listOpenTasks,
      getTask: cu.getTask,
      listLists: cu.listLists,
      listMembers: cu.listMembers,
    },
    clickupWrite: {
      // Live getters: .env kill-switch flips apply without restarting MCP.
      get enabled() { return mcpPermissions().allowClickUpWrites; },
      resolveTask: cuw.resolveTask,
      addComment: cuw.addComment,
      createTask: cuw.createTask,
      updateTask: cuw.updateTask,
    },
    gmail: {
      configured: gm.gmailConfigured,
      listEmails: gm.listEmails,
      getEmail: gm.getEmail,
      createDraft: gm.createDraft,
      getProfileEmail: gm.getProfileEmail,
      getDraft: gm.getDraft,
      sendDraft: gm.sendDraft, // used only by gmail_send_confirmed_draft after a validated confirmation
      get sendEnabled() { return mcpPermissions().allowEmailSend; },
    },
    llm: { model: config.ollama.model, health: ollamaHealth, summarize: ask },
    discord: { ...d, api: () => (api ??= createDiscordRest(d.token)) },
    confirmations,
    pendingEmails: { save: savePending, remove: (id) => { kvDelete(`pending:${id}`); } },
    audit: auditLog(),
    secrets: [d.token, config.clickup.token, process.env.DISCORD_APP_ID ?? ''].filter(Boolean),
  };
}
