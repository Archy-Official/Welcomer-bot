export default async function router(req, res, pathname, body) {
  res.setHeader('Content-Type', 'application/json');

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
    console.log('[router/generate/welcome] Stub invoked');
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true }));
  }

  // POST /generate/leave (Stub)
  if (pathname === '/generate/leave' && req.method === 'POST') {
    console.log('[router/generate/leave] Stub invoked');
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true }));
  }

  // GET /health
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  // Fallback Catch-All
  res.writeHead(404);
  return res.end(JSON.stringify({ error: 'Not Found' }));
}
