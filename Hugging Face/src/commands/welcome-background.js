import { readJSON, writeJSON } from '../storage/hfClient.js';
import { uploadFile } from '@huggingface/hub';

const WEBHOOK_BASE = 'https://discord.com/api/v10/webhooks';
const EMBED_COLOR = 0x5865F2;
const MANAGE_GUILD = 32n;

async function patchWebhook(clientId, token, payload) {
  const url = `${WEBHOOK_BASE}/${clientId}/${token}/messages/@original`;
  return await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function createEmbed(title, description, fields = [], color = EMBED_COLOR) {
  return {
    embeds: [{ title, description, fields, color, timestamp: new Date().toISOString() }]
  };
}

function hasManageGuild(interaction) {
  const perms = BigInt(interaction.member.permissions);
  return !!(perms & MANAGE_GUILD);
}

async function getConfig(guildId) {
  try { return await readJSON(`guilds/${guildId}/config.json`); } 
  catch {
    return {
      guildId, welcomeChannelId: null, leaveChannelId: null, autoRoles: [],
      welcomeMessage: '{username} just joined {server}!',
      leaveMessage: '{username} has left {server}.',
      dmMessage: 'Welcome to {server}!', dmEnabled: false,
      welcomeBackground: 'default1', leaveBackground: 'default1',
      cardTextColor: '#ffffff', cardAccentColor: '#5865F2',
      createdAt: new Date().toISOString()
    };
  }
}

export default async function handleWelcomeBackground(interaction) {
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
  const style = options.find(o => o.name === 'style')?.value;
  const attachmentId = options.find(o => o.name === 'file')?.value;
  
  let config = await getConfig(guildId);
  
  switch (subcommand) {
    case 'default': {
      if (!style || !['default1', 'default2', 'default3'].includes(style)) {
        await patchWebhook(clientId, token, createEmbed('Invalid Style', 'Choose: `default1`, `default2`, or `default3`'));
        return;
      }
      config.welcomeBackground = style;
      await writeJSON(`guilds/${guildId}/config.json`, config);
      await patchWebhook(clientId, token, createEmbed('Background Updated', `Welcome card background set to **${style}**.`));
      break;
    }
    
    case 'upload': {
      if (!attachmentId) {
        await patchWebhook(clientId, token, createEmbed('No File Provided', 'Please attach an image file.'));
        return;
      }
      
      const attachments = interaction.data.resolved?.attachments || {};
      const attachment = attachments[attachmentId];
      if (!attachment) {
        await patchWebhook(clientId, token, createEmbed('Invalid Attachment', 'Could not locate attachment metadata.'));
        return;
      }
      
      try {
        const response = await fetch(attachment.url);
        const arrayBuffer = await response.with ? await response.arrayBuffer() : await response.arrayBuffer();
        
        // STABLE FIX: Passing explicit target space parameters directly via ArrayBuffer tracking
        await uploadFile({
          repo: { type: 'space', id: process.env.HF_REPO_ID || process.env.SPACE_ID },
          pathInRepo: `guilds/${guildId}/background-welcome.png`,
          file: arrayBuffer,
          accessToken: process.env.HF_TOKEN
        });
        
        config.welcomeBackground = 'custom';
        await writeJSON(`guilds/${guildId}/config.json`, config);
        await patchWebhook(clientId, token, createEmbed('Custom Background Uploaded', 'Your custom welcome background is active.'));
      } catch (err) {
        console.error('[Welcome Background Upload Error]:', err);
        await patchWebhook(clientId, token, createEmbed('Upload Failed', `Error: ${err.message}`));
      }
      break;
    }
  }
}
