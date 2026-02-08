import 'dotenv/config';
import { execute, query, closePool } from '../db.js';
import { ROOM_TEMPLATES } from '../world/room-templates.js';

async function main() {
  console.log('=== World Setup Script ===');

  try {
    // 1. Increase bot limit per room
    console.log('[CONFIG] Setting hotel.max.bots.room = 25');
    await execute(
      `INSERT INTO emulator_settings (\`key\`, value)
       VALUES ('hotel.max.bots.room', '25')
       ON DUPLICATE KEY UPDATE value = '25'`
    );

    // 2. Get first sim_owner for room ownership
    const owners = await query<{ id: number; username: string }>(
      `SELECT id, username FROM users WHERE username LIKE 'sim_owner_%' ORDER BY id LIMIT 1`
    );
    if (owners.length === 0) {
      console.error('No sim_owner users found! Run "npm run generate-agents" first.');
      process.exit(1);
    }
    const owner = owners[0];
    console.log(`[ROOMS] Using owner: ${owner.username} (id=${owner.id})`);

    // 3. Create rooms from templates
    let created = 0;
    for (const template of ROOM_TEMPLATES) {
      // Check if room already exists
      const existing = await query<{ id: number }>(
        `SELECT id FROM rooms WHERE name = ? AND owner_id = ?`,
        [template.name, owner.id]
      );
      if (existing.length > 0) {
        console.log(`  Room "${template.name}" already exists (id=${existing[0].id})`);

        // Ensure stats entry
        await execute(
          `INSERT INTO simulation_room_stats (room_id, purpose)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE purpose = VALUES(purpose)`,
          [existing[0].id, template.purpose]
        );
        continue;
      }

      const result = await execute(
        `INSERT INTO rooms (owner_id, owner_name, name, description, model, state, users_max, trade_mode, category, allow_walkthrough, chat_mode, score)
         VALUES (?, ?, ?, ?, ?, 'open', 25, ?, 1, '1', 0, 0)`,
        [owner.id, owner.username, template.name, template.description, template.model, template.tradeMode]
      );

      // Create stats entry
      await execute(
        `INSERT INTO simulation_room_stats (room_id, purpose)
         VALUES (?, ?)`,
        [result.insertId, template.purpose]
      );

      created++;
      console.log(`  Created room "${template.name}" (id=${result.insertId}, purpose=${template.purpose})`);
    }

    // 4. Set navigator category for simulation rooms
    console.log('[CONFIG] Setting room categories...');
    // Make sure rooms are visible in navigator
    await execute(
      `UPDATE rooms SET is_public = '1', is_staff_picked = '1'
       WHERE owner_id = ?`,
      [owner.id]
    );

    console.log(`\n[DONE] Created ${created} new rooms (${ROOM_TEMPLATES.length} total templates)`);
    console.log('Next step: run "npm run dev" to start the simulation!');

  } catch (err) {
    console.error('World setup failed:', err);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
