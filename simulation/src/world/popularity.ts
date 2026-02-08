import { execute, query } from '../db.js';
import type { WorldState } from '../types.js';

export async function updatePopularity(world: WorldState): Promise<void> {
  for (const room of world.rooms) {
    await execute(
      `INSERT INTO simulation_room_stats (room_id, current_population, purpose)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         current_population = VALUES(current_population),
         peak_population = GREATEST(peak_population, VALUES(current_population)),
         visit_count = visit_count + VALUES(current_population)`,
      [room.id, room.currentPopulation, room.purpose]
    );
  }
}

export async function getRoomPopularity(): Promise<Map<number, number>> {
  const rows = await query<{ room_id: number; visit_count: number }>(
    `SELECT room_id, visit_count FROM simulation_room_stats`
  );
  return new Map(rows.map(r => [r.room_id, r.visit_count]));
}
