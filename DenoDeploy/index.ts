Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  
  // 1. Target endpoint configuration
  const TARGET_API = "https://discord.com/api"; 
  const targetUrl = `${TARGET_API}${url.pathname}${url.search}`;

  // 2. Clone headers and override Host to match the target environment
  const headers = new Headers(req.headers);
  headers.set("host", new URL(TARGET_API).host);
  headers.delete("origin");

  try {
    // 3. Extract the body stream safely for writing methods (POST, PATCH, PUT)
    let requestBody: ReadableStream<Uint8Array> | null = null;
    if (req.body && req.method !== "GET" && req.method !== "HEAD") {
      requestBody = req.body;
    }

    // 4. Execute the upstream request
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: requestBody,
      redirect: "manual",
    });

    // 5. Reconstruct response headers and attach open CORS permissions
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "*");

    // 6. Stream the payload directly back to your Hugging Face Space
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });

  } catch (error: any) {
    console.error("[Proxy Fatal]:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
