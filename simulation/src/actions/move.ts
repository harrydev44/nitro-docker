import { CONFIG } from '../config.js';
import { getCachedFriends, getCachedEnemies } from '../world/state-cache.js';
import { queueBotMove } from '../world/batch-writer.js';
import { getRandomFreeTile } from '../world/room-models.js';
import type { Agent, WorldState, SimRoom } from '../types.js';

export async function moveAgent(agent: Agent, world: WorldState): Promise<void> {
  if (agent.currentRoomId && Math.random() < CONFIG.ROOM_INERTIA_PROBABILITY) return;

  const targetRoom = chooseRoom(agent, world);
  if (!targetRoom || targetRoom.id === agent.currentRoomId) return;
  if (targetRoom.currentPopulation >= targetRoom.usersMax) return;

  const { x, y } = getRandomFreeTile(targetRoom.model, targetRoom.id);

  queueBotMove(agent.id, targetRoom.id, x, y);

  // Update in-memory state for this tick
  if (agent.currentRoomId) {
    const oldRoom = world.rooms.find(r => r.id === agent.currentRoomId);
    if (oldRoom) oldRoom.currentPopulation--;
  }
  targetRoom.currentPopulation++;
  agent.currentRoomId = targetRoom.id;
  agent.ticksInCurrentRoom = 0;
  agent.state = 'idle';
}

function chooseRoom(agent: Agent, world: WorldState): SimRoom | null {
  const rooms = world.rooms.filter(r => r.id !== agent.currentRoomId && r.currentPopulation < r.usersMax);
  if (rooms.length === 0) return null;

  const friends = getCachedFriends(agent.id);
  const enemies = getCachedEnemies(agent.id);

  const scored = rooms.map(room => {
    let score = 0;

    if (agent.preferences.preferredRoomTypes.includes(room.purpose)) {
      score += CONFIG.ROOM_PURPOSE_WEIGHT;
    }

    const friendsInRoom = world.agents.filter(
      a => a.currentRoomId === room.id && friends.includes(a.id)
    ).length;
    score += Math.min(friendsInRoom / 5, 1) * CONFIG.FRIEND_PRESENCE_WEIGHT;

    const popFactor = Math.min(room.currentPopulation / 10, 1);
    score += popFactor * agent.personality.curiosity * CONFIG.CURIOSITY_WEIGHT;

    const enemiesInRoom = world.agents.filter(
      a => a.currentRoomId === room.id && enemies.includes(a.id)
    ).length;
    score -= enemiesInRoom * CONFIG.AVOID_WEIGHT;

    score += Math.random() * 0.1;
    return { room, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(5, scored.length));
  const totalScore = top.reduce((sum, s) => sum + Math.max(0, s.score), 0);
  if (totalScore === 0) return top[0]?.room || null;

  let roll = Math.random() * totalScore;
  for (const s of top) {
    roll -= Math.max(0, s.score);
    if (roll <= 0) return s.room;
  }
  return top[0].room;
}
