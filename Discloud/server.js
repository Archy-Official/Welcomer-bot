import express from 'express';

const app = express();
// Discloud automatically injects the proper web routing port here
const PORT = process.env.PORT || 8080;

// Ingest any incoming binary stream data up to 25MB smoothly
app.use(express.raw({ type: '*/*', limit: '25mb' }));

// Open CORS policy to allow cross-cloud handshakes
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.all('*', async (req, res) => {
  // Extract target path from query parameter (?route=)
  const discordRoute = req.query.route;

  if (!discordRoute) {
    return res.status(400).json({ error: 'Missing target executable parameter "?route="' });
  }

  const targetUrl = `https://discord.com/api${discordRoute}`;

  try {
    const headers = new Headers();
    
    // Copy headers from incoming request, cleaning host-level overrides
    for (const [key, value] of Object.entries(req.headers)) {
      if (!['host', 'connection', 'content-length'].includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }

    const fetchOptions = {
      method: req.method,
      headers: headers
    };

    // Forward the request body buffer if it's a mutation/payload request
    if (!['GET', 'HEAD'].includes(req.method) && req.body && req.body.length > 0) {
      fetchOptions.body = req.body;
    }

    console.log(`[Discloud Node] Forwarding ${req.method} route to: ${targetUrl}`);
    const discordResponse = await fetch(targetUrl, fetchOptions);
    
    // Process response payload directly as a raw array buffer
    const responseBuffer = await discordResponse.arrayBuffer();
    
    // Mirror response details back to the primary bot engine
    res.status(discordResponse.status);
    
    const contentType = discordResponse.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    return res.send(Buffer.from(responseBuffer));

  } catch (err) {
    console.error('[Discloud Proxy Exception]:', err);
    return res.status(500).json({ error: 'Discloud node routing failure', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Discloud Cluster Router] Online and listening on port: ${PORT}`);
});
