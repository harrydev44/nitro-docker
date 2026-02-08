import { query } from '../db.js';
import type { SimRoom, RoomPurpose } from '../types.js';

interface RoomRow {
  id: number;
  name: string;
  owner_id: number;
  owner_name: string;
  model: string;
  users: number;
  users_max: number;
  trade_mode: number;
  tags: string;
}

interface RoomStatsRow {
  room_id: number;
  purpose: string;
}

export async function loadRooms(): Promise<SimRoom[]> {
  // Load rooms owned by simulation owners
  const rooms = await query<RoomRow>(
    `SELECT r.id, r.name, r.owner_id, r.owner_name, r.model, r.users, r.users_max, r.trade_mode, r.tags
     FROM rooms r
     JOIN users u ON r.owner_id = u.id
     WHERE u.username LIKE 'sim_owner_%'
     ORDER BY r.id`
  );

  // Load purpose from stats table
  const stats = await query<RoomStatsRow>(
    `SELECT room_id, purpose FROM simulation_room_stats`
  );
  const purposeMap = new Map(stats.map(s => [s.room_id, s.purpose as RoomPurpose]));

  // Also count bots in each room for population
  const botCounts = await query<{ room_id: number; cnt: number }>(
    `SELECT room_id, COUNT(*) as cnt FROM bots WHERE room_id > 0 GROUP BY room_id`
  );
  const popMap = new Map(botCounts.map(b => [b.room_id, b.cnt]));

  return rooms.map(r => ({
    id: r.id,
    name: r.name,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    model: r.model,
    purpose: purposeMap.get(r.id) || guessPurpose(r.name, r.tags),
    currentPopulation: popMap.get(r.id) || 0,
    usersMax: r.users_max,
    tradeMode: r.trade_mode,
  }));
}

function guessPurpose(name: string, tags: string): RoomPurpose {
  const text = (name + ' ' + tags).toLowerCase();
  if (text.includes('trade') || text.includes('market')) return 'trade';
  if (text.includes('work') || text.includes('office')) return 'work';
  if (text.includes('game') || text.includes('arcade')) return 'game';
  if (text.includes('cafe') || text.includes('shop') || text.includes('bar')) return 'service';
  if (text.includes('vip') || text.includes('elite')) return 'vip';
  if (text.includes('empty') || text.includes('blank')) return 'empty';
  return 'hangout';
}
