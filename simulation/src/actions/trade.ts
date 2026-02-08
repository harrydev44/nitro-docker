import { execute, query } from '../db.js';
import { CONFIG } from '../config.js';
import { getRelationship, adjustRelationship } from '../agents/relationships.js';
import { addMemory } from '../agents/memory.js';
import { completeGoal } from '../engine/goals.js';
import type { Agent, WorldState } from '../types.js';

interface ItemRow {
  id: number;
  item_id: number;
  user_id: number;
}

export async function agentTrade(agent: Agent, world: WorldState): Promise<void> {
  if (!agent.currentRoomId) return;

  const roommates = world.agents.filter(
    a => a.id !== agent.id && a.currentRoomId === agent.currentRoomId
  );
  if (roommates.length === 0) return;

  // Pick a trade partner (prefer friends)
  const partner = await pickTradePartner(agent, roommates);
  if (!partner) return;

  // Get items owned by each agent
  const agentItems = await query<ItemRow>(
    `SELECT id, item_id, user_id FROM items WHERE user_id = ? AND room_id = 0 LIMIT 10`,
    [agent.userId]
  );
  const partnerItems = await query<ItemRow>(
    `SELECT id, item_id, user_id FROM items WHERE user_id = ? AND room_id = 0 LIMIT 10`,
    [partner.userId]
  );

  // Simple credit trade if no items
  if (agentItems.length === 0 && partnerItems.length === 0) {
    // Skip trade - nothing to trade
    return;
  }

  // Determine trade: agent offers an item, wants credits or vice versa
  const relationship = await getRelationship(agent.id, partner.id);
  const trustBonus = relationship ? Math.max(0, relationship.score / 100) * 0.2 : 0;

  // Acceptance probability
  const acceptProbability = CONFIG.TRADE_ACCEPT_BASE_PROBABILITY + trustBonus;
  const roll = Math.random();

  if (roll < acceptProbability && agentItems.length > 0) {
    // Trade: agent gives item, gets credits
    const offeredItem = agentItems[Math.floor(Math.random() * agentItems.length)];
    const price = 50 + Math.floor(Math.random() * 200);

    if (partner.credits >= price) {
      // Transfer item
      await execute(`UPDATE items SET user_id = ? WHERE id = ?`, [partner.userId, offeredItem.id]);

      // Transfer credits
      await execute(`UPDATE users SET credits = credits + ? WHERE id = ?`, [price, agent.userId]);
      await execute(`UPDATE users SET credits = credits - ? WHERE id = ?`, [price, partner.userId]);
      agent.credits += price;
      partner.credits -= price;

      // Update market price
      await execute(
        `INSERT INTO simulation_market_prices (item_base_id, avg_price, last_trade_price, trade_count)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           avg_price = (avg_price * trade_count + ?) / (trade_count + 1),
           last_trade_price = ?,
           trade_count = trade_count + 1`,
        [offeredItem.item_id, price, price, price, price]
      );

      // Relationships
      await adjustRelationship(agent.id, partner.id, CONFIG.RELATIONSHIP_TRADE_COMPLETE);
      await adjustRelationship(partner.id, agent.id, CONFIG.RELATIONSHIP_TRADE_COMPLETE);

      // Memory
      await addMemory(agent.id, partner.id, 'trade', 0.5, `Sold item to ${partner.name} for ${price}cr`, agent.currentRoomId);
      await addMemory(partner.id, agent.id, 'trade', 0.5, `Bought item from ${agent.name} for ${price}cr`, agent.currentRoomId);

      completeGoal(agent, 'trade');

      // Trade chat
      const room = world.rooms.find(r => r.id === agent.currentRoomId);
      const tradeMsg = `Thanks for the trade ${partner.name}!`;
      await execute(
        `UPDATE bots SET chat_lines = ?, chat_auto = '1', chat_delay = ? WHERE id = ?`,
        [tradeMsg, CONFIG.MIN_CHAT_DELAY, agent.id]
      );
    }
  }

  agent.state = 'trading';
}

async function pickTradePartner(agent: Agent, candidates: Agent[]): Promise<Agent | null> {
  // Score candidates: friends preferred
  const scored = [];
  for (const candidate of candidates) {
    const rel = await getRelationship(agent.id, candidate.id);
    const score = (rel ? rel.score / 100 : 0) + Math.random() * 0.5;
    scored.push({ agent: candidate, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.agent || null;
}
