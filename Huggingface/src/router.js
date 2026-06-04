import { readJSON, writeJSON } from './storage/hfClient.js';
import { getCached } from './storage/cache.js';
import { generateWelcomeCard } from './canvas/welcomeCard.js';
import { generateLeaveCard } from './canvas/leaveCard.js';

// Import global proxy handler
import { patchWebhook, fetchViaProxy } from './utils/proxy.js';
import { parseTemplate } from './utils/templateParser.js';

// Import command handlers
import handleSetup from './commands/setup.js';
import handleWelcomeMessage from './commands/welcome-message.js';
import handleLeaveMessage from './commands/leave-message.js';
import handleWelcomeBackground from './commands/welcome-background.js';
import handleLeaveBackground from './commands/leave-background.js';
import handlePreview from './commands/preview.js';
import handleReset from './commands/reset.js';

// Map command names to handlers
const COMMAND_HANDLERS = {
  'setup': handleSetup,
  'welcome-message': handleWelcomeMessage,
  'leave-message': handleLeaveMessage,
  'welcome-background': handleWelcomeBackground,
  'leave-background': handleLeaveBackground,
  'preview': handlePreview,
  'reset': handleReset
};

// Helper to send error embed via our global routing proxy network
async function sendErrorWebhook(clientId, token, errorMessage) {
  const payload = {
    embeds: [{
      title: 'Command Error',
      description: `An error occurred: ${errorMessage}`,
      color: 0xff0000,
      timestamp: new Date().toISOString()
    }]
  };

  try {
    await patchWebhook(clientId, token, payload);
    console.log(`[Router Webhook] System error successfully routed through global proxy matrix.`);
  } catch (err) {
    console.error('[Router Webhook Proxy Error]:', err);
  }
}

