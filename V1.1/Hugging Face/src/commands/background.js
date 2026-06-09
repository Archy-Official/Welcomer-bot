import { readJSON, writeJSON, writeBinary, deleteBucketFile } from '../storage/hfClient.js';
import { invalidateWelcomeBgCache, generateWelcomeCard } from '../canvas/welcomeCard.js';
import { invalidateLeaveBgCache, generateLeaveCard } from '../canvas/leaveCard.js';
import { Canvas, loadImage } from 'skia-canvas';
import { patchWebhook, fetchViaProxy } from '../utils/proxy.js';

const EMBED_COLOR = 0x5865F2;
const MANAGE_GUILD = 32n;
const SLOT_NAME_REGEX = /^[a-z0-9-]{1,20}$/i;
const MAX_CUSTOM_SLOTS = 10;
const DEFAULT_BACKGROUNDS = ['default1', 'default2', 'default3'];
const DISCORD_CDN = 'https://cdn.discordapp.com';

function createEmbed(title, description, fields = [], color = EMBED_COLOR) {
  return {
    embeds: [{ title, description, fields, color, timestamp: new Date().toISOString() }],
  };
}

function hasManageGuild(interaction) {
  return !!(BigInt(interaction.member.permissions) & MANAGE_GUILD);
}

async function autoCropToBanner(buffer) {
  const img = await loadImage(buffer);
  const canvas = new Canvas(800, 200);
  const ctx = canvas.getContext('2d');

  const scale = Math.max(800 / img.width, 200 / img.height);
  const x = (800 - img.width * scale) / 2;
  const y = (200 - img.height * scale) / 2;

  ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
  return canvas.toBuffer('png');
}

async function getConfig(guildId) {
  const defaults = {
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
    customBackgrounds: [],
    cardTextColor: '#ffffff',
    cardAccentColor: '#5865F2',
    createdAt: new Date().toISOString(),
  };

  try {
    const data = await readJSON(`guilds/${guildId}/config.json`);
    if (!data) return defaults;

    // Migration logic for old separate slots
    if (!data.customBackgrounds && (data.welcomeCustomBackgrounds || data.leaveCustomBackgrounds)) {
      const legacyWelcome = data.welcomeCustomBackgrounds || [];
      const legacyLeave = data.leaveCustomBackgrounds || [];
      data.customBackgrounds = [...new Set([...legacyWelcome, ...legacyLeave])].slice(0, MAX_CUSTOM_SLOTS);
      delete data.welcomeCustomBackgrounds;
      delete data.leaveCustomBackgrounds;
    }

    return { ...defaults, ...data };
  } catch {
    return defaults;
  }
}

async function generatePreviewBuffer(interaction, config, type, targetBg) {
  const user = interaction.member.user;
  const avatarUrl = user.avatar
    ? `${DISCORD_CDN}/avatars/${user.id}/${user.avatar}.png?size=256`
    : `${DISCORD_CDN}/embed/avatars/${parseInt(user.discriminator || '0') % 5}.png`;

  let guildName = 'Your Server';
  let memberCount = 123;

  try {
    const resp = await fetchViaProxy(`/v10/guilds/${interaction.guild_id}?with_counts=true`, {
      method: 'GET',
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    });
    if (resp.ok) {
      const data = await resp.json();
      guildName = data.name;
      memberCount = data.approximate_member_count || data.member_count || 123;
    }
  } catch (err) {
    console.warn('[background-preview] Guild fetch failed:', err.message);
  }

  const previewConfig = { 
    ...config, 
    welcomeBackground: type === 'leave' ? config.welcomeBackground : targetBg,
    leaveBackground: type === 'welcome' ? config.leaveBackground : targetBg 
  };

  if (type === 'leave') {
    return await generateLeaveCard({
      avatarURL: avatarUrl, username: user.username,
      serverName: guildName, memberCount, config: previewConfig, guildId: interaction.guild_id,
    });
  } else {
    return await generateWelcomeCard({
      avatarURL: avatarUrl, username: user.username,
      serverName: guildName, memberCount, config: previewConfig, guildId: interaction.guild_id,
    });
  }
}

