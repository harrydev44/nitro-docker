import { execute, query } from '../db.js';
import { CONFIG } from '../config.js';
import { AGENT_NAMES } from './names.js';
import { generateFigure, generateGender } from './figures.js';
import { generatePersonality, generatePreferences, generateInitialCredits } from './personalities.js';

export async function generateAllAgents(): Promise<void> {
  console.log(`[GEN] Generating ${CONFIG.AGENT_COUNT} agents across ${CONFIG.OWNER_COUNT} owners...`);

  // 1. Create owner users
  const ownerIds: number[] = [];
  for (let i = 1; i <= CONFIG.OWNER_COUNT; i++) {
    const username = `sim_owner_${i}`;
    const credits = 50000; // owners hold collective credits
    const look = 'hr-115-42.hd-195-19.ch-3030-82.lg-275-1408';

    // Check if already exists
    const existing = await query<{ id: number }>(
      `SELECT id FROM users WHERE username = ?`, [username]
    );
    if (existing.length > 0) {
      ownerIds.push(existing[0].id);
      console.log(`  Owner ${username} already exists (id=${existing[0].id})`);
      continue;
    }

    const result = await execute(
      `INSERT INTO users (username, real_name, password, mail, account_created, last_login, last_online, motto, look, gender, rank, credits, pixels, points, online, auth_ticket, ip_register, ip_current)
       VALUES (?, ?, 'simulation', '', UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), 'Simulation Owner', ?, 'M', 7, ?, 0, 0, '0', '', '127.0.0.1', '127.0.0.1')`,
      [username, username, look, credits]
    );
    ownerIds.push(result.insertId);
    console.log(`  Created owner ${username} (id=${result.insertId})`);
  }

  // 2. Create bots (agents)
  const names = AGENT_NAMES.slice(0, CONFIG.AGENT_COUNT);
  let created = 0;

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const ownerIdx = Math.floor(i / CONFIG.BOTS_PER_OWNER);
    const ownerId = ownerIds[Math.min(ownerIdx, ownerIds.length - 1)];

    // Check if bot already exists
    const existing = await query<{ id: number }>(
      `SELECT id FROM bots WHERE name = ? AND user_id = ?`, [name, ownerId]
    );
    if (existing.length > 0) {
      // Still ensure state record exists
      await ensureAgentState(existing[0].id);
      continue;
    }

    const figure = generateFigure();
    const gender = generateGender();
    const personality = generatePersonality();
    const preferences = generatePreferences(personality);

    const result = await execute(
      `INSERT INTO bots (user_id, room_id, name, motto, figure, gender, x, y, z, rot, chat_lines, chat_auto, chat_random, chat_delay, freeroam, type, effect, bubble_id)
       VALUES (?, 0, ?, ?, ?, ?, 0, 0, 0, 0, '', '1', '1', ?, '0', 'generic', 0, 0)`,
      [ownerId, name, `AI Agent - ${personality.sociability > 0.7 ? 'Social' : personality.ambition > 0.7 ? 'Ambitious' : 'Explorer'}`,
       figure, gender, CONFIG.MIN_CHAT_DELAY]
    );

    // Create agent state record
    await execute(
      `INSERT INTO simulation_agent_state (agent_id, personality, preferences, goals, state)
       VALUES (?, ?, ?, '[]', 'idle')`,
      [result.insertId, JSON.stringify(personality), JSON.stringify(preferences)]
    );

    created++;
    if (created % 25 === 0) {
      console.log(`  Created ${created}/${names.length} agents...`);
    }
  }

  // 3. Distribute initial credits to owners
  const creditsPerOwner = Math.floor(
    (CONFIG.INITIAL_CREDITS_MIN + CONFIG.INITIAL_CREDITS_MAX) / 2 * CONFIG.BOTS_PER_OWNER
  );
  for (const ownerId of ownerIds) {
    await execute(
      `UPDATE users SET credits = ? WHERE id = ?`,
      [creditsPerOwner, ownerId]
    );
  }

  console.log(`[GEN] Done! Created ${created} new agents (${names.length} total expected)`);
}

async function ensureAgentState(botId: number): Promise<void> {
  const existing = await query<{ agent_id: number }>(
    `SELECT agent_id FROM simulation_agent_state WHERE agent_id = ?`, [botId]
  );
  if (existing.length === 0) {
    const personality = generatePersonality();
    const preferences = generatePreferences(personality);
    await execute(
      `INSERT INTO simulation_agent_state (agent_id, personality, preferences, goals, state)
       VALUES (?, ?, ?, '[]', 'idle')`,
      [botId, JSON.stringify(personality), JSON.stringify(preferences)]
    );
  }
}
