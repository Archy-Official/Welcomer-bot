const DISCORD_API = 'https://discord.com/api';

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const targetUrl = `${DISCORD_API}${url.pathname}${url.search}`;

  const headers = new Headers(req.headers);
  headers.set('host', new URL(DISCORD_API).host);
  headers.delete('origin');

  try {
    const body = (req.method !== 'GET' && req.method !== 'HEAD')
      ? req.body
      : null;

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
    const message = err instanceof Error ? err.message : 'Unknown proxy error';
    console.error('[Proxy] Fatal:', err);
    return new Response(JSON.stringify({ error: message }), {
      status:  500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});