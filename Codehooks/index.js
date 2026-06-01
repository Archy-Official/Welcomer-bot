import { app } from 'codehooks-js';

// CRITICAL: Bypass Codehooks' default API-key authentication 
// so your Hugging Face Space can communicate with it freely
app.auth('*', (req, res, next) => {
  next();
});

// Catch-all route handler for the proxy network
app.all('*', async (req, res) => {
  // 1. Extract the destination path from the query string (?route=/v10/gateway)
  const routeParam = req.query.route;
  
  if (!routeParam) {
    return res.status(200).send("Codehooks Proxy Node Alive! Append ?route=/v10/gateway to test.");
  }

  let cleanPath = routeParam.startsWith('/') ? routeParam : '/' + routeParam;

  // 2. Clone the query string object and remove our internal proxy controller token
  const queryObj = { ...req.query };
  delete queryObj.route;
  
  const searchParams = new URLSearchParams(queryObj);
  const searchString = searchParams.toString();

  // 3. Construct the clean upstream Discord destination URL
  const TARGET_API = "https://discord.com/api";
  const targetUrl = `${TARGET_API}${cleanPath}${searchString ? "?" + searchString : ""}`;

  // 4. Copy incoming headers over while excluding host/origin constraints
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.toLowerCase() !== 'host' && key.toLowerCase() !== 'origin') {
      headers.set(key, value);
    }
  }
  headers.set("host", "discord.com");

  try {
    const fetchOptions = {
      method: req.method,
      headers: headers,
    };

    // If the bot is writing data (POST/PATCH), serialize the payload back to a string
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOptions.body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
    }

    // 5. Fire request into Discord's endpoint
    const discordResponse = await fetch(targetUrl, fetchOptions);
    const responseData = await discordResponse.text();

    // 6. Formulate response headers with universal CORS settings
    res.status(discordResponse.status);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', '*');

    const contentType = discordResponse.headers.get('content-type');
    if (contentType) {
      res.set('Content-Type', contentType);
    }

    // 7. Deliver data back to Hugging Face
    res.send(responseData);

  } catch (error) {
    console.error("[Codehooks Proxy Error]:", error);
    res.status(500).json({ error: error.message });
  }
});

// Bind to Codehooks serverless runtime
export default app.init();
