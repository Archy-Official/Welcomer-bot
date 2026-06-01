/*
* Codehooks Discord API Proxy Node
*/
import { app } from 'codehooks-js'

const proxyHandler = async (req, res) => {
  // 1. Extract the destination path from the query parameter (?route=/v10/gateway)
  const routeParam = req.query.route;
  if (!routeParam) {
    return res.status(200).send("Proxy node online! Use /proxy?route=/v10/gateway to test.");
  }

  // Format clean path string
  let cleanPath = routeParam.startsWith('/') ? routeParam : '/' + routeParam;

  // 2. Rebuild query parameters excluding our internal route flag
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== 'route') {
      queryParams.append(key, value);
    }
  }
  const queryString = queryParams.toString();

  const TARGET_API = "https://discord.com/api";
  const targetUrl = `${TARGET_API}${cleanPath}${queryString ? '?' + queryString : ''}`;

  // 3. Duplicate headers while dropping environment-specific system markers
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey !== 'host' && lowerKey !== 'origin' && !lowerKey.startsWith('x-cow-')) {
      headers[lowerKey] = value;
    }
  }
  headers['host'] = 'discord.com';

  try {
    const fetchOptions = {
      method: req.method,
      headers: headers
    };

    // 4. Codehooks automatically parses JSON into an object! 
    // We stringify it back before forwarding to Discord
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOptions.body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
      if (typeof req.body === 'object' && !headers['content-type']) {
        headers['content-type'] = 'application/json';
      }
    }

    // 5. Execute downstream handshake with Discord
    const discordResponse = await fetch(targetUrl, fetchOptions);
    const responseText = await discordResponse.text();

    // 6. Set up open CORS headers so your Hugging Face Space won't block the responses
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', '*');
    
    const discordContentType = discordResponse.headers.get('content-type');
    if (discordContentType) {
      res.set('Content-Type', discordContentType);
    }

    res.status(discordResponse.status).send(responseText);
  } catch (err) {
    console.error("[Codehooks Proxy Error]:", err);
    res.status(500).json({ error: err.message });
  }
};

// Map the proxy worker explicitly to standard HTTP methods
app.get('/proxy', proxyHandler);
app.post('/proxy', proxyHandler);
app.patch('/proxy', proxyHandler);
app.put('/proxy', proxyHandler);
app.delete('/proxy', proxyHandler);

// Keep a clean message on the root directory
app.get('/', (req, res) => {
  res.send('Proxy Node Active. Target the /proxy path.')
});

// Bind cleanly to serverless runtime
export default app.init();
