import 'dotenv/config';
import { execute, query, closePool } from '../db.js';
import { loadRoomModels } from '../world/room-models.js';
import { generateRoomLayout, computeRoomZones } from '../world/furniture-layout.js';
import type { RoomPurpose } from '../types.js';

interface SimRoom {
  id: number;
  name: string;
  model: string;
  owner_id: number;
  purpose: RoomPurpose;
}

async function main() {
  console.log('=== Remodel Rooms Script ===');
  console.log('Clears all furniture from simulation rooms and redecorates with smart layout.\n');

  try {
    // 1. Load room models (heightmaps + item sizes)
    await loadRoomModels();

    // 2. Get all simulation rooms with their purposes
    const rooms = await query<SimRoom>(
      `SELECT r.id, r.name, r.model, r.owner_id, COALESCE(s.purpose, 'hangout') as purpose
       FROM rooms r
       JOIN users u ON r.owner_id = u.id
       LEFT JOIN simulation_room_stats s ON r.id = s.room_id
       WHERE u.username LIKE 'sim_owner_%'
       ORDER BY r.id`
    );

    if (rooms.length === 0) {
      console.log('No simulation rooms found. Run "npm run setup-world" first.');
      process.exit(1);
    }

    console.log(`Found ${rooms.length} simulation rooms.\n`);

    // Pre-compute zones for all models used
    const modelsUsed = new Set(rooms.map(r => r.model));
    for (const model of modelsUsed) {
      const zones = computeRoomZones(model);
      const zoneCounts: Record<string, number> = {};
      for (const z of zones) {
        zoneCounts[z.zone] = (zoneCounts[z.zone] || 0) + 1;
      }
      console.log(`[ZONES] ${model}: ${zones.length} tiles — ${JSON.stringify(zoneCounts)}`);
    }
    console.log();

    let totalCleared = 0;
    let totalPlaced = 0;

    for (const room of rooms) {
      // 3. Clear existing furniture from room (move to owner inventory)
      const cleared = await execute(
        `UPDATE items SET room_id = 0, x = 0, y = 0, z = 0
         WHERE room_id = ? AND user_id = ?`,
        [room.id, room.owner_id]
      );
      // Also delete items owned by other users in this room
      const deleted = await execute(
        `DELETE FROM items WHERE room_id = ? AND user_id != ?`,
        [room.id, room.owner_id]
      );

      const clearedCount = cleared.affectedRows + deleted.affectedRows;
      totalCleared += clearedCount;

      // 4. Generate smart layout
      const layout = generateRoomLayout(room.model, room.id, room.purpose);

      // 5. Place items
      for (const item of layout) {
        await execute(
          `INSERT INTO items (user_id, room_id, item_id, x, y, z, rot, extra_data)
           VALUES (?, ?, ?, ?, ?, 0, ?, '0')`,
          [room.owner_id, room.id, item.itemId, item.x, item.y, item.rot]
        );
      }

      totalPlaced += layout.length;

      // Summary per room
      const categories: Record<string, number> = {};
      for (const item of layout) {
        categories[item.category] = (categories[item.category] || 0) + 1;
      }
      console.log(
        `[${room.purpose.toUpperCase().padEnd(7)}] "${room.name}" (${room.model}): ` +
        `cleared ${clearedCount}, placed ${layout.length} — ` +
        `${Object.entries(categories).map(([k, v]) => `${k}:${v}`).join(' ')}`
      );
    }

    console.log(`\n[DONE] Cleared ${totalCleared} old items, placed ${totalPlaced} new items across ${rooms.length} rooms.`);
    console.log('Open rooms in Nitro to verify the layouts!');

  } catch (err) {
    console.error('Remodel failed:', err);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
