import { readJSON, writeJSON } from './storage/hfClient.js';
import { getCached } from './storage/cache.js';
import { generateWelcomeCard } from './canvas/welcomeCard.js';
import { generateLeaveCard } from './canvas/leaveCard.js';
import { patchWebhook, fetchViaProxy } from './utils/proxy.js';
import { parseTemplate } from './utils/templateParser.js';

import handleSetup             from './commands/setup.js';
import handleWelcomeMessage    from './commands/welcome-message.js';
import handleLeaveMessage      from './commands/leave-message.js';
import handleWelcomeBackground from './commands/welcome-background.js';
import handleLeaveBackground   from './commands/leave-background.js';
import handlePreview           from './commands/preview.js';
import handleReset             from './commands/reset.js';

const COMMAND_HANDLERS = {
  'setup':              handleSetup,
  'welcome-message':    handleWelcomeMessage,
  'leave-message':      handleLeaveMessage,
  'welcome-background': handleWelcomeBackground,
  'leave-background':   handleLeaveBackground,
  'preview':            handlePreview,
  'reset':              handleReset,
};

function unauthorized(res) {
  res.writeHead(401);
  return res.end(JSON.stringify({ error: 'Unauthorized' }));
}

function checkSecret(req) {
  const secret = process.env.API_SECRET;
  return secret && req.headers['x-api-secret'] === secret;
}

async function sendErrorWebhook(clientId, token, message) {
  try {
    await patchWebhook(clientId, token, {
      embeds: [{
        title: 'Command Error',
        description: `An error occurred: ${message}`,
        color: 0xff0000,
        timestamp: new Date().toISOString(),
      }],
    });
  } catch (err) {
    console.error('[router] Failed to send error webhook:', err);
  }
}

