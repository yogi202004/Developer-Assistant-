# MCP setup — use the assistant from Cursor Agent and Claude Code

The same assistant backend (`src/mcp.ts`) is shared by **Cursor Agent** and **Claude Code**. Both launch it locally over **stdio**. The two clients are configured **separately**: setting up one does not set up the other.

The MCP server is independent of the Discord bot (`npm start`):

- It does **not** log in to the Discord gateway, start the scheduler, or send notifications.
- It talks to Discord through the REST API, as your assistant bot.
- Both processes share `.env`, `data/` and the SQLite database.

## Tools

| Tool | What it does | Changes anything? |
|---|---|---|
| `assistant_status` | Checks Ollama, ClickUp, Gmail and Discord connectivity. No secrets are returned. | No |
| `clickup_list_tasks` | Lists open tasks (yours, or a given ClickUp user id). Filters: `due`, `status`, `search`, `limit`. | No |
| `clickup_get_task` | Returns one task by id, custom id or URL: description, checklists, and remaining items. | No |
| `clickup_find_list` | Finds a list by name, to get the `list_id` for creating tasks. | No |
| `clickup_find_user` | Finds a workspace member, to get user ids for assigning. | No |
| `clickup_add_comment` | Comments on a task, posted as you. | **Yes** |
| `clickup_create_task` | Creates a task: name, description, status, priority, due date, assignees. | **Yes** |
| `clickup_update_task` | Changes name, description, status, priority, due date or assignees. Returns the previous values so changes can be undone. | **Yes** |
| `gmail_search_emails` | Gmail search syntax, up to 25 results. | No |
| `gmail_get_email` | Full email by id, with an optional local-model summary. | No |
| `gmail_create_draft` | Creates a Gmail draft. Does not send. | Draft only |
| `gmail_prepare_send` | Step 1 of sending: freezes the draft's current content and DMs you a code. **Nothing is sent.** | Sends you a code |
| `gmail_send_confirmed_draft` | Step 2: sends that exact draft after you confirm with the code. | **Sends email** |
| `discord_list_team_members` | Lists members of the approved server. | No |
| `discord_find_member` | Finds a teammate by name. Returns candidates if the name is ambiguous. | No |
| `discord_prepare_message` | Validates the recipient and text and DMs you a code. **Nothing is sent.** | Sends you a code |
| `discord_send_confirmed_message` | Sends that exact message after you confirm with the code. | **Sends a DM** |

**Not included, on purpose:**
- **Deleting ClickUp tasks or comments:** this can't be undone.
- **Shell, file and arbitrary HTTP tools:** Cursor and Claude Code already have these built in, with their own permission prompts, so duplicating them here would only widen what a prompt injection could reach.

**Turning capabilities off:** set `MCP_ALLOW_EMAIL_SEND=false` or `MCP_ALLOW_CLICKUP_WRITES=false` in `.env`. Reads keep working.

**Audit log:** every comment, task change and sent email or DM made through MCP is recorded in the `mcp_audit` table in `data/assistant.db`.

## 1. One-time preparation

```bash
cd /path/to/dev-assistant
npm install
npm run mcp:config      # prints both client configs with YOUR absolute paths filled in
```

`npm run mcp:config` writes nothing. It only prints text to copy, so no personal paths ever end up in the repo.

> **Don't register `npm run mcp` as the client command.** npm prints a banner line to stdout, which corrupts the MCP protocol. Use the `node … cli.mjs … src/mcp.ts` command that `mcp:config` prints. `npm run mcp` is fine for a quick manual check in a terminal: it prints `ready on stdio` and waits, and Ctrl+C exits.

The printed command uses the absolute path to your `node` binary. That matters because apps started from the Dock (Cursor) often don't see nvm/Homebrew PATH changes.

## 2. Cursor Agent

1. Open `~/.cursor/mcp.json`, or create it if it doesn't exist.
2. **Merge** the `dev-assistant` entry into the existing `mcpServers` object. Don't replace the file, or you'll lose your other servers. Example of a merged file:

```json
{
  "mcpServers": {
    "some-server-you-already-had": { "command": "…" },
    "dev-assistant": {
      "command": "/ABSOLUTE/PATH/TO/node",
      "args": [
        "/ABSOLUTE/PATH/TO/dev-assistant/node_modules/tsx/dist/cli.mjs",
        "/ABSOLUTE/PATH/TO/dev-assistant/src/mcp.ts"
      ]
    }
  }
}
```

