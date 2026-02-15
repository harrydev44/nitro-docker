import { query } from '../db.js';
import { CONFIG } from '../config.js';
import type { Agent, PersonalityTraits, AgentPreferences, Goal } from '../types.js';

function safeParse<T>(val: any, fallback: T): T {
  if (val == null) return fallback;
  if (typeof val === 'object') return val as T;
  try { return JSON.parse(val); } catch { return fallback; }
}

interface BotRow {
  id: number;
  user_id: number;
  room_id: number;
  name: string;
}

interface UserAgentRow {
  id: number;
  real_name: string;
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

interface UserCreditsRow {
  id: number;
  credits: number;
}

export async function loadAgents(): Promise<Agent[]> {
  if (CONFIG.USE_WEBSOCKET_AGENTS) {
    return loadWSAgents();
  }
  return loadBotAgents();
}

/**
 * WebSocket mode: Load agents from users table (sim_agent_* users).
 * In WS mode, agent.id = user.id and agent.userId = user.id (same).
 */
async function loadWSAgents(): Promise<Agent[]> {
  const limit = CONFIG.TEST_AGENT_COUNT > 0 ? CONFIG.TEST_AGENT_COUNT : 0;
  const users = await query<UserAgentRow>(
    `SELECT id, real_name FROM users WHERE username LIKE 'sim_agent_%' ORDER BY id${limit ? ` LIMIT ${limit}` : ''}`
  );

  if (users.length === 0) return [];

  // Load agent state data
  const states = await query<AgentStateRow>(
    `SELECT * FROM simulation_agent_state WHERE agent_id IN (${users.map(() => '?').join(',')})`,
    users.map(u => u.id)
  );
  const stateMap = new Map(states.map(s => [s.agent_id, s]));

  // Load credits directly from each user
  const creditRows = await query<UserCreditsRow>(
    `SELECT id, credits FROM users WHERE id IN (${users.map(() => '?').join(',')})`,
    users.map(u => u.id)
  );
  const creditMap = new Map(creditRows.map(c => [c.id, c.credits]));

  return users.map(user => {
    const state = stateMap.get(user.id);
    const defaultPersonality: PersonalityTraits = {
      sociability: 0.5, ambition: 0.5, curiosity: 0.5, friendliness: 0.5, impulsiveness: 0.5,
    };
    const defaultPreferences: AgentPreferences = {
      preferredRoomTypes: ['hangout'],
      socialCircleSize: 5,
      wealthGoal: 3000,
    };

    return {
      id: user.id,          // In WS mode, agent ID = user ID
      userId: user.id,       // Same user — no owner indirection
      name: user.real_name,
      personality: safeParse(state?.personality, defaultPersonality),
      preferences: safeParse(state?.preferences, defaultPreferences),
      goals: safeParse(state?.goals, []),
      currentRoomId: null,   // Room tracked by ClientPool, not DB
      credits: creditMap.get(user.id) || 0,
      state: (state?.state as Agent['state']) || 'idle',
      ticksSinceLastAction: 0,
      ticksInCurrentRoom: state?.ticks_in_room || 0,
      ticksWorking: state?.ticks_working || 0,
    };
  });
}

/**
 * Original bot mode: Load agents from bots table.
 */
async function loadBotAgents(): Promise<Agent[]> {
  // Load all simulation bots (owned by sim_owner users)
  const bots = await query<BotRow>(
    `SELECT b.id, b.user_id, b.room_id, b.name
     FROM bots b
     JOIN users u ON b.user_id = u.id
     WHERE u.username LIKE 'sim_owner_%'
     ORDER BY b.id`
  );

  if (bots.length === 0) return [];

  // Load agent state data
  const states = await query<AgentStateRow>(
    `SELECT * FROM simulation_agent_state WHERE agent_id IN (${bots.map(() => '?').join(',')})`,
    bots.map(b => b.id)
  );
  const stateMap = new Map(states.map(s => [s.agent_id, s]));

  // Load owner credits (used as proxy for agent credits)
  const ownerIds = [...new Set(bots.map(b => b.user_id))];
  const users = await query<UserCreditsRow>(
    `SELECT id, credits FROM users WHERE id IN (${ownerIds.map(() => '?').join(',')})`,
    ownerIds
  );
  const creditMap = new Map(users.map(u => [u.id, u.credits]));

  return bots.map(bot => {
    const state = stateMap.get(bot.id);
    const defaultPersonality: PersonalityTraits = {
      sociability: 0.5, ambition: 0.5, curiosity: 0.5, friendliness: 0.5, impulsiveness: 0.5,
    };
    const defaultPreferences: AgentPreferences = {
      preferredRoomTypes: ['hangout'],
      socialCircleSize: 5,
      wealthGoal: 3000,
    };

    return {
      id: bot.id,
      userId: bot.user_id,
      name: bot.name,
      personality: safeParse(state?.personality, defaultPersonality),
      preferences: safeParse(state?.preferences, defaultPreferences),
      goals: safeParse(state?.goals, []),
      currentRoomId: bot.room_id || null,
      credits: creditMap.get(bot.user_id) || 0,
      state: (state?.state as Agent['state']) || 'idle',
      ticksSinceLastAction: 0,
      ticksInCurrentRoom: state?.ticks_in_room || 0,
      ticksWorking: state?.ticks_working || 0,
    };
  });
}
