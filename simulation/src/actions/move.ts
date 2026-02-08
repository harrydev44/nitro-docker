import { execute } from '../db.js';
import { CONFIG } from '../config.js';
import { getFriends, getEnemies } from '../agents/relationships.js';
import type { Agent, WorldState, SimRoom } from '../types.js';

export async function moveAgent(agent: Agent, world: WorldState): Promise<void> {
  // Inertia: chance to stay in current room
  if (agent.currentRoomId && Math.random() < CONFIG.ROOM_INERTIA_PROBABILITY) {
    return;
  }

  const targetRoom = await chooseRoom(agent, world);
  if (!targetRoom || targetRoom.id === agent.currentRoomId) return;

  // Don't enter full rooms
  if (targetRoom.currentPopulation >= targetRoom.usersMax) return;

  // Pick a random walkable position (simple: within model bounds)
  const { x, y } = getRandomPosition(targetRoom.model);

  // Update bot position in DB
  await execute(
    `UPDATE bots SET room_id = ?, x = ?, y = ?, chat_lines = '' WHERE id = ?`,
    [targetRoom.id, x, y, agent.id]
  );

  agent.currentRoomId = targetRoom.id;
  agent.ticksInCurrentRoom = 0;
  agent.state = 'idle';
}

async function chooseRoom(agent: Agent, world: WorldState): Promise<SimRoom | null> {
  const rooms = world.rooms.filter(r => r.id !== agent.currentRoomId && r.currentPopulation < r.usersMax);
  if (rooms.length === 0) return null;

  const friends = await getFriends(agent.id);
  const enemies = await getEnemies(agent.id);

  const scored = rooms.map(room => {
    let score = 0;

    // Room purpose match (40%)
    if (agent.preferences.preferredRoomTypes.includes(room.purpose)) {
      score += CONFIG.ROOM_PURPOSE_WEIGHT;
    }

    // Friends present (30%)
    const friendsInRoom = world.agents.filter(
      a => a.currentRoomId === room.id && friends.includes(a.id)
    ).length;
    score += Math.min(friendsInRoom / 5, 1) * CONFIG.FRIEND_PRESENCE_WEIGHT;

    // Curiosity / popularity (20%)
    const popFactor = Math.min(room.currentPopulation / 10, 1);
    score += popFactor * agent.personality.curiosity * CONFIG.CURIOSITY_WEIGHT;

    // Avoid enemies (10%)
    const enemiesInRoom = world.agents.filter(
      a => a.currentRoomId === room.id && enemies.includes(a.id)
    ).length;
    score -= enemiesInRoom * CONFIG.AVOID_WEIGHT;

    // Small random factor
    score += Math.random() * 0.1;

    return { room, score };
  });

  // Weighted random selection from top choices
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

// Simple position generation based on room model
const MODEL_SIZES: Record<string, { maxX: number; maxY: number }> = {
  model_a: { maxX: 10, maxY: 10 },
  model_b: { maxX: 10, maxY: 10 },
  model_c: { maxX: 12, maxY: 12 },
  model_d: { maxX: 12, maxY: 12 },
  model_e: { maxX: 14, maxY: 14 },
  model_f: { maxX: 14, maxY: 14 },
};

function getRandomPosition(model: string): { x: number; y: number } {
  const size = MODEL_SIZES[model] || { maxX: 8, maxY: 8 };
  return {
    x: 1 + Math.floor(Math.random() * (size.maxX - 1)),
    y: 1 + Math.floor(Math.random() * (size.maxY - 1)),
  };
}
