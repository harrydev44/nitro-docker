import { CONFIG } from '../config.js';
import { getWebhookAgents, updateWebhookStatus } from '../api/external-agents.js';
import { getBotFromWorld } from '../api/external-api.js';
import { botTalk, botShout, botDance, botAction, botWhisper } from '../emulator/actions.js';
import { getClientPool } from '../habbo-client/client-pool.js';
import { buildWalkPacket } from '../habbo-client/protocol.js';
import { execute, query } from '../db.js';
import { checkActionRate } from '../api/rate-limiter.js';
import type { ExternalAgent } from '../api/external-agents.js';
import type { WorldState } from '../types.js';

// Track in-flight dispatches to prevent double-dispatch
const inflight = new Set<number>();

// Gesture name -> Habbo RoomUserAction ID (same map as external-api.ts)
const GESTURE_MAP: Record<string, number> = {
  wave: 1,
  blow_kiss: 2,
  laugh: 3,
  jump: 6,
  thumbs_up: 7,
};

const VALID_ACTIONS = new Set([
  'idle', 'chat', 'shout', 'whisper', 'move', 'walk', 'dance', 'gesture', 'motto',
]);

/**
 * Non-blocking webhook dispatcher — called every tick from the main loop.
 * Picks up to WEBHOOK_MAX_PER_TICK agents that are "due" and fires off
 * POST requests to their callback_url. Responses are parsed and executed.
 */
export function dispatchWebhooks(world: WorldState): void {
  const agents = getWebhookAgents();
  if (agents.length === 0) return;

  const now = Date.now();
  const due: ExternalAgent[] = [];

  for (const agent of agents) {
    // Skip if already in-flight
    if (inflight.has(agent.id)) continue;

    // Circuit breaker: exponential backoff after consecutive failures
    if (agent.webhookFailures >= CONFIG.WEBHOOK_MAX_FAILURES) {
      // Backoff: 2^(failures - maxFailures) * interval, capped at 30min
      const backoffMultiplier = Math.pow(2, agent.webhookFailures - CONFIG.WEBHOOK_MAX_FAILURES);
      const backoffSecs = Math.min(1800, agent.webhookIntervalSecs * backoffMultiplier);
      const lastAttempt = agent.lastWebhookAt?.getTime() || 0;
      if (now - lastAttempt < backoffSecs * 1000) continue;
    }

    // Check if enough time has elapsed since last webhook
    const lastAt = agent.lastWebhookAt?.getTime() || 0;
    const elapsedSecs = (now - lastAt) / 1000;
    if (elapsedSecs < agent.webhookIntervalSecs) continue;

    due.push(agent);
  }

  if (due.length === 0) return;

  // Shuffle and pick up to max per tick
  for (let i = due.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [due[i], due[j]] = [due[j], due[i]];
  }
  const batch = due.slice(0, CONFIG.WEBHOOK_MAX_PER_TICK);

  // Fire-and-forget for each agent
  for (const agent of batch) {
    inflight.add(agent.id);
    dispatchOne(agent, world).finally(() => {
      inflight.delete(agent.id);
    });
  }
}

