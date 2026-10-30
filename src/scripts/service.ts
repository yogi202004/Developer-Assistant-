// Runs the assistant as a macOS background service (launchd): starts at login, restarts if it crashes.
//   npm run service:install | service:uninstall | service:restart | service:status | service:logs
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { config, projectRoot } from '../config';
import { dashboardUrl } from '../dashboard/key';

const LABEL = 'com.devassistant.agent';
const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const domain = `gui/${process.getuid?.() ?? 501}`;
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function plist(): string {
  const args = [process.execPath, path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(projectRoot, 'src', 'index.ts')];
  const pathEnv = [...new Set([path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(':');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${xml(projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(pathEnv)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${xml(config.logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(config.logFile)}</string>
</dict>
</plist>
`;
}

const launchctl = (...args: string[]) => spawnSync('launchctl', args, { encoding: 'utf8' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function serviceState(): { loaded: boolean; running: boolean; pid?: string; lastExit?: string } {
  const r = launchctl('print', `${domain}/${LABEL}`);
  if (r.status !== 0) return { loaded: false, running: false };
  return {
    loaded: true,
    running: /\bstate = running\b/.test(r.stdout),
    pid: /\bpid = (\d+)/.exec(r.stdout)?.[1],
    lastExit: /last exit code = ([^\n]+)/.exec(r.stdout)?.[1]?.trim(),
  };
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(1000, () => { s.destroy(); resolve(false); });
  });
}

function otherInstances(): string[] {
  const r = spawnSync('pgrep', ['-fl', 'src/index.ts'], { encoding: 'utf8' });
  return (r.stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.includes('pgrep'));
}

function recentLog(lines = 25): string {
  try { return fs.readFileSync(config.logFile, 'utf8').split('\n').slice(-lines).join('\n'); } catch { return ''; }
}

async function status() {
  const s = serviceState();
  if (!s.loaded) {
    console.log('⚪ Background service is not installed. Install it with: npm run service:install');
    return;
  }
  console.log(s.running ? `🟢 Running (pid ${s.pid})` : `🔴 Installed but not running (last exit code ${s.lastExit ?? 'unknown'})`);
  console.log(`   Dashboard: ${dashboardUrl()}  (open with: npm run dashboard)`);
  console.log(`   Log file:  ${config.logFile}`);
  const log = recentLog(400);
  if (/Operation not permitted|EPERM/.test(log)) {
    console.log(`\n⚠️  macOS is blocking access to the project folder. See "Folder permission" in README.md, or move the project out of Desktop/Documents/Downloads and reinstall.`);
  }
}

async function install() {
  if (process.platform !== 'darwin') throw new Error('The background service uses launchd and only works on macOS.');
  const loaded = serviceState().loaded;
  if (!loaded) {
    const others = otherInstances();
    if (others.length || (await portInUse(config.dashboard.port))) {
      console.log('⚠️  The assistant already seems to be running (probably `npm start` in a terminal):');
      for (const o of others) console.log(`   ${o}`);
      console.log('   Stop it first (Ctrl+C in that terminal), otherwise you will get every alert twice.');
      process.exitCode = 1;
      return;
    }
  }
  const home = os.homedir();
  if (['Desktop', 'Documents', 'Downloads'].some((d) => projectRoot.startsWith(path.join(home, d) + path.sep))) {
    console.log('ℹ️  This project is inside a protected macOS folder. If macOS asks whether "node" may access it, click Allow.');
  }
  fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  if (loaded) launchctl('bootout', `${domain}/${LABEL}`);
  fs.writeFileSync(plistPath, plist());
  const r = launchctl('bootstrap', domain, plistPath);
  if (r.status !== 0) throw new Error(`launchctl bootstrap failed: ${(r.stderr || r.stdout).trim()}`);
  console.log(`✅ Installed ${plistPath}`);
  console.log('   The assistant now starts automatically when you log in and restarts if it crashes.');
  console.log('   Checking that it started…');
  await sleep(8000);
  await status();
  if (serviceState().running) console.log('\nOpen the dashboard with: npm run dashboard');
  else console.log(`\nRecent log output:\n${recentLog()}`);
}

function uninstall() {
  launchctl('bootout', `${domain}/${LABEL}`);
  if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
  console.log('🗑️  Background service removed. Start the assistant manually with: npm start');
}

async function restart() {
  if (!serviceState().loaded) { console.log('Not installed. Run: npm run service:install'); return; }
  launchctl('kickstart', '-k', `${domain}/${LABEL}`);
  console.log('🔄 Restarting…');
  await sleep(5000);
  await status();
}

function logs() {
  if (!fs.existsSync(config.logFile)) { console.log(`No log file yet at ${config.logFile}`); return; }
  spawn('tail', ['-n', '60', '-f', config.logFile], { stdio: 'inherit' });
}

const cmd = process.argv[2] ?? 'status';
const commands: Record<string, () => unknown> = { install, uninstall, restart, status, logs };
if (!commands[cmd]) {
  console.log('Usage: tsx src/scripts/service.ts install | uninstall | restart | status | logs');
  process.exitCode = 1;
} else {
  try { await commands[cmd](); } catch (e) { console.error(`❌ ${e instanceof Error ? e.message : e}`); process.exitCode = 1; }
}
