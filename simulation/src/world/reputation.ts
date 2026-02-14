import { query } from '../db.js';
import type { Agent } from '../types.js';

/**
 * Reputation/Fame system — tracks hotel-wide celebrity status.
 *
 * Fame score = weighted composite:
 *   - Social interactions (40%): total relationship interactions
 *   - Wealth (20%): current credits
 *   - Drama (25%): dramatic events (gifts, conflicts, reunions)
 *   - Parties hosted (15%): from memory events
 *
 * Updated periodically (every 50 ticks), cached in memory.
 */

export interface AgentFame {
  agentId: number;
  name: string;
  fameScore: number;
  tier: 'legend' | 'celebrity' | 'rising' | 'known' | 'unknown';
  moltbookUrl?: string;
}

// In-memory fame cache — refreshed every 50 ticks
let fameCache: AgentFame[] = [];
let fameLookup: Map<number, AgentFame> = new Map();

export function getFameList(): AgentFame[] {
  return fameCache;
}

export function getAgentFame(agentId: number): AgentFame | null {
  return fameLookup.get(agentId) || null;
}

export function isCelebrity(agentId: number): boolean {
  const fame = fameLookup.get(agentId);
  return !!fame && (fame.tier === 'celebrity' || fame.tier === 'legend');
}

/**
 * Recompute fame scores for all agents.
 */
export async function refreshFame(agents: Agent[]): Promise<void> {
  // 1. Total interactions per agent
  const interactions = await query<{ agent_id: number; total: number }>(
    `SELECT agent_id, SUM(interaction_count) as total
     FROM simulation_relationships
     GROUP BY agent_id`
  );
  const interactionMap = new Map(interactions.map(r => [r.agent_id, Number(r.total)]));

  // 2. Drama event counts per agent
  const dramaEvents = await query<{ agent_id: number; cnt: number }>(
    `SELECT agent_id, COUNT(*) as cnt
     FROM simulation_agent_memory
     WHERE event_type IN ('gift', 'conflict', 'reunion', 'argument')
     GROUP BY agent_id`
  );
  const dramaMap = new Map(dramaEvents.map(r => [r.agent_id, Number(r.cnt)]));

  // 3. Compute fame for all agents
  const maxInteractions = Math.max(1, ...Array.from(interactionMap.values()));
  const maxCredits = Math.max(1, ...agents.map(a => a.credits));
  const maxDrama = Math.max(1, ...Array.from(dramaMap.values()));

  const results: AgentFame[] = agents.map(agent => {
    const socialScore = (interactionMap.get(agent.id) || 0) / maxInteractions;
    const wealthScore = agent.credits / maxCredits;
    const dramaScore = (dramaMap.get(agent.id) || 0) / maxDrama;

    const fameScore = socialScore * 0.4 + wealthScore * 0.2 + dramaScore * 0.4;

    return {
      agentId: agent.id,
      name: agent.name,
      fameScore,
      tier: fameToTier(fameScore),
      moltbookUrl: agent.moltbookUrl,
    };
  });

  // Sort by fame descending
  results.sort((a, b) => b.fameScore - a.fameScore);

  fameCache = results;
  fameLookup = new Map(results.map(r => [r.agentId, r]));
}

function fameToTier(score: number): AgentFame['tier'] {
  if (score >= 0.8) return 'legend';
  if (score >= 0.6) return 'celebrity';
  if (score >= 0.4) return 'rising';
  if (score >= 0.2) return 'known';
  return 'unknown';
}

/**
 * Celebrity attraction bonus for room movement.
 * Famous agents draw others to their room.
 */
export function getCelebrityAttraction(roomId: number, agents: Agent[]): number {
  let bonus = 0;
  for (const agent of agents) {
    if (agent.currentRoomId !== roomId) continue;
    const fame = fameLookup.get(agent.id);
    if (!fame) continue;
    if (fame.tier === 'legend') bonus += 0.4;
    else if (fame.tier === 'celebrity') bonus += 0.2;
    else if (fame.tier === 'rising') bonus += 0.1;
  }
  return Math.min(bonus, 0.6); // cap at 0.6
}