export default async function router(req, res, pathname, body) {
  res.setHeader('Content-Type', 'application/json');

  // Storage smoke test — dev/ops use only
  if (pathname === '/test-storage' && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (!checkSecret(req) && url.searchParams.get('secret') !== process.env.API_SECRET) {
      return unauthorized(res);
    }

    try {
      const payload = {
        status: 'ok',
        message: 'Read/write healthy',
        timestamp: new Date().toISOString(),
      };
      await writeJSON('test-file.json', payload);
      const data = await getCached('test-key', () => readJSON('test-file.json'));

      res.writeHead(200);
      return res.end(JSON.stringify({ storage_test: 'PASSED', data }, null, 2));
    } catch (err) {
      console.error('[storage test]', err);
      res.writeHead(500);
      return res.end(JSON.stringify({ storage_test: 'FAILED', error: err.message }));
    }
  }

  // Slash command dispatch — forwarded here by the Cloudflare worker after deferral
  if (pathname === '/interactions' && req.method === 'POST') {
    if (!checkSecret(req)) return unauthorized(res);

    const interaction  = typeof body === 'string' ? JSON.parse(body) : body;
    const commandName  = interaction.data?.name;
    const handler      = COMMAND_HANDLERS[commandName];

    if (!handler) {
      await sendErrorWebhook(
        process.env.DISCORD_CLIENT_ID,
        interaction.token,
        `Unknown command: ${commandName}`
      );
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true }));
    }

    try {
      await handler(interaction);
    } catch (err) {
      console.error(`[router] Command error (${commandName}):`, err);
      await sendErrorWebhook(process.env.DISCORD_CLIENT_ID, interaction.token, err.message);
    }

    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true }));
  }

  if (pathname === '/generate/welcome' && req.method === 'POST') {
    try {
      const p = typeof body === 'string' ? JSON.parse(body) : body;
      const image = await generateWelcomeCard({
        avatarURL:   p.avatarURL,
        username:    p.username,
        serverName:  p.serverName,
        memberCount: p.memberCount,
        config:      p.config || {},
      });
      res.setHeader('Content-Type', 'image/png');
      res.writeHead(200);
      return res.end(image);
    } catch (err) {
      console.error('[router] Welcome card error:', err);
      res.writeHead(500);
      return res.end(JSON.stringify({ error: 'Failed to generate welcome card', detail: err.message }));
    }
  }

  if (pathname === '/generate/leave' && req.method === 'POST') {
    try {
      const p = typeof body === 'string' ? JSON.parse(body) : body;
      const image = await generateLeaveCard({
        avatarURL:   p.avatarURL,
        username:    p.username,
        serverName:  p.serverName,
        memberCount: p.memberCount,
        config:      p.config || {},
        guildId:     p.guildId || p.config?.guildId,
      });
      res.setHeader('Content-Type', 'image/png');
      res.writeHead(200);
      return res.end(image);
    } catch (err) {
      console.error('[router] Leave card error:', err);
      res.writeHead(500);
      return res.end(JSON.stringify({ error: 'Failed to generate leave card', detail: err.message }));
    }
  }

  // Connectivity ping from the Discloud bot — no guild index file exists,
  // configs live at guilds/{guildId}/config.json and are read per-event
  if (pathname === '/internal/guilds' && req.method === 'GET') {
    if (!checkSecret(req)) return unauthorized(res);
    res.writeHead(200);
    return res.end(JSON.stringify([]));
  }

  // Inbound member join/leave events from the Discloud bot
  if (pathname === '/internal/member-event' && req.method === 'POST') {
    if (!checkSecret(req)) return unauthorized(res);

    const { event, guildId, userId, username, globalName, avatarUrl, memberCount } = body || {};

    if (!event || !guildId || !userId) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'Missing required fields: event, guildId, userId' }));
    }

    console.log(`[events] '${event}' — ${username} (${userId}) in guild ${guildId}`);

    try {
      const config = await readJSON(`guilds/${guildId}/config.json`);

      if (!config) {
        console.log(`[events] No config for guild ${guildId} — skipping.`);
        res.writeHead(200);
        return res.end(JSON.stringify({ status: 'no_config' }));
      }

      const isJoin    = event === 'join';
      const channelId = isJoin ? config.welcomeChannelId : config.leaveChannelId;

      if (!channelId) {
        console.log(`[events] No ${isJoin ? 'welcome' : 'leave'} channel set for guild ${guildId}.`);
        res.writeHead(200);
        return res.end(JSON.stringify({ status: 'no_channel' }));
      }

      // Resolve guild name via the proxy mesh — non-fatal if it fails
      let guildName = 'Unknown Server';
      try {
        const r = await fetchViaProxy(`/v10/guilds/${guildId}?with_counts=true`, {
          method:  'GET',
          headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
        });
        if (r.ok) {
          const data = await r.json();
          guildName  = data.name || guildName;
        }
      } catch (err) {
        console.warn(`[events] Could not resolve guild name: ${err.message}`);
      }

      const displayName = globalName || username;
      const avatarURL   = avatarUrl  || 'https://cdn.discordapp.com/embed/avatars/0.png';

      const imageBuffer = isJoin
        ? await generateWelcomeCard({ avatarURL, username: displayName, serverName: guildName, memberCount, config, guildId })
        : await generateLeaveCard(  { avatarURL, username: displayName, serverName: guildName, memberCount, config, guildId });

      const messageText = parseTemplate(
        isJoin ? config.welcomeMessage : config.leaveMessage,
        { username: displayName, server: guildName, memberCount: String(memberCount ?? '') }
      );

      const formData = new FormData();
      formData.append('payload_json', JSON.stringify({
        content: messageText || undefined,
        embeds: [{
          color:     isJoin ? 0x57F287 : 0xED4245,
          image:     { url: 'attachment://card.png' },
          timestamp: new Date().toISOString(),
        }],
      }));
      formData.append('files[0]', new Blob([imageBuffer], { type: 'image/png' }), 'card.png');

      const sendResp = await fetchViaProxy(`/v10/channels/${channelId}/messages`, {
        method:  'POST',
        headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
        body:    formData,
      });

      if (sendResp.ok) {
        console.log(`[events] Card sent to channel ${channelId}`);
        res.writeHead(200);
        return res.end(JSON.stringify({ status: 'sent' }));
      }

      const errText = await sendResp.text().catch(() => '');
      console.error(`[events] Discord returned ${sendResp.status}: ${errText}`);
      res.writeHead(502);
      return res.end(JSON.stringify({ status: 'discord_error', code: sendResp.status, detail: errText }));

    } catch (err) {
      console.error(`[events] Fatal:`, err);
      res.writeHead(500);
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  res.writeHead(404);
  return res.end(JSON.stringify({ error: 'Not Found' }));
}