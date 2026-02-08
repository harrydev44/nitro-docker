import 'dotenv/config';
import { CONFIG } from './config.js';
import { closePool, execute } from './db.js';
import { ensureSimulationTables } from './db-setup.js';
import { refreshCache, getAgents, getRooms } from './world/state-cache.js';
import { flushAll, queueAgentState } from './world/batch-writer.js';
import { runDecisionEngine } from './engine/decision.js';
import { updatePopularity } from './world/popularity.js';
import { decayRelationships } from './agents/relationships.js';
import { startStatsServer } from './stats/collector.js';
import type { WorldState } from './types.js';

const SPECTATOR_SSO_TICKET = 'spectator-sso-ticket';

let running = true;
let currentTick = 0;

async function tick(world: WorldState): Promise<void> {
  currentTick++;
  world.tick = currentTick;

  // 1. Refresh all caches from DB (agents, rooms, relationships, items)
  await refreshCache();
  world.agents = getAgents();
  world.rooms = getRooms();

  // Shuffle agents for fairness
  const shuffled = [...world.agents].sort(() => Math.random() - 0.5);

  // 2. Run decisions for each agent (queues writes, no direct DB per agent)
  for (const agent of shuffled) {
    // Skip with probability — not all agents act every tick
    if (Math.random() < CONFIG.AGENT_IDLE_PROBABILITY) continue;

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
}

async function main(): Promise<void> {
  console.log('=== Habbo AI Civilization ===');
  console.log(`Tick interval: ${CONFIG.TICK_INTERVAL_MS}ms`);

  await ensureSimulationTables();

  // Load initial world state via cache
  await refreshCache();

  const world: WorldState = {
    rooms: getRooms(),
    agents: getAgents(),
    tick: 0,
    roomChatHistory: new Map(),
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
