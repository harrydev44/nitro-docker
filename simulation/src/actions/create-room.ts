import { execute, query } from '../db.js';
import { CONFIG } from '../config.js';
import { queueBotChat, queueCreditChange } from '../world/batch-writer.js';
import { completeGoal } from '../engine/goals.js';
import type { Agent, WorldState, RoomPurpose } from '../types.js';

const ROOM_NAME_PREFIXES = [
  'Cool', 'Epic', 'Chill', 'Funky', 'The', 'Club', 'Pixel', 'Retro',
  'Neon', 'Cozy', 'Grand', 'Royal', 'Secret', 'Lucky', 'Golden',
];

const ROOM_NAME_SUFFIXES: Record<RoomPurpose, string[]> = {
  hangout: ['Lounge', 'Hangout', 'Den', 'Pad', 'Zone', 'Hub', 'Spot'],
  trade: ['Market', 'Exchange', 'Bazaar', 'Shop', 'Trading Post'],
  work: ['Office', 'Workshop', 'Studio', 'Lab', 'HQ'],
  game: ['Arcade', 'Arena', 'Stadium', 'Playroom', 'Funhouse'],
  service: ['Cafe', 'Bar', 'Diner', 'Spa', 'Salon'],
  empty: ['Room', 'Space', 'Place'],
  vip: ['VIP Lounge', 'Elite Club', 'Penthouse', 'Suite'],
};

const MODELS = ['model_a', 'model_b', 'model_c', 'model_d', 'model_e', 'model_f'];

export async function agentCreateRoom(agent: Agent, world: WorldState): Promise<void> {
  if (agent.credits < CONFIG.ROOM_CREATION_COST) return;

  // Check room limit
  const ownedCount = world.rooms.filter(r => r.ownerId === agent.userId).length;
  if (ownedCount >= CONFIG.MAX_ROOMS_PER_AGENT) return;

  // Decide what kind of room to create based on what's underserved
  const purposeCounts: Record<RoomPurpose, number> = {
    hangout: 0, trade: 0, work: 0, game: 0, service: 0, empty: 0, vip: 0,
  };
  for (const room of world.rooms) {
    purposeCounts[room.purpose]++;
  }

  // Pick the least represented purpose (with some randomness)
  const purposes: RoomPurpose[] = ['hangout', 'trade', 'work', 'game', 'service'];
  purposes.sort((a, b) => purposeCounts[a] - purposeCounts[b]);
  const chosenPurpose = purposes[Math.floor(Math.random() * Math.min(3, purposes.length))];

  // Generate room name
  const prefix = ROOM_NAME_PREFIXES[Math.floor(Math.random() * ROOM_NAME_PREFIXES.length)];
  const suffixes = ROOM_NAME_SUFFIXES[chosenPurpose];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  const roomName = `${prefix} ${suffix}`.substring(0, 50);

  const model = MODELS[Math.floor(Math.random() * MODELS.length)];

  // Get the owner username
  const ownerRows = await query<{ username: string }>(
    `SELECT username FROM users WHERE id = ?`, [agent.userId]
  );
  const ownerName = ownerRows[0]?.username || 'sim_owner';

  // Create room (direct DB — needs insertId)
  const tradeMode = chosenPurpose === 'trade' ? 2 : 0;
  const result = await execute(
    `INSERT INTO rooms (owner_id, owner_name, name, description, model, state, users_max, trade_mode, category)
     VALUES (?, ?, ?, ?, ?, 'open', 25, ?, 1)`,
    [agent.userId, ownerName, roomName, `A ${chosenPurpose} room created by ${agent.name}`, model, tradeMode]
  );

  // Register in simulation stats (direct DB — needs insertId from above)
  await execute(
    `INSERT INTO simulation_room_stats (room_id, purpose) VALUES (?, ?)`,
    [result.insertId, chosenPurpose]
  );

  // Batch: deduct cost
  queueCreditChange(agent.userId, -CONFIG.ROOM_CREATION_COST);
  agent.credits -= CONFIG.ROOM_CREATION_COST;

  completeGoal(agent, 'decorate');

  // Batch: chat about new room
  queueBotChat(agent.id, `Just created my new ${chosenPurpose} room: ${roomName}!`, CONFIG.MIN_CHAT_DELAY);

  console.log(`[ROOM] Agent ${agent.name} created room "${roomName}" (${chosenPurpose})`);
}
