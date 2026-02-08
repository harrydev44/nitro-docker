import { CONFIG } from '../config.js';
import type { Agent, Goal, GoalType, WorldState } from '../types.js';

export function pruneExpiredGoals(agent: Agent, currentTick: number): void {
  agent.goals = agent.goals.filter(g => g.expiresAtTick > currentTick);
}

export function generateGoals(agent: Agent, world: WorldState): void {
  const possibleGoals: GoalType[] = ['socialize', 'earn', 'explore', 'trade', 'work', 'decorate'];

  // Weight by personality
  const weights: Record<GoalType, number> = {
    socialize: agent.personality.sociability,
    earn: agent.personality.ambition,
    explore: agent.personality.curiosity,
    trade: agent.personality.ambition * 0.8,
    work: agent.personality.ambition * 0.6,
    decorate: (1 - agent.personality.ambition) * 0.3 + 0.1,
  };

  // Don't duplicate existing goal types
  const existingTypes = new Set(agent.goals.map(g => g.type));
  const available = possibleGoals.filter(g => !existingTypes.has(g));
  if (available.length === 0) return;

  // Weighted random selection
  const totalWeight = available.reduce((sum, g) => sum + weights[g], 0);
  let roll = Math.random() * totalWeight;
  let chosen: GoalType = available[0];
  for (const g of available) {
    roll -= weights[g];
    if (roll <= 0) { chosen = g; break; }
  }

  const goal: Goal = {
    type: chosen,
    priority: 0.3 + Math.random() * 0.7,
    createdAtTick: world.tick,
    expiresAtTick: world.tick + CONFIG.GOAL_EXPIRY_TICKS,
  };

  // Add target for some goals
  if (chosen === 'explore') {
    const unvisitedRooms = world.rooms.filter(r => r.id !== agent.currentRoomId);
    if (unvisitedRooms.length > 0) {
      goal.targetId = unvisitedRooms[Math.floor(Math.random() * unvisitedRooms.length)].id;
    }
  }

  agent.goals.push(goal);
}

export function completeGoal(agent: Agent, goalType: GoalType): void {
  const idx = agent.goals.findIndex(g => g.type === goalType);
  if (idx >= 0) {
    agent.goals.splice(idx, 1);
  }
}
