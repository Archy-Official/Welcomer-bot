# Archy Welcomer - V1

A fully serverless Discord welcome/leave bot that runs across **five free-tier cloud platforms simultaneously** with no VPS, no monthly cost, and no single point of failure.

When a member joins or leaves your Discord server, Archy generates a custom image card and sends it to your configured channel. Server admins configure everything through slash commands — no dashboard, no website login, no extra tooling.

**Created and maintained by [Archnemix](https://github.com/Archnemix). Free to use.**

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Why This Architecture — Every Decision Explained](#why-this-architecture--every-decision-explained)
- [Known Issues — Planned for v2](#known-issues--planned-for-v2)
- [Project Structure](#project-structure)
- [Features](#features)
- [How It All Works Together](#how-it-all-works-together)
- [Prerequisites](#prerequisites)
- [Step-by-Step Deployment](#step-by-step-deployment)
- [Environment Variables Reference](#environment-variables-reference)
- [Slash Commands Reference](#slash-commands-reference)
- [Storage Layout](#storage-layout)
- [Contributing](#contributing)
- [Credits & License](#credits--license)

---

## Architecture Overview

```
Discord User runs a slash command
        │
        ▼
┌─────────────────────────┐
│   Cloudflare Worker     │  ← Receives HTTPS POST from Discord
│   worker.js             │    Verifies Ed25519 signature natively
│                         │    Responds type:5 (deferred) instantly
└────────────┬────────────┘
             │ ctx.waitUntil → forwards payload
             ▼
┌─────────────────────────┐
│   Hugging Face Space    │  ← Node.js ESM server, Dockerized
│   src/index.js          │    Runs command logic
│   src/router.js         │    Reads/writes guild config to HF Bucket
│   src/canvas/           │    Generates image cards via skia-canvas
└────────────┬────────────┘
             │ patchWebhook() / fetchViaProxy()
             ▼
┌─────────────────────────────────────────────────┐
│               PROXY_POOL (priority order)        │
│  1. Wispbyte    (Python / FastAPI, Romania)      │
│  2. Codehooks   (Node.js)                        │
│  3. Supabase    (Edge Function / TypeScript)     │
│  4. Deno Deploy (TypeScript)                     │
└────────────────────────┬────────────────────────┘
                         │
                         ▼
                  discord.com/api

──────────── Separate real-time event flow ────────────

Member Joins or Leaves a Server
        │
        ▼
┌─────────────────────────┐
│   Discloud Bot           │  ← Python discord.py, persistent WebSocket
│   main.py               │    on_member_join / on_member_remove
└────────────┬────────────┘
             │ POST /internal/member-event
             ▼
┌─────────────────────────┐
│   Hugging Face Space    │  ← Reads guild config, generates card,
│                         │    sends via proxy pool → Discord channel
└─────────────────────────┘
```

---

## Why This Architecture — Every Decision Explained

### Why Cloudflare Worker as the interaction endpoint?

Discord requires your interactions endpoint to respond in **under 3 seconds**. Hugging Face Spaces can have cold starts or processing delays that blow past that deadline. The Cloudflare Worker is the fix: it sits in front of everything, verifies the Discord request, and instantly fires back a deferred acknowledgement (interaction type `5`) before Discord's clock runs out. The actual work gets forwarded to the HF Space in the background via `ctx.waitUntil()`.

That is the only reason Cloudflare is in this stack. No domain setup was needed, no edge performance reason — purely the 3-second timeout problem.

The Ed25519 signature verification in the Worker uses the native `crypto.subtle` Web Crypto API with zero npm dependencies. This was a deliberate choice — importing a library adds latency and a potential cold-start failure to the most time-sensitive part of the system.

### Why is there a proxy system at all?

This was discovered the hard way — Hugging Face **blocks outbound HTTP requests to Discord's API** from Spaces. When the HF Space tried to call `discord.com/api` directly to send a reply or post a card to a channel, the requests were silently dropped.

The proxy pool is the fix: a set of small free-tier serverless endpoints outside HF that accept a forwarded request and relay it to Discord. HF calls the proxy, the proxy calls Discord, Discord responds, proxy relays it back.

### Why multiple proxy platforms instead of one?

Two reasons that both apply: **redundancy** and **free tier limits**.

Any single free-tier service has rate limits, request quotas, and occasional downtime. If one node is down or rate-limited, the next one in the pool takes over automatically. The proxy pool in `proxy.js` is tried in strict priority order — if the first node returns a 502/503/504 or times out, it falls through to the next.

The priority order was determined by real-world latency testing, not guesswork:

1. **Wispbyte** — fastest in practice, claims always-on, no per-request API limits (resource limits apply: 512MB RAM, 1GB storage, shared CPU). Server located in Romania.
2. **Codehooks** — very reliable, ~60 requests/minute free tier limit.
3. **Supabase** — solid fallback, ~500k requests/month on free tier.
4. **Deno Deploy** — least consistent in testing, 100k requests/month on unverified accounts.

### Why not Python for the HF Space from the start?

No specific technical blocker — Node.js felt like the natural choice for this kind of Discord bot service work. The command system, routing, and async patterns all flow naturally in JS. A future version may be rebuilt fully in Python. This was a preference call, not a constraint.

### Why is there a Python file (`delete_helper.py`) inside a Node.js container?

The `@huggingface/hub` JavaScript SDK does not implement the `batch_bucket_files` deletion API — it simply does not exist in the JS SDK yet. The Python `huggingface_hub` library does have it.

Rather than leave file deletion broken or blocked on the JS SDK's roadmap, a small Python bridge script was added. Node.js calls it via `child_process.execFile('python3', [...])`. The Python binary and `huggingface_hub` are installed in the Dockerfile for exactly this purpose. When the JS SDK eventually adds deletion support, this bridge gets removed.

### Why Hugging Face Bucket storage instead of a database?

Three reasons that all apply together:

**Storage amount.** HF gives free accounts **100GB of private bucket storage**. Supabase's free tier gives 500MB of database storage. For a bot storing per-guild JSON configs and custom background images, 100GB is enormous headroom.

**Direct integration.** The Bucket is within the same HF ecosystem as the Space — no extra service account, no outbound connection to manage, no separate credentials beyond the HF token already in use.

**The data shape doesn't need a database.** Each guild has one config object. There are no relational queries, no joins, no aggregations. Storing a JSON file per guild at `guilds/{guildId}/config.json` is cleaner and faster than spinning up a database for what is essentially a key-value store.

### Why does `readJSON` in `hfClient.js` have two strategies?

Strategy 1 uses the HF SDK. Strategy 2 manually handles the HTTP redirect.

HF bucket downloads redirect to **AWS S3** for the actual file transfer. If you let `fetch` follow that redirect automatically with the `Authorization` header attached, two problems occur: your HF token gets sent to an AWS server that doesn't need it, and S3 rejects requests that carry an unrecognized Authorization header. Strategy 2 intercepts the 302, extracts the S3 URL from the `location` header, then makes a clean second request to S3 without any auth headers. Token security and S3 compatibility, solved together.

### Why Discloud for the persistent Discord gateway bot?

The Discord WebSocket gateway — which delivers `on_member_join` and `on_member_remove` events — requires a **persistent long-running process**. You cannot receive real-time gateway events from a serverless function that spins up on request.

HF Spaces on the free tier hibernate after inactivity and cannot hold a WebSocket connection. Discloud is a hosting platform built specifically for Discord bots with a free tier, persistent process execution, and `autorestart=true` in the config so the bot recovers from crashes automatically.

The bot itself is intentionally minimal — it only listens for two gateway events and makes one HTTP POST per event.

### Why `reconnect=False` on the Discloud bot?

This was left this way during a debugging phase to see exact gateway errors instead of letting discord.py silently retry in a loop. Discloud's `autorestart=true` handles process-level restarts independently.

**This is a known issue and will be fixed in v2.** See the Known Issues section below.

### Why ephemeral deferred responses for slash commands?

All slash command responses use the `EPHEMERAL` flag (value `64`). Config feedback is only visible to the person who ran the command. This prevents the welcome/leave channel — or any channel — from being filled with bot setup messages that everyone in the server can see.

---

## Known Issues — Planned for v2

These are confirmed issues in the current version. None of them break core functionality but they are worth knowing about.

**`reconnect=False` on the Discloud bot**
The discord.py client is set to not automatically reconnect on WebSocket drops. This means a transient network blip or a routine Discord gateway restart will kill the bot connection and rely on Discloud's process-level autorestart instead of a lightweight socket reconnect. The fix is one character — `reconnect=True` — and will be in v2.

**No timeout on `patchWebhook()`**
`fetchViaProxy()` has a 4-second `AbortSignal.timeout` on every request. `patchWebhook()` does not. If a proxy node accepts the connection but hangs without responding, the entire command handler will stall indefinitely waiting for it. Under concurrent load this could pile up. A matching timeout will be added in v2.

**Guild config is not cached on member events**
Every `on_member_join` / `on_member_remove` event triggers a fresh read of `guilds/{guildId}/config.json` from the HF bucket. A `getCached()` wrapper already exists in `cache.js` and is used elsewhere in the codebase — it just wasn't applied here. On a server with a burst of joins, this means multiple redundant bucket reads for the same config. Will be fixed in v2.

**Discloud is a single point of failure**
The proxy pool has 4 fallback nodes. The Cloudflare Worker runs on global edge infrastructure. But if Discloud goes down, member join/leave events are silently lost with no retry and no queue. There is no recovery path for missed events in v1. A message queue or retry mechanism is planned for v2.

---

## Project Structure

```
v1/
├── Cloudflare/
│   └── worker.js                    # Interaction gateway: signature verify + defer + forward
│
├── Codehook/
│   ├── index.js                     # Discord API proxy node (Node.js on Codehooks)
│   └── package.json
│
├── Deno Deploy/
│   └── index.ts                     # Discord API proxy node (Deno / TypeScript)
│
├── Supabase/
│   └── index.ts                     # Discord API proxy node (Supabase Edge Function)
│
├── Wispbyte/
│   ├── main.py                      # Discord API proxy node (Python FastAPI)
│   └── requirements.txt
│
├── Discloud/
│   ├── main.py                      # Gateway bot: listens for join/leave, forwards to HF
│   ├── requirements.txt
│   ├── discloud.config              # Platform config (name, RAM, Python version, autorestart)
│   └── .env.example                 # All required environment variables listed
│
├── Huggingface/
│   ├── Dockerfile                   # Alpine + Node 22 + build tools for skia-canvas
│   ├── package.json
│   └── src/
│       ├── index.js                 # HTTP server entrypoint on port 7860
│       ├── router.js                # Route dispatcher for all API endpoints
│       ├── canvas/
│       │   ├── welcomeCard.js       # Generates 800x200 welcome image via skia-canvas
│       │   └── leaveCard.js         # Generates 800x200 leave image via skia-canvas
│       ├── commands/
│       │   ├── setup.js             # /setup (channels, autorole, dm subcommands)
│       │   ├── welcome-message.js   # /welcome-message
│       │   ├── leave-message.js     # /leave-message
│       │   ├── welcome-background.js# /welcome-background
│       │   ├── leave-background.js  # /leave-background
│       │   ├── preview.js           # /preview
│       │   └── reset.js             # /reset
│       ├── storage/
│       │   ├── hfClient.js          # Read/write/delete to HF Bucket (dual-strategy reads)
│       │   ├── cache.js             # In-memory TTL cache (5-minute default)
│       │   └── delete_helper.py     # Python bridge for HF SDK bucket deletion
│       └── utils/
│           ├── proxy.js             # Priority proxy pool: routes Discord API calls
│           ├── retry.js             # Exponential backoff retry with TLS error detection
│           └── templateParser.js    # {username} {server} {memberCount} substitution
│
└── frontend/
    └── index.html                   # Placeholder — future web dashboard
```

---

## Features

- **Welcome & Leave Cards** — Generates 800×200px image cards with the member's avatar, username, server name, and member count using `skia-canvas`.
- **Custom Backgrounds** — Upload your own background images per server (up to 6 custom slots per event type). Images are automatically center-cropped and resized to 800×200.
- **Three Built-in Default Backgrounds** — Bundled directly in the Docker image so they load instantly without a bucket read.
- **Custom Messages** — Set the text message sent alongside the card. Supports `{username}`, `{server}`, and `{memberCount}` template variables.
- **Auto-Roles** — Automatically assign up to 5 roles to new members on join.
- **DM on Join** — Optionally send a welcome DM to new members.
- **Per-Guild Config** — Every setting is isolated per server, stored as `guilds/{guildId}/config.json` in HF Bucket storage.
- **Preview Command** — Test your configuration without waiting for a real join/leave event.
- **Reset Command** — Wipe all config back to defaults.
- **Permission Gating** — All configuration commands require the `Manage Server` permission.
- **Zero-cost** — Every component runs on a free tier.

---

## How It All Works Together

**Slash Command Flow (e.g. `/setup channels #welcome #goodbye`):**

1. User runs the command in Discord.
2. Discord POSTs the interaction to the Cloudflare Worker's URL.
3. The Worker verifies the Ed25519 signature, immediately responds with `{ type: 5, data: { flags: 64 } }`, and fires `ctx.waitUntil(fetch(...))` to forward the payload to the HF Space — all before the 3-second deadline.
4. The HF Space `/interactions` endpoint authenticates via `x-api-secret` and routes the payload to the matching command handler.
5. The handler reads the guild's config from HF Bucket, applies the change, writes it back, and calls `patchWebhook()` to edit the deferred message with a confirmation embed.
6. `patchWebhook()` tries each proxy in the pool in priority order until one succeeds, sending a PATCH to Discord's webhook endpoint.
7. The user sees the confirmation embed. Nobody else in the server sees anything.

**Member Join/Leave Flow:**

1. A member joins a server where the bot is installed.
2. The Discloud bot receives `on_member_join`, gathers member info (ID, username, avatar URL, member count), and POSTs it to `{SERVICES_URL}/internal/member-event` with `x-api-secret`.
3. The HF Space reads `guilds/{guildId}/config.json` from the Bucket. If no config exists, it silently returns `no_config` — nothing breaks.
4. The HF Space fetches the guild name from Discord via the proxy pool.
5. `generateWelcomeCard()` renders the 800×200 image card with the member's avatar, name, server name, and member count.
6. The card and optional text message are posted to `welcomeChannelId` as a multipart form POST via the proxy pool.

---

## Prerequisites

Accounts needed before starting:

- [Discord Developer Portal](https://discord.com/developers) — for your bot application
- [Hugging Face](https://huggingface.co) — for the core service and bucket storage (free account)
- [Cloudflare](https://cloudflare.com) — for the interaction gateway (free Workers plan)
- [Discloud](https://discloudbot.com) — for the persistent gateway bot (free tier)
- **At least one proxy node** — pick any combination of:
  - [Wispbyte](https://wispbyte.com) — recommended as primary
  - [Codehooks](https://codehooks.io)
  - [Supabase](https://supabase.com)
  - [Deno Deploy](https://deno.com/deploy)

---

## Step-by-Step Deployment

### Step 1 — Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Name it anything (e.g. `Archy Welcomer`).
3. Go to **Bot** → click **Add Bot**.
4. Under **Privileged Gateway Intents**, enable **Server Members Intent** — required for `on_member_join` and `on_member_remove`.
5. Save and copy these three values:
   - **Application ID** (also shown as Client ID) — on the General Information page
   - **Public Key** — on the General Information page
   - **Bot Token** — on the Bot page (click Reset Token if not shown)
6. Under **OAuth2 → URL Generator**, select scopes `bot` and `applications.commands`. For bot permissions select `Send Messages`, `Embed Links`, `Attach Files`, and `Manage Roles` (required for auto-role). Use the generated URL to invite the bot to your server.

---

### Step 2 — Deploy the Hugging Face Space (Core Service)

**2a. Create an HF Bucket**

1. Log into Hugging Face. Go to your profile → **Buckets** → create a new bucket. Name it anything (e.g. `archy-storage`). Copy the full bucket name — it will be in the format `yourusername/archy-storage`.
2. Go to **Settings → Access Tokens**. Create a new token with **write** permissions. Copy it.

**2b. Create an HF Space**

1. Go to your HF profile → **New Space**. Set the SDK to **Docker**. Name it anything (e.g. `archy-welcomer`).
2. In Space settings, make sure the port is set to `7860`.
3. Upload all files from the `Huggingface/` folder into the Space repository (via git or the web UI).

**2c. Set Secrets in the Space**

Go to your Space → **Settings → Variables and Secrets**. Add all of these as **secrets** (not plain variables):

| Secret | Value |
|---|---|
| `DISCORD_BOT_TOKEN` | Your bot token from Step 1 |
| `DISCORD_CLIENT_ID` | Your Application ID from Step 1 |
| `HF_TOKEN` | Your HF write access token from Step 2a |
| `HF_BUCKET_NAME` | Full bucket name (e.g. `yourusername/archy-storage`) |
| `API_SECRET` | A long random string you generate yourself — acts as a shared password between all your services. A UUID works perfectly. |
| `PROXY_POOL` | Leave blank for now — fill in after Step 4 |

The Space will build automatically. Check the **Logs** tab and confirm you see `[startup] Node.js ESM server live on port 7860`.

Your Space URL will look like `https://yourusername-archy-welcomer.hf.space`. Save this — it is your `SERVICES_URL`.

---

### Step 3 — Deploy the Cloudflare Worker (Interaction Gateway)

1. Log into [Cloudflare Dashboard](https://dash.cloudflare.com).
2. Go to **Workers & Pages → Create → Create Worker**.
3. Replace the default code entirely with the contents of `Cloudflare/worker.js`.
4. Click **Save and Deploy**.
5. Go to the worker's **Settings → Variables**. Add these as **encrypted** variables:

| Variable | Value |
|---|---|
| `DISCORD_PUBLIC_KEY` | Your app's Public Key from Step 1 |
| `HF_SERVICES_URL` | Your HF Space URL (no trailing slash) |
| `API_SECRET` | The same `API_SECRET` you set in Step 2c |

6. Copy the Worker's URL (e.g. `https://your-worker.your-subdomain.workers.dev`).
7. Go to the Discord Developer Portal → your application → **General Information**. Paste the Worker URL into the **Interactions Endpoint URL** field and save. Discord will ping the Worker to verify it — if your Worker is deployed and `DISCORD_PUBLIC_KEY` is correct, it will pass.

---

### Step 4 — Deploy the Discord API Proxy Nodes

Deploy at least one. Deploy all of them for maximum reliability. Each proxy receives a request, strips internal headers, and forwards it to `discord.com/api`.

**Wispbyte (Recommended Primary)**

1. Create an account at [wispbyte.com](https://wispbyte.com).
2. Deploy the `Wispbyte/` folder. Wispbyte injects `SERVER_PORT` automatically.
3. Proxy URL: provided by the Wispbyte dashboard after deploy.

**Codehooks**

1. Create an account at [codehooks.io](https://codehooks.io).
2. Install the CLI: `npm install -g codehooks-cli`
3. Inside the `Codehook/` folder, run `coho login` then `coho deploy`.
4. Go to the Codehooks dashboard, find your project's **API Key** under Project Settings.
5. Proxy URL format: `https://yourproject.api.codehooks.io/dev/proxy`
6. Also add `CODEHOOKS_API_KEY` to your HF Space secrets — the proxy system appends it automatically as `?apikey=YOUR_KEY` on every request.

**Supabase Edge Function**

1. Create a project at [supabase.com](https://supabase.com).
2. Deploy `Supabase/index.ts` as an edge function via the Supabase CLI (`supabase functions deploy`).
3. Proxy URL: `https://yourproject.supabase.co/functions/v1/your-function-name`

**Deno Deploy**

1. Create an account at [deno.com/deploy](https://deno.com/deploy). Create a new project.
2. Paste or deploy the contents of `Deno Deploy/index.ts`.
3. Proxy URL: `https://yourproject.deno.dev`

**After deploying your proxies**, go back to your HF Space secrets and set `PROXY_POOL` to a comma-separated list of your proxy base URLs in priority order (left = tried first):

```
PROXY_POOL=https://your-wispbyte-url,https://yourproject.api.codehooks.io/dev/proxy,https://yourproject.supabase.co/functions/v1/proxy,https://yourproject.deno.dev
```

---

### Step 5 — Deploy the Discloud Bot (Event Listener)

1. Create an account at [discloudbot.com](https://discloudbot.com).
2. Fill in `Discloud/.env` using `.env.example` as the template:

```env
DISCORD_TOKEN=your-bot-token-from-step-1
DISCORD_CLIENT_ID=your-application-id-from-step-1
HF_TOKEN=your-hf-write-token-from-step-2a
HF_BUCKET_NAME=yourusername/archy-storage
SERVICES_URL=https://yourusername-archy-welcomer.hf.space
API_SECRET=the-same-api-secret-used-everywhere
```

3. Zip the entire contents of the `Discloud/` folder (including `.env`, `main.py`, `requirements.txt`, and `discloud.config`) into a single zip file.
4. Upload it to Discloud via the dashboard under **Upload App**.
5. Discloud reads `discloud.config` automatically and starts the bot with `python3 main.py`.
6. In the Discloud dashboard logs you will see the diagnostics suite run, then `[Gateway Connected] Registered as operational identity: YourBotName`.

> **Note:** `discloud.config` specifies `RAM=100` (MB). This is enough for the thin event-forwarding bot. Do not lower it.

---

### Step 6 — Register Slash Commands

The slash commands must be registered with Discord's API before users can run them. This is a one-time operation per deploy.

Send a `PUT` request to `https://discord.com/api/v10/applications/{YOUR_CLIENT_ID}/commands` with your bot token in the `Authorization: Bot <token>` header and the full command definitions in the body.

You can do this with `curl`, Postman, or a small one-off Node.js script using `discord.js`'s `REST` client. Register these commands:

- `/setup` — with subcommands: `channels`, `autorole-add`, `autorole-remove`, `autorole-list`, `dm`
- `/welcome-message`
- `/leave-message`
- `/welcome-background`
- `/leave-background`
- `/preview`
- `/reset`

Register them as **global** commands (available in all servers, takes up to 1 hour to propagate) or as **guild** commands for a specific server (instant, good for testing).

---

### Step 7 — Verify Everything

Run these checks in order.

**Test HF Bucket storage:**
Visit `https://yourusername-archy-welcomer.hf.space/test-storage?secret=YOUR_API_SECRET` in your browser. You should get `"storage_test": "PASSED"`.

**Test the Cloudflare Worker:**
Already verified when Discord accepted the Interactions Endpoint URL in Step 3. No extra check needed.

**Test the Discloud Bot:**
In the Discloud logs, confirm `[System Ready] Monitoring N guild(s).`

**Test a slash command:**
Run `/preview type:welcome` in a Discord server the bot is in. You should receive an ephemeral reply with a preview card within a few seconds. If the deferred message never resolves, check the HF Space logs for errors.

**Test a real join/leave:**
Have a user join the server. Check HF Space logs for `[Member Event]` entries confirming the event arrived and the card was sent.

---

## Environment Variables Reference

### Hugging Face Space Secrets

| Variable | Required | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Yes | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | Application / Client ID |
| `HF_TOKEN` | Yes | HF access token with write permissions to your bucket |
| `HF_BUCKET_NAME` | Yes | Full bucket identifier (`username/bucket-name`) |
| `API_SECRET` | Yes | Shared secret for authenticating all internal service calls |
| `PROXY_POOL` | Yes | Comma-separated proxy base URLs, priority-ordered left to right |
| `CODEHOOKS_API_KEY` | If using Codehooks | API key appended as `?apikey=` on Codehooks requests |

### Cloudflare Worker Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | Yes | Ed25519 public key from Discord Developer Portal |
| `HF_SERVICES_URL` | Yes | Base URL of your HF Space, no trailing slash |
| `API_SECRET` | Yes | Must exactly match the HF Space `API_SECRET` |

### Discloud Bot (`.env`)

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | Yes | Bot token |
| `DISCORD_CLIENT_ID` | Yes | Application ID |
| `HF_TOKEN` | Yes | HF write access token |
| `HF_BUCKET_NAME` | Yes | Full bucket identifier |
| `SERVICES_URL` | Yes | Base URL of your HF Space |
| `API_SECRET` | Yes | Must exactly match the HF Space `API_SECRET` |

---

## Slash Commands Reference

All configuration commands require the **Manage Server** permission.

| Command | What it does |
|---|---|
| `/setup channels` | Set the welcome and/or leave channel |
| `/setup autorole-add` | Add a role to auto-assign on join (max 5) |
| `/setup autorole-remove` | Remove a role from auto-assignment |
| `/setup autorole-list` | List all currently configured auto-roles |
| `/setup dm` | Enable or disable welcome DMs to new members |
| `/welcome-message` | Set the welcome text. Supports `{username}`, `{server}`, `{memberCount}` |
| `/leave-message` | Set the leave text. Same template variables |
| `/welcome-background` | Upload, list, select, or delete custom welcome backgrounds |
| `/leave-background` | Upload, list, select, or delete custom leave backgrounds |
| `/preview` | Preview the current welcome or leave card without a real event |
| `/reset` | Reset all server configuration to defaults |

---

## Storage Layout

All guild data lives in your HF Bucket under this structure:

```
guilds/
└── {guildId}/
    ├── config.json
    └── assets/
        └── backgrounds/
            ├── welcome/
            │   └── {slotName}.png
            └── leave/
                └── {slotName}.png
```

A `config.json` looks like:

```json
{
  "guildId": "123456789",
  "welcomeChannelId": "987654321",
  "leaveChannelId": "987654321",
  "autoRoles": ["111111111"],
  "welcomeMessage": "{username} just joined {server}!",
  "leaveMessage": "{username} has left {server}.",
  "dmMessage": "Welcome to {server}!",
  "dmEnabled": false,
  "welcomeBackground": "default1",
  "leaveBackground": "default1",
  "welcomeCustomBackgrounds": ["mybg"],
  "leaveCustomBackgrounds": [],
  "cardTextColor": "#ffffff",
  "cardAccentColor": "#5865F2",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

---

## Contributing

Pull requests are welcome. For significant changes, open an issue first.

**Adding a new slash command:**
1. Create the handler in `Huggingface/src/commands/`.
2. Add it to the `COMMAND_HANDLERS` map in `router.js`.
3. Register it with Discord's API (see Step 6).

**Adding a new proxy platform:**
1. Create the proxy file in a new folder named after the platform.
2. The proxy must accept a `?route=` query parameter and forward it to `https://discord.com/api{route}`.
3. All responses must include `Access-Control-Allow-Origin: *`.
4. Update `prioritizePool()` in `proxy.js` to include the new platform's detection string.
5. Update the URL construction blocks in both `patchWebhook()` and `fetchViaProxy()` in `proxy.js`.

---

## Credits & License

**Created by [Archnemix](https://github.com/Archnemix).**

This project is free to use. You may use, modify, fork, and deploy it for personal or public use at no cost. If you build something with it, a credit back is appreciated but not required.s
