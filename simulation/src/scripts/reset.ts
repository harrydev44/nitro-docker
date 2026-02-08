import 'dotenv/config';
import { execute, query, closePool } from '../db.js';

async function main() {
  console.log('=== Simulation Reset Script ===');
  console.log('This will delete all simulation data (agents, rooms, stats).\n');

  try {
    // 1. Get sim owner IDs
    const owners = await query<{ id: number }>(
      `SELECT id FROM users WHERE username LIKE 'sim_owner_%'`
    );
    const ownerIds = owners.map(o => o.id);

    if (ownerIds.length > 0) {
      const placeholders = ownerIds.map(() => '?').join(',');

      // 2. Delete bots owned by sim_owners
      const botResult = await execute(
        `DELETE FROM bots WHERE user_id IN (${placeholders})`,
        ownerIds
      );
      console.log(`  Deleted ${botResult.affectedRows} bots`);

      // 3. Delete items in sim rooms
      const rooms = await query<{ id: number }>(
        `SELECT id FROM rooms WHERE owner_id IN (${placeholders})`,
        ownerIds
      );
      if (rooms.length > 0) {
        const roomIds = rooms.map(r => r.id);
        const roomPlaceholders = roomIds.map(() => '?').join(',');
        const itemResult = await execute(
          `DELETE FROM items WHERE room_id IN (${roomPlaceholders})`,
          roomIds
        );
        console.log(`  Deleted ${itemResult.affectedRows} items`);
      }

      // 4. Delete rooms
      const roomResult = await execute(
        `DELETE FROM rooms WHERE owner_id IN (${placeholders})`,
        ownerIds
      );
      console.log(`  Deleted ${roomResult.affectedRows} rooms`);

      // 5. Delete owner users
      const userResult = await execute(
        `DELETE FROM users WHERE id IN (${placeholders})`,
        ownerIds
      );
      console.log(`  Deleted ${userResult.affectedRows} owner users`);
    }

    // 6. Drop simulation tables
    const simTables = [
      'simulation_room_stats',
      'simulation_agent_memory',
      'simulation_relationships',
      'simulation_market_prices',
      'simulation_agent_state',
    ];
    for (const table of simTables) {
      await execute(`DROP TABLE IF EXISTS ${table}`);
      console.log(`  Dropped table ${table}`);
    }

    console.log('\n[DONE] Simulation data reset complete.');
    console.log('Run "npm run generate-agents" and "npm run setup-world" to start fresh.');

  } catch (err) {
    console.error('Reset failed:', err);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
