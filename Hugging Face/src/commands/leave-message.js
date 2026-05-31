import { readJSON, writeJSON } from '../storage/hfClient.js';

const WEBHOOK_BASE = 'https://discord.com/api/v10/webhooks';
const EMBED_COLOR = 0x5865F2;
const MANAGE_GUILD = 32n;

async function patchWebhook(clientId, token, payload) {
  const url = `${WEBHOOK_BASE}/${clientId}/${token}/messages/@original`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response;
}

function createEmbed(title, description, fields = [], color = EMBED_COLOR) {
  return {
    embeds: [{
      title,
      description,
      fields,
      color,
      timestamp: new Date().toISOString()
    }]
  };
}

function hasManageGuild(interaction) {
  const perms = BigInt(interaction.member.permissions);
  return !!(perms & MANAGE_GUILD);
}

async function getConfig(guildId) {
  try {
    return await readJSON(`guilds/${guildId}/config.json`);
  } catch {
    return {
      guildId,
      welcomeChannelId: null,
      leaveChannelId: null,
      autoRoles: [],
      welcomeMessage: '{username} just joined {server}!',
      leaveMessage: '{username} has left {server}.',
      dmMessage: 'Welcome to {server}!',
      dmEnabled: false,
      welcomeBackground: 'default1',
      leaveBackground: 'default1',
      cardTextColor: '#ffffff',
      cardAccentColor: '#5865F2',
      createdAt: new Date().toISOString()
    };
  }
}

async function saveConfig(guildId, config) {
  await writeJSON(`guilds/${guildId}/config.json`, config);
}

export default async function handleLeaveMessage(interaction) {
  const { guild_id: guildId, data, token } = interaction;
  const clientId = process.env.DISCORD_CLIENT_ID;
  
  if (!hasManageGuild(interaction)) {
    await patchWebhook(clientId, token, createEmbed(
      'Permission Denied',
      'You need the **Manage Server** permission to use this command.'
    ));
    return;
  }
  
  const subcommand = data.options?.[0]?.name;
  const options = data.options?.[0]?.options || [];
  const getOption = (name) => options.find(o => o.name === name)?.value;
  
  let config = await getConfig(guildId);
  
  switch (subcommand) {
    case 'set': {
      const message = getOption('message');
      if (!message) break;
      
      config.leaveMessage = message;
      await saveConfig(guildId, config);
      
      await patchWebhook(clientId, token, createEmbed(
        'Leave Message Updated',
        'Your new leave message has been saved.',
        [
          { name: 'Message', value: `\`\`\`${message}\`\`\`` },
          { name: 'Available Variables', value: '`{username}` `{server}` `{memberCount}`' }
        ]
      ));
      break;
    }
    
    case 'preview': {
      await patchWebhook(clientId, token, createEmbed(
        'Current Leave Message',
        'This is the raw template that will be used for leave messages:',
        [{ name: 'Template', value: `\`\`\`${config.leaveMessage}\`\`\`` }]
      ));
      break;
    }
    
    default: {
      await patchWebhook(clientId, token, createEmbed(
        'Unknown Subcommand',
        `The subcommand \`${subcommand}\` was not recognized.`
      ));
    }
  }
}
