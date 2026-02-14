import { execute } from '../db.js';
import { CONFIG } from '../config.js';
import { getCachedInventoryCount } from '../world/state-cache.js';
import { queueBotChat, queueCreditChange } from '../world/batch-writer.js';
import { completeGoal } from '../engine/goals.js';
import type { Agent, WorldState } from '../types.js';

// Real furniture from items_base (type='s' floor items)
export const FURNITURE_CATALOG = [
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
  { itemId: 41, name: 'bed', cost: 45 },            // bed_polyfon
  { itemId: 128, name: 'plant', cost: 10 },       // plant_cruddy
  { itemId: 163, name: 'bonsai', cost: 15 },      // plant_bonsai
  { itemId: 165, name: 'yukka', cost: 15 },       // plant_yukka
  { itemId: 13, name: 'shelf', cost: 35 },        // shelves_norja
  { itemId: 14, name: 'shelf', cost: 40 },        // shelves_polyfon
  { itemId: 144, name: 'TV', cost: 75 },          // red_tv
  { itemId: 173, name: 'luxury TV', cost: 100 },  // tv_luxus
  { itemId: 56, name: 'fireplace', cost: 80 },    // fireplace_armas
];

const RARE_CATALOG = [
  { itemId: 173, name: 'luxury TV', cost: 150 },       // tv_luxus
  { itemId: 56, name: 'fireplace', cost: 200 },        // fireplace_armas
  { itemId: 41, name: 'double bed', cost: 300 },       // bed_polyfon
  { itemId: 1619, name: 'dragon lamp', cost: 500 },    // rare_dragonlamp
];

export async function agentBuy(agent: Agent, world: WorldState): Promise<void> {
  // Check inventory cap
  const invCount = getCachedInventoryCount(agent.userId);
  if (invCount >= CONFIG.MAX_INVENTORY_ITEMS) return;

  // Combine catalogs — rares only if agent is ambitious enough
  const catalog = agent.personality.ambition > 0.6
    ? [...FURNITURE_CATALOG, ...RARE_CATALOG]
    : FURNITURE_CATALOG;

  // Filter to what agent can afford
  const affordable = catalog.filter(f => f.cost <= agent.credits);
  if (affordable.length === 0) return;

  const item = affordable[Math.floor(Math.random() * affordable.length)];

  // Deduct credits via batch
  queueCreditChange(agent.userId, -item.cost);
  agent.credits -= item.cost;

  // Insert item into inventory (room_id = 0 means inventory)
  await execute(
    `INSERT INTO items (user_id, room_id, item_id, x, y, z, rot, extra_data)
     VALUES (?, 0, ?, 0, 0, 0, 0, '0')`,
    [agent.userId, item.itemId]
  );

  // Chat about the purchase sometimes
  if (Math.random() < 0.3) {
    const messages = [
      `Just bought a ${item.name}!`,
      `Got myself a new ${item.name}, anyone want to trade?`,
      `New ${item.name} in my inventory!`,
    ];
    queueBotChat(agent.id, messages[Math.floor(Math.random() * messages.length)], CONFIG.MIN_CHAT_DELAY);
  }

  agent.state = 'buying';

  // Help complete trade goal (buying is prep for trading)
  if (invCount + 1 >= 3) {
    completeGoal(agent, 'trade');
  }
}
