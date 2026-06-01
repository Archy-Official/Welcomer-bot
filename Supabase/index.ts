Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  
  // DYNAMIC REGEX FIX:
  // Automatically strips "/functions/v1/super-endpoint" (or whatever the function is named)
  // leaving clean trailing paths like "/v10/gateway" or "/v10/webhooks/..."
  const cleanPath = url.pathname.replace(/^\/functions\/v1\/[^/]+/, "");
  
  const TARGET_API = "https://discord.com/api"; 
  const targetUrl = `${TARGET_API}${cleanPath}${url.search}`;

  const headers = new Headers(req.headers);
  headers.set("host", new URL(TARGET_API).host);
  headers.delete("origin");

  try {
    let requestBody: ReadableStream<Uint8Array> | null = null;
    if (req.body && req.method !== "GET" && req.method !== "HEAD") {
      requestBody = req.body;
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: requestBody,
      redirect: "manual",
    });

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
