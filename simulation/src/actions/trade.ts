import { execute, query } from '../db.js';
import { CONFIG } from '../config.js';
import { getCachedRelationship } from '../world/state-cache.js';
import { queueBotChat, queueCreditChange, queueRelationshipChange, queueMemory } from '../world/batch-writer.js';
import { completeGoal } from '../engine/goals.js';
import { getTradeAnnouncement, getTradeBuyerAnnouncement } from '../chat/announcements.js';
import { getItemName } from '../world/item-catalog.js';
import { pickBubbleForContext } from '../chat/bubble-styles.js';
import { shouldGesture, pickGesture } from '../chat/gesture-triggers.js';
import { rconBotAction } from '../emulator/rcon.js';
import type { Agent, WorldState, ChatMessage } from '../types.js';

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

  // Pick a trade partner (prefer friends) — uses cached relationships
  const partner = pickTradePartner(agent, roommates);
  if (!partner) return;

  // Get items owned by each agent (need actual item IDs, must query DB)
  const agentItems = await query<ItemRow>(
    `SELECT id, item_id, user_id FROM items WHERE user_id = ? AND room_id = 0 LIMIT 10`,
    [agent.userId]
  );
  const partnerItems = await query<ItemRow>(
    `SELECT id, item_id, user_id FROM items WHERE user_id = ? AND room_id = 0 LIMIT 10`,
    [partner.userId]
  );

  // Skip trade if nothing to trade
  if (agentItems.length === 0 && partnerItems.length === 0) return;

  // Determine trade: agent offers an item, wants credits or vice versa
  const relationship = getCachedRelationship(agent.id, partner.id);
  const trustBonus = relationship ? Math.max(0, relationship.score / 100) * 0.2 : 0;

  // Acceptance probability
  const acceptProbability = CONFIG.TRADE_ACCEPT_BASE_PROBABILITY + trustBonus;
  const roll = Math.random();

  if (roll < acceptProbability && agentItems.length > 0) {
    // Trade: agent gives item, gets credits
    const offeredItem = agentItems[Math.floor(Math.random() * agentItems.length)];
    const price = 50 + Math.floor(Math.random() * 200);

    if (partner.credits >= price) {
      // Transfer item (direct DB — needs atomicity)
      await execute(`UPDATE items SET user_id = ? WHERE id = ?`, [partner.userId, offeredItem.id]);

      // Update market price (direct DB — needs insertId/upsert)
      await execute(
        `INSERT INTO simulation_market_prices (item_base_id, avg_price, last_trade_price, trade_count)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           avg_price = (avg_price * trade_count + ?) / (trade_count + 1),
           last_trade_price = ?,
           trade_count = trade_count + 1`,
        [offeredItem.item_id, price, price, price, price]
      );

      // Batch: credit changes
      queueCreditChange(agent.userId, price);
      queueCreditChange(partner.userId, -price);
      agent.credits += price;
      partner.credits -= price;

      // Batch: relationships
      queueRelationshipChange(agent.id, partner.id, CONFIG.RELATIONSHIP_TRADE_COMPLETE);
      queueRelationshipChange(partner.id, agent.id, CONFIG.RELATIONSHIP_TRADE_COMPLETE);

      // Batch: memory
      queueMemory({
        agentId: agent.id, targetAgentId: partner.id,
        eventType: 'trade', sentiment: 0.5,
        summary: `Sold item to ${partner.name} for ${price}cr`, roomId: agent.currentRoomId,
      });
      queueMemory({
        agentId: partner.id, targetAgentId: agent.id,
        eventType: 'trade', sentiment: 0.5,
        summary: `Bought item from ${agent.name} for ${price}cr`, roomId: agent.currentRoomId,
      });

      completeGoal(agent, 'trade');

      // Thumb-up gesture for both traders
      if (CONFIG.GESTURE_ENABLED) {
        if (shouldGesture('trade_complete')) {
          const g = pickGesture('trade_complete');
          if (g) rconBotAction(agent.id, g).catch(() => {});
        }
        if (shouldGesture('trade_complete')) {
          const g = pickGesture('trade_complete');
          if (g) rconBotAction(partner.id, g).catch(() => {});
        }
      }

      // Announcement-style trade chat with item names and personality flavor
      const itemName = getItemName(offeredItem.item_id);
      const tradeBubble = CONFIG.STYLED_BUBBLES_ENABLED ? pickBubbleForContext('trade') : -1;
      if (Math.random() < CONFIG.ANNOUNCEMENT_PROBABILITY) {
        const sellerMsg = getTradeAnnouncement(agent, partner.name, itemName, price);
        queueBotChat(agent.id, sellerMsg, CONFIG.MIN_CHAT_DELAY, tradeBubble);

        // Track as announcement in room chat history
        if (agent.currentRoomId) {
          const chatMsg: ChatMessage = { agentId: agent.id, agentName: agent.name, message: sellerMsg, tick: world.tick, isAnnouncement: true };
          if (!world.roomChatHistory.has(agent.currentRoomId)) world.roomChatHistory.set(agent.currentRoomId, []);
          world.roomChatHistory.get(agent.currentRoomId)!.push(chatMsg);
        }
      }

      if (Math.random() < CONFIG.ANNOUNCEMENT_PROBABILITY) {
        const buyerMsg = getTradeBuyerAnnouncement(partner, agent.name, itemName, price);
        queueBotChat(partner.id, buyerMsg, CONFIG.MIN_CHAT_DELAY + 2, tradeBubble);

        if (agent.currentRoomId) {
          const chatMsg: ChatMessage = { agentId: partner.id, agentName: partner.name, message: buyerMsg, tick: world.tick, isAnnouncement: true };
          if (!world.roomChatHistory.has(agent.currentRoomId)) world.roomChatHistory.set(agent.currentRoomId, []);
          world.roomChatHistory.get(agent.currentRoomId)!.push(chatMsg);
        }
      }
    }
  }

  agent.state = 'trading';
}

function pickTradePartner(agent: Agent, candidates: Agent[]): Agent | null {
  // Score candidates using cached relationships
  const scored = candidates.map(candidate => {
    const rel = getCachedRelationship(agent.id, candidate.id);
    const score = (rel ? rel.score / 100 : 0) + Math.random() * 0.5;
    return { agent: candidate, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.agent || null;
}
