// Opens your private dashboard in the browser, signed in with the key from data/dashboard.key.
import { spawn } from 'node:child_process';
import { dashboardKey, dashboardUrl } from '../dashboard/key';

const url = dashboardUrl(dashboardKey());
const running = await fetch(`${dashboardUrl()}api/session`, { signal: AbortSignal.timeout(3000) }).then(() => true, () => false);

if (!running) {
  console.log('⚠️  The assistant is not running, so the dashboard is not available.');
  console.log('   Start it in the background (recommended):  npm run service:install');
  console.log('   Or in this terminal:                        npm start');
  process.exitCode = 1;
} else if (process.platform === 'darwin') {
  spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  console.log('📊 Dashboard opened in your browser. Bookmark it: after the first visit, http://127.0.0.1 without the key works too.');
} else {
  console.log(`Open this link in your browser (it contains your secret key, don't share it):\n${url}`);
}
