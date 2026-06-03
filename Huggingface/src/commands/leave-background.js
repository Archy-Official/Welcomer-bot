import { readJSON, writeJSON, writeBinary, deleteBucketFile } from '../storage/hfClient.js';
import { invalidateLeaveBgCache } from '../canvas/leaveCard.js';
import { Canvas, loadImage } from 'skia-canvas';

// Import global proxy handler
import { patchWebhook } from '../utils/proxy.js';

const EMBED_COLOR = 0x5865F2;
const MANAGE_GUILD = 32n;
const SLOT_NAME_REGEX = /^[a-z0-9-]{1,20}$/i;
const MAX_CUSTOM_SLOTS = 6;
const DEFAULT_BACKGROUNDS = ['default1', 'default2', 'default3'];

function createEmbed(title, description, fields = [], color = EMBED_COLOR) {
  return {
    embeds: [{ title, description, fields, color, timestamp: new Date().toISOString() }]
  };
}

function hasManageGuild(interaction) {
  const perms = BigInt(interaction.member.permissions);
  return !!(perms & MANAGE_GUILD);
}

/**
 * Automatically resizes and center-crops any incoming image buffer to exactly 800x200
 */
async function autoCropToBanner(buffer) {
  const img = await loadImage(buffer);
  const canvas = new Canvas(800, 200);
  const ctx = canvas.getContext('2d');

  // Determine scaling factor to fill the 800x200 bounding box completely
  const scale = Math.max(800 / img.width, 200 / img.height);
  
  // Center alignment offset coordinates
  const x = (800 / 2) - (img.width / 2) * scale;
  const y = (200 / 2) - (img.height / 2) * scale;

  ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
  return await canvas.toBuffer('png');
}

async function getConfig(guildId) {
  const baseConfig = {
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
    welcomeCustomBackgrounds: [],
    leaveCustomBackgrounds: [],
    cardTextColor: '#ffffff', 
    cardAccentColor: '#5865F2',
    createdAt: new Date().toISOString()
  };

  try {
    const data = await readJSON(`guilds/${guildId}/config.json`);
    return data ? { ...baseConfig, ...data } : baseConfig;
  } catch {
    return baseConfig;
  }
}

