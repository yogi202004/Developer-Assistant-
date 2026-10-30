import Database from 'better-sqlite3';
import path from 'node:path';
import { config } from './config';

// Exported for the MCP confirmation store. The bot and the MCP server may both use this file.
export const db = new Database(path.join(config.dataDir, 'assistant.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.exec(`
  CREATE TABLE IF NOT EXISTS seen (kind TEXT NOT NULL, id TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (kind, id));
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, ts INTEGER NOT NULL);
`);

/** Returns true the first time an id is seen (used for de-duplicating notifications). */
export function markSeen(kind: string, id: string): boolean {
  return db.prepare('INSERT OR IGNORE INTO seen (kind, id, ts) VALUES (?, ?, ?)').run(kind, id, Date.now()).changes > 0;
}

export function pruneSeen(days = 30) {
  db.prepare('DELETE FROM seen WHERE ts < ?').run(Date.now() - days * 86_400_000);
  db.prepare('DELETE FROM history WHERE ts < ?').run(Date.now() - 7 * 86_400_000);
  db.prepare('DELETE FROM notifications WHERE ts < ?').run(Date.now() - days * 86_400_000);
}

export function kvGet(key: string): string | undefined {
  return (db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}
export function kvSet(key: string, value: string) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function addHistory(role: 'user' | 'assistant', content: string) {
  db.prepare('INSERT INTO history (role, content, ts) VALUES (?, ?, ?)').run(role, content, Date.now());
}
export function getHistory(limit = 12): { role: 'user' | 'assistant'; content: string }[] {
  const rows = db.prepare('SELECT role, content FROM history ORDER BY id DESC LIMIT ?').all(limit) as { role: 'user' | 'assistant'; content: string }[];
  return rows.reverse();
}
export function clearHistory() {
  db.prepare('DELETE FROM history').run();
}
export function kvDelete(key: string): boolean {
  return db.prepare('DELETE FROM kv WHERE key = ?').run(key).changes > 0;
}
/** All kv entries whose key starts with the prefix, in key order. */
export function kvList(prefix: string): { key: string; value: string }[] {
  return db.prepare("SELECT key, value FROM kv WHERE substr(key, 1, ?) = ? ORDER BY key").all(prefix.length, prefix) as { key: string; value: string }[];
}

export interface Notification { id: number; text: string; ts: number }
export function addNotification(text: string) {
  db.prepare('INSERT INTO notifications (text, ts) VALUES (?, ?)').run(text, Date.now());
}
export function listNotifications(limit = 100): Notification[] {
  return db.prepare('SELECT id, text, ts FROM notifications ORDER BY id DESC LIMIT ?').all(limit) as Notification[];
}

export interface JobStatus { name: string; lastRun: number; ok: boolean; error?: string }
export function recordJob(name: string, ok: boolean, error?: string) {
  kvSet(`job:${name}`, JSON.stringify({ name, lastRun: Date.now(), ok, error } satisfies JobStatus));
}
export function listJobs(): JobStatus[] {
  return kvList('job:').map((r) => JSON.parse(r.value) as JobStatus);
}