Replace the three placeholders with the values `npm run mcp:config` printed. You don't need an `env` block, because the server reads `.env` from its own project folder.

3. Reload Cursor: Command Palette → **Developer: Reload Window**, or quit and reopen.
4. Verify: **Cursor Settings → MCP** (labelled "Tools & MCP" in some versions). `dev-assistant` should show as enabled with 10 tools. If it shows an error, use the Output panel → "MCP Logs".
5. Try asking the Agent: *"Use dev-assistant to check my assistant status."*

**Keep approvals on.** Don't enable auto-run for the send tools or the ClickUp write tools (`clickup_add_comment`, `clickup_create_task`, `clickup_update_task`). For ClickUp writes, the approval prompt is the only check before the change happens.

## 3. Claude Code (including inside Cursor's terminal)

Run the command printed by `npm run mcp:config`. It looks like this:

```bash
claude mcp add --scope user dev-assistant -- /ABSOLUTE/PATH/TO/node /ABSOLUTE/PATH/TO/dev-assistant/node_modules/tsx/dist/cli.mjs /ABSOLUTE/PATH/TO/dev-assistant/src/mcp.ts
```

- `--scope user` makes it available in every project and stores it in your user config, not the repo. If you already have servers, this **adds** one entry and leaves the others alone.
- Check it: `claude mcp list` should show `dev-assistant … ✓ Connected`.
- Inside a Claude Code session, run `/mcp`. `dev-assistant` should be listed as connected, and you can open it to see the 10 tools.
- To remove it: `claude mcp remove --scope user dev-assistant`.

**Keep approvals on.** Claude Code asks before running MCP tools. You may add the read-only tools to your allow list if you like, for example `mcp__dev-assistant__clickup_list_tasks`. **Never** allow-list `mcp__dev-assistant__discord_send_confirmed_message`, `mcp__dev-assistant__gmail_send_confirmed_draft`, or the three ClickUp write tools.

## 4. Discord setup for teammate messages

The MCP tools use **your private assistant bot** (the same `DISCORD_TOKEN`), never the team's Revy bot and never your personal account.

1. **Add the assistant bot to your team's server.** Someone with *Manage Server* permission must approve it. Reuse the invite URL from the README (scopes `bot` + `applications.commands`; *Send Messages* is enough). Check with your team first.
2. In Discord with Developer Mode on, right-click the team server → **Copy Server ID**. Set it in `.env`:
   ```
   DISCORD_ALLOWED_GUILD_ID=<team server id>
   ```
   This is the only server the tools will search or message. If it isn't set, all Discord tools refuse to run.
3. Optional but recommended: in the Developer Portal, go to **Bot** and enable **Server Members Intent**. `discord_list_team_members` needs it. `discord_find_member` works without it for prefix matches, and uses the full list for substring matches when it's available.
4. `DISCORD_OWNER_ID` must be set, because confirmation codes are DM'd to you.

Your existing slash commands stay registered only in your private server (`DISCORD_GUILD_ID`), and the bot still ignores everyone except you.

**DM delivery:** Discord only lets a bot DM someone who shares a server with it and allows DMs from server members. If a teammate has DMs from server members turned off, sending fails with a clear error (Discord code 50007). There's no way to check this without actually sending, so the failure appears at send time, the reference is used up, and nothing is retried automatically.

## 5. How sending is confirmed (Discord DMs and email)

An MCP server can't see your conversation, so a tool argument like `confirmed: true` proves nothing: the model could set it by itself, or a malicious email could talk it into doing so. That's why the default mode **`dm_code`** works like this:

1. You say: *"Prepare a Discord message to Raul saying the PR is ready for review."*
2. The model calls `discord_find_member`. If there are two Rauls, it must ask you which one.
3. The model calls `discord_prepare_message` with the user ID and text. **Nothing is sent to Raul.** You get a DM from your assistant bot showing the exact recipient, the exact text, and a **6-digit code**. The code is not in the tool result, so the model never sees it.
4. The model shows you the recipient and text. If you want it sent, you type the code into Cursor/Claude Code, e.g. *"send it, code 483920"*.
5. The model calls `discord_send_confirmed_message` with the reference and your code. Your MCP client also asks you to approve that tool call.

The server enforces these rules no matter what the model says:

