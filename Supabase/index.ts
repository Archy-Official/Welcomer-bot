// Supabase Edge Function: Discord API Route Proxy

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  
  // 1. Strip out the Supabase routing prefix to leave clean Discord routes
  // e.g., /functions/v1/discord-proxy/v10/webhooks -> /v10/webhooks
  const cleanPath = url.pathname.replace(/^\/functions\/v1\/discord-proxy/, "");
  
  const TARGET_API = "https://discord.com/api"; 
  const targetUrl = `${TARGET_API}${cleanPath}${url.search}`;

  // 2. Clone headers and mask the host signature
  const headers = new Headers(req.headers);
  headers.set("host", new URL(TARGET_API).host);
  headers.delete("origin");

  try {
    // 3. Keep body stream intact for interaction PATCH/POST payloads
    let requestBody: ReadableStream<Uint8Array> | null = null;
    if (req.body && req.method !== "GET" && req.method !== "HEAD") {
      requestBody = req.body;
    }

    // 4. Upstream call directly into Discord's networks
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: requestBody,
      redirect: "manual",
    });

    // 5. Append open CORS handling to ensure your Space won't block it
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "*");

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });

  } catch (error: any) {
    console.error("[Supabase Proxy Fatal]:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
