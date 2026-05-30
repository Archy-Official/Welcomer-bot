import { readJSON, writeJSON } from './storage/hfClient.js';
import { getCached } from './storage/cache.js';
import { generateWelcomeCard } from './canvas/welcomeCard.js';
import { generateLeaveCard } from './canvas/leaveCard.js';

export default async function router(req, res, pathname, body) {
  // Safe helper to extract and parse string payload bodies if passed as text streams
  const getParsedBody = () => {
    if (!body) return {};
    return typeof body === 'string' ? JSON.parse(body) : body;
  };

  const urlObj = new URL(req.url, 'http://localhost');
  const querySecret = urlObj.searchParams.get('secret');

  // Secure Storage Test Endpoint
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

  // POST /interactions
  if (pathname === '/interactions' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    const secret = process.env.API_SECRET;
    if (!secret || req.headers['x-api-secret'] !== secret) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true }));
  }

  // POST /generate/welcome
  if (pathname === '/generate/welcome' && req.method === 'POST') {
    try {
      const payload = getParsedBody();
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

  // POST /generate/leave
  if (pathname === '/generate/leave' && req.method === 'POST') {
    try {
      const payload = getParsedBody();
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

  // GET /health
  if (pathname === '/health' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  res.setHeader('Content-Type', 'application/json');
  res.writeHead(404);
  return res.end(JSON.stringify({ error: 'Not Found' }));
}
