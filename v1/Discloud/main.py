import os
import sys
import asyncio
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer

import aiohttp
import discord
from dotenv import load_dotenv


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ('/', '/health'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status": "healthy", "platform": "discloud"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress request logging


def start_health_server():
    port = int(os.getenv('PORT', 8080))

    def run():
        try:
            server = HTTPServer(('0.0.0.0', port), HealthHandler)
            print(f'[health] Listening on port {port}', flush=True)
            server.serve_forever()
        except Exception as e:
            print(f'[health] Failed to bind port {port}: {e}', flush=True)

    threading.Thread(target=run, daemon=True).start()


def run_diagnostics() -> bool:
    """Validates that all required env vars are present and non-empty."""
    print('\n' + '=' * 50, flush=True)
    print('[diagnostics] Verifying container environment...', flush=True)
    print('=' * 50, flush=True)

    env_path = Path.cwd() / '.env'

    if env_path.exists():
        print(f'[diagnostics] .env found at {env_path} ({env_path.stat().st_size} bytes)', flush=True)
        load_dotenv(dotenv_path=env_path)
    else:
        print('[diagnostics] No .env file — reading from injected shell environment.', flush=True)

    required = [
        'DISCORD_TOKEN',
        'DISCORD_CLIENT_ID',
        'HF_TOKEN',
        'HF_BUCKET_NAME',
        'SERVICES_URL',
        'API_SECRET',
    ]

    # Keys safe to log in plaintext (non-sensitive)
    plaintext_keys = {'DISCORD_CLIENT_ID', 'HF_BUCKET_NAME', 'SERVICES_URL'}

    failures = 0
    for key in required:
        value = os.getenv(key)
        if not value or not value.strip():
            print(f'[diagnostics] MISSING  {key}', flush=True)
            failures += 1
        else:
            if key in plaintext_keys:
                display = value
            elif len(value) > 8:
                display = f'{value[:4]}...{value[-4:]}'
            else:
                display = '***'
            print(f'[diagnostics] OK       {key} -> {display}', flush=True)

    print('=' * 50, flush=True)
    if failures:
        print(f'[diagnostics] {failures} variable(s) missing. Check your Discloud dashboard.', flush=True)
        return False

    print('[diagnostics] All variables loaded.', flush=True)
    return True


async def forward_member_event(event_type: str, member: discord.Member):
    services_url = os.getenv('SERVICES_URL')
    api_secret   = os.getenv('API_SECRET', '')

    if not services_url:
        print(f'[events] SERVICES_URL not set — cannot forward {event_type}', flush=True)
        return

    payload = {
        'event':       event_type,
        'guildId':     str(member.guild.id),
        'userId':      str(member.id),
        'username':    member.name,
        'globalName':  member.global_name,
        'avatarUrl':   str(member.display_avatar.url) if member.display_avatar else None,
        'memberCount': member.guild.member_count,
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f'{services_url}/internal/member-event',
                json=payload,
                headers={
                    'Content-Type': 'application/json',
                    'x-api-secret': api_secret,
                },
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                body = await resp.text()
                if resp.status == 200:
                    print(f'[events] {event_type} forwarded for {member.name} — {body}', flush=True)
                else:
                    print(f'[events] HF returned {resp.status} for {event_type}: {body}', flush=True)

    except asyncio.TimeoutError:
        print(f'[events] Timeout forwarding {event_type} for {member.name}', flush=True)
    except Exception as e:
        print(f'[events] Error forwarding {event_type} for {member.name}: {e}', flush=True)


intents = discord.Intents.default()
intents.guilds  = True
intents.members = True  # required for join/leave events

client = discord.Client(intents=intents)


@client.event
async def on_ready():
    print(f'[gateway] Connected as {client.user.name}', flush=True)
    print(f'[gateway] Watching {len(client.guilds)} guild(s)', flush=True)


@client.event
async def on_member_join(member: discord.Member):
    print(f'[events] join  — {member.name} in {member.guild.name}', flush=True)
    await forward_member_event('join', member)


@client.event
async def on_member_remove(member: discord.Member):
    print(f'[events] leave — {member.name} from {member.guild.name}', flush=True)
    await forward_member_event('leave', member)


@client.event
async def on_guild_join(guild: discord.Guild):
    print(f'[events] added to guild: {guild.name}', flush=True)


@client.event
async def on_guild_remove(guild: discord.Guild):
    print(f'[events] removed from guild: {guild.name}', flush=True)


def main():
    start_health_server()

    if not run_diagnostics():
        print('[startup] Aborting — environment check failed.', flush=True)
        sys.exit(1)

    token = os.getenv('DISCORD_TOKEN')
    print('[startup] Connecting to Discord gateway (reconnect disabled)...', flush=True)

    try:
        client.run(token, reconnect=False)
        sys.exit(0)

    except discord.errors.LoginFailure as e:
        print(f'[startup] Login failed — token rejected: {e}', flush=True)
        sys.exit(1)

    except discord.errors.GatewayNotFound:
        print('[startup] Discord gateway unreachable.', flush=True)
        sys.exit(1)

    except Exception:
        import traceback
        print('[startup] Unexpected error:', flush=True)
        traceback.print_exc(file=sys.stdout)
        sys.exit(1)


if __name__ == '__main__':
    main()