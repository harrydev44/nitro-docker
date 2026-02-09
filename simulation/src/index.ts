import 'dotenv/config';
import { CONFIG } from './config.js';
import { closePool, execute, query } from './db.js';
import { ensureSimulationTables } from './db-setup.js';
import { refreshCache, getAgents, getRooms } from './world/state-cache.js';
import { flushAll, queueAgentState } from './world/batch-writer.js';
import { runDecisionEngine } from './engine/decision.js';
import { updatePopularity } from './world/popularity.js';
import { decayRelationships } from './agents/relationships.js';
import { startStatsServer } from './stats/collector.js';
import { loadRoomModels, refreshOccupiedTiles } from './world/room-models.js';
import { loadItemCatalog } from './world/item-catalog.js';
import { rconBotDance, rconBotAction, rconBotEffect } from './emulator/rcon.js';
import { shouldGesture, pickGesture } from './chat/gesture-triggers.js';
import type { WorldState } from './types.js';

const SPECTATOR_SSO_TICKET = 'spectator-sso-ticket';

let running = true;
let currentTick = 0;

async function seedStartingItems(): Promise<void> {
  // Check if agents already have inventory items
  const invCount = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM items i
     JOIN users u ON i.user_id = u.id
     WHERE u.username LIKE 'sim_owner_%' AND i.room_id = 0`
  );
  if (invCount[0].cnt > 50) {
    console.log(`[SEED] Agents already have ${invCount[0].cnt} inventory items, skipping seed`);
    return;
  }

  // Get all sim_owner user IDs
  const owners = await query<{ id: number }>(
    `SELECT id FROM users WHERE username LIKE 'sim_owner_%'`
  );
  if (owners.length === 0) return;

  // Give each owner user 5 random items (real furniture from items_base)
  const itemIds = [18, 30, 39, 17, 22, 40, 199, 57, 35, 28, 29, 41, 128, 163, 165, 13, 14, 144, 173, 56];
  const values: string[] = [];
  const params: any[] = [];

  for (const owner of owners) {
    for (let i = 0; i < CONFIG.STARTING_ITEMS_PER_AGENT; i++) {
      const itemId = itemIds[Math.floor(Math.random() * itemIds.length)];
      values.push('(?, 0, ?, 0, 0, 0, 0, \'0\')');
      params.push(owner.id, itemId);
    }
  }

  if (values.length > 0) {
    await execute(
      `INSERT INTO items (user_id, room_id, item_id, x, y, z, rot, extra_data) VALUES ${values.join(', ')}`,
      params
    );
    console.log(`[SEED] Gave ${values.length} starting items to ${owners.length} owners`);
  }
}

async function tick(world: WorldState): Promise<void> {
  currentTick++;
  world.tick = currentTick;

  // 1. Refresh all caches from DB (agents, rooms, relationships, items)
  await refreshCache();
  await refreshOccupiedTiles();
  world.agents = getAgents();
  world.rooms = getRooms();

  // Shuffle agents and pick a small batch per tick (staggered processing)
  const shuffled = [...world.agents].sort(() => Math.random() - 0.5);
  const batch = shuffled.slice(0, CONFIG.AGENTS_PER_TICK);

  // 2. Run decisions for batch of agents (queues writes, no direct DB per agent)
  for (const agent of batch) {
    agent.ticksInCurrentRoom++;

    try {
      await runDecisionEngine(agent, world);
    } catch (err) {
      console.error(`[TICK ${currentTick}] Error for agent ${agent.name}:`, err);
    }

    // Queue agent state save for every active agent
    queueAgentState({
      agentId: agent.id,
      personality: JSON.stringify(agent.personality),
      preferences: JSON.stringify(agent.preferences),
      goals: JSON.stringify(agent.goals),
      state: agent.state,
      ticksInRoom: agent.ticksInCurrentRoom,
      ticksWorking: agent.ticksWorking,
    });
  }

  // 3. Flush all batched writes in a single transaction
  try {
    await flushAll();
  } catch (err) {
    console.error(`[TICK ${currentTick}] Flush error:`, err);
  }

  // Keep spectator SSO ticket alive (emulator clears it after login)
  if (currentTick % 5 === 0) {
    await execute(
      `UPDATE users SET auth_ticket = ? WHERE username = 'sim_spectator'`,
      [SPECTATOR_SSO_TICKET]
    );
  }

  // Periodic tasks
  if (currentTick % 10 === 0) {
    await updatePopularity(world);
  }
  if (currentTick % 100 === 0) {
    await decayRelationships();
    console.log(`[TICK ${currentTick}] Relationship decay applied`);
  }

  // Prune old chat history
  for (const [roomId, messages] of world.roomChatHistory) {
    if (messages.length > CONFIG.CHAT_HISTORY_LENGTH) {
      world.roomChatHistory.set(roomId, messages.slice(-CONFIG.CHAT_HISTORY_LENGTH));
    }
  }

  // Clean up expired conversations
  for (const [roomId, convo] of world.activeConversations) {
    if (
      currentTick - convo.lastTick > CONFIG.CONVERSATION_TIMEOUT_TICKS ||
      convo.exchangeCount >= CONFIG.CONVERSATION_MAX_EXCHANGES
    ) {
      world.activeConversations.delete(roomId);
    }
  }

  // Party dance pulse — re-send dance commands every 5 ticks for active parties
  // This ensures bots dance even when spectators enter the room after party started
  if (currentTick % 5 === 0) {
    for (const party of world.activeParties) {
      const botsInRoom = world.agents.filter(a => a.currentRoomId === party.roomId);
      for (const bot of botsInRoom) {
        const danceId = (bot.id % 4) + 1; // deterministic per bot so it doesn't flicker
        rconBotDance(bot.id, danceId).catch(() => {});
        party.attendees.add(bot.id);
      }

      // Random party gesture: 1 random bot per pulse waves/laughs/jumps
      if (CONFIG.GESTURE_ENABLED && botsInRoom.length > 0 && shouldGesture('party_pulse')) {
        const randomBot = botsInRoom[Math.floor(Math.random() * botsInRoom.length)];
        const g = pickGesture('party_pulse');
        if (g) rconBotAction(randomBot.id, g).catch(() => {});
      }

      // Refresh host spotlight effect every 10 ticks
      if (CONFIG.EFFECT_ENABLED && currentTick % 10 === 0) {
        rconBotEffect(party.hostAgentId, 10, 60).catch(() => {});
      }
    }
  }

  // Clean up expired parties — stop dancing for bots still in the room
  const expiredParties = world.activeParties.filter(p => currentTick >= p.endTick);
  for (const party of expiredParties) {
    const botsInRoom = world.agents.filter(a => a.currentRoomId === party.roomId);
    for (const bot of botsInRoom) {
      rconBotDance(bot.id, 0).catch(() => {});
    }
    console.log(`[PARTY] Party at room ${party.roomId} ended (${party.attendees.size} attended, hosted by ${party.hostName})`);
  }
  world.activeParties = world.activeParties.filter(p => currentTick < p.endTick);
}

async function main(): Promise<void> {
  console.log('=== Habbo AI Civilization ===');
  console.log(`Tick interval: ${CONFIG.TICK_INTERVAL_MS}ms, agents/tick: ${CONFIG.AGENTS_PER_TICK}`);
  if (CONFIG.AI_ENABLED) {
    console.log(`[AI] OpenRouter enabled (${CONFIG.AI_MODEL})`);
  } else {
    console.log('[AI] OpenRouter disabled (no OPENROUTER_API_KEY)');
  }

  await ensureSimulationTables();
  await loadRoomModels();
  await loadItemCatalog();
  await seedStartingItems();

  // Load initial world state via cache
  await refreshCache();

  const world: WorldState = {
    rooms: getRooms(),
    agents: getAgents(),
    tick: 0,
    roomChatHistory: new Map(),
    activeConversations: new Map(),
    activeParties: [],
  };

  console.log(`[INIT] Loaded ${world.agents.length} agents, ${world.rooms.length} rooms`);

  if (world.agents.length === 0) {
    console.error('[INIT] No agents found! Run "npm run generate-agents" first.');
    process.exit(1);
  }
  if (world.rooms.length === 0) {
    console.error('[INIT] No rooms found! Run "npm run setup-world" first.');
    process.exit(1);
  }

  // Start stats HTTP server
  startStatsServer(world);

  // Main tick loop
  console.log('[SIM] Simulation started');

  const tickLoop = async () => {
    while (running) {
      const start = Date.now();
      try {
        await tick(world);
      } catch (err) {
        console.error(`[TICK ${currentTick}] Fatal tick error:`, err);
      }
      const elapsed = Date.now() - start;
      const sleep = Math.max(0, CONFIG.TICK_INTERVAL_MS - elapsed);
      if (elapsed > CONFIG.TICK_INTERVAL_MS) {
        console.warn(`[TICK ${currentTick}] Tick took ${elapsed}ms (over budget by ${elapsed - CONFIG.TICK_INTERVAL_MS}ms)`);
      }
      await new Promise(resolve => setTimeout(resolve, sleep));
    }
  };

  tickLoop();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[SIM] Shutting down...');
    running = false;
    await closePool();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[SIM] Shutting down...');
    running = false;
    await closePool();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
