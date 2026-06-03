export default async (req, context) => {
  // 1. Handle CORS Preflight Options
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      }
    });
  }

  // 2. Extract the target Discord endpoint from the query string (?route=)
  const urlObj = new URL(req.url);
  const discordRoute = urlObj.searchParams.get('route');

  if (!discordRoute) {
    return new Response(JSON.stringify({ error: 'Missing target routing parameter "?route="' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const targetUrl = `https://discord.com/api${discordRoute}`;

  try {
    // 3. Clone and clean headers
    const headers = new Headers(req.headers);
    headers.delete('host');
    headers.delete('connection');

    const fetchOptions = {
      method: req.method,
      headers: headers
    };

    // 4. Read raw request body array buffers for non-GET requests (handles attachments safely)
    if (!['GET', 'HEAD'].includes(req.method)) {
      const arrayBuffer = await req.arrayBuffer();
      if (arrayBuffer.byteLength > 0) {
        fetchOptions.body = arrayBuffer;
      }
    }

    console.log(`[Netlify Node] Forwarding ${req.method} request to: ${targetUrl}`);
    const discordResponse = await fetch(targetUrl, fetchOptions);
    
    // 5. Build response headers mirroring Discord's content types
    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    
    const contentType = discordResponse.headers.get('content-type');
    if (contentType) {
      responseHeaders.set('Content-Type', contentType);
    }

    // 6. Return response buffer directly back to the bot mesh
    const responseBuffer = await discordResponse.arrayBuffer();
    return new Response(responseBuffer, {
      status: discordResponse.status,
      headers: responseHeaders
    });

  } catch (err) {
    console.error('[Netlify Proxy Exception]:', err);
    return new Response(JSON.stringify({ error: 'Netlify infrastructure routing failure', details: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};
