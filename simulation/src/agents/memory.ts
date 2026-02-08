import { execute, query } from '../db.js';
import { CONFIG } from '../config.js';
import type { Memory, MemoryEventType } from '../types.js';

export async function addMemory(
  agentId: number,
  targetAgentId: number | null,
  eventType: MemoryEventType,
  sentiment: number,
  summary: string,
  roomId: number | null
): Promise<void> {
  await execute(
    `INSERT INTO simulation_agent_memory (agent_id, target_agent_id, event_type, sentiment, summary, room_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [agentId, targetAgentId, eventType, sentiment, summary, roomId]
  );

  // Prune old memories
  await execute(
    `DELETE FROM simulation_agent_memory
     WHERE agent_id = ? AND id NOT IN (
       SELECT id FROM (
         SELECT id FROM simulation_agent_memory WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?
       ) AS recent
     )`,
    [agentId, agentId, CONFIG.MAX_MEMORIES_PER_AGENT]
  );
}

export async function getRecentMemories(agentId: number, limit: number = 10): Promise<Memory[]> {
  return query<Memory>(
    `SELECT id, agent_id as agentId, target_agent_id as targetAgentId, event_type as eventType,
            sentiment, summary, room_id as roomId, created_at as createdAt
     FROM simulation_agent_memory
     WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`,
    [agentId, limit]
  );
}

export async function getMemoriesAbout(agentId: number, targetAgentId: number): Promise<Memory[]> {
  return query<Memory>(
    `SELECT id, agent_id as agentId, target_agent_id as targetAgentId, event_type as eventType,
            sentiment, summary, room_id as roomId, created_at as createdAt
     FROM simulation_agent_memory
     WHERE agent_id = ? AND target_agent_id = ? ORDER BY created_at DESC LIMIT 10`,
    [agentId, targetAgentId]
  );
}
