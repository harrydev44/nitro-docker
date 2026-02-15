import { getPool } from '../db.js';
import { CONFIG } from '../config.js';
import { rconBotTalk, rconBotShout } from '../emulator/rcon.js';
import { wsBotTalk, wsBotShout } from '../emulator/ws-actions.js';
import { getClientPool } from '../habbo-client/client-pool.js';
import { buildWalkPacket } from '../habbo-client/protocol.js';

// Accumulated writes per tick, flushed in bulk at tick end

interface BotUpdate {
  id: number;
  roomId?: number;
  x?: number;
  y?: number;
  chatLines?: string;
  chatDelay?: number;
}

interface CreditUpdate {
  userId: number;
  delta: number;
}

interface RelationshipUpdate {
  agentId: number;
  targetId: number;
  delta: number;
}

interface MemoryInsert {
  agentId: number;
  targetAgentId: number | null;
  eventType: string;
  sentiment: number;
  summary: string;
  roomId: number | null;
}

interface AgentStateUpdate {
  agentId: number;
  personality: string;
  preferences: string;
  goals: string;
  state: string;
  ticksInRoom: number;
  ticksWorking: number;
}

// Buffers
let botUpdates: Map<number, BotUpdate> = new Map();
let creditUpdates: Map<number, number> = new Map(); // userId -> total delta
let relationshipUpdates: Map<string, number> = new Map(); // "a:b" -> total delta
let memoryInserts: MemoryInsert[] = [];
let agentStateUpdates: Map<number, AgentStateUpdate> = new Map();

// RCON/WS chat queue — sent directly to emulator, no DB roundtrip
const pendingChats: { botId: number; message: string; bubbleId: number; shout: boolean }[] = [];

// --- Buffer methods (called during tick, no DB) ---

export function queueBotMove(botId: number, roomId: number, x: number, y: number): void {
  const existing = botUpdates.get(botId) || { id: botId };
  existing.roomId = roomId;
  existing.x = x;
  existing.y = y;
  existing.chatLines = '';  // clear chat on move
  botUpdates.set(botId, existing);
}

export function queueBotChat(botId: number, chatLine: string, _delay: number, bubbleId = -1): void {
  pendingChats.push({ botId, message: chatLine, bubbleId, shout: false });
}

export function queueBotShout(botId: number, chatLine: string, bubbleId = -1): void {
  pendingChats.push({ botId, message: chatLine, bubbleId, shout: true });
}

export function queueCreditChange(userId: number, delta: number): void {
  creditUpdates.set(userId, (creditUpdates.get(userId) || 0) + delta);
}

export function queueRelationshipChange(agentId: number, targetId: number, delta: number): void {
  const key = `${agentId}:${targetId}`;
  relationshipUpdates.set(key, (relationshipUpdates.get(key) || 0) + delta);
}

export function queueMemory(m: MemoryInsert): void {
  memoryInserts.push(m);
}

export function queueAgentState(s: AgentStateUpdate): void {
  agentStateUpdates.set(s.agentId, s);
}

// --- Flush all buffered writes in bulk ---

export async function flushAll(): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  const useWS = CONFIG.USE_WEBSOCKET_AGENTS;

  try {
    await conn.beginTransaction();

    // 1. Bot updates (position + chat)
    if (botUpdates.size > 0) {
      if (useWS) {
        // WS mode: send room enter + walk packets instead of DB updates
        const clientPool = getClientPool();
        for (const bot of botUpdates.values()) {
          if (bot.roomId !== undefined) {
            // Move to room via WebSocket — await so walk happens after entry
            const entered = await clientPool.moveToRoom(bot.id, bot.roomId).catch(() => false);
            if (entered && bot.x !== undefined && bot.y !== undefined) {
              clientPool.send(bot.id, buildWalkPacket(bot.x, bot.y));
            }
          } else if (bot.x !== undefined && bot.y !== undefined) {
            // Walk only (no room change)
            clientPool.send(bot.id, buildWalkPacket(bot.x, bot.y));
          }
        }
      } else {
        // Bot mode: update bots table
        for (const bot of botUpdates.values()) {
          const sets: string[] = [];
          const params: any[] = [];

          if (bot.roomId !== undefined) {
            sets.push('room_id = ?', 'x = ?', 'y = ?');
            params.push(bot.roomId, bot.x || 0, bot.y || 0);
          }
          if (bot.chatLines !== undefined) {
            sets.push("chat_lines = ?", "chat_auto = '0'", "chat_random = '0'");
            params.push(bot.chatLines);
          }
          if (bot.chatDelay !== undefined) {
            sets.push('chat_delay = ?');
            params.push(bot.chatDelay);
          }

          if (sets.length > 0) {
            params.push(bot.id);
            await conn.execute(`UPDATE bots SET ${sets.join(', ')} WHERE id = ?`, params);
          }
        }
      }
    }

    // 2. Credit updates (batch by userId)
    if (creditUpdates.size > 0) {
      for (const [userId, delta] of creditUpdates) {
        if (delta !== 0) {
          await conn.execute(`UPDATE users SET credits = credits + ? WHERE id = ?`, [delta, userId]);
        }
      }
    }

    // 3. Relationship updates
    if (relationshipUpdates.size > 0) {
      for (const [key, delta] of relationshipUpdates) {
        const [agentId, targetId] = key.split(':').map(Number);
        await conn.execute(
          `INSERT INTO simulation_relationships (agent_id, target_agent_id, score, interaction_count, last_interaction)
           VALUES (?, ?, ?, 1, NOW())
           ON DUPLICATE KEY UPDATE
             score = GREATEST(-100, LEAST(100, score + ?)),
             interaction_count = interaction_count + 1,
             last_interaction = NOW()`,
          [agentId, targetId, Math.max(-100, Math.min(100, delta)), delta]
        );
      }
    }

    // 4. Memory inserts (batch insert)
    if (memoryInserts.length > 0) {
      const placeholders = memoryInserts.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const params = memoryInserts.flatMap(m => [
        m.agentId, m.targetAgentId, m.eventType, m.sentiment, m.summary, m.roomId
      ]);
      await conn.execute(
        `INSERT INTO simulation_agent_memory (agent_id, target_agent_id, event_type, sentiment, summary, room_id)
         VALUES ${placeholders}`,
        params
      );
    }

    // 5. Agent state upserts
    if (agentStateUpdates.size > 0) {
      for (const s of agentStateUpdates.values()) {
        await conn.execute(
          `INSERT INTO simulation_agent_state (agent_id, personality, preferences, goals, state, ticks_in_room, ticks_working)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             goals = VALUES(goals), state = VALUES(state),
             ticks_in_room = VALUES(ticks_in_room), ticks_working = VALUES(ticks_working)`,
          [s.agentId, s.personality, s.preferences, s.goals, s.state, s.ticksInRoom, s.ticksWorking]
        );
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();

    // Clear buffers
    botUpdates.clear();
    creditUpdates.clear();
    relationshipUpdates.clear();
    memoryInserts = [];
    agentStateUpdates.clear();

    // Send queued chats (fire-and-forget, after DB transaction)
    const chats = pendingChats.splice(0);
    for (const chat of chats) {
      if (useWS) {
        if (chat.shout) {
          wsBotShout(chat.botId, chat.message).catch(() => {});
        } else {
          wsBotTalk(chat.botId, chat.message, chat.bubbleId).catch(() => {});
        }
      } else {
        if (chat.shout) {
          rconBotShout(chat.botId, chat.message).catch(() => {});
        } else {
          rconBotTalk(chat.botId, chat.message, chat.bubbleId).catch(() => {});
        }
      }
    }
  }
}