- References are HMAC-signed. A reference that has been modified or forged is rejected, and so is a stored message whose text or recipient was changed.
- References expire after `MCP_CONFIRM_TTL_MINUTES` (default 10).
- Each reference is **single-use**. It is claimed atomically, so even parallel calls send once.
- Five wrong codes lock the reference.
- Preparing the same text again cancels the older reference.
- The same text can't be sent to the same person twice within 10 minutes.
- The recipient must be a non-bot member of the approved server, both when the message is prepared and when it is sent.
- Mentions are disabled in sent messages, so no `@everyone` or role pings.

**Email works the same way.** The model creates a draft (`gmail_create_draft`), then calls `gmail_prepare_send`. You get a Discord DM with the exact To/Cc/Bcc, subject, start of the body, and a code. You type the code, and `gmail_send_confirmed_draft` sends it. Before sending, the server re-reads the draft. If it changed after you confirmed (for example, a different recipient), **nothing is sent** and you're asked to confirm again. Sending also disables any Discord **Send** button for the same draft, so it can't go out twice.

**ClickUp writes** (comments, creating or updating tasks) don't use a code. They're reversible and stay inside your own workspace, so a code every time would be tedious. Your client's approval prompt is the check, and these guards are enforced on the server:
- Tasks must belong to your configured workspace (`CLICKUP_TEAM_ID`), and lists must exist in it.
- Assignees must be workspace members.
- There is no delete.
- `clickup_update_task` returns the previous values, so you can ask the model to undo a change.

**`host_approval` mode** (`MCP_CONFIRM_MODE=host_approval`, applies to DMs and email) skips the code and relies only on the client's tool-approval prompt. That prompt is good, but you can turn it off (auto-run, allow lists), and the server can't tell whether it was shown. Use `dm_code` unless the extra step really bothers you.

You can also send a draft without the code: tap **Send** from `offer_send_button: true` (needs the main bot running), or send it from Gmail → Drafts.

## 6. Verifying it works

Ask in Cursor or Claude Code:

- *"Check whether my assistant's integrations are working."* (`assistant_status`)
- *"Check my ClickUp tasks due today."*
- *"Summarize task 86abc123 and list what remains."*
- *"Search my Gmail for the latest email about the deployment."*
- *"Find the Discord teammate named Raul."*
- *"Comment on task 86abc123: PR #42 is up for review."*
- *"Create a task in Sprint 12 called 'Add retry to webhook', high priority, due Friday, assign to me."*
- *"Draft an email to raul@acme.com saying the deployment is done, then send it."* (you'll get a code on Discord)

## Troubleshooting

| Symptom | Fix |
|---|---|
| Server shows red / "failed to start" | Run the printed command in a terminal: it should print `ready on stdio` (Ctrl+C to exit). Check that the paths are absolute and that `npm install` was run. |
| Connected but every tool says "not configured" | `.env` is missing values. The server reads `.env` from the project folder, so check `DATA_DIR` if you changed it. |
| "Discord … (403/50001)" | The assistant bot isn't in the approved server. |
| "Enable the Server Members Intent" | Developer Portal → Bot → **Server Members Intent** on. |
| "(…/50007)" when sending | The teammate doesn't accept DMs from server members, or has blocked the bot. |
| "not in the configured ClickUp workspace" | Set `CLICKUP_TEAM_ID` to the workspace you mean (the first number in ClickUp URLs). |
| "The draft changed after it was confirmed" | You or someone edited the draft in Gmail. Ask to send it again; you'll get a new code. |
| "Could not deliver the confirmation code" | Check `DISCORD_OWNER_ID`, and that you share a server with the bot and allow its DMs. |
| Gmail `invalid_grant` | The token expired. Run `npm run gmail:auth` again (see the 7-day note in the README). |
| Ollama "unreachable" in status | Only affects `gmail_get_email` with `summarize: true`. Everything else works without Ollama, because your MCP client's model does the reasoning. |
| You changed `.env` | Reload Cursor, or restart the Claude Code session (or use `/mcp` → reconnect). Most settings are read at startup. `MCP_ALLOW_EMAIL_SEND` / `MCP_ALLOW_CLICKUP_WRITES` are re-read from `.env` on each write tool call. |
| Email send says `MCP_ALLOW_EMAIL_SEND=false` but `.env` says `true` | The MCP process started before you flipped the flag. Reconnect MCP (or Reload Window). |
