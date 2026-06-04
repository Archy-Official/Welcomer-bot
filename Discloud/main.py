import os
import sys
import asyncio
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
import aiohttp
import discord
from dotenv import load_dotenv


# ====================================================================
# 🔌 NATIVE BACKGROUND HEALTHCHECK SERVER
# ====================================================================
class DiscloudHealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ['/health', '/']:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status": "healthy", "platform": "discloud"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        return

def start_health_server():
    port = int(os.getenv('PORT', 8080))
    def run():
        try:
            server = HTTPServer(('0.0.0.0', port), DiscloudHealthHandler)
            print(f"[System Health] Server listening on Discloud port allocation {port}", flush=True)
            server.serve_forever()
        except Exception as e:
            print(f"[System Health Fatal] Failed to bind internal health port: {e}", flush=True)

    health_thread = threading.Thread(target=run, daemon=True)
    health_thread.start()


# ====================================================================
# 🔍 CORE ENVIRONMENT & .ENV FILE DIAGNOSTICS SUITE
# ====================================================================
def run_system_diagnostics():
    print('\n==================================================', flush=True)
    print('[System Diagnosis] Initiating Discloud Container Verification...', flush=True)
    print('==================================================', flush=True)

    env_path = Path.cwd() / '.env'
    env_exists = env_path.exists()

    if env_exists:
        print(f"📁 [FILE FOUND] Physical .env file detected at: {env_path}", flush=True)
        try:
            stats = env_path.stat()
            print(f"   └─ File Size: {stats.st_size} bytes | Status: Readable", flush=True)
        except Exception as e:
            print(f"❌ [FILE ERROR] .env file exists but is unreadable: {e}", flush=True)
    else:
        print(f"⚠️  [FILE MISSING] No physical .env file found at: {env_path}", flush=True)
        print("   └─ Processing environment variables directly via injected shell variables.", flush=True)

    print('--------------------------------------------------', flush=True)
    print('[Memory Check] Verifying Loaded Environment Variables:', flush=True)
    print('--------------------------------------------------', flush=True)

    if env_exists:
        load_dotenv(dotenv_path=env_path)

    required_keys = [
        'DISCORD_TOKEN',
        'DISCORD_CLIENT_ID',
        'HF_TOKEN',
        'HF_BUCKET_NAME',
        'SERVICES_URL',
        'API_SECRET'
    ]

    missing_count = 0

    for key in required_keys:
        value = os.getenv(key)

        if value is None:
            print(f"❌ [MISSING] os.getenv('{key}') is completely UNDEFINED", flush=True)
            missing_count += 1
        elif value.strip() == '':
            print(f"❌ [EMPTY] os.getenv('{key}') contains an EMPTY string value", flush=True)
            missing_count += 1
        else:
            masked_value = '***'
            if key in ['DISCORD_CLIENT_ID', 'HF_BUCKET_NAME', 'SERVICES_URL']:
                masked_value = value
            elif len(value) > 8:
                masked_value = f"{value[:4]}...{value[-4:]}"
            print(f"✅ [LOADED] os.getenv('{key}') -> \"{masked_value}\"", flush=True)

    print('==================================================', flush=True)
    if missing_count > 0:
        print(f"🚨 [DIAGNOSTIC FAILURE] {missing_count} required variables failed verification!", flush=True)
        print("👉 Update your variables tab in the Discloud Dashboard or fix your local zip content.", flush=True)
        print('==================================================\n', flush=True)
        return False
    else:
        print('🎉 [DIAGNOSTIC SUCCESS] All parameters are cleanly allocated into active container memory.', flush=True)
        print('==================================================\n', flush=True)
        return True


