Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  
  // 1. Pull the destination route from the query string (?route=/v10/gateway)
  const routeParam = url.searchParams.get("route");
  
  // Hybrid Fallback: Use the query param if it exists, otherwise fall back to path parsing
  let cleanPath = routeParam || url.pathname.replace(/^\/functions\/v1\/[^/]+/, "");
  if (!cleanPath.startsWith("/")) {
    cleanPath = "/" + cleanPath;
  }

  // 2. Clean out the internal 'route' token so it isn't forwarded to Discord
  const forwardSearch = new URLSearchParams(url.search);
  forwardSearch.delete("route");
  const searchString = forwardSearch.toString();

  // 3. Assemble the authentic Discord destination URL
  const TARGET_API = "https://discord.com/api"; 
  const targetUrl = `${TARGET_API}${cleanPath}${searchString ? "?" + searchString : ""}`;

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
