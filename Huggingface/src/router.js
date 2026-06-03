import { readJSON, writeJSON } from './storage/hfClient.js';
import { getCached } from './storage/cache.js';
import { generateWelcomeCard } from './canvas/welcomeCard.js';
import { generateLeaveCard } from './canvas/leaveCard.js';

// Import global proxy handler
import { patchWebhook } from './utils/proxy.js';

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
    
    // Validate API secret coming from outbound sources
    const secret = process.env.API_SECRET;
    if (!secret || req.headers['x-api-secret'] !== secret) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    
    // Parse body context safely
    const interaction = typeof body === 'string' ? JSON.parse(body) : body;
    
    // Get command name and route to handler
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
  
  // 5. GET /health
  if (pathname === '/health' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'ok' }));
  }
  
  // 6. 404 for unmatched routes
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(404);
  return res.end(JSON.stringify({ error: 'Not Found' }));
}