// Server-side confirmation store for outbound Discord messages prepared via MCP.
//
// Why: an MCP server cannot see the chat, so a tool argument like `confirmed: true` proves nothing.
// Instead, preparing a message creates a short-lived, single-use, HMAC-signed reference, and (in the
// default "dm_code" mode) a 6-digit code is DM'd to the OWNER only. The model never sees the code, so
// a send can only happen after the human reads the code in Discord and types it into the chat.
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

export type Kind = 'discord_dm' | 'email_send';
export type Status = 'pending' | 'sending' | 'sent' | 'failed' | 'expired' | 'locked' | 'superseded';

export interface Outbound {
  id: string;
  kind: Kind;
  guildId: string;
  recipientId: string;
  recipientLabel: string;
  content: string;
  createdAt: number;
  expiresAt: number;
  status: Status;
  attempts: number;
}

interface Row {
  id: string; kind: Kind; guild_id: string; recipient_id: string; recipient_label: string; content: string;
  sig: string; code_hash: string | null; created_at: number; expires_at: number; status: Status;
  attempts: number; sent_message_id: string | null; error: string | null;
}

export const MAX_CODE_ATTEMPTS = 5;

export class ConfirmationError extends Error {
  constructor(message: string, readonly reason: 'invalid' | 'unknown' | 'expired' | 'used' | 'tampered' | 'bad_code' | 'locked' | 'guild') {
    super(message);
  }
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export class ConfirmationStore {
  constructor(
    private readonly db: Database.Database,
    private readonly secret: Buffer,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS mcp_outbound (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, recipient_id TEXT NOT NULL, recipient_label TEXT NOT NULL,
      content TEXT NOT NULL, sig TEXT NOT NULL, code_hash TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, sent_message_id TEXT, error TEXT)`);
    const cols = (db.prepare('PRAGMA table_info(mcp_outbound)').all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('kind')) db.exec(`ALTER TABLE mcp_outbound ADD COLUMN kind TEXT NOT NULL DEFAULT 'discord_dm'`);
  }

  private hmac(s: string) { return crypto.createHmac('sha256', this.secret).update(s).digest('hex'); }
  private rowSig(r: { id: string; kind: Kind; guild_id: string; recipient_id: string; content: string; expires_at: number }) {
    return this.hmac(`row|${r.kind}|${r.id}|${r.guild_id}|${r.recipient_id}|${r.expires_at}|${sha256(r.content)}`);
  }
  private refFor(id: string) { return `dmc_${id}.${this.hmac(`ref|${id}`).slice(0, 24)}`; }

  /** Creates a pending message. Returns the reference and (dm_code mode) the plaintext code to DM the owner. */
  prepare(input: { kind?: Kind; guildId: string; recipientId: string; recipientLabel: string; content: string; ttlMs: number; withCode: boolean }) {
    const id = crypto.randomBytes(16).toString('hex');
    const createdAt = this.now();
    const expiresAt = createdAt + input.ttlMs;
    const code = input.withCode ? String(crypto.randomInt(0, 1_000_000)).padStart(6, '0') : null;
    const kind: Kind = input.kind ?? 'discord_dm';
    const base = { id, kind, guild_id: input.guildId, recipient_id: input.recipientId, content: input.content, expires_at: expiresAt };
    // An older identical pending message is superseded so only the newest reference works.
    this.db.prepare(`UPDATE mcp_outbound SET status='superseded' WHERE status='pending' AND kind=? AND recipient_id=? AND content=?`)
      .run(kind, input.recipientId, input.content);
    this.db.prepare(`INSERT INTO mcp_outbound (id, kind, guild_id, recipient_id, recipient_label, content, sig, code_hash, created_at, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
      .run(id, kind, input.guildId, input.recipientId, input.recipientLabel, input.content, this.rowSig(base), code ? this.hmac(`code|${id}|${code}`) : null, createdAt, expiresAt);
    return { ref: this.refFor(id), code, expiresAt, id };
  }

  /** Discard a pending message (e.g. the owner could not be sent the code). */
  cancel(id: string) {
    this.db.prepare(`UPDATE mcp_outbound SET status='superseded' WHERE id=? AND status='pending'`).run(id);
  }

  /** Was an identical message already sent to this recipient recently? */
  recentlySent(recipientId: string, content: string, withinMs: number, kind: Kind = 'discord_dm'): boolean {
    return !!this.db.prepare(`SELECT 1 FROM mcp_outbound WHERE status='sent' AND kind=? AND recipient_id=? AND content=? AND created_at > ?`)
      .get(kind, recipientId, content, this.now() - withinMs);
  }

  /**
   * Validates a reference (+ code) and atomically claims it for sending.
   * After this returns, the reference can never be used again: call markSent/markFailed.
   */
  claim(ref: string, code: string | undefined, allowedGuildId: string, kind: Kind = 'discord_dm'): Outbound {
    const m = /^dmc_([a-f0-9]{32})\.([a-f0-9]{24})$/.exec(ref.trim());
    if (!m) throw new ConfirmationError('Invalid confirmation reference format.', 'invalid');
    const [, id, tag] = m;
    if (!safeEqual(tag, this.refFor(id).split('.')[1])) throw new ConfirmationError('Confirmation reference failed its integrity check (modified or forged).', 'tampered');

    const row = this.db.prepare('SELECT * FROM mcp_outbound WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new ConfirmationError('Unknown confirmation reference.', 'unknown');
    if (row.kind !== kind) throw new ConfirmationError(`This reference is for a different action (${row.kind}), not ${kind}.`, 'invalid');
    if (row.status === 'sent' || row.status === 'sending' || row.status === 'failed')
      throw new ConfirmationError(`This reference was already used (status: ${row.status}). Prepare a new message if needed.`, 'used');
    if (row.status === 'superseded') throw new ConfirmationError('This reference was replaced by a newer prepared message. Use the newest reference.', 'used');
    if (row.status === 'locked') throw new ConfirmationError('Too many wrong codes — this reference is locked. Prepare the message again.', 'locked');
    if (row.status === 'expired' || this.now() > row.expires_at) {
      this.db.prepare(`UPDATE mcp_outbound SET status='expired' WHERE id=? AND status='pending'`).run(id);
      throw new ConfirmationError('This confirmation reference has expired. Prepare the message again.', 'expired');
    }
    if (!safeEqual(row.sig, this.rowSig(row))) throw new ConfirmationError('Stored message failed its integrity check (recipient or text was modified). Not sending.', 'tampered');
    if (row.guild_id !== allowedGuildId) throw new ConfirmationError('This message was prepared for a server that is no longer the allowed server. Not sending.', 'guild');

    if (row.code_hash) {
      const ok = !!code && /^\d{6}$/.test(code.trim()) && safeEqual(row.code_hash, this.hmac(`code|${id}|${code.trim()}`));
      if (!ok) {
        const attempts = row.attempts + 1;
        const locked = attempts >= MAX_CODE_ATTEMPTS;
        this.db.prepare(`UPDATE mcp_outbound SET attempts=?, status=CASE WHEN ? THEN 'locked' ELSE status END WHERE id=?`).run(attempts, locked ? 1 : 0, id);
        throw new ConfirmationError(
          locked ? 'Wrong confirmation code. Too many attempts — reference locked.'
            : `Missing or wrong confirmation code. Ask the user for the 6-digit code the assistant bot sent them on Discord (${MAX_CODE_ATTEMPTS - attempts} attempts left).`,
          locked ? 'locked' : 'bad_code');
      }
    }

    // Atomic single-use claim: only one caller can move pending -> sending.
    const claimed = this.db.prepare(`UPDATE mcp_outbound SET status='sending' WHERE id=? AND status='pending'`).run(id).changes === 1;
    if (!claimed) throw new ConfirmationError('This reference was already used.', 'used');
    return {
      id, kind: row.kind, guildId: row.guild_id, recipientId: row.recipient_id, recipientLabel: row.recipient_label, content: row.content,
      createdAt: row.created_at, expiresAt: row.expires_at, status: 'sending', attempts: row.attempts,
    };
  }

  markSent(id: string, messageId: string) {
    this.db.prepare(`UPDATE mcp_outbound SET status='sent', sent_message_id=? WHERE id=?`).run(messageId, id);
  }
  /** Failed sends are NOT retried with the same reference, to avoid accidental duplicates. */
  markFailed(id: string, error: string) {
    this.db.prepare(`UPDATE mcp_outbound SET status='failed', error=? WHERE id=?`).run(error.slice(0, 500), id);
  }
  status(id: string): Status | undefined {
    return (this.db.prepare('SELECT status FROM mcp_outbound WHERE id=?').get(id) as { status: Status } | undefined)?.status;
  }
  prune(olderThanMs = 30 * 86_400_000) {
    this.db.prepare('DELETE FROM mcp_outbound WHERE created_at < ?').run(this.now() - olderThanMs);
  }
}
