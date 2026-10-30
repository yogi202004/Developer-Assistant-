// One-time Gmail login. Run: npm run gmail:auth
import fs from 'node:fs';
import http from 'node:http';
import { exec } from 'node:child_process';
import { config } from '../config';
import { GMAIL_SCOPES, loadOAuthClient } from '../integrations/gmail';

if (!fs.existsSync(config.gmail.credentialsPath)) {
  console.error(`\n❌ Put your OAuth Desktop client JSON at:\n   ${config.gmail.credentialsPath}\n   (see README → Gmail setup)\n`);
  process.exit(1);
}

const PORT = 53682;
const redirect = `http://127.0.0.1:${PORT}/oauth2callback`;
const auth = loadOAuthClient(redirect);
const url = auth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GMAIL_SCOPES });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', redirect);
  if (u.pathname !== '/oauth2callback') { res.writeHead(404).end(); return; }
  const code = u.searchParams.get('code');
  if (!code) { res.end(`Login failed: ${u.searchParams.get('error') ?? 'no code'}`); return; }
  try {
    const { tokens } = await auth.getToken(code);
    fs.writeFileSync(config.gmail.tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    res.end('✅ Gmail connected. You can close this tab and return to the terminal.');
    console.log(`\n✅ Saved token to ${config.gmail.tokenPath}. Gmail is ready.\n`);
  } catch (e) {
    res.end('Token exchange failed — see terminal.');
    console.error(e);
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nOpen this URL to authorize Gmail (opening automatically on macOS):\n\n${url}\n`);
  exec(`open "${url}"`, () => {});
});
