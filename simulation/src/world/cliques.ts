import { query } from '../db.js';
import { CONFIG } from '../config.js';
import type { Agent } from '../types.js';

/**
 * Clique detection — finds natural friend groups from the relationship graph.
 *
 * A clique is 3-6 agents who all have mutual friendship scores (≥ friend threshold).
 * Clique members prefer each other's rooms and get social bonuses.
 *
 * Refreshed every 50 ticks alongside fame.
 */

export interface Clique {
  id: number;
  members: number[];   // agent IDs
  memberNames: string[];
  strength: number;    // avg relationship score among members
}

let cliqueCache: Clique[] = [];
let agentCliqueMap: Map<number, number> = new Map(); // agentId -> cliqueId

export function getAgentClique(agentId: number): Clique | null {
  const cliqueId = agentCliqueMap.get(agentId);
  if (cliqueId === undefined) return null;
  return cliqueCache[cliqueId] || null;
}

export function getCliqueSummary(): { id: number; members: string[]; strength: number }[] {
  return cliqueCache.map(c => ({
    id: c.id,
    members: c.memberNames,
    strength: Math.round(c.strength),
  }));
}

/**
 * Compute cliques from the relationship graph.
 * Uses a greedy approach: start from strongest mutual pairs, expand outward.
 */
export async function refreshCliques(agents: Agent[]): Promise<void> {
  // Load all friendships (mutual positive relationships above threshold)
  const friendships = await query<{ agent_id: number; target_agent_id: number; score: number }>(
    `SELECT agent_id, target_agent_id, score
     FROM simulation_relationships
     WHERE score >= ?`,
    [CONFIG.RELATIONSHIP_FRIEND_THRESHOLD]
  );

  // Build adjacency map: agentId -> Map<targetId, score>
  const adj = new Map<number, Map<number, number>>();
  for (const f of friendships) {
    if (!adj.has(f.agent_id)) adj.set(f.agent_id, new Map());
    adj.get(f.agent_id)!.set(f.target_agent_id, f.score);
  }

  // Find mutual friendships (both directions above threshold)
  const mutualPairs: { a: number; b: number; score: number }[] = [];
  for (const [agentId, targets] of adj) {
    for (const [targetId, score] of targets) {
      if (agentId < targetId) {
        const reverseScore = adj.get(targetId)?.get(agentId);
        if (reverseScore !== undefined) {
          mutualPairs.push({ a: agentId, b: targetId, score: (score + reverseScore) / 2 });
        }
      }
    }
  }

  // Sort by strength (strongest pairs first)
  mutualPairs.sort((a, b) => b.score - a.score);

  // Greedy clique building
  const assigned = new Set<number>();
  const cliques: Clique[] = [];
  const nameMap = new Map(agents.map(a => [a.id, a.name]));

  for (const pair of mutualPairs) {
    if (assigned.has(pair.a) || assigned.has(pair.b)) continue;

    // Start a new clique with this pair
    const members = [pair.a, pair.b];
    assigned.add(pair.a);
    assigned.add(pair.b);

    // Try to expand: find agents who are mutual friends with ALL current members
    for (const candidate of agents) {
      if (assigned.has(candidate.id)) continue;
      if (members.length >= 6) break; // max clique size

      let allMutual = true;
      let totalScore = 0;
      for (const memberId of members) {
        const scoreToMember = adj.get(candidate.id)?.get(memberId);
        const scoreFromMember = adj.get(memberId)?.get(candidate.id);
        if (scoreToMember === undefined || scoreFromMember === undefined) {
          allMutual = false;
          break;
        }
        totalScore += (scoreToMember + scoreFromMember) / 2;
      }

      if (allMutual) {
        members.push(candidate.id);
        assigned.add(candidate.id);
      }
    }

    // Only keep cliques of 3+ members
    if (members.length >= 3) {
      // Calculate average strength
      let totalStrength = 0;
      let pairCount = 0;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const s1 = adj.get(members[i])?.get(members[j]) || 0;
          const s2 = adj.get(members[j])?.get(members[i]) || 0;
          totalStrength += (s1 + s2) / 2;
          pairCount++;
        }
      }

      cliques.push({
        id: cliques.length,
        members,
        memberNames: members.map(id => nameMap.get(id) || 'Unknown'),
        strength: pairCount > 0 ? totalStrength / pairCount : 0,
      });
    }
  }

  // Update caches
  cliqueCache = cliques;
  agentCliqueMap.clear();
  for (const clique of cliques) {
    for (const memberId of clique.members) {
      agentCliqueMap.set(memberId, clique.id);
    }
  }
}

/**
 * Room movement bonus for clique mates.
 * Agents prefer rooms where their clique members are.
 */
export function getCliqueRoomBonus(agentId: number, roomId: number, agents: Agent[]): number {
  const clique = getAgentClique(agentId);
  if (!clique) return 0;

  const cliqueMatesInRoom = clique.members.filter(
    mid => mid !== agentId && agents.some(a => a.id === mid && a.currentRoomId === roomId)
  ).length;

  // +0.15 per clique mate in the room (max 0.45)
  return Math.min(cliqueMatesInRoom * 0.15, 0.45);
}