async function dispatchOne(agent: ExternalAgent, world: WorldState): Promise<void> {
  const bot = getBotFromWorld(agent.botId);
  const roomId = bot?.currentRoomId ?? null;

  // Build context payload
  const room = roomId ? world.rooms.find(r => r.id === roomId) : null;

  const nearbyAgents = roomId
    ? world.agents
        .filter(a => a.currentRoomId === roomId && a.id !== agent.botId)
        .slice(0, 15)
        .map(a => ({ name: a.name, state: a.state }))
    : [];

  const recentChat = roomId
    ? (world.roomChatHistory.get(roomId) || [])
        .slice(-10)
        .map(m => ({ agent: m.agentName, message: m.message, tick: m.tick }))
    : [];

  // Fetch credits
  let credits = 0;
  try {
    const rows = await query<{ credits: number }>(
      `SELECT credits FROM users WHERE id = ?`, [agent.userId]
    );
    credits = rows[0]?.credits || 0;
  } catch {}

  const payload = {
    agent: {
      name: agent.name,
      credits,
      current_room_id: roomId,
    },
    room: room ? {
      id: room.id,
      name: room.name,
      purpose: room.purpose,
      population: room.currentPopulation,
    } : null,
    nearby_agents: nearbyAgents,
    recent_chat: recentChat,
    tick: world.tick,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.WEBHOOK_TIMEOUT_MS);

    const response = await fetch(agent.callbackUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ClawHabbo-Agent': agent.name,
        'X-ClawHabbo-Tick': String(world.tick),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[WEBHOOK] ${agent.name}: HTTP ${response.status}`);
      await updateWebhookStatus(agent, false);
      return;
    }

    const body = await response.json() as { action?: string; params?: Record<string, any> };

    if (!body.action || !VALID_ACTIONS.has(body.action)) {
      // No action or invalid — treat as idle (still a success)
      await updateWebhookStatus(agent, true);
      return;
    }

    if (body.action === 'idle') {
      await updateWebhookStatus(agent, true);
      return;
    }

    // Execute the action
    await executeWebhookAction(agent, body.action, body.params || {}, world);
    await updateWebhookStatus(agent, true);

  } catch (err: any) {
    const reason = err.name === 'AbortError' ? 'timeout' : err.message;
    console.warn(`[WEBHOOK] ${agent.name}: ${reason}`);
    await updateWebhookStatus(agent, false);
  }
}

async function executeWebhookAction(
  agent: ExternalAgent,
  action: string,
  params: Record<string, any>,
  world: WorldState
): Promise<void> {
  const bot = getBotFromWorld(agent.botId);

  switch (action) {
    case 'chat': {
      const msg = params.message;
      if (!msg || typeof msg !== 'string' || msg.length > 100) return;
      if (!checkActionRate(agent.id, 'chat').allowed) return;
      if (!bot?.currentRoomId) return;
      const ok = await botTalk(agent.botId, msg);
      if (ok && world) {
        const history = world.roomChatHistory.get(bot.currentRoomId) || [];
        history.push({ agentId: agent.botId, agentName: agent.name, message: msg, tick: world.tick });
        world.roomChatHistory.set(bot.currentRoomId, history);
      }
      break;
    }

    case 'shout': {
      const msg = params.message;
      if (!msg || typeof msg !== 'string' || msg.length > 100) return;
      if (!checkActionRate(agent.id, 'shout').allowed) return;
      if (!bot?.currentRoomId) return;
      await botShout(agent.botId, msg);
      break;
    }

    case 'whisper': {
      const target = params.targetAgentName || params.target;
      const msg = params.message;
      if (!target || !msg || typeof msg !== 'string' || msg.length > 100) return;
      if (!checkActionRate(agent.id, 'whisper').allowed) return;
      if (!bot?.currentRoomId) return;
      await botWhisper(agent.botId, target, msg);
      break;
    }

    case 'move': {
      const roomId = params.roomId;
      if (!roomId || typeof roomId !== 'number') return;
      if (!checkActionRate(agent.id, 'move').allowed) return;
      const room = world.rooms.find(r => r.id === roomId);
      if (!room) return;
      if (CONFIG.USE_WEBSOCKET_AGENTS) {
        const pool = getClientPool();
        await pool.moveToRoom(agent.botId, roomId);
      } else {
        await execute(`UPDATE bots SET room_id = ? WHERE id = ?`, [roomId, agent.botId]);
      }
      break;
    }

    case 'walk': {
      const { x, y } = params;
      if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || y < 0) return;
      if (!checkActionRate(agent.id, 'walk').allowed) return;
      if (!bot?.currentRoomId) return;
      if (CONFIG.USE_WEBSOCKET_AGENTS) {
        const pool = getClientPool();
        pool.send(agent.botId, buildWalkPacket(x, y));
      } else {
        await execute(`UPDATE bots SET x = ?, y = ? WHERE id = ?`, [x, y, agent.botId]);
      }
      break;
    }

    case 'dance': {
      const style = typeof params.style === 'number' ? params.style : 1;
      if (style < 0 || style > 4) return;
      if (!checkActionRate(agent.id, 'dance').allowed) return;
      if (!bot?.currentRoomId) return;
      await botDance(agent.botId, style);
      break;
    }

    case 'gesture': {
      const type = params.type;
      if (!type || !GESTURE_MAP[type]) return;
      if (!checkActionRate(agent.id, 'gesture').allowed) return;
      if (!bot?.currentRoomId) return;
      await botAction(agent.botId, GESTURE_MAP[type]);
      break;
    }

    case 'motto': {
      const motto = params.motto;
      if (typeof motto !== 'string' || motto.length > 127) return;
      if (!checkActionRate(agent.id, 'motto').allowed) return;
      if (CONFIG.USE_WEBSOCKET_AGENTS) {
        await execute(`UPDATE users SET motto = ? WHERE id = ?`, [motto, agent.botId]);
      } else {
        await execute(`UPDATE bots SET motto = ? WHERE id = ?`, [motto, agent.botId]);
      }
      break;
    }
  }
}
