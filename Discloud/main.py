import os
import sys
import asyncio
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
import aiohttp
import discord
from dotenv import load_dotenv

# Global configuration map state
guild_config_cache = {}

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
        # Prevent spamming your Discloud console logs with 200 OK polling messages
        return

def start_health_server():
    # Discloud automatically injects a PORT variable if needed, default to 8080
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

    # Physical File System Check relative to the active working directory
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

    # Force load local structure if file exists, otherwise let container injection handle it
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
            # Mask value strings carefully for private logs
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
# 🗃️ REMOTE STORAGE ROUTER CONNECTOR
# ====================================================================
async def load_all_guild_configs():
    services_url = os.getenv('SERVICES_URL')
    if not services_url:
        print('[Cache Sync Fatal] Cannot pull configurations: SERVICES_URL variable is missing.', flush=True)
        return

    try:
        print('[Cache Sync] Pulling remote configurations from Hugging Face Storage Matrix...', flush=True)
        headers = {'x-api-secret': os.getenv('API_SECRET', '')}
        
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{services_url}/internal/guilds", headers=headers, timeout=10) as response:
                if response.status == 200:
                    guilds = await response.json()
                    guild_config_cache.clear()
                    for guild in guilds:
                        guild_id = guild.get('guildId')
                        if guild_id:
                            guild_config_cache[str(guild_id)] = guild
                    print(f"[Cache Sync] Successfully loaded {len(guild_config_cache)} target guild parameters.", flush=True)
                else:
                    print(f"[Cache Sync Fail] API returned an error response: {response.status} {response.reason}", flush=True)
    except Exception as error:
        print(f"[Cache Sync Fatal] Connection link dropped to processing engine: {error}", flush=True)


# ====================================================================
# 🤖 DISCORD ENGINE CONFIGURATION
# ====================================================================
intents = discord.Intents.default()
intents.guilds = True
intents.members = True

client = discord.Client(intents=intents)

@client.event
async def on_ready():
    print(f"[Gateway Connected] Registered as operational identity: {client.user.name}", flush=True)
    await load_all_guild_configs()

@client.event
async def on_member_join(member):
    print(f"[Event] Member joined: {member.name} in server: {member.guild.name}", flush=True)

@client.event
async def on_member_remove(member):
    print(f"[Event] Member left: {member.name} from server: {member.guild.name}", flush=True)

@client.event
async def on_guild_join(guild):
    print(f"[Event] Added to a new server cluster: {guild.name}", flush=True)
    await load_all_guild_configs()


# ====================================================================
# 🏁 MONOLITHIC ENTRYPOINT EXECUTION
# ====================================================================
def main():
    # Pre-bind standard health servers
    start_health_server()

    # Validate your credentials before touching Discord networks
    if not run_system_diagnostics():
        print("[Execution Stopped] Environment error found. Process terminating.", flush=True)
        sys.exit(1)

    token = os.getenv('DISCORD_TOKEN')
    print("[Single-Shot Activation] Attempting a strict one-time Discord gateway connection...", flush=True)
    
    try:
        # reconnect=False tells discord.py NEVER to catch connection dropping errors silently or auto-loop
        client.run(token, reconnect=False)
        
        # If execution unblocks gracefully without triggering an exception catch:
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
        traceback.print_exc(file=sys.stdout) # Direct layout pipe straight out to flush targets
        print("==================================================", flush=True)
        sys.exit(1)

if __name__ == '__main__':
    main()