# ====================================================================
# 📡 HF EVENT FORWARDER
# Forwards member join/leave events to HF Space POST /internal/member-event.
# HF reads guilds/{guildId}/config.json, generates the card, sends via proxy mesh.
# No local config cache needed — HF handles the no_config case itself.
# ====================================================================
async def forward_member_event(event_type: str, member: discord.Member):
    services_url = os.getenv('SERVICES_URL')
    api_secret   = os.getenv('API_SECRET', '')

    if not services_url:
        print(f"[Event Forward Fatal] SERVICES_URL missing — cannot forward {event_type} for {member.name}", flush=True)
        return

    avatar_url = str(member.display_avatar.url) if member.display_avatar else None

    payload = {
        "event":       event_type,
        "guildId":     str(member.guild.id),
        "userId":      str(member.id),
        "username":    member.name,
        "globalName":  member.global_name,
        "avatarUrl":   avatar_url,
        "memberCount": member.guild.member_count,
    }

    try:
        print(f"[Event Forward] Sending '{event_type}' for {member.name} ({member.id}) in {member.guild.name}...", flush=True)

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{services_url}/internal/member-event",
                json=payload,
                headers={
                    'Content-Type': 'application/json',
                    'x-api-secret': api_secret
                },
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                body = await response.text()
                if response.status == 200:
                    print(f"[Event Forward] ✅ HF acknowledged '{event_type}' for {member.name} — {body}", flush=True)
                else:
                    print(f"[Event Forward Fail] HF returned {response.status} for '{event_type}': {body}", flush=True)

    except asyncio.TimeoutError:
        print(f"[Event Forward Timeout] HF did not respond for '{event_type}' event (member: {member.name})", flush=True)
    except Exception as error:
        print(f"[Event Forward Fatal] '{event_type}' for {member.name}: {error}", flush=True)


# ====================================================================
# 🤖 DISCORD ENGINE CONFIGURATION
# ====================================================================
intents = discord.Intents.default()
intents.guilds = True
intents.members = True  # Required for member join/leave events

client = discord.Client(intents=intents)

@client.event
async def on_ready():
    print(f"[Gateway Connected] Registered as operational identity: {client.user.name}", flush=True)
    print(f"[System Ready] Monitoring {len(client.guilds)} guild(s).", flush=True)


@client.event
async def on_member_join(member: discord.Member):
    print(f"[Event] Member joined: {member.name} in server: {member.guild.name}", flush=True)
    await forward_member_event("join", member)


@client.event
async def on_member_remove(member: discord.Member):
    print(f"[Event] Member left: {member.name} from server: {member.guild.name}", flush=True)
    await forward_member_event("leave", member)


@client.event
async def on_guild_join(guild: discord.Guild):
    print(f"[Event] Added to a new server cluster: {guild.name}", flush=True)


@client.event
async def on_guild_remove(guild: discord.Guild):
    print(f"[Event] Removed from server: {guild.name}", flush=True)


# ====================================================================
# 🏁 MONOLITHIC ENTRYPOINT EXECUTION
# ====================================================================
def main():
    start_health_server()

    if not run_system_diagnostics():
        print("[Execution Stopped] Environment error found. Process terminating.", flush=True)
        sys.exit(1)

    token = os.getenv('DISCORD_TOKEN')
    print("[Single-Shot Activation] Attempting a strict one-time Discord gateway connection...", flush=True)

    try:
        client.run(token, reconnect=False)
        print("[Gateway Terminated] Connection closed down cleanly without crashing.", flush=True)
        sys.exit(0)

    except discord.errors.LoginFailure as login_err:
        print("\n==================================================", flush=True)
        print("🚨 [CRITICAL LOGIN FAIL] Authentication Token Rejected by Discord Gateways!", flush=True)
        print(f"Details: {login_err}", flush=True)
        print("==================================================", flush=True)
        sys.exit(1)

    except discord.errors.GatewayNotFound:
        print("\n==================================================", flush=True)
        print("🚨 [GATEWAY EXCEPTION] Discord web endpoint was unreachable or down.", flush=True)
        print("==================================================", flush=True)
        sys.exit(1)

    except Exception as generic_err:
        print("\n==================================================", flush=True)
        print("🚨 [FATAL PROTOCOL EXCEPTION] System caught a running socket level error:", flush=True)
        import traceback
        traceback.print_exc(file=sys.stdout)
        print("==================================================", flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
