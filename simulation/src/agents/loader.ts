import { query } from '../db.js';
import type { Agent, PersonalityTraits, AgentPreferences, Goal } from '../types.js';

interface BotRow {
  id: number;
  user_id: number;
  room_id: number;
  name: string;
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
      personality: state ? JSON.parse(state.personality) : defaultPersonality,
      preferences: state ? JSON.parse(state.preferences) : defaultPreferences,
      goals: state ? JSON.parse(state.goals) : [],
      currentRoomId: bot.room_id || null,
      credits: creditMap.get(bot.user_id) || 0,
      state: (state?.state as Agent['state']) || 'idle',
      ticksSinceLastAction: 0,
      ticksInCurrentRoom: state?.ticks_in_room || 0,
      ticksWorking: state?.ticks_working || 0,
    };
  });
}
