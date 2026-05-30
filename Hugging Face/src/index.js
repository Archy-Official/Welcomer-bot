import http from 'http';
import router from './router.js';

const PORT = process.env.PORT || 7860;

// Helper to reliably buffer stream payloads into a text string
function getBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // Standardize body tracking across HTTP methods
    let body = null;
    if (req.method === 'POST') {
      const raw = await getBody(req);
      if (raw.trim()) {
        try {
          body = JSON.parse(raw);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        }
      }
    }

    // Hand over context directly to the routing controller
    await router(req, res, pathname, body);
  } catch (err) {
    console.error('[Runtime Exception Override]:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
});

server.listen(PORT, () => {
  console.log(`[startup] Node.js ESM server live on port ${PORT}`);
});
