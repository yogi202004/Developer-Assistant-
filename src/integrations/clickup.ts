import { config } from '../config';
import { fmtDate } from '../util';

const BASE = 'https://api.clickup.com/api/v2';

export interface Task {
  id: string;
  custom_id?: string | null;
  name: string;
  status: { status: string; type?: string };
  priority: { priority: string } | null;
  due_date: string | null;
  url: string;
  list?: { name: string };
  description?: string;
  text_content?: string;
  markdown_description?: string;
  checklists?: { name: string; items: { name: string; resolved: boolean }[] }[];
  assignees?: { id: number; username?: string | null }[];
  team_id?: string;
}

async function cu<T>(pathAndQuery: string): Promise<T> {
  if (!config.clickup.token) throw new Error('ClickUp is not configured (CLICKUP_TOKEN missing).');
  const res = await fetch(`${BASE}${pathAndQuery}`, {
    headers: { Authorization: config.clickup.token },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

let meCache: { id: number; username: string } | null = null;
export async function getMe() {
  meCache ??= (await cu<{ user: { id: number; username: string } }>('/user')).user;
  return meCache;
}

let teamCache = '';
export async function getTeamId(): Promise<string> {
  if (config.clickup.teamId) return config.clickup.teamId;
  if (!teamCache) {
    const { teams } = await cu<{ teams: { id: string }[] }>('/team');
    if (!teams.length) throw new Error('No ClickUp workspaces found for this token.');
    teamCache = teams[0].id;
  }
  return teamCache;
}

const isDone = (t: Task) => t.status.type === 'closed' || t.status.type === 'done';

const NOT_STARTED = /^(to ?do|open|backlog|new|not started|planned)$/i;
/** Started but not finished: ClickUp's "custom" statuses (in progress, testing, review, …), not the first "open" status. */
export function isWorkingOn(t: Task): boolean {
  if (isDone(t)) return false;
  return t.status.type ? t.status.type === 'custom' : !NOT_STARTED.test(t.status.status.trim());
}

export async function listMyOpenTasks(): Promise<Task[]> {
  const me = await getMe();
  return listOpenTasks([me.id]);
}

/** Read-only: open tasks in the workspace assigned to any of the given ClickUp user ids. */
export async function listOpenTasks(assigneeIds: number[]): Promise<Task[]> {
  const team = await getTeamId();
  const all: Task[] = [];
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ page: String(page), include_closed: 'false', subtasks: 'true', order_by: 'updated' });
    for (const id of assigneeIds) q.append('assignees[]', String(id));
    const data = await cu<{ tasks: Task[]; last_page?: boolean }>(`/team/${team}/task?${q}`);
    all.push(...data.tasks);
    if (data.last_page !== false || data.tasks.length < 100) break;
  }
  return all.filter((t) => !isDone(t));
}

/** Accepts a task id, a custom id like DEV-123, or a ClickUp task URL. */
export async function getTask(input: string): Promise<Task> {
  const clean = input.trim().replace(/^#/, '');
  const fromUrl = /\/t\/(?:\d+\/)?([A-Za-z0-9-]+)/.exec(clean)?.[1];
  const taskId = fromUrl ?? clean;
  const q = new URLSearchParams({ include_markdown_description: 'true' });
  if (taskId.includes('-')) { q.set('custom_task_ids', 'true'); q.set('team_id', await getTeamId()); }
  return cu<Task>(`/task/${encodeURIComponent(taskId)}?${q}`);
}

export interface ListInfo { id: string; name: string; space: string; folder: string | null }
let listCache: { at: number; lists: ListInfo[] } | null = null;

/** Read-only: every list in the workspace (cached 5 minutes). */
export async function listLists(): Promise<ListInfo[]> {
  if (listCache && Date.now() - listCache.at < 5 * 60_000) return listCache.lists;
  const team = await getTeamId();
  const { spaces } = await cu<{ spaces: { id: string; name: string }[] }>(`/team/${team}/space?archived=false`);
  const lists: ListInfo[] = [];
  for (const sp of spaces) {
    const [{ folders }, { lists: loose }] = await Promise.all([
      cu<{ folders: { name: string; lists?: { id: string; name: string }[] }[] }>(`/space/${sp.id}/folder?archived=false`),
      cu<{ lists: { id: string; name: string }[] }>(`/space/${sp.id}/list?archived=false`),
    ]);
    for (const l of loose) lists.push({ id: l.id, name: l.name, space: sp.name, folder: null });
    for (const f of folders) for (const l of f.lists ?? []) lists.push({ id: l.id, name: l.name, space: sp.name, folder: f.name });
  }
  listCache = { at: Date.now(), lists };
  return lists;
}

export interface WorkspaceMember { id: number; username: string; email: string | null }

/** Read-only: members of the configured workspace. */
export async function listMembers(): Promise<WorkspaceMember[]> {
  const team = await getTeamId();
  const { teams } = await cu<{ teams: { id: string; members: { user: { id: number; username: string | null; email?: string | null } }[] }[] }>('/team');
  const t = teams.find((x) => String(x.id) === String(team));
  return (t?.members ?? []).map((m) => ({ id: m.user.id, username: m.user.username ?? `user ${m.user.id}`, email: m.user.email ?? null }));
}

export function taskLine(t: Task): string {
  const pr = t.priority?.priority ? `\`${t.priority.priority}\` ` : '';
  const due = t.due_date ? ` · due ${fmtDate(Number(t.due_date))}` : '';
  return `• ${pr}[${t.name}](<${t.url}>) — _${t.status.status}_${due}${t.list ? ` · ${t.list.name}` : ''} · id \`${t.id}\``;
}

export function taskContext(t: Task): string {
  const desc = t.markdown_description || t.text_content || t.description || '(no description)';
  const checklists = (t.checklists ?? [])
    .map((c) => `Checklist "${c.name}":\n${c.items.map((i) => `- [${i.resolved ? 'x' : ' '}] ${i.name}`).join('\n')}`)
    .join('\n');
  return [
    `Task: ${t.name}${t.custom_id ? ` (${t.custom_id})` : ''}`,
    `Status: ${t.status.status} | Priority: ${t.priority?.priority ?? 'none'} | Due: ${t.due_date ? fmtDate(Number(t.due_date)) : 'none'}`,
    `List: ${t.list?.name ?? '-'} | URL: ${t.url}`,
    `Description:\n${desc.slice(0, 8000)}`,
    checklists,
  ].filter(Boolean).join('\n');
}
