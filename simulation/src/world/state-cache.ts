import { query } from '../db.js';
import type { Agent, SimRoom, Relationship, PersonalityTraits, AgentPreferences, RoomPurpose, CachedMemory } from '../types.js';

// In-memory caches loaded once per tick
let agentCache: Agent[] = [];
let roomCache: SimRoom[] = [];
let relationshipCache: Map<string, Relationship> = new Map(); // "agentId:targetId" -> Relationship
let friendsCache: Map<number, number[]> = new Map();
let enemiesCache: Map<number, number[]> = new Map();
let closeFriendsCache: Map<number, number[]> = new Map(); // score >= 50
let itemCountCache: Map<number, number> = new Map(); // userId -> item count in inventory
let roomItemCountCache: Map<number, number> = new Map(); // roomId -> item count
let memoryCache: CachedMemory[] = []; // recent memories for gossip

interface BotRow {
  id: number;
  user_id: number;
  room_id: number;
  name: string;
  motto: string;
}

interface AgentStateRow {
  agent_id: number;
  personality: string;
  preferences: string;
  goals: string;
  state: string;
  ticks_in_room: number;
  ticks_working: number;
}

interface RoomRow {
  id: number;
  name: string;
  owner_id: number;
  owner_name: string;
  model: string;
  users_max: number;
  trade_mode: number;
}

interface RelRow {
  agent_id: number;
  target_agent_id: number;
  score: number;
  interaction_count: number;
  last_interaction: Date | null;
}

