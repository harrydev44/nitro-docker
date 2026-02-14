import { execute, query } from '../db.js';
import { CONFIG } from '../config.js';
import { getCachedRoomItemCount } from '../world/state-cache.js';
import { queueBotChat, queueCreditChange } from '../world/batch-writer.js';
import { completeGoal } from '../engine/goals.js';
import { getSmartFurniTile, pickNeededItem } from '../world/furniture-layout.js';
import { getDecorateAnnouncement } from '../chat/announcements.js';
import { getItemName } from '../world/item-catalog.js';
import type { Agent, WorldState, ChatMessage } from '../types.js';
import type { PlacedItem } from '../world/furniture-layout.js';

// Item category mapping (mirrors furniture-layout.ts)
const ITEM_CATEGORIES: Record<number, PlacedItem['category']> = {
  56: 'wall_hugger', 13: 'wall_hugger', 14: 'wall_hugger',
  144: 'wall_hugger', 173: 'wall_hugger',
  41: 'bed',
  35: 'seating', 28: 'seating', 29: 'seating',
  18: 'seating', 30: 'seating', 39: 'seating',
  17: 'table', 22: 'table', 40: 'table',
  128: 'accent', 163: 'accent', 165: 'accent',
  199: 'accent', 57: 'accent',
};

export async function agentDecorate(agent: Agent, world: WorldState): Promise<void> {
  // Must be in own room (decision engine enforces this, but double-check)
  const room = world.rooms.find(r => r.id === agent.currentRoomId && r.ownerId === agent.userId);
  if (!room) return;

  const itemCount = getCachedRoomItemCount(room.id);

  // Don't over-furnish
  if (itemCount >= 15) {
    completeGoal(agent, 'decorate');
    return;
  }

  // Load existing items in the room to inform smart placement
  const existingRows = await query<{ item_id: number; x: number; y: number; rot: number }>(
    `SELECT item_id, x, y, rot FROM items WHERE room_id = ?`,
    [room.id]
  );
  const existingItems: PlacedItem[] = existingRows.map(r => ({
    itemId: r.item_id, x: r.x, y: r.y, rot: r.rot,
    category: ITEM_CATEGORIES[r.item_id] || 'accent',
  }));

  // Place multiple items when room is bare (up to 3 at once for empty rooms)
  const itemsToPlace = itemCount < 3 ? 3 : itemCount < 8 ? 2 : 1;
  let placed = 0;

  for (let i = 0; i < itemsToPlace && (itemCount + placed) < 15; i++) {
    // Try inventory first
    const invItems = await query<{ id: number; item_id: number }>(
      `SELECT id, item_id FROM items WHERE user_id = ? AND room_id = 0 LIMIT 5`,
      [agent.userId]
    );

    if (invItems.length > 0) {
      const item = invItems[Math.floor(Math.random() * invItems.length)];
      const pos = getSmartFurniTile(room.model, room.id, item.item_id, room.purpose);
      if (!pos) break; // no more space

      await execute(
        `UPDATE items SET room_id = ?, x = ?, y = ?, z = 0, rot = ? WHERE id = ?`,
        [room.id, pos.x, pos.y, pos.rot, item.id]
      );
      existingItems.push({
        itemId: item.item_id, x: pos.x, y: pos.y, rot: pos.rot,
        category: ITEM_CATEGORIES[item.item_id] || 'accent',
      });
      placed++;
    } else {
      // No inventory — buy from catalog using smart selection
      const neededItem = pickNeededItem(room.purpose, existingItems, agent.credits);
      if (!neededItem) break;

      const pos = getSmartFurniTile(room.model, room.id, neededItem.itemId, room.purpose);
      if (!pos) break; // no more space

      queueCreditChange(agent.userId, -neededItem.cost);
      agent.credits -= neededItem.cost;

      await execute(
        `INSERT INTO items (user_id, room_id, item_id, x, y, z, rot, extra_data)
         VALUES (?, ?, ?, ?, ?, 0, ?, '0')`,
        [agent.userId, room.id, neededItem.itemId, pos.x, pos.y, pos.rot]
      );
      existingItems.push({
        itemId: neededItem.itemId, x: pos.x, y: pos.y, rot: pos.rot,
        category: neededItem.category,
      });
      placed++;
    }
  }

  if (placed > 0) {
    // Announce last placed item (one announcement per decorate action)
    if (Math.random() < CONFIG.ANNOUNCEMENT_PROBABILITY) {
      const msg = placed > 1
        ? getDecorateAnnouncement(agent, `${placed} items`, itemCount + placed)
        : getDecorateAnnouncement(agent, 'new furniture', itemCount + placed);
      queueBotChat(agent.id, msg, CONFIG.MIN_CHAT_DELAY);

      if (agent.currentRoomId) {
        const chatMsg: ChatMessage = { agentId: agent.id, agentName: agent.name, message: msg, tick: world.tick, isAnnouncement: true };
        if (!world.roomChatHistory.has(agent.currentRoomId)) world.roomChatHistory.set(agent.currentRoomId, []);
        world.roomChatHistory.get(agent.currentRoomId)!.push(chatMsg);
      }
    }
  }

  agent.state = 'decorating';

  if (itemCount + placed >= 10) {
    completeGoal(agent, 'decorate');
  }
}
