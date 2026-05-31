import { readJSON } from '../storage/hfClient.js';
import { generateWelcomeCard } from '../canvas/welcomeCard.js';
import { generateLeaveCard } from '../canvas/leaveCard.js';

const WEBHOOK_BASE = 'https://discord.com/api/v10/webhooks';
const EMBED_COLOR = 0x5865F2;
const DISCORD_CDN = 'https://cdn.discordapp.com';

async function patchWebhook(clientId, token, payload, fileBuffer = null, fileName = null) {
  const url = `${WEBHOOK_BASE}/${clientId}/${token}/messages/@original`;
  
  if (fileBuffer && fileName) {
    const formData = new FormData();
    // Inject image attachment reference into the layout object dynamically
    if (payload.embeds && payload.embeds[0]) {
      payload.embeds[0].image = { url: `attachment://${fileName}` };
    }
    
    formData.append('payload_json', JSON.stringify(payload));
    // CRITICAL FIX: Changed 'file' to 'files[0]' for Discord compliance
    formData.append('files[0]', new Blob([fileBuffer], { type: 'image/png' }), fileName);
    
    return await fetch(url, {
      method: 'PATCH',
      body: formData
    });
  } else {
    return await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
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

export default async function handlePreview(interaction) {
  const { guild_id: guildId, member, data, token } = interaction;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const subcommand = data.options?.[0]?.name;
  
  let config = await getConfig(guildId);
  const user = member.user;
  const avatarUrl = user.avatar 
    ? `${DISCORD_CDN}/avatars/${user.id}/${user.avatar}.png?size=256`
    : `${DISCORD_CDN}/embed/avatars/${parseInt(user.discriminator || '0') % 5}.png`;
  
  let guildName = 'Unknown Server';
  let memberCount = 1;
  
  try {
    // CRITICAL FIX: Appended ?with_counts=true to receive metric telemetry details
    const guildResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}?with_counts=true`, {
      headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}` }
    });
    if (guildResponse.ok) {
      const guildData = await guildResponse.json();
      guildName = guildData.name;
      memberCount = guildData.approximate_member_count || guildData.member_count || 1;
    }
  } catch (err) {
    console.warn('[Preview] Could not fetch guild info:', err);
  }
  
  try {
    let imageBuffer;
    let embedTitle;
    
    switch (subcommand) {
      case 'welcome': {
        embedTitle = 'Welcome Card Preview';
        imageBuffer = await generateWelcomeCard({
          avatarURL: avatarUrl,
          username: user.username,
          serverName: guildName,
          memberCount: memberCount,
          config: config
        });
        break;
      }
      case 'leave': {
        embedTitle = 'Leave Card Preview';
        imageBuffer = await generateLeaveCard({
          avatarURL: avatarUrl,
          username: user.username,
          serverName: guildName,
          memberCount: memberCount,
          config: config,
          guildId: guildId
        });
        break;
      }
      default: {
        await patchWebhook(clientId, token, createEmbed(
          'Unknown Subcommand',
          `The subcommand \`${subcommand}\` was not recognized.`
        ));
        return;
      }
    }
    
    await patchWebhook(
      clientId,
      token,
      createEmbed(embedTitle, 'Here is your active design build rendering:'),
      imageBuffer,
      'preview.png'
    );
    
  } catch (err) {
    console.error('[Preview Generation Error]:', err);
    await patchWebhook(clientId, token, createEmbed(
      'Preview Failed',
      `Failed to generate preview: ${err.message}`
    ));
  }
}
