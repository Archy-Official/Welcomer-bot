const TARGET_API = 'https://discord.com/api';

Deno.serve(async (req: Request): Promise<Response> => {
  const url        = new URL(req.url);
  const routeParam = url.searchParams.get('route');

  // Use explicit route param if provided, otherwise strip the Supabase function prefix from the path
  let cleanPath = routeParam ?? url.pathname.replace(/^\/functions\/v1\/[^/]+/, '');
  if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;

  // Strip the internal 'route' param before forwarding
  const forwardParams = new URLSearchParams(url.search);
  forwardParams.delete('route');
  const queryString = forwardParams.toString();

  const targetUrl = `${TARGET_API}${cleanPath}${queryString ? `?${queryString}` : ''}`;

  const headers = new Headers(req.headers);
  headers.set('host', new URL(TARGET_API).host);
  headers.delete('origin');

  try {
    const body = (req.method !== 'GET' && req.method !== 'HEAD') ? req.body : null;

    const upstream = await fetch(targetUrl, {
      method:   req.method,
      headers,
      body,
      redirect: 'manual',
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set('Access-Control-Allow-Origin',  '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', '*');

    return new Response(upstream.body, {
      status:  upstream.status,
      headers: responseHeaders,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[proxy] Fatal:', err);
    return new Response(JSON.stringify({ error: message }), {
      status:  500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});