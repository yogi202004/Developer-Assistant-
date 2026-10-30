import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

const keyFile = () => path.join(config.dataDir, 'dashboard.key');

/** The secret that unlocks the dashboard. Created on first use, stored only in data/. */
export function dashboardKey(): string {
  try {
    const existing = fs.readFileSync(keyFile(), 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch { /* create below */ }
  const key = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(keyFile(), key, { mode: 0o600 });
  return key;
}

export const dashboardUrl = (key?: string) => `http://127.0.0.1:${config.dashboard.port}/${key ? `?key=${key}` : ''}`;
