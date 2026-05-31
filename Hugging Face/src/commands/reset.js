import { writeJSON } from '../storage/hfClient.js';

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

function getDefaultConfig(guildId) {
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

export default async function handleReset(interaction) {
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
  
  switch (subcommand) {
    case 'confirm': {
      const defaultConfig = getDefaultConfig(guildId);
      await writeJSON(`guilds/${guildId}/config.json`, defaultConfig);
      
      await patchWebhook(clientId, token, createEmbed(
        'Configuration Reset',
        'Your server configuration has been reset to default values.',
        [
          { name: 'Welcome Message', value: defaultConfig.welcomeMessage, inline: false },
          { name: 'Leave Message', value: defaultConfig.leaveMessage, inline: false },
          { name: 'Backgrounds', value: `Welcome: \`${defaultConfig.welcomeBackground}\` | Leave: \`${defaultConfig.leaveBackground}\``, inline: false }
        ]
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
