// MCP server entry point (stdio). Launched by Cursor / Claude Code — see docs/MCP_SETUP.md.
// Does NOT log in to the Discord gateway or start the scheduler; the main bot (npm start) keeps doing that.
import './mcp/stdout-guard'; // must stay first: keeps stdout clean for the protocol
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp/server';
import { realDeps } from './mcp/deps';
import { db } from './db';

const server = createMcpServer(realDeps());
const transport = new StdioServerTransport();

let closing = false;
async function shutdown(reason: string) {
  if (closing) return;
  closing = true;
  console.error(`[dev-assistant mcp] shutting down (${reason})`);
  try { await server.close(); } catch { /* ignore */ }
  try { db.close(); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.stdin.on('end', () => void shutdown('stdin closed'));
process.on('unhandledRejection', (e) => console.error('[dev-assistant mcp] unhandled rejection:', e instanceof Error ? e.message : e));

await server.connect(transport);
console.error('[dev-assistant mcp] ready on stdio');
