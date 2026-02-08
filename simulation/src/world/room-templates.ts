import type { RoomPurpose } from '../types.js';

export interface RoomTemplate {
  name: string;
  description: string;
  model: string;
  purpose: RoomPurpose;
  tradeMode: number;  // 0=disabled, 2=enabled
}

export const ROOM_TEMPLATES: RoomTemplate[] = [
  // --- Hangout rooms (5) ---
  { name: 'The Lobby', description: 'Main hangout spot for everyone', model: 'model_a', purpose: 'hangout', tradeMode: 0 },
  { name: 'Sunset Terrace', description: 'Chill vibes and good company', model: 'model_b', purpose: 'hangout', tradeMode: 0 },
  { name: 'Pixel Park', description: 'The public park where friends meet', model: 'model_c', purpose: 'hangout', tradeMode: 0 },
  { name: 'Neon Lounge', description: 'Late night hangout with neon lights', model: 'model_d', purpose: 'hangout', tradeMode: 0 },
  { name: 'The Commons', description: 'Open space for all', model: 'model_e', purpose: 'hangout', tradeMode: 0 },

  // --- Trade rooms (4) ---
  { name: 'Grand Bazaar', description: 'The biggest marketplace in the hotel', model: 'model_c', purpose: 'trade', tradeMode: 2 },
  { name: 'Trade Center', description: 'Professional trading floor', model: 'model_d', purpose: 'trade', tradeMode: 2 },
  { name: 'Flea Market', description: 'Bargain deals and rare finds', model: 'model_b', purpose: 'trade', tradeMode: 2 },
  { name: 'Rare Exchange', description: 'Only the finest items traded here', model: 'model_e', purpose: 'trade', tradeMode: 2 },

  // --- Work rooms (4) ---
  { name: 'City Office', description: 'Where the workforce gathers', model: 'model_a', purpose: 'work', tradeMode: 0 },
  { name: 'The Workshop', description: 'Hands-on work and crafting', model: 'model_b', purpose: 'work', tradeMode: 0 },
  { name: 'Startup HQ', description: 'Innovation and hustle', model: 'model_d', purpose: 'work', tradeMode: 0 },
  { name: 'The Factory', description: 'Industrial work zone', model: 'model_f', purpose: 'work', tradeMode: 0 },

  // --- Game rooms (3) ---
  { name: 'Pixel Arcade', description: 'Games and fun for everyone', model: 'model_c', purpose: 'game', tradeMode: 0 },
  { name: 'The Arena', description: 'Competitive games and showdowns', model: 'model_e', purpose: 'game', tradeMode: 0 },
  { name: 'Fun Zone', description: 'Casual games and laughs', model: 'model_a', purpose: 'game', tradeMode: 0 },

  // --- Service rooms (3) ---
  { name: 'Habbo Cafe', description: 'Coffee and conversation', model: 'model_a', purpose: 'service', tradeMode: 0 },
  { name: 'The Diner', description: 'Food and friends', model: 'model_b', purpose: 'service', tradeMode: 0 },
  { name: 'Chill Bar', description: 'Drinks and good times', model: 'model_d', purpose: 'service', tradeMode: 0 },

  // --- Empty rooms (3) ---
  { name: 'Blank Canvas 1', description: 'An empty room waiting for life', model: 'model_a', purpose: 'empty', tradeMode: 0 },
  { name: 'Blank Canvas 2', description: 'Space for creativity', model: 'model_b', purpose: 'empty', tradeMode: 0 },
  { name: 'Blank Canvas 3', description: 'Your vision starts here', model: 'model_c', purpose: 'empty', tradeMode: 0 },

  // --- VIP rooms (3) ---
  { name: 'Elite Lounge', description: 'For the hotel\'s finest', model: 'model_e', purpose: 'vip', tradeMode: 0 },
  { name: 'Penthouse Suite', description: 'Luxury living at the top', model: 'model_f', purpose: 'vip', tradeMode: 0 },
  { name: 'Diamond Club', description: 'Exclusive membership only', model: 'model_d', purpose: 'vip', tradeMode: 0 },
];
