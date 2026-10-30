import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { config, projectRoot } from '../config';
import { errMsg } from '../util';
import { HttpError, type Routes } from './http';
import { dashboardKey, dashboardUrl } from './key';
import type { LiveExtras } from './live-api';

const COOKIE = 'da_key';
const MAX_BODY = 64 * 1024;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req: http.IncomingMessage, name: string): string {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request body too large.');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'Expected a JSON object.');
  return parsed as Record<string, unknown>;
}

function serveStatic(publicDir: string, pathname: string, res: http.ServerResponse) {
  let rel: string;
  try { rel = decodeURIComponent(pathname); } catch { rel = ''; }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(publicDir, `.${rel}`);
  const type = TYPES[path.extname(file)];
  if (!file.startsWith(publicDir + path.sep) || !type || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

export interface DashboardOptions { routes: Routes; key: string; publicDir: string }

/**
 * Local-only dashboard server. Requests must use a 127.0.0.1/localhost Host header (blocks DNS rebinding),
 * API calls need the key cookie, and writes must come from the dashboard's own origin as JSON (blocks CSRF).
 */
export function createDashboardServer(o: DashboardOptions): http.Server {
  const publicDir = path.resolve(o.publicDir);
  const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body ?? null));
    };
    try {
      const port = (server.address() as AddressInfo).port;
      const host = req.headers.host ?? '';
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return json(421, { error: 'Unknown host.' });
      const url = new URL(req.url ?? '/', `http://${host}`);

      if (req.method === 'GET' && url.searchParams.has('key')) {
        const ok = safeEqual(url.searchParams.get('key') ?? '', o.key);
        res.writeHead(302, {
          Location: '/',
          ...(ok ? { 'Set-Cookie': `${COOKIE}=${o.key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` } : {}),
        });
        return res.end();
      }

      if (url.pathname.startsWith('/api/')) {
        if (!safeEqual(readCookie(req, COOKIE), o.key)) return json(401, { error: 'Locked. Open the dashboard with: npm run dashboard' });
        if (req.method !== 'GET') {
          if (req.headers.origin !== `http://${host}`) return json(403, { error: 'Cross-origin request blocked.' });
          if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(415, { error: 'Expected application/json.' });
        }
        const handler = o.routes[`${req.method} ${url.pathname}`];
        if (!handler) return json(404, { error: 'Not found.' });
        const input = req.method === 'POST' ? await readJson(req) : Object.fromEntries(url.searchParams);
        return json(200, await handler(input));
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'Method not allowed.' });
      serveStatic(publicDir, url.pathname, res);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('[dashboard]', errMsg(e));
      if (!res.headersSent) json(status, { error: errMsg(e) });
    }
  });
  return server;
}

/** Starts the dashboard on 127.0.0.1. Never throws: the bot keeps running if the port is taken. */
export async function startDashboard(extra: LiveExtras): Promise<http.Server | null> {
  const { liveRoutes } = await import('./live-api');
  const server = createDashboardServer({ routes: liveRoutes(extra), key: dashboardKey(), publicDir: path.join(projectRoot, 'public') });
  return new Promise((resolve) => {
    server.once('error', (e) => {
      console.warn(`⚠️  Dashboard not started: ${errMsg(e)}. Set DASHBOARD_PORT in .env to a free port.`);
      resolve(null);
    });
    server.listen(config.dashboard.port, '127.0.0.1', () => {
      console.log(`📊 Dashboard on ${dashboardUrl()} — open it with: npm run dashboard`);
      resolve(server);
    });
  });
}
