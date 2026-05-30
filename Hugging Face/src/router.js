import { readJSON, writeJSON } from './storage/hfClient.js';
import { getCached } from './storage/cache.js';

export default async function router(req, res, pathname, body) {
  res.setHeader('Content-Type', 'application/json');

  // New Storage Test Endpoint
  if (pathname === '/test-storage' && req.method === 'GET') {
    try {
      console.log('[Test] Starting Bucket Storage self-test...');
      
      const testPayload = { 
        status: "Success!", 
        message: "Read and Write are working perfectly!",
        timestamp: new Date().toISOString() 
      };

      // 1. Test Writing
      console.log('[Test] Attempting to write test-file.json...');
      await writeJSON('test-file.json', testPayload);

      // 2. Test Reading (Wrapped in getCached to verify the cache layer too!)
      console.log('[Test] Attempting to read test-file.json back...');
      const retrievedData = await getCached('test-key', () => readJSON('test-file.json'));

      res.writeHead(200);
      return res.end(JSON.stringify({
        storage_test: "PASSED",
        data_recovered: retrievedData
      }, null, 2));

    } catch (err) {
      console.error('[Test Failure]:', err);
      res.writeHead(500);
      return res.end(JSON.stringify({ 
        storage_test: "FAILED", 
        error: err.message 
      }, null, 2));
    }
  }

  // POST /interactions
  if (pathname === '/interactions' && req.method === 'POST') {
    const secret = process.env.API_SECRET;
    if (!secret || req.headers['x-api-secret'] !== secret) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    console.log('[router/interactions] Payload validated against API_SECRET');
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true }));
  }

  // POST /generate/welcome (Stub)
  if (pathname === '/generate/welcome' && req.method === 'POST') {
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true }));
  }

  // POST /generate/leave (Stub)
  if (pathname === '/generate/leave' && req.method === 'POST') {
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true }));
  }

  // GET /health
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  res.writeHead(404);
  return res.end(JSON.stringify({ error: 'Not Found' }));
}
