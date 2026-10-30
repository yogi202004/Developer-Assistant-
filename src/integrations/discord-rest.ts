// Discord access for the MCP server via the REST API only.
// It never opens a gateway connection, so it can run alongside the main bot process.
// Messages are sent AS THE ASSISTANT BOT (bot token), never as a personal account.
import { REST, Routes, DiscordAPIError, type APIGuildMember, type APIUser, type APIChannel, type APIMessage } from 'discord.js';

export interface Member {
  userId: string;
  username: string;
  globalName: string | null;
  nickname: string | null;
  displayName: string;
  isBot: boolean;
}

export interface MessageButton { customId: string; label: string; style: 'success' | 'secondary' }

/** Everything the MCP tools need from Discord. Tests provide a fake implementation. */
export interface DiscordApi {
  getBotUser(): Promise<{ id: string; username: string }>;
  getGuildName(guildId: string): Promise<string>;
  /** Returns null if the user is not a member of the guild. */
  getMember(guildId: string, userId: string): Promise<Member | null>;
  searchMembers(guildId: string, query: string, limit: number): Promise<Member[]>;
  listMembers(guildId: string, limit: number): Promise<Member[]>;
  /** DM a user as the bot. Mentions are never parsed (no @everyone / role pings). */
  sendDm(userId: string, content: string, buttons?: MessageButton[]): Promise<{ messageId: string; channelId: string }>;
}

export class DiscordError extends Error {
  constructor(message: string, readonly code?: number | string, readonly status?: number) {
    super(message);
  }
}

export function toMember(m: APIGuildMember): Member {
  const u = m.user as APIUser;
  return {
    userId: u.id,
    username: u.username,
    globalName: u.global_name ?? null,
    nickname: m.nick ?? null,
    displayName: m.nick || u.global_name || u.username,
    isBot: !!u.bot,
  };
}

/** Translate Discord API errors into actionable messages (never includes the token). */
export function explainDiscordError(e: unknown, action: string): DiscordError {
  if (e instanceof DiscordAPIError) {
    const hints: Record<string, string> = {
      '50007': 'Discord will not let the bot DM this user (they have DMs from server members turned off, blocked the bot, or share no server with it).',
      '50001': 'The bot has no access. Make sure the assistant bot has been added to the allowed server.',
      '10004': 'Unknown server. Check DISCORD_ALLOWED_GUILD_ID and that the bot is a member of that server.',
      '10007': 'That user is not a member of the allowed server.',
      '10013': 'Unknown Discord user.',
      '40001': 'Unauthorized. DISCORD_TOKEN is invalid or was reset.',
    };
    const hint = hints[String(e.code)] ??
      (e.status === 403 && action.includes('list') ? 'Enable the "Server Members Intent" for the bot in the Discord Developer Portal (Bot page).' : '');
    return new DiscordError(`Discord ${action} failed (${e.status}/${e.code}): ${hint || e.message}`, e.code, e.status);
  }
  if (e instanceof DiscordError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new DiscordError(`Discord ${action} failed: ${msg}`);
}

export function createDiscordRest(token: string): DiscordApi {
  if (!token) throw new DiscordError('Discord is not configured (DISCORD_TOKEN missing in .env).');
  const rest = new REST({ version: '10', timeout: 15_000 }).setToken(token);

  const call = async <T>(action: string, fn: () => Promise<unknown>): Promise<T> => {
    try { return (await fn()) as T; } catch (e) { throw explainDiscordError(e, action); }
  };

  return {
    async getBotUser() {
      const u = await call<APIUser>('get bot user', () => rest.get(Routes.user('@me')));
      return { id: u.id, username: u.username };
    },
    async getGuildName(guildId) {
      const g = await call<{ name: string }>('get server', () => rest.get(Routes.guild(guildId)));
      return g.name;
    },
    async getMember(guildId, userId) {
      try {
        return toMember((await rest.get(Routes.guildMember(guildId, userId))) as APIGuildMember);
      } catch (e) {
        if (e instanceof DiscordAPIError && (e.code === 10007 || e.code === 10013)) return null;
        throw explainDiscordError(e, 'get member');
      }
    },
    async searchMembers(guildId, query, limit) {
      const q = new URLSearchParams({ query, limit: String(Math.min(limit, 100)) });
      const list = await call<APIGuildMember[]>('search members', () => rest.get(Routes.guildMembersSearch(guildId), { query: q }));
      return list.map(toMember);
    },
    async listMembers(guildId, limit) {
      const q = new URLSearchParams({ limit: String(Math.min(limit, 1000)) });
      const list = await call<APIGuildMember[]>('list members', () => rest.get(Routes.guildMembers(guildId), { query: q }));
      return list.map(toMember);
    },
    async sendDm(userId, content, buttons) {
      const channel = await call<APIChannel>('open DM', () => rest.post(Routes.userChannels(), { body: { recipient_id: userId } }));
      const body: Record<string, unknown> = { content, allowed_mentions: { parse: [] } };
      if (buttons?.length) {
        body.components = [{
          type: 1,
          components: buttons.map((b) => ({ type: 2, custom_id: b.customId, label: b.label, style: b.style === 'success' ? 3 : 2 })),
        }];
      }
      const msg = await call<APIMessage>('send DM', () => rest.post(Routes.channelMessages(channel.id), { body }));
      return { messageId: msg.id, channelId: channel.id };
    },
  };
}
