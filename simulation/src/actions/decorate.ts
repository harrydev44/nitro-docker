import { execute, query } from '../db.js';
import { CONFIG } from '../config.js';
import { getCachedRoomItemCount } from '../world/state-cache.js';
import { queueBotChat, queueCreditChange } from '../world/batch-writer.js';
import { completeGoal } from '../engine/goals.js';
import { getRandomFurniTile } from '../world/room-models.js';
import type { Agent, WorldState } from '../types.js';

// Real furniture from items_base (type='s' floor items)
const FURNITURE_CATALOG = [
  { itemId: 18, name: 'chair', cost: 25 },       // chair_polyfon
  { itemId: 30, name: 'chair', cost: 25 },        // chair_norja
  { itemId: 39, name: 'chair', cost: 20 },        // chair_plasto
  { itemId: 17, name: 'table', cost: 30 },        // table_polyfon_small
  { itemId: 22, name: 'table', cost: 30 },        // table_plasto_4leg
  { itemId: 40, name: 'table', cost: 20 },        // table_plasto_square
  { itemId: 199, name: 'lamp', cost: 20 },        // lamp_basic
  { itemId: 57, name: 'lamp', cost: 25 },         // lamp_armas
  { itemId: 35, name: 'sofa', cost: 50 },         // sofa_polyfon
  { itemId: 28, name: 'sofa', cost: 50 },         // sofa_silo
  { itemId: 29, name: 'couch', cost: 45 },        // couch_norja
  { itemId: 41, name: 'bed', cost: 45 },          // bed_polyfon
  { itemId: 128, name: 'plant', cost: 10 },       // plant_cruddy
  { itemId: 163, name: 'bonsai', cost: 15 },      // plant_bonsai
  { itemId: 165, name: 'yukka', cost: 15 },       // plant_yukka
  { itemId: 13, name: 'shelf', cost: 35 },        // shelves_norja
  { itemId: 14, name: 'shelf', cost: 40 },        // shelves_polyfon
  { itemId: 144, name: 'TV', cost: 75 },          // red_tv
  { itemId: 173, name: 'luxury TV', cost: 100 },  // tv_luxus
  { itemId: 56, name: 'fireplace', cost: 80 },    // fireplace_armas
];

export async function agentDecorate(agent: Agent, world: WorldState): Promise<void> {
  // Must be in own room (decision engine enforces this, but double-check)
  const room = world.rooms.find(r => r.id === agent.currentRoomId && r.ownerId === agent.userId);
  if (!room) return;

  const itemCount = getCachedRoomItemCount(room.id);

  // Don't over-furnish (reduced from 30 to 15 for smaller rooms)
  if (itemCount >= 15) {
    completeGoal(agent, 'decorate');
    return;
  }

  // Try to place an item from inventory first
  const invItems = await query<{ id: number; item_id: number }>(
    `SELECT id, item_id FROM items WHERE user_id = ? AND room_id = 0 LIMIT 5`,
    [agent.userId]
  );

  if (invItems.length > 0) {
    const item = invItems[Math.floor(Math.random() * invItems.length)];
    const pos = getRandomFurniTile(room.model, room.id, item.item_id);
    if (!pos) return; // no space

    await execute(
      `UPDATE items SET room_id = ?, x = ?, y = ?, z = 0, rot = ? WHERE id = ?`,
      [room.id, pos.x, pos.y, pos.rot || 0, item.id]
    );

    if (Math.random() < 0.3) {
      queueBotChat(agent.id, `Placed some new furniture in my room!`, CONFIG.MIN_CHAT_DELAY);
    }
  } else {
    // No inventory — buy from catalog and place directly
    const affordableItems = FURNITURE_CATALOG.filter(f => f.cost <= agent.credits);
    if (affordableItems.length === 0) return;

    const item = affordableItems[Math.floor(Math.random() * affordableItems.length)];
    const pos = getRandomFurniTile(room.model, room.id, item.itemId);
    if (!pos) return; // no space

    queueCreditChange(agent.userId, -item.cost);
    agent.credits -= item.cost;

    await execute(
      `INSERT INTO items (user_id, room_id, item_id, x, y, z, rot, extra_data)
       VALUES (?, ?, ?, ?, ?, 0, ?, '0')`,
      [agent.userId, room.id, item.itemId, pos.x, pos.y, pos.rot || 0]
    );

    if (Math.random() < 0.3) {
      queueBotChat(agent.id, `Just added a new ${item.name} to my room!`, CONFIG.MIN_CHAT_DELAY);
    }
  }

  agent.state = 'decorating';

  if (itemCount + 1 >= 10) {
    completeGoal(agent, 'decorate');
  }
}