export default async function handleBackground(interaction) {
  const { guild_id: guildId, data, token } = interaction;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!hasManageGuild(interaction)) {
    await patchWebhook(clientId, token, createEmbed('Permission Denied', 'You need the **Manage Server** permission to use this command.'));
    return;
  }

  const subcommand = data.options?.[0]?.name;
  const options = data.options?.[0]?.options || [];
  const config = await getConfig(guildId);

  switch (subcommand) {
    case 'default': {
      const style = options.find(o => o.name === 'style')?.value;
      const type = options.find(o => o.name === 'type')?.value || 'both';

      if (!style || !DEFAULT_BACKGROUNDS.includes(style)) {
        await patchWebhook(clientId, token, createEmbed('Invalid Style', 'Please choose default1, default2, or default3.'));
        return;
      }

      if (type === 'welcome' || type === 'both') config.welcomeBackground = style;
      if (type === 'leave' || type === 'both') config.leaveBackground = style;

      await writeJSON(`guilds/${guildId}/config.json`, config);
      invalidateWelcomeBgCache(guildId);
      invalidateLeaveBgCache(guildId);

      await patchWebhook(clientId, token, createEmbed('Background Updated', `Set **${type}** background style to default layout: \`${style}\`.`));
      break;
    }

    case 'upload': {
      const name = options.find(o => o.name === 'name')?.value?.toLowerCase();
      const attachmentId = options.find(o => o.name === 'file')?.value;
      const type = options.find(o => o.name === 'apply-to')?.value || 'both';

      if (!name || !SLOT_NAME_REGEX.test(name)) {
        await patchWebhook(clientId, token, createEmbed('Invalid Slot Name', 'Name must be 1-20 characters, alphanumeric and dashes only.'));
        return;
      }

      const attachment = (interaction.data.resolved?.attachments || {})[attachmentId];
      if (!attachment || !attachment.content_type?.startsWith('image/')) {
        await patchWebhook(clientId, token, createEmbed('Invalid File', 'Please provide a valid image file.'));
        return;
      }

      if (config.customBackgrounds.length >= MAX_CUSTOM_SLOTS && !config.customBackgrounds.includes(name)) {
        await patchWebhook(clientId, token, createEmbed('Max Slots Reached', `You have reached the limit of ${MAX_CUSTOM_SLOTS} backgrounds.`));
        return;
      }

      try {
        const resp = await fetch(attachment.url);
        const raw = Buffer.from(await resp.arrayBuffer());
        const processed = await autoCropToBanner(raw);
        
        await writeBinary(`guilds/${guildId}/assets/backgrounds/shared/${name}.png`, processed, 'image/png');

        if (!config.customBackgrounds.includes(name)) {
          config.customBackgrounds.push(name);
        }
        
        if (type === 'welcome' || type === 'both') config.welcomeBackground = name;
        if (type === 'leave' || type === 'both') config.leaveBackground = name;

        await writeJSON(`guilds/${guildId}/config.json`, config);
        invalidateWelcomeBgCache(guildId, name);
        invalidateLeaveBgCache(guildId, name);

        await patchWebhook(clientId, token, createEmbed('Background Uploaded', `Custom background \`${name}\` saved and applied to **${type}**.`));
      } catch (err) {
        console.error('[background] Upload error:', err);
        await patchWebhook(clientId, token, createEmbed('Upload Failed', err.message));
      }
      break;
    }

    case 'switch': {
      const name = options.find(o => o.name === 'name')?.value?.toLowerCase();
      const type = options.find(o => o.name === 'type')?.value;

      if (!name || !type) {
        await patchWebhook(clientId, token, createEmbed('Missing Options', 'Please specify both the background name and card type.'));
        return;
      }

      if (!DEFAULT_BACKGROUNDS.includes(name) && !config.customBackgrounds.includes(name)) {
        await patchWebhook(clientId, token, createEmbed('Background Not Found', `\`${name}\` does not exist in your background choices.`));
        return;
      }

      if (type === 'welcome') {
        config.welcomeBackground = name;
        invalidateWelcomeBgCache(guildId, name);
      } else {
        config.leaveBackground = name;
        invalidateLeaveBgCache(guildId, name);
      }

      await writeJSON(`guilds/${guildId}/config.json`, config);

      try {
        const previewBuffer = await generatePreviewBuffer(interaction, config, type, name);
        const embed = {
          embeds: [{
            title: 'Background Switched',
            description: `Successfully swapped the **${type}** card background asset to slot: \`${name}\`.`,
            color: EMBED_COLOR,
            image: { url: 'attachment://preview.png' },
            timestamp: new Date().toISOString()
          }]
        };
        await patchWebhook(clientId, token, embed, previewBuffer, 'preview.png');
      } catch (err) {
        console.error('[background-switch] Preview generation error:', err);
        await patchWebhook(clientId, token, createEmbed('Background Switched', `Active asset updated to \`${name}\` for **${type}** cards (preview failed).`));
      }
      break;
    }

    case 'delete': {
      const name = options.find(o => o.name === 'name')?.value?.toLowerCase();

      if (DEFAULT_BACKGROUNDS.includes(name)) {
        await patchWebhook(clientId, token, createEmbed('Action Denied', 'Default styles cannot be deleted from the system.'));
        return;
      }
      if (!config.customBackgrounds.includes(name)) {
        await patchWebhook(clientId, token, createEmbed('Not Found', `Custom background slot \`${name}\` does not exist.`));
        return;
      }

      try {
        await deleteBucketFile(`guilds/${guildId}/assets/backgrounds/shared/${name}.png`);

        config.customBackgrounds = config.customBackgrounds.filter(s => s !== name);
        if (config.welcomeBackground === name) config.welcomeBackground = 'default1';
        if (config.leaveBackground === name) config.leaveBackground = 'default1';

        await writeJSON(`guilds/${guildId}/config.json`, config);
        invalidateWelcomeBgCache(guildId, name);
        invalidateLeaveBgCache(guildId, name);

        await patchWebhook(clientId, token, createEmbed('Background Deleted', `Successfully removed custom slot \`${name}\` from storage.`));
      } catch (err) {
        console.error('[background] Deletion error:', err);
        await patchWebhook(clientId, token, createEmbed('Deletion Failed', err.message));
      }
      break;
    }

    case 'list': {
      await patchWebhook(clientId, token, createEmbed(
        'Server Background Configuration',
        'Overview of your server card layout asset tracks:',
        [
          { name: 'Active Welcome Background', value: `\`${config.welcomeBackground}\``, inline: true },
          { name: 'Active Leave Background', value: `\`${config.leaveBackground}\``, inline: true },
          { name: 'Storage Limits Pool', value: `${config.customBackgrounds.length} / ${MAX_CUSTOM_SLOTS} slots used.`, inline: false },
          { name: 'Default Options', value: DEFAULT_BACKGROUNDS.join(', '), inline: false },
          { name: 'Custom Background Pool', value: config.customBackgrounds.join(', ') || '*No custom slots loaded yet.*', inline: false }
        ]
      ));
      break;
    }

    default:
      await patchWebhook(clientId, token, createEmbed('Unknown Subcommand', 'Please choose from: default, upload, switch, delete, list.'));
  }
}