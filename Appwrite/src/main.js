export default async ({ req, res, log, error }) => {
  // 1. Extract the destination URL dynamically
  const targetUrl = req.headers['x-target-url'] || req.query['route'];

  if (!targetUrl) {
    error('Drop execution: Missing target URL routing parameter.');
    return res.json({ error: 'Missing target URL route mapping.' }, 400);
  }

  // 2. Strip standard platform headers to pass validation checks cleanly
  const forwardedHeaders = {};
  const strippedHeaders = [
    'host', 
    'content-length', 
    'connection', 
    'x-appwrite-key', 
    'x-forwarded-for', 
    'x-forwarded-proto'
  ];
  
  for (const [key, value] of Object.entries(req.headers)) {
    if (!strippedHeaders.includes(key.toLowerCase())) {
      forwardedHeaders[key] = value;
    }
  }

  // Fallback to json context if content-type is missing during payloads
  if (req.body && !forwardedHeaders['content-type']) {
    forwardedHeaders['content-type'] = 'application/json';
  }

  try {
    // 3. Normalize the incoming payload format
    let requestBody = req.body;
    if (req.method !== 'GET' && req.method !== 'HEAD' && requestBody) {
      if (typeof requestBody === 'object') {
        requestBody = JSON.stringify(requestBody);
      }
    } else {
      requestBody = undefined;
    }

    log(`Forwarding ${req.method} request directly to: ${targetUrl}`);

    // 4. Send request through the native fetch pool
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: forwardedHeaders,
      body: requestBody,
    });

    const responseData = await response.text();
    const responseContentType = response.headers.get('content-type') || 'text/plain';

    // 5. Pass response payload back to your client
    let jsonOutput;
    try {
      jsonOutput = JSON.parse(responseData);
    } catch {
      jsonOutput = null;
    }

    if (jsonOutput) {
      return res.json(jsonOutput, response.status, { 'content-type': responseContentType });
    } else {
      return res.send(responseData, response.status, { 'content-type': responseContentType });
    }

  } catch (err) {
    error(`Proxy intercept breakdown: ${err.message}`);
    return res.json({ error: 'Proxy target connection failure', details: err.message }, 500);
  }
};
