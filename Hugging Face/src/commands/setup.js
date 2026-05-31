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

export default async function handleSetup(interaction) {
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
    case 'channels': {
      const welcomeChannel = getOption('welcome-channel');
      const leaveChannel = getOption('leave-channel');
      
      if (welcomeChannel) config.welcomeChannelId = welcomeChannel;
      if (leaveChannel) config.leaveChannelId = leaveChannel;
      
      await saveConfig(guildId, config);
      
      await patchWebhook(clientId, token, createEmbed(
        'Channels Updated',
        'Channel settings have been saved successfully.',
        [
          { name: 'Welcome Channel', value: welcomeChannel ? `<#${welcomeChannel}>` : 'Not set', inline: true },
          { name: 'Leave Channel', value: leaveChannel ? `<#${leaveChannel}>` : 'Not set', inline: true }
        ]
      ));
      break;
    }
    
    case 'autorole-add': {
      const roleId = getOption('role');
      if (!roleId) break;
      
      if (!config.autoRoles) config.autoRoles = [];
      if (config.autoRoles.includes(roleId)) {
        await patchWebhook(clientId, token, createEmbed(
          'Auto-Role Already Added',
          `This role is already in the auto-role list.`
        ));
        return;
      }
      if (config.autoRoles.length >= 5) {
        await patchWebhook(clientId, token, createEmbed(
          'Auto-Role Limit Reached',
          'Maximum 5 auto-roles allowed. Remove one before adding another.'
        ));
        return;
      }
      
      config.autoRoles.push(roleId);
      await saveConfig(guildId, config);
      
      await patchWebhook(clientId, token, createEmbed(
        'Auto-Role Added',
        `Role <@&${roleId}> will now be automatically assigned to new members.`,
        [{ name: 'Current Auto-Roles', value: config.autoRoles.map(r => `<@&${r}>`).join(', ') || 'None' }]
      ));
      break;
    }
    
    case 'autorole-remove': {
      const roleId = getOption('role');
      if (!roleId) break;
      
      if (!config.autoRoles) config.autoRoles = [];
      const index = config.autoRoles.indexOf(roleId);
      if (index === -1) {
        await patchWebhook(clientId, token, createEmbed(
          'Role Not Found',
          `This role is not in the auto-role list.`
        ));
        return;
      }
      
      config.autoRoles.splice(index, 1);
      await saveConfig(guildId, config);
      
      await patchWebhook(clientId, token, createEmbed(
        'Auto-Role Removed',
        `Role <@&${roleId}> removed from auto-assignment.`,
        [{ name: 'Current Auto-Roles', value: config.autoRoles.map(r => `<@&${r}>`).join(', ') || 'None' }]
      ));
      break;
    }
    
    case 'autorole-list': {
      if (!config.autoRoles || config.autoRoles.length === 0) {
        await patchWebhook(clientId, token, createEmbed(
          'Auto-Roles',
          'No auto-roles configured.',
          [{ name: 'Current Auto-Roles', value: 'None' }]
        ));
      } else {
        await patchWebhook(clientId, token, createEmbed(
          'Auto-Roles',
          'Current auto-roles that will be assigned to new members:',
          [{ name: 'Roles', value: config.autoRoles.map(r => `<@&${r}>`).join(', ') }]
        ));
      }
      break;
    }
    
    case 'dm': {
      const enabled = getOption('enabled');
      if (enabled === undefined) break;
      
      config.dmEnabled = enabled;
      await saveConfig(guildId, config);
      
      await patchWebhook(clientId, token, createEmbed(
        'DM Settings Updated',
        `Direct messages for new members: **${enabled ? 'Enabled' : 'Disabled'}**`
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
