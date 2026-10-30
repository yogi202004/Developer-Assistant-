// Imported FIRST by every test file: isolates tests from your real .env, credentials and database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-assistant-test-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  // Defined-but-empty values win over .env (dotenv never overrides existing variables).
  DISCORD_TOKEN: '', DISCORD_APP_ID: '', DISCORD_GUILD_ID: '', DISCORD_OWNER_ID: '', DISCORD_ALLOWED_GUILD_ID: '',
  CLICKUP_TOKEN: '', CLICKUP_TEAM_ID: '',
  OLLAMA_URL: 'http://127.0.0.1:9', // closed port: no real model calls
  MCP_DISCORD_CONFIRM_MODE: 'dm_code', MCP_CONFIRM_MODE: 'dm_code',
  MCP_ALLOW_EMAIL_SEND: 'true', MCP_ALLOW_CLICKUP_WRITES: 'true',
  TIMEZONE: 'UTC',
});
export const testDataDir = dir;