export default async function handleLeaveBackground(interaction) {
  const { guild_id: guildId, data, token } = interaction;
  const clientId = process.env.DISCORD_CLIENT_ID;
  
  if (!hasManageGuild(interaction)) {
    await patchWebhook(clientId, token, createEmbed(
      'Permission Denied',
      'You need the **Manage Server** permission to execute this configuration.'
    ));
    return;
  }
  
  const subcommand = data.options?.[0]?.name;
  const options = data.options?.[0]?.options || [];
  
  let config = await getConfig(guildId);
  
  switch (subcommand) {
    case 'default': {
      const style = options.find(o => o.name === 'style')?.value;
      if (!style || !DEFAULT_BACKGROUNDS.includes(style)) {
        await patchWebhook(clientId, token, createEmbed('Invalid Style', 'Choose: `default1`, `default2`, or `default3`'));
        return;
      }
      config.leaveBackground = style;
      await writeJSON(`guilds/${guildId}/config.json`, config);
      invalidateLeaveBgCache(guildId);
      await patchWebhook(clientId, token, createEmbed('Background Updated', `Leave card background set to **${style}**.`));
      break;
    }
    
    case 'upload': {
      const name = options.find(o => o.name === 'name')?.value?.toLowerCase();
      const attachmentId = options.find(o => o.name === 'file')?.value;
      
      if (!name || !SLOT_NAME_REGEX.test(name)) {
        await patchWebhook(clientId, token, createEmbed('Invalid Slot Name', 'Slot name must be 1-20 characters, alphanumeric and dashes only.'));
        return;
      }
      
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
      
      if (!attachment.content_type?.startsWith('image/')) {
        await patchWebhook(clientId, token, createEmbed('Invalid File Type', 'Please upload a valid image file (PNG, JPG, etc.).'));
        return;
      }
      
      if (config.leaveCustomBackgrounds.length >= MAX_CUSTOM_SLOTS && !config.leaveCustomBackgrounds.includes(name)) {
        const fields = [{ name: 'Current Slots', value: config.leaveCustomBackgrounds.join(', ') || 'None', inline: false }];
        await patchWebhook(clientId, token, createEmbed('Max Slots Reached', `You can only have ${MAX_CUSTOM_SLOTS} custom backgrounds.`, fields));
        return;
      }
      
      try {
        // Fetch raw upload from Discord CDN
        const response = await fetch(attachment.url);
        const rawBuffer = Buffer.from(await response.arrayBuffer());
        
        // Dynamic smart crop to perfectly scale into 800x200 canvas dimensions
        const processedBuffer = await autoCropToBanner(rawBuffer);
        const bucketPath = `guilds/${guildId}/assets/backgrounds/leave/${name}.png`;
        
        // Write standard cropped PNG out to storage
        await writeBinary(bucketPath, processedBuffer, 'image/png');
        
        if (!config.leaveCustomBackgrounds.includes(name)) {
          config.leaveCustomBackgrounds.push(name);
        }
        
        config.leaveBackground = name;
        await writeJSON(`guilds/${guildId}/config.json`, config);
        
        invalidateLeaveBgCache(guildId, name);
        
        await patchWebhook(clientId, token, createEmbed('Background Uploaded', `Custom background **${name}** safely processed, optimized to 800x200, and set as active.`));
      } catch (err) {
        console.error('[Leave Background Upload Error]:', err);
        await patchWebhook(clientId, token, createEmbed('Upload Failed', `Error: ${err.message}`));
      }
      break;
    }
    
    case 'switch': {
      const name = options.find(o => o.name === 'name')?.value?.toLowerCase();
      
      if (!name) {
        await patchWebhook(clientId, token, createEmbed('Missing Slot Name', 'Please provide a slot name to switch to.'));
        return;
      }
      
      if (DEFAULT_BACKGROUNDS.includes(name) || config.leaveCustomBackgrounds.includes(name)) {
        config.leaveBackground = name;
        await writeJSON(`guilds/${guildId}/config.json`, config);
        invalidateLeaveBgCache(guildId, name);
        await patchWebhook(clientId, token, createEmbed('Background Switched', `Leave background set to **${name}**.`));
        return;
      }
      
      const fields = [
        { name: 'Available Defaults', value: DEFAULT_BACKGROUNDS.join(', '), inline: true },
        { name: 'Your Custom Slots', value: config.leaveCustomBackgrounds.join(', ') || 'None', inline: true }
      ];
      await patchWebhook(clientId, token, createEmbed('Slot Not Found', `Background slot **${name}** not found.`, fields));
      break;
    }
    
    case 'delete': {
      const name = options.find(o => o.name === 'name')?.value?.toLowerCase();
      
      if (!name) {
        await patchWebhook(clientId, token, createEmbed('Missing Slot Name', 'Please provide a slot name to delete.'));
        return;
      }
      
      if (DEFAULT_BACKGROUNDS.includes(name)) {
        await patchWebhook(clientId, token, createEmbed('Cannot Delete Default', 'Default backgrounds cannot be deleted.'));
        return;
      }
      
      if (!config.leaveCustomBackgrounds.includes(name)) {
        await patchWebhook(clientId, token, createEmbed('Slot Not Found', `Custom background **${name}** not found in your slots.`));
        return;
      }
      
      try {
        const bucketPath = `guilds/${guildId}/assets/backgrounds/leave/${name}.png`;
        await deleteBucketFile(bucketPath);
        
        config.leaveCustomBackgrounds = config.leaveCustomBackgrounds.filter(s => s !== name);
        
        if (config.leaveBackground === name) {
          config.leaveBackground = 'default1';
        }
        
        await writeJSON(`guilds/${guildId}/config.json`, config);
        invalidateLeaveBgCache(guildId, name);
        
        await patchWebhook(clientId, token, createEmbed('Background Deleted', `Custom background **${name}** has been deleted.`));
      } catch (err) {
        console.error('[Leave Background Delete Error]:', err);
        await patchWebhook(clientId, token, createEmbed('Delete Failed', `Error: ${err.message}`));
      }
      break;
    }
    
    case 'list': {
      const fields = [
        { name: 'Active Background', value: `\`${config.leaveBackground}\``, inline: true },
        { name: 'Slots Used', value: `${config.leaveCustomBackgrounds.length}/${MAX_CUSTOM_SLOTS}`, inline: true },
        { name: 'Defaults Available', value: DEFAULT_BACKGROUNDS.join(', '), inline: false },
        { name: 'Your Custom Slots', value: config.leaveCustomBackgrounds.join(', ') || 'None', inline: false }
      ];
      await patchWebhook(clientId, token, createEmbed('Leave Backgrounds', 'Your configured leave backgrounds:', fields));
      break;
    }
    
    default: {
      await patchWebhook(clientId, token, createEmbed('Unknown Subcommand', 'Available: `default`, `upload`, `switch`, `delete`, `list`'));
    }
  }
}