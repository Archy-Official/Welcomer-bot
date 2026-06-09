import os
import re
import urllib.parse
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse

TARGET_API = 'https://discord.com/api'


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Share a single AsyncClient across requests to reuse the connection pool
    app.state.client = httpx.AsyncClient()
    yield
    await app.state.client.aclose()


app = FastAPI(lifespan=lifespan)


@app.api_route('/{path:path}', methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])
async def proxy_handler(request: Request, path: str):
    client = request.app.state.client

    try:
        route_param = request.query_params.get('route')

        if route_param:
            clean_path = route_param
        else:
            # Mirror Deno's pathname stripping: remove the Supabase function prefix
            clean_path = re.sub(r'^/functions/v1/[^/]+', '', request.url.path)

        if not clean_path.startswith('/'):
            clean_path = '/' + clean_path

        # Strip the internal 'route' param before forwarding to Discord
        query_items  = [(k, v) for k, v in request.query_params.multi_items() if k != 'route']
        query_string = urllib.parse.urlencode(query_items)

        target_url = f'{TARGET_API}{clean_path}'
        if query_string:
            target_url += f'?{query_string}'

        headers = dict(request.headers)
        headers['host'] = 'discord.com'
        headers.pop('origin', None)

        request_body = None
        if request.method not in ('GET', 'HEAD'):
            request_body = request.stream()
            # Drop content-length so httpx can chunk the stream correctly
            headers.pop('content-length', None)

        req = client.build_request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=request_body,
        )

        # follow_redirects=False matches Deno's redirect: "manual"
        upstream = await client.send(req, stream=True, follow_redirects=False)

        response_headers = dict(upstream.headers)
        response_headers['Access-Control-Allow-Origin']  = '*'
        response_headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, PUT, DELETE, OPTIONS'
        response_headers['Access-Control-Allow-Headers'] = '*'

        # Remove these so FastAPI can recalculate them for the outgoing stream
        response_headers.pop('content-length',   None)
        response_headers.pop('content-encoding', None)

        async def stream_response():
            try:
                async for chunk in upstream.aiter_bytes():
                    yield chunk
            finally:
                await upstream.aclose()

        return StreamingResponse(
            stream_response(),
            status_code=upstream.status_code,
            headers=response_headers,
        )

    except Exception as e:
        print(f'[proxy] Error: {e}')
        return JSONResponse(
            status_code=500,
            content={'error': str(e)},
            headers={'Access-Control-Allow-Origin': '*'},
        )


if __name__ == '__main__':
    # Wispbyte injects the port via SERVER_PORT; fall back to 8000 for local dev
    port = int(os.environ.get('SERVER_PORT', 8000))
    uvicorn.run('main:app', host='0.0.0.0', port=port, log_level='info')