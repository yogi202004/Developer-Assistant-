// Preview the public demo exactly as Vercel serves it: static files from public/ plus api/ai.js.
//   npm run demo   ->  http://127.0.0.1:4748
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot } from '../config';

const PORT = Number(process.env.DEMO_PORT) || 4748;
const publicDir = path.join(projectRoot, 'public');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const { default: ai } = (await import(pathToFileURL(path.join(projectRoot, 'api', 'ai.js')).href)) as { default: http.RequestListener };

http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/ai') return void ai(req, res);
  if (url.pathname.startsWith('/api/')) { res.writeHead(404); return void res.end('Not found'); }
  const file = path.resolve(publicDir, `.${url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)}`);
  const type = TYPES[path.extname(file)];
  if (!file.startsWith(publicDir + path.sep) || !type || !fs.existsSync(file)) { res.writeHead(404); return void res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`🌐 Public demo preview: http://127.0.0.1:${PORT}`);
  console.log(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY ? '   Live AI: on' : '   Live AI: off (pre-written answers). Set GROQ_API_KEY or GEMINI_API_KEY to try live answers.');
});
