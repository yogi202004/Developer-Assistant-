import { config } from '../config';

export type ToolCall = { function: { name: string; arguments: Record<string, unknown> | string } };
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
};
export type ToolDef = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

export async function chat(messages: ChatMessage[], tools?: ToolDef[], opts: { json?: boolean } = {}): Promise<ChatMessage> {
  const body: Record<string, unknown> = {
    model: config.ollama.model,
    messages,
    stream: false,
    options: { num_ctx: config.ollama.numCtx, temperature: 0.3 },
  };
  if (tools?.length) body.tools = tools;
  if (opts.json) body.format = 'json';
  if (config.ollama.think !== undefined) body.think = config.ollama.think;

  const res = await fetch(`${config.ollama.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { message: ChatMessage };
  return { ...data.message, content: stripThink(data.message.content ?? '') };
}

/** Returns null if healthy, otherwise a human-readable problem. */
export async function ollamaHealth(): Promise<string | null> {
  try {
    const res = await fetch(`${config.ollama.url}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { models?: { name: string }[] };
    const want = config.ollama.model;
    const names = (data.models ?? []).map((m) => m.name);
    const found = names.some((n) => n === want || n === `${want}:latest`);
    return found ? null : `Model "${want}" not found. Run: ollama pull ${want}`;
  } catch {
    return `Can't reach Ollama at ${config.ollama.url}. Is the Ollama app running?`;
  }
}
