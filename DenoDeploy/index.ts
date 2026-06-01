import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req: Request) => {
  const url = new URL(req.url);
  
  // Extract path (e.g., /v10/webhooks/...) and target Discord API directly
  const targetUrl = `https://discord.com/api${url.pathname}${url.search}`;

  // Clone original request headers and strip host constraints
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("origin");

  try {
    // Forward full content payload body along with method signature
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? await req.blob() : null,
    });

    // Extract headers safely to avoid immutable constraints
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
