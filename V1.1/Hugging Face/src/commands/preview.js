import { readJSON } from '../storage/hfClient.js';
import { generateWelcomeCard } from '../canvas/welcomeCard.js';
import { generateLeaveCard } from '../canvas/leaveCard.js';
import { patchWebhook, fetchViaProxy } from '../utils/proxy.js';

const EMBED_COLOR  = 0x5865F2;
const DISCORD_CDN  = 'https://cdn.discordapp.com';

function createEmbed(title, description, fields = [], color = EMBED_COLOR) {
  return {
    embeds: [{ title, description, fields, color, timestamp: new Date().toISOString() }],
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
      createdAt: new Date().toISOString(),
    };
  }
}

export default async function handlePreview(interaction) {
  const { guild_id: guildId, member, data, token } = interaction;
  const clientId   = process.env.DISCORD_CLIENT_ID;
  const subcommand = data.options?.[0]?.name;
  const config     = await getConfig(guildId);
  const user       = member.user;

  const avatarUrl = user.avatar
    ? `${DISCORD_CDN}/avatars/${user.id}/${user.avatar}.png?size=256`
    : `${DISCORD_CDN}/embed/avatars/${parseInt(user.discriminator || '0') % 5}.png`;

  let guildName   = 'Unknown Server';
  let memberCount = 1;

  try {
    const resp = await fetchViaProxy(`/v10/guilds/${guildId}?with_counts=true`, {
      method:  'GET',
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    });
    if (resp.ok) {
      const data    = await resp.json();
      guildName     = data.name;
      memberCount   = data.approximate_member_count || data.member_count || 1;
    }
  } catch (err) {
    console.warn('[preview] Could not fetch guild info:', err.message);
  }

  try {
    let imageBuffer;
    let embedTitle;

    switch (subcommand) {
      case 'welcome':
        embedTitle  = 'Welcome Card Preview';
        imageBuffer = await generateWelcomeCard({
          avatarURL: avatarUrl, username: user.username,
          serverName: guildName, memberCount, config,
        });
        break;

      case 'leave':
        embedTitle  = 'Leave Card Preview';
        imageBuffer = await generateLeaveCard({
          avatarURL: avatarUrl, username: user.username,
          serverName: guildName, memberCount, config, guildId,
        });
        break;

      default:
        await patchWebhook(clientId, token, createEmbed(
          'Unknown Subcommand',
          `\`${subcommand}\` is not a valid preview type.`
        ));
        return;
    }

    await patchWebhook(clientId, token, createEmbed(embedTitle, 'Here is your current card:'), imageBuffer, 'preview.png');

  } catch (err) {
    console.error('[preview] Card generation failed:', err);
    await patchWebhook(clientId, token, createEmbed('Preview Failed', err.message));
  }
}