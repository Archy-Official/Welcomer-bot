import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { startHealthServer } from './health.js';
import handleMemberAdd from './events/guildMemberAdd.js';
import handleMemberRemove from './events/guildMemberRemove.js';
import handleGuildCreate from './events/guildCreate.js';

let activeClient = null;
let lastReconnectAt = 0;
const guildConfigCache = new Map();

// Fire up internal web layer for container readiness check routines
startHealthServer();

async function loadAllGuildConfigs() {
  try {
    console.log('[Cache Sync] Pulling remote engine configurations from Hugging Face Space...');
    const response = await fetch(`${process.env.SERVICES_URL}/internal/guilds`, {
      headers: {
        'x-api-secret': process.env.API_SECRET
      }
    });
    
    if (response.ok) {
      const guilds = await response.json();
      guildConfigCache.clear();
      for (const guild of guilds) {
        guildConfigCache.set(guild.guildId, guild);
      }
      console.log(`[Cache Sync] Successfully loaded ${guildConfigCache.size} guild configurations.`);
    } else {
      console.error(`[Cache Sync Fail] System status error response: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error('[Cache Sync Fatal] Failed connection pipeline to Hugging Face server:', error.message);
  }
}

function triggerReconnect() {
  if (Date.now() - lastReconnectAt < 10000) {
    return; // Rate limit reconnection spikes to once per 10 seconds
  }
  lastReconnectAt = Date.now();
  console.warn('[Gateway Mesh] Execution connection drop detected. Initializing racing reconnection loop...');
  raceConnect();
}

async function raceConnect() {
  const controller = new AbortController();
  const clients = [];

  const createConnectionPromise = (i) => {
    return new Promise((resolve) => {
      const timeout = setTimeout(async () => {
        if (controller.signal.aborted) return;
        
        console.log(`[Race Node] Initializing WebSocket client connection instance #${i + 1}`);
        const client = new Client({
          intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
        });
        clients.push(client);

        client.once(Events.ClientReady, () => {
          if (!controller.signal.aborted) {
            controller.abort(); // Shut down alternate connecting attempts immediately 
            resolve(client);
          } else {
            client.destroy().catch(() => {});
          }
        });

        try {
          await client.login(process.env.DISCORD_TOKEN);
        } catch (err) {
          client.destroy().catch(() => {});
        }
      }, i * 200);
    });
  };

  try {
    const attempts = Array.from({ length: 10 }, (_, i) => createConnectionPromise(i));
    const winner = await Promise.any(attempts);
    
    activeClient = winner;
    
    // Silently remove losing shards to prevent memory leak accumulation
    for (const client of clients) {
      if (client !== winner) {
        client.destroy().catch(() => {});
      }
    }
    
    setupClient(activeClient);
  } catch (error) {
    console.error('[Gateway Failure] All concurrent racing connections failed. Attempting full system reset in 3s...', error);
    setTimeout(() => {
      raceConnect();
    }, 3000);
  }
}

function setupClient(client) {
  console.log(`[Gateway Connected] Registered as operational identity: ${client.user.tag}`);
  
  // Sync memory cache parameters with production bucket variables
  loadAllGuildConfigs();

  client.on(Events.GuildMemberAdd, (member) => {
    handleMemberAdd(member, guildConfigCache);
  });

  client.on(Events.GuildMemberRemove, (member) => {
    handleMemberRemove(member, guildConfigCache);
  });

  client.on(Events.GuildCreate, (guild) => {
    loadAllGuildConfigs(); // Re-sync entire server structure cache map upon new invitation
    handleGuildCreate(guild, guildConfigCache);
  });

  client.on('error', (err) => {
    console.error('[Internal Shard Exception]:', err);
    triggerReconnect();
  });

  client.on('disconnect', () => {
    console.warn('[Socket Disconnect Exception] Socket dropped tracking handle.');
    triggerReconnect();
  });
}

// Watchdog Routine: Check to ensure websocket connection state hasn't turned into a zombie
setInterval(() => {
  if (activeClient && activeClient.ws.ping === -1) {
    console.warn('[Watchdog Flag] Client reporting dead link channel (ping is -1). Killing loop connection...');
    triggerReconnect();
  }
}, 20000);

process.on('uncaughtException', (err) => {
  console.error('[Critical Application Core Failure]:', err);
  triggerReconnect();
});

// Fire connection matrix
raceConnect();
