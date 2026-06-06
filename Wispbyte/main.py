import os
import re
import urllib.parse
import httpx
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse

# Lifespan manager to handle the HTTPX client connection pool efficiently
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize a global async client instance
    app.state.client = httpx.AsyncClient()
    yield
    # Clean up and close connections when the server shuts down
    await app.state.client.aclose()

app = FastAPI(lifespan=lifespan)
TARGET_API = "https://discord.com/api"

# Catch-all route to handle every method and structural endpoint path
@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_handler(request: Request, path: str):
    client = request.app.state.client
    
    try:
        # 1. Pull the destination route from the query string (?route=/v10/gateway)
        route_param = request.query_params.get("route")
        
        # Hybrid Fallback: Use query param if it exists, otherwise fall back to path parsing
        if route_param:
            clean_path = route_param
        else:
            # Matches Deno's: url.pathname.replace(/^\/functions\/v1\/[^/]+/, "")
            clean_path = re.sub(r'^/functions/v1/[^/]+', '', request.url.path)
            
        if not clean_path.startswith("/"):
            clean_path = "/" + clean_path

        # 2. Clean out the internal 'route' token so it isn't forwarded to Discord
        query_items = [(k, v) for k, v in request.query_params.multi_items() if k != "route"]
        search_string = urllib.parse.urlencode(query_items)

        # 3. Assemble the authentic Discord destination URL
        target_url = f"{TARGET_API}{clean_path}"
        if search_string:
            target_url += f"?{search_string}"

        # Mirror and adjust incoming headers
        headers = dict(request.headers)
        headers["host"] = "discord.com"
        headers.pop("origin", None)

        # Handle request body streaming dynamically for payload methods
        request_body = None
        if request.method not in ("GET", "HEAD"):
            request_body = request.stream()
            # Strip content-length so HTTPX chunks the data forward correctly
            headers.pop("content-length", None)

        # Build and dispatch the streaming request to Discord
        # follow_redirects=False replicates Deno's `redirect: "manual"`
        req = client.build_request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=request_body
        )
        response_stream = await client.send(req, stream=True, follow_redirects=False)

        # 4. Prepare response headers and inject CORS wildcards
        response_headers = dict(response_stream.headers)
        response_headers["Access-Control-Allow-Origin"] = "*"
        response_headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, PUT, DELETE, OPTIONS"
        response_headers["Access-Control-Allow-Headers"] = "*"
        
        # Clear out size and compression headers to let FastAPI recalculate them for the stream
        response_headers.pop("content-length", None)
        response_headers.pop("content-encoding", None)

        # Generator to stream chunks out while ensuring the HTTPX stream closes cleanly
        async def iterate_and_close():
            try:
                async for chunk in response_stream.aiter_bytes():
                    yield chunk
            finally:
                await response_stream.aclose()

        return StreamingResponse(
            iterate_and_close(),
            status_code=response_stream.status_code,
            headers=response_headers,
        )

    except Exception as error:
        print(f"[Supabase Proxy Fatal]: {error}")
        return JSONResponse(
            status_code=500,
            content={"error": str(error)},
            headers={
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
        )

# This block hooks into Wispbyte's process runner and keeps it alive
if __name__ == "__main__":
    # Wispbyte dynamically assigns a port via the SERVER_PORT environment variable.
    # We read that value, or default to 8000 if running locally.
    port = int(os.environ.get("SERVER_PORT", 8000))
    
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
