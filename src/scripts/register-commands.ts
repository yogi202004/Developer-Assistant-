// Run once (and after changing commands): npm run register
import { REST, Routes } from 'discord.js';
import { discordConfig } from '../config';
import { commands } from '../discord/commands';

const dc = discordConfig();
const rest = new REST().setToken(dc.token);
await rest.put(Routes.applicationGuildCommands(dc.appId, dc.guildId), { body: commands });
console.log(`✅ Registered ${commands.length} slash commands in your server.`);
