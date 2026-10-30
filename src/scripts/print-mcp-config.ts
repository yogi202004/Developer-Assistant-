// Prints copy-paste MCP configs with YOUR absolute paths filled in (nothing is written or committed).
// Run: npm run mcp:config
import path from 'node:path';
import { createRequire } from 'node:module';
import { projectRoot } from '../config';

const require = createRequire(import.meta.url);
const node = process.execPath;
const tsxCli = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');
const entry = path.join(projectRoot, 'src', 'mcp.ts');

const cursor = { mcpServers: { 'dev-assistant': { command: node, args: [tsxCli, entry] } } };
const q = (s: string) => (/[\s"'$]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s);

process.stdout.write(`
# Cursor — merge this entry into the "mcpServers" object of ~/.cursor/mcp.json
${JSON.stringify(cursor, null, 2)}

# Claude Code — run once in a terminal (user scope = available in every project)
claude mcp add --scope user dev-assistant -- ${q(node)} ${q(tsxCli)} ${q(entry)}

`);