export async function refreshCache(): Promise<void> {
  // Load only external agent bots (hotel is API-driven only)
  const bots = await query<BotRow>(
    `SELECT b.id, b.user_id, b.room_id, b.name, b.motto
     FROM bots b JOIN users u ON b.user_id = u.id
     WHERE u.username LIKE 'ext_%' ORDER BY b.id`
  );

  // Load all agent states in one query
  const states = await query<AgentStateRow>(`SELECT * FROM simulation_agent_state`);
  const stateMap = new Map(states.map(s => [s.agent_id, s]));

  // Load credits for external agent users only
  const credits = await query<{ id: number; credits: number }>(
    `SELECT id, credits FROM users WHERE username LIKE 'ext_%'`
  );
  const creditMap = new Map(credits.map(c => [c.id, c.credits]));

  // Build agent cache
  agentCache = bots.map(bot => {
    const state = stateMap.get(bot.id);
    const defaultPersonality: PersonalityTraits = {
      sociability: 0.5, ambition: 0.5, curiosity: 0.5, friendliness: 0.5, impulsiveness: 0.5,
    };
    const defaultPreferences: AgentPreferences = {
      preferredRoomTypes: ['hangout'],
      socialCircleSize: 5,
      wealthGoal: 3000,
    };
    const moltbookUrl = bot.motto?.startsWith('moltbook.com/u/')
      ? `https://www.${bot.motto}`
      : undefined;
    return {
      id: bot.id,
      userId: bot.user_id,
      name: bot.name,
      personality: state ? JSON.parse(state.personality) : defaultPersonality,
      preferences: state ? JSON.parse(state.preferences) : defaultPreferences,
      goals: state ? JSON.parse(state.goals) : [],
      currentRoomId: bot.room_id || null,
      credits: creditMap.get(bot.user_id) || 0,
      state: (state?.state as Agent['state']) || 'idle',
      ticksSinceLastAction: 0,
      ticksInCurrentRoom: state?.ticks_in_room || 0,
      ticksWorking: state?.ticks_working || 0,
      moltbookUrl,
    };
  });

  // Load all rooms in one query
  const rooms = await query<RoomRow>(
    `SELECT r.id, r.name, r.owner_id, r.owner_name, r.model, r.users_max, r.trade_mode
     FROM rooms r JOIN users u ON r.owner_id = u.id
     WHERE u.username LIKE 'sim_owner_%' OR u.username LIKE 'ext_%' ORDER BY r.id`
  );

  const roomStats = await query<{ room_id: number; purpose: string }>(
    `SELECT room_id, purpose FROM simulation_room_stats`
  );
  const purposeMap = new Map(roomStats.map(s => [s.room_id, s.purpose as RoomPurpose]));

  // Count bots per room from our agent cache
  const popMap = new Map<number, number>();
  for (const agent of agentCache) {
    if (agent.currentRoomId) {
      popMap.set(agent.currentRoomId, (popMap.get(agent.currentRoomId) || 0) + 1);
    }
  }

  roomCache = rooms.map(r => ({
    id: r.id,
    name: r.name,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    model: r.model,
    purpose: purposeMap.get(r.id) || 'hangout',
    currentPopulation: popMap.get(r.id) || 0,
    usersMax: r.users_max,
    tradeMode: r.trade_mode,
  }));

  // Load all relationships in one query
  const rels = await query<RelRow>(`SELECT * FROM simulation_relationships`);
  relationshipCache.clear();
  friendsCache.clear();
  enemiesCache.clear();
  closeFriendsCache.clear();

  for (const rel of rels) {
    const key = `${rel.agent_id}:${rel.target_agent_id}`;
    relationshipCache.set(key, {
      agentId: rel.agent_id,
      targetAgentId: rel.target_agent_id,
      score: rel.score,
      interactionCount: rel.interaction_count,
      lastInteraction: rel.last_interaction,
    });

    // Build friends/enemies/close friends lists
    if (rel.score >= 20) {
      if (!friendsCache.has(rel.agent_id)) friendsCache.set(rel.agent_id, []);
      friendsCache.get(rel.agent_id)!.push(rel.target_agent_id);
    }
    if (rel.score >= 50) {
      if (!closeFriendsCache.has(rel.agent_id)) closeFriendsCache.set(rel.agent_id, []);
      closeFriendsCache.get(rel.agent_id)!.push(rel.target_agent_id);
    }
    if (rel.score <= -10) {
      if (!enemiesCache.has(rel.agent_id)) enemiesCache.set(rel.agent_id, []);
      enemiesCache.get(rel.agent_id)!.push(rel.target_agent_id);
    }
  }

  // Load item counts per user (inventory) and per room
  const invItems = await query<{ user_id: number; cnt: number }>(
    `SELECT user_id, COUNT(*) as cnt FROM items WHERE room_id = 0 GROUP BY user_id`
  );
  itemCountCache = new Map(invItems.map(i => [i.user_id, i.cnt]));

  const roomItems = await query<{ room_id: number; cnt: number }>(
    `SELECT room_id, COUNT(*) as cnt FROM items WHERE room_id > 0 GROUP BY room_id`
  );
  roomItemCountCache = new Map(roomItems.map(i => [i.room_id, i.cnt]));

  // Load recent memories for gossip (last 5 minutes, capped at 500)
  const recentMems = await query<{ agent_id: number; target_agent_id: number | null; event_type: string; summary: string }>(
    `SELECT agent_id, target_agent_id, event_type, summary
     FROM simulation_agent_memory
     WHERE created_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
     ORDER BY created_at DESC LIMIT 500`
  );
  memoryCache = recentMems.map(m => ({
    agentId: m.agent_id,
    targetAgentId: m.target_agent_id,
    eventType: m.event_type as CachedMemory['eventType'],
    summary: m.summary,
  }));
}

// --- Cache accessors (no DB calls) ---

export function getAgents(): Agent[] { return agentCache; }
export function getRooms(): SimRoom[] { return roomCache; }

export function getCachedRelationship(agentId: number, targetId: number): Relationship | null {
  return relationshipCache.get(`${agentId}:${targetId}`) || null;
}

export function getCachedFriends(agentId: number): number[] {
  return friendsCache.get(agentId) || [];
}

export function getCachedEnemies(agentId: number): number[] {
  return enemiesCache.get(agentId) || [];
}

export function getCachedInventoryCount(userId: number): number {
  return itemCountCache.get(userId) || 0;
}

export function getCachedRoomItemCount(roomId: number): number {
  return roomItemCountCache.get(roomId) || 0;
}

export function getCachedCloseFriends(agentId: number): number[] {
  return closeFriendsCache.get(agentId) || [];
}

export function getCachedMemories(): CachedMemory[] {
  return memoryCache;
}
