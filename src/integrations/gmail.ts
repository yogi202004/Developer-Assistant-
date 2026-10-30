import fs from 'node:fs';
import { google, type gmail_v1 } from 'googleapis';
import { config } from '../config';

// readonly = read mail; compose = create drafts and send them (only after you tap Send).
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
];

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  replyTo: string;
  subject: string;
  date: string;
  snippet: string;
  messageId: string;
  link: string;
}

export const gmailConfigured = () =>
  fs.existsSync(config.gmail.credentialsPath) && fs.existsSync(config.gmail.tokenPath);

export function loadOAuthClient(redirectUri?: string) {
  const raw = JSON.parse(fs.readFileSync(config.gmail.credentialsPath, 'utf8'));
  const c = raw.installed ?? raw.web;
  if (!c) throw new Error('google-credentials.json is not an OAuth client file (Desktop app).');
  return new google.auth.OAuth2(c.client_id, c.client_secret, redirectUri ?? c.redirect_uris?.[0]);
}

let api: gmail_v1.Gmail | null = null;
function gmail(): gmail_v1.Gmail {
  if (api) return api;
  if (!gmailConfigured()) throw new Error('Gmail is not set up. Run: npm run gmail:auth');
  const auth = loadOAuthClient();
  auth.setCredentials(JSON.parse(fs.readFileSync(config.gmail.tokenPath, 'utf8')));
  auth.on('tokens', (t) => {
    const prev = JSON.parse(fs.readFileSync(config.gmail.tokenPath, 'utf8'));
    fs.writeFileSync(config.gmail.tokenPath, JSON.stringify({ ...prev, ...t }, null, 2));
  });
  api = google.gmail({ version: 'v1', auth });
  return api;
}

const header = (m: gmail_v1.Schema$Message, name: string) =>
  m.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

function toSummary(m: gmail_v1.Schema$Message): EmailSummary {
  const from = header(m, 'From');
  return {
    id: m.id!,
    threadId: m.threadId!,
    from,
    replyTo: header(m, 'Reply-To') || from,
    subject: header(m, 'Subject') || '(no subject)',
    date: header(m, 'Date'),
    snippet: decodeEntities(m.snippet ?? ''),
    messageId: header(m, 'Message-ID'),
    link: `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
  };
}

export async function listEmails(query = config.gmail.query, max = 15): Promise<EmailSummary[]> {
  const g = gmail();
  const list = await g.users.messages.list({ userId: 'me', q: query, maxResults: max });
  const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  const msgs = await Promise.all(
    ids.map((id) =>
      g.users.messages.get({
        userId: 'me', id, format: 'metadata',
        metadataHeaders: ['From', 'Reply-To', 'Subject', 'Date', 'Message-ID'],
      }),
    ),
  );
  return msgs.map((r) => toSummary(r.data));
}

export async function getEmail(id: string): Promise<{ meta: EmailSummary; body: string }> {
  const { data } = await gmail().users.messages.get({ userId: 'me', id, format: 'full' });
  const plain = findPart(data.payload, 'text/plain');
  const html = plain ? '' : findPart(data.payload, 'text/html');
  const body = (plain || htmlToText(html) || data.snippet || '').trim();
  return { meta: toSummary(data), body: body.slice(0, 12_000) };
}

export interface OutgoingEmail {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
}

export function buildRaw(e: OutgoingEmail): string {
  const headers = [
    `To: ${e.to}`,
    ...(e.cc ? [`Cc: ${e.cc}`] : []),
    `Subject: ${encodeHeader(e.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  if (e.inReplyTo) headers.push(`In-Reply-To: ${e.inReplyTo}`, `References: ${e.inReplyTo}`);
  const b64 = Buffer.from(e.body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${b64}`).toString('base64url');
}

/** Saves an email as a Gmail DRAFT. Returns the draft id. */
export async function createDraft(e: OutgoingEmail): Promise<string> {
  const res = await gmail().users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw: buildRaw(e), threadId: e.threadId } },
  });
  if (!res.data.id) throw new Error('Gmail did not return a draft id.');
  return res.data.id;
}

export async function createReplyDraft(email: EmailSummary, body: string): Promise<{ draftId: string; to: string; subject: string }> {
  const subject = /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`;
  const draftId = await createDraft({ to: email.replyTo, subject, body, threadId: email.threadId, inReplyTo: email.messageId || undefined });
  return { draftId, to: email.replyTo, subject };
}

/** Current To/Cc/Subject of a draft (reflects any edits you made in Gmail). */
export async function getDraftInfo(draftId: string): Promise<{ to: string; cc: string; subject: string }> {
  const { data } = await gmail().users.drafts.get({ userId: 'me', id: draftId, format: 'metadata' });
  const m = data.message ?? {};
  return { to: header(m, 'To'), cc: header(m, 'Cc'), subject: header(m, 'Subject') };
}

/** Sends an existing draft (its latest version, including edits made in Gmail). */
export async function sendDraft(draftId: string): Promise<void> {
  await gmail().users.drafts.send({ userId: 'me', requestBody: { id: draftId } });
}

export async function deleteDraft(draftId: string): Promise<void> {
  await gmail().users.drafts.delete({ userId: 'me', id: draftId });
}

// ---------- helpers ----------
function findPart(part: gmail_v1.Schema$MessagePart | undefined, mime: string): string {
  if (!part) return '';
  if (part.mimeType === mime && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return '';
}

function decodeEntities(s: string) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function htmlToText(html: string): string {
  if (!html) return '';
  return decodeEntities(
    html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n');
}

function encodeHeader(s: string) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

/** The connected account's address (used only for the status check). */
export async function getProfileEmail(): Promise<string> {
  const { data } = await gmail().users.getProfile({ userId: 'me' });
  return data.emailAddress ?? '';
}

/** Full current content of a draft (reflects edits made in Gmail). */
export async function getDraft(draftId: string): Promise<{ to: string; cc: string; bcc: string; subject: string; body: string }> {
  const { data } = await gmail().users.drafts.get({ userId: 'me', id: draftId, format: 'full' });
  const m = data.message ?? {};
  const plain = findPart(m.payload, 'text/plain');
  const body = (plain || htmlToText(findPart(m.payload, 'text/html')) || '').trim();
  return { to: header(m, 'To'), cc: header(m, 'Cc'), bcc: header(m, 'Bcc'), subject: header(m, 'Subject'), body };
}