export default async function router(req, res, pathname, body) {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const querySecret = urlObj.searchParams.get('secret');
  
  // 1. Secure Storage Test Endpoint
  if (pathname === '/test-storage' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    try {
      if (!process.env.API_SECRET || querySecret !== process.env.API_SECRET) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'Unauthorized test access' }));
      }
      
      console.log('[Test] Starting Bucket Storage self-test...');
      const testPayload = { 
        status: "Success!", 
        message: "Read and Write are working perfectly!",
        timestamp: new Date().toISOString() 
      };

      await writeJSON('test-file.json', testPayload);
      const retrievedData = await getCached('test-key', () => readJSON('test-file.json'));

      res.writeHead(200);
      return res.end(JSON.stringify({ storage_test: "PASSED", data_recovered: retrievedData }, null, 2));
    } catch (err) {
      console.error('[Test Failure]:', err);
      res.writeHead(500);
      return res.end(JSON.stringify({ storage_test: "FAILED", error: err.message }, null, 2));
    }
  }
  
  // 2. POST /interactions - Discord slash command handler
  if (pathname === '/interactions' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    
    const secret = process.env.API_SECRET;
    if (!secret || req.headers['x-api-secret'] !== secret) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    
    const interaction = typeof body === 'string' ? JSON.parse(body) : body;
    const commandName = interaction.data?.name;
    const handler = COMMAND_HANDLERS[commandName];
    
    if (!handler) {
      const clientId = process.env.DISCORD_CLIENT_ID;
      const token = interaction.token;
      await sendErrorWebhook(clientId, token, `Unknown command: ${commandName}`);
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true }));
    }
    
    try {
      await handler(interaction);
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error(`[Command Handler Error] ${commandName}:`, err);
      const clientId = process.env.DISCORD_CLIENT_ID;
      const token = interaction.token;
      await sendErrorWebhook(clientId, token, err.message);
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true }));
    }
  }
  
  // 3. POST /generate/welcome
  if (pathname === '/generate/welcome' && req.method === 'POST') {
    try {
      const payload = typeof body === 'string' ? JSON.parse(body) : body;
      const imageBuffer = await generateWelcomeCard({
        avatarURL: payload.avatarURL,
        username: payload.username,
        serverName: payload.serverName,
        memberCount: payload.memberCount,
        config: payload.config || {}
      });
      
      res.setHeader('Content-Type', 'image/png');
      res.writeHead(200);
      return res.end(imageBuffer);
    } catch (err) {
      console.error('[Router] Welcome card generation crashed:', err);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      return res.end(JSON.stringify({ error: 'Failed to generate welcome image asset', details: err.message }));
    }
  }
  
  // 4. POST /generate/leave
  if (pathname === '/generate/leave' && req.method === 'POST') {
    try {
      const payload = typeof body === 'string' ? JSON.parse(body) : body;
      const imageBuffer = await generateLeaveCard({
        avatarURL: payload.avatarURL,
        username: payload.username,
        serverName: payload.serverName,
        memberCount: payload.memberCount,
        config: payload.config || {},
        guildId: payload.guildId || (payload.config && payload.config.guildId)
      });
      
      res.setHeader('Content-Type', 'image/png');
      res.writeHead(200);
      return res.end(imageBuffer);
    } catch (err) {
      console.error('[Router] Leave card generation crashed:', err);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      return res.end(JSON.stringify({ error: 'Failed to generate leave image asset', details: err.message }));
    }
  }

  // 5. GET /internal/guilds - Ping endpoint for Discloud bot connectivity check
  // Note: configs are stored per-guild at guilds/{guildId}/config.json, there is no index file.
  // Discloud bot no longer caches configs locally — it forwards all events to HF which reads
  // the individual guild config at event time.
  if (pathname === '/internal/guilds' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');

    const secret = process.env.API_SECRET;
    if (!secret || req.headers['x-api-secret'] !== secret) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }

    res.writeHead(200);
    return res.end(JSON.stringify([]));
  }

  // 6. POST /internal/member-event - Called by Discloud bot on member join/leave
  if (pathname === '/internal/member-event' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');

    const secret = process.env.API_SECRET;
    if (!secret || req.headers['x-api-secret'] !== secret) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }

    const { event, guildId, userId, username, globalName, avatarUrl, memberCount } = body || {};

    if (!event || !guildId || !userId) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'Missing required fields: event, guildId, userId' }));
    }

    console.log(`[Member Event] '${event}' for ${username} (${userId}) in guild ${guildId}`);

    try {
      // Load this guild's config from HF bucket storage (same path all commands use)
      const config = await readJSON(`guilds/${guildId}/config.json`);

      if (!config) {
        console.log(`[Member Event] No config for guild ${guildId} — ignoring.`);
        res.writeHead(200);
        return res.end(JSON.stringify({ status: 'no_config' }));
      }

      const isJoin = event === 'join';
      const channelId = isJoin ? config.welcomeChannelId : config.leaveChannelId;

      if (!channelId) {
        console.log(`[Member Event] Guild ${guildId} has no ${isJoin ? 'welcome' : 'leave'} channel set.`);
        res.writeHead(200);
        return res.end(JSON.stringify({ status: 'no_channel' }));
      }

      // Fetch guild name via proxy mesh (same pattern as preview.js)
      let guildName = 'Unknown Server';
      try {
        const guildResponse = await fetchViaProxy(`/v10/guilds/${guildId}?with_counts=true`, {
          method: 'GET',
          headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}` }
        });
        if (guildResponse.ok) {
          const guildData = await guildResponse.json();
          guildName = guildData.name || guildName;
        }
      } catch (err) {
        console.warn(`[Member Event] Could not fetch guild name, using fallback: ${err.message}`);
      }

      // Build the card image using the exact same generators the /generate routes use
      const displayName = globalName || username;
      const cardAvatarUrl = avatarUrl || `https://cdn.discordapp.com/embed/avatars/0.png`;

      const imageBuffer = isJoin
        ? await generateWelcomeCard({
            avatarURL: cardAvatarUrl,
            username: displayName,
            serverName: guildName,
            memberCount: memberCount,
            config: config,
            guildId: guildId
          })
        : await generateLeaveCard({
            avatarURL: cardAvatarUrl,
            username: displayName,
            serverName: guildName,
            memberCount: memberCount,
            config: config,
            guildId: guildId
          });

      // Parse the text message template using existing templateParser
      // templateParser supports: {username} {server} {memberCount}
      const rawTemplate = isJoin ? config.welcomeMessage : config.leaveMessage;
      const messageText = parseTemplate(rawTemplate, {
        username: displayName,
        server: guildName,
        memberCount: String(memberCount ?? '')
      });

      // Send card image + text message to the channel via proxy mesh
      // Uses multipart/form-data with payload_json + file attachment (same shape as patchWebhook with file)
      const formData = new FormData();
      const payload = {
        content: messageText || undefined,
        embeds: [{
          color: isJoin ? 0x57F287 : 0xED4245,
          image: { url: 'attachment://card.png' },
          timestamp: new Date().toISOString()
        }]
      };
      formData.append('payload_json', JSON.stringify(payload));
      formData.append('files[0]', new Blob([imageBuffer], { type: 'image/png' }), 'card.png');

      const sendResponse = await fetchViaProxy(`/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`
        },
        body: formData
      });

      if (sendResponse.ok) {
        console.log(`[Member Event] ✅ Card sent to channel ${channelId} for '${event}' event`);
        res.writeHead(200);
        return res.end(JSON.stringify({ status: 'sent' }));
      } else {
        const errText = await sendResponse.text().catch(() => '');
        console.error(`[Member Event] Discord returned ${sendResponse.status}: ${errText}`);
        res.writeHead(502);
        return res.end(JSON.stringify({ status: 'discord_error', code: sendResponse.status, detail: errText }));
      }

    } catch (err) {
      console.error(`[Member Event Fatal] ${err.message}`, err);
      res.writeHead(500);
      return res.end(JSON.stringify({ error: err.message }));
    }
  }
  
  // 7. GET /health
  if (pathname === '/health' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'ok' }));
  }
  
  // 8. 404 for unmatched routes
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(404);
  return res.end(JSON.stringify({ error: 'Not Found' }));
}
