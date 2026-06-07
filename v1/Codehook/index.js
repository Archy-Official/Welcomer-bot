import { app } from 'codehooks-js';

const DISCORD_API = 'https://discord.com/api';

// Headers injected by the Codehooks runtime that shouldn't leak downstream
const STRIP_HEADERS = new Set(['host', 'origin']);
const STRIP_PREFIX  = 'x-cow-';

async function proxyHandler(req, res) {
  const route = req.query.route;

  if (!route) {
    return res.status(200).send('Proxy node online. Use ?route=/v10/... to forward requests.');
  }

  const path = route.startsWith('/') ? route : `/${route}`;

  const qs = new URLSearchParams(
    Object.entries(req.query).filter(([k]) => k !== 'route')
  ).toString();

  const targetUrl = `${DISCORD_API}${path}${qs ? `?${qs}` : ''}`;

  const headers = {};
  for (const [key, val] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (!STRIP_HEADERS.has(lower) && !lower.startsWith(STRIP_PREFIX)) {
      headers[lower] = val;
    }
  }
  headers['host'] = 'discord.com';

  const fetchOptions = { method: req.method, headers };

  if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
    // Codehooks pre-parses JSON bodies — re-serialize before forwarding
    fetchOptions.body = typeof req.body === 'object'
      ? JSON.stringify(req.body)
      : req.body;

    if (typeof req.body === 'object' && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
  }

  try {
    const upstream = await fetch(targetUrl, fetchOptions);
    const body     = await upstream.text();

    res.set('Access-Control-Allow-Origin',  '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', '*');

    const contentType = upstream.headers.get('content-type');
    if (contentType) res.set('Content-Type', contentType);

    return res.status(upstream.status).send(body);
  } catch (err) {
    console.error('[Proxy] Upstream request failed:', err);
    return res.status(500).json({ error: err.message });
  }
}

app.get('/proxy',    proxyHandler);
app.post('/proxy',   proxyHandler);
app.patch('/proxy',  proxyHandler);
app.put('/proxy',    proxyHandler);
app.delete('/proxy', proxyHandler);

app.get('/', (_req, res) => res.send('Proxy node active.'));

export default app.init();