// ClickUp WRITE operations, kept separate from the read-only module (clickup.ts).
// Only create/update/comment. There is deliberately no delete.
import { config } from '../config';
import { getTask, getTeamId, type Task } from './clickup';

const BASE = 'https://api.clickup.com/api/v2';

async function write<T>(method: 'POST' | 'PUT', path: string, body: Record<string, unknown>): Promise<T> {
  if (!config.clickup.token) throw new Error('ClickUp is not configured (CLICKUP_TOKEN missing).');
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: config.clickup.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/** Resolves an id / custom id / URL to the canonical task and checks it belongs to the configured workspace. */
export async function resolveTask(input: string): Promise<Task> {
  const t = await getTask(input);
  const team = await getTeamId();
  if (t.team_id && String(t.team_id) !== String(team)) throw new Error('That task belongs to a different ClickUp workspace than the configured one. Not changing it.');
  return t;
}

export async function addComment(taskId: string, text: string, notifyAll: boolean): Promise<{ id: string }> {
  const r = await write<{ id: string | number }>('POST', `/task/${encodeURIComponent(taskId)}/comment`, { comment_text: text, notify_all: notifyAll });
  return { id: String(r.id) };
}

export interface TaskFields {
  name?: string;
  description?: string;
  status?: string;
  priority?: 1 | 2 | 3 | 4 | null;
  due_date?: number | null;
  assignees?: number[];
}

export async function createTask(listId: string, f: TaskFields & { name: string }): Promise<Task> {
  const body: Record<string, unknown> = { name: f.name };
  if (f.description !== undefined) body.description = f.description;
  if (f.status) body.status = f.status;
  if (f.priority !== undefined && f.priority !== null) body.priority = f.priority;
  if (f.due_date) { body.due_date = f.due_date; body.due_date_time = true; }
  if (f.assignees?.length) body.assignees = f.assignees;
  return write<Task>('POST', `/list/${encodeURIComponent(listId)}/task`, body);
}

export async function updateTask(taskId: string, f: Omit<TaskFields, 'assignees'> & { add_assignees?: number[]; remove_assignees?: number[] }): Promise<Task> {
  const body: Record<string, unknown> = {};
  if (f.name !== undefined) body.name = f.name;
  if (f.description !== undefined) body.description = f.description;
  if (f.status !== undefined) body.status = f.status;
  if (f.priority !== undefined) body.priority = f.priority;
  if (f.due_date !== undefined) { body.due_date = f.due_date; body.due_date_time = f.due_date !== null; }
  if (f.add_assignees?.length || f.remove_assignees?.length) body.assignees = { add: f.add_assignees ?? [], rem: f.remove_assignees ?? [] };
  return write<Task>('PUT', `/task/${encodeURIComponent(taskId)}`, body);
}
