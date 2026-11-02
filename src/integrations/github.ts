import { config } from '../config';

// Read-only by design: every request below is a GET. Nothing here can comment, approve, merge or push.
const BASE = 'https://api.github.com';

export interface Review { id: number; user: string; state: string; body: string; submittedAt: string | null; url: string }

export interface PullRequest {
  id: number;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  comments: number;
  labels: string[];
}

export type ReviewState = 'changes_requested' | 'approved' | 'commented' | 'pending';
export interface ReviewSummary { state: ReviewState; changesBy: string[]; approvedBy: string[]; changes: Review[] }

interface SearchItem {
  id: number; number: number; title: string; html_url: string; repository_url: string; draft?: boolean;
  user: { login: string } | null; created_at: string; updated_at: string; comments: number;
  labels?: { name: string }[]; pull_request?: { merged_at: string | null };
}
interface ApiReview { id: number; user: { login: string } | null; state: string; body: string | null; submitted_at?: string | null; html_url: string }

export const githubConfigured = () => !!config.github.token;

async function gh<T>(pathAndQuery: string): Promise<T> {
  if (!config.github.token) throw new Error('GitHub is not configured (GITHUB_TOKEN missing).');
  const res = await fetch(`${BASE}${pathAndQuery}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.github.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dev-assistant',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

let viewerCache = '';
/** The PR author to watch: GITHUB_USER, or the account that owns the token. */
export async function getAuthor(): Promise<string> {
  if (config.github.user) return config.github.user;
  viewerCache ||= (await gh<{ login: string }>('/user')).login;
  return viewerCache;
}

const repoOf = (apiUrl: string) => apiUrl.replace(/^.*\/repos\//, '');

function toPr(i: SearchItem): PullRequest {
  return {
    id: i.id,
    repo: repoOf(i.repository_url),
    number: i.number,
    title: i.title,
    url: i.html_url,
    author: i.user?.login ?? '',
    draft: !!i.draft,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    mergedAt: i.pull_request?.merged_at ?? null,
    comments: i.comments,
    labels: (i.labels ?? []).map((l) => l.name),
  };
}

async function searchPrs(qualifiers: string): Promise<PullRequest[]> {
  const author = await getAuthor();
  const repos = config.github.repos.map((r) => ` repo:${r}`).join('');
  const q = new URLSearchParams({ q: `is:pr author:${author} ${qualifiers}${repos}`, sort: 'updated', order: 'desc', per_page: '50' });
  const { items } = await gh<{ items: SearchItem[] }>(`/search/issues?${q}`);
  // Search already filters by author; checked again so only your own PRs can ever trigger anything.
  return items.map(toPr).filter((p) => p.author.toLowerCase() === author.toLowerCase());
}

/** Your open pull requests, most recently updated first. */
export const listMyOpenPrs = () => searchPrs('is:open archived:false');

/** Your pull requests merged in the last `days` days. */
export function listMyMergedPrs(days = 7): Promise<PullRequest[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return searchPrs(`is:merged merged:>=${since}`);
}

const reviewCache = new Map<string, { at: number; reviews: Review[] }>();
/** Reviews on one PR. Cached per PR version (updatedAt) for up to 10 minutes. */
export async function listReviews(pr: PullRequest): Promise<Review[]> {
  const key = `${pr.repo}#${pr.number}@${pr.updatedAt}`;
  const hit = reviewCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.reviews;
  const raw = await gh<ApiReview[]>(`/repos/${pr.repo}/pulls/${pr.number}/reviews?per_page=100`);
  const reviews = raw.map((r) => ({ id: r.id, user: r.user?.login ?? 'ghost', state: r.state, body: r.body ?? '', submittedAt: r.submitted_at ?? null, url: r.html_url }));
  for (const k of reviewCache.keys()) if (k.startsWith(`${pr.repo}#${pr.number}@`)) reviewCache.delete(k);
  reviewCache.set(key, { at: Date.now(), reviews });
  return reviews;
}

/** Current review decision from each reviewer's latest approve/request-changes review. Your own reviews are ignored. */
export function summarizeReviews(reviews: Review[], author: string): ReviewSummary {
  const me = author.toLowerCase();
  const latest = new Map<string, Review>();
  let commented = false;
  for (const r of reviews) {
    if (r.user.toLowerCase() === me) continue;
    if (r.state === 'COMMENTED') { commented = true; continue; }
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED' || r.state === 'DISMISSED') latest.set(r.user, r);
  }
  const changes = [...latest.values()].filter((r) => r.state === 'CHANGES_REQUESTED');
  const approvedBy = [...latest.values()].filter((r) => r.state === 'APPROVED').map((r) => r.user);
  const state: ReviewState = changes.length ? 'changes_requested' : approvedBy.length ? 'approved' : commented ? 'commented' : 'pending';
  return { state, changesBy: changes.map((r) => r.user), approvedBy, changes };
}

export const prRef = (p: PullRequest) => `${p.repo}#${p.number}`;
export const prLine = (p: PullRequest) => `• [${p.title}](<${p.url}>) — \`${prRef(p)}\``;
