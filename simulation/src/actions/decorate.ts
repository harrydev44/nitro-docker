import { execute } from '../db.js';
import { CONFIG } from '../config.js';
import { getCachedRoomItemCount } from '../world/state-cache.js';
import { queueBotChat, queueCreditChange } from '../world/batch-writer.js';
import { completeGoal } from '../engine/goals.js';
import type { Agent, WorldState } from '../types.js';

// Common furniture item_ids from Habbo catalog (base items)
const FURNITURE_CATALOG = [
  { itemId: 1, name: 'chair', cost: 25 },
  { itemId: 2, name: 'table', cost: 30 },
  { itemId: 3, name: 'lamp', cost: 20 },
  { itemId: 4, name: 'sofa', cost: 50 },
  { itemId: 5, name: 'rug', cost: 15 },
  { itemId: 6, name: 'plant', cost: 10 },
  { itemId: 7, name: 'poster', cost: 5 },
  { itemId: 8, name: 'shelf', cost: 35 },
  { itemId: 9, name: 'tv', cost: 100 },
  { itemId: 10, name: 'jukebox', cost: 75 },
];

export async function agentDecorate(agent: Agent, world: WorldState): Promise<void> {
  // Find a room this agent owns
  const ownedRooms = world.rooms.filter(r => r.ownerId === agent.userId);
  if (ownedRooms.length === 0) return;

  const room = ownedRooms[Math.floor(Math.random() * ownedRooms.length)];

  // Use cached item count instead of DB query
  const itemCount = getCachedRoomItemCount(room.id);

  // Don't over-furnish
  if (itemCount >= 30) {
    completeGoal(agent, 'decorate');
    return;
  }

  // Pick a random furniture item
  const affordableItems = FURNITURE_CATALOG.filter(f => f.cost <= agent.credits);
  if (affordableItems.length === 0) return;

  const item = affordableItems[Math.floor(Math.random() * affordableItems.length)];

  // Batch: deduct credits
  queueCreditChange(agent.userId, -item.cost);
  agent.credits -= item.cost;

  // Place item in room at random position (direct DB — needs INSERT)
  const x = Math.floor(Math.random() * 8) + 1;
  const y = Math.floor(Math.random() * 8) + 1;

  await execute(
    `INSERT INTO items (user_id, room_id, item_id, x, y, z, rot, extra_data)
     VALUES (?, ?, ?, ?, ?, 0, 0, '0')`,
    [agent.userId, room.id, item.itemId, x, y]
  );

  // Batch: chat about decorating
  if (Math.random() < 0.3) {
    queueBotChat(agent.id, `Just added a new ${item.name} to my room!`, CONFIG.MIN_CHAT_DELAY);
  }

  agent.state = 'decorating';

  // Complete decorate goal if room has enough items
  if (itemCount + 1 >= 10) {
    completeGoal(agent, 'decorate');
  }
}
