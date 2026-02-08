import { execute, query } from '../db.js';
import { CONFIG } from '../config.js';
import type { Relationship } from '../types.js';

export async function getRelationship(agentId: number, targetId: number): Promise<Relationship | null> {
  const rows = await query<Relationship>(
    `SELECT agent_id as agentId, target_agent_id as targetAgentId, score, interaction_count as interactionCount, last_interaction as lastInteraction
     FROM simulation_relationships WHERE agent_id = ? AND target_agent_id = ?`,
    [agentId, targetId]
  );
  return rows[0] || null;
}

export async function getAgentRelationships(agentId: number): Promise<Relationship[]> {
  return query<Relationship>(
    `SELECT agent_id as agentId, target_agent_id as targetAgentId, score, interaction_count as interactionCount, last_interaction as lastInteraction
     FROM simulation_relationships WHERE agent_id = ? ORDER BY score DESC`,
    [agentId]
  );
}

export async function getFriends(agentId: number): Promise<number[]> {
  const rows = await query<{ target_agent_id: number }>(
    `SELECT target_agent_id FROM simulation_relationships
     WHERE agent_id = ? AND score >= ?`,
    [agentId, CONFIG.RELATIONSHIP_FRIEND_THRESHOLD]
  );
  return rows.map(r => r.target_agent_id);
}

export async function getEnemies(agentId: number): Promise<number[]> {
  const rows = await query<{ target_agent_id: number }>(
    `SELECT target_agent_id FROM simulation_relationships
     WHERE agent_id = ? AND score <= ?`,
    [agentId, CONFIG.RELATIONSHIP_AVOID_THRESHOLD]
  );
  return rows.map(r => r.target_agent_id);
}

export async function adjustRelationship(agentId: number, targetId: number, delta: number): Promise<void> {
  await execute(
    `INSERT INTO simulation_relationships (agent_id, target_agent_id, score, interaction_count, last_interaction)
     VALUES (?, ?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE
       score = GREATEST(-100, LEAST(100, score + ?)),
       interaction_count = interaction_count + 1,
       last_interaction = NOW()`,
    [agentId, targetId, Math.max(-100, Math.min(100, delta)), delta]
  );
}

export async function decayRelationships(): Promise<void> {
  // Decay positive relationships toward 0
  await execute(
    `UPDATE simulation_relationships
     SET score = CASE
       WHEN score > 0 THEN GREATEST(0, score - ?)
       WHEN score < 0 THEN LEAST(0, score + ?)
       ELSE score
     END`,
    [CONFIG.RELATIONSHIP_DECAY_PER_100_TICKS, CONFIG.RELATIONSHIP_DECAY_PER_100_TICKS]
  );
}
