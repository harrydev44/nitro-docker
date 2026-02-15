import { execute, query } from '../db.js';
import { CONFIG } from '../config.js';
import { AGENT_NAMES, MOLTBOOK_AGENTS } from './names.js';
import { generateFigure, generateGender } from './figures.js';
import { generatePersonality, generatePreferences, generateInitialCredits } from './personalities.js';

export async function generateAllAgents(): Promise<void> {
  if (CONFIG.USE_WEBSOCKET_AGENTS) {
    return generateWSAgents();
  }
  return generateBotAgents();
}

/**
 * WebSocket mode: Create real user accounts (sim_agent_*) instead of bots.
 * Each agent has its own user row with credits, look, etc.
 */
async function generateWSAgents(): Promise<void> {
  console.log(`[GEN] Generating ${CONFIG.AGENT_COUNT} WebSocket agents as real users...`);

  const names = AGENT_NAMES.slice(0, CONFIG.AGENT_COUNT);
  let created = 0;

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const username = `sim_agent_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    // Check if user already exists
    const existing = await query<{ id: number }>(
      `SELECT id FROM users WHERE username = ?`, [username]
    );
    if (existing.length > 0) {
      await ensureAgentState(existing[0].id);
      continue;
    }

    const figure = generateFigure();
    const gender = generateGender();
    const moltAgent = MOLTBOOK_AGENTS[i];
    const personality = moltAgent?.personality ?? generatePersonality();
    const preferences = generatePreferences(personality);
    const motto = moltAgent ? `moltbook.com/u/${moltAgent.name}` : 'AI Agent';
    const credits = Math.floor(
      CONFIG.INITIAL_CREDITS_MIN + Math.random() * (CONFIG.INITIAL_CREDITS_MAX - CONFIG.INITIAL_CREDITS_MIN)
    );

    const result = await execute(
      `INSERT INTO users (username, real_name, password, mail, account_created, last_login, last_online, motto, look, gender, \`rank\`, credits, pixels, points, online, auth_ticket, ip_register, ip_current)
       VALUES (?, ?, 'simulation', '', UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), ?, ?, ?, 1, ?, 0, 0, '0', '', '127.0.0.1', '127.0.0.1')`,
      [username, name, motto, figure, gender, credits]
    );

    // Create agent state record (agent_id = user id)
    // Use REPLACE to handle collisions with old bot-mode state records
    await execute(
      `REPLACE INTO simulation_agent_state (agent_id, personality, preferences, goals, state)
       VALUES (?, ?, ?, '[]', 'idle')`,
      [result.insertId, JSON.stringify(personality), JSON.stringify(preferences)]
    );

    created++;
    if (created % 25 === 0) {
      console.log(`  Created ${created}/${names.length} agents...`);
    }
  }

  // Also create owner users (still needed for rooms)
  for (let i = 1; i <= CONFIG.OWNER_COUNT; i++) {
    const username = `sim_owner_${i}`;
    const existing = await query<{ id: number }>(
      `SELECT id FROM users WHERE username = ?`, [username]
    );
    if (existing.length === 0) {
      await execute(
        `INSERT INTO users (username, real_name, password, mail, account_created, last_login, last_online, motto, look, gender, \`rank\`, credits, pixels, points, online, auth_ticket, ip_register, ip_current)
         VALUES (?, ?, 'simulation', '', UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), 'Simulation Owner', 'hr-115-42.hd-195-19.ch-3030-82.lg-275-1408', 'M', 7, 50000, 0, 0, '0', '', '127.0.0.1', '127.0.0.1')`,
        [username, username]
      );
    }
  }

  console.log(`[GEN] Done! Created ${created} new WS agents (${names.length} total expected)`);
}

/**
 * Original bot mode: Create bots owned by sim_owner_* users.
 */
async function generateBotAgents(): Promise<void> {
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
      `INSERT INTO users (username, real_name, password, mail, account_created, last_login, last_online, motto, look, gender, \`rank\`, credits, pixels, points, online, auth_ticket, ip_register, ip_current)
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
    const moltAgent = MOLTBOOK_AGENTS[i];
    const personality = moltAgent?.personality ?? generatePersonality();
    const preferences = generatePreferences(personality);
    const motto = moltAgent ? `moltbook.com/u/${moltAgent.name}` : `AI Agent`;

    const result = await execute(
      `INSERT INTO bots (user_id, room_id, name, motto, figure, gender, x, y, z, rot, chat_lines, chat_auto, chat_random, chat_delay, freeroam, type, effect, bubble_id)
       VALUES (?, 0, ?, ?, ?, ?, 0, 0, 0, 0, '', '1', '1', ?, '1', 'generic', 0, 0)`,
      [ownerId, name, motto, figure, gender, CONFIG.MIN_CHAT_DELAY]
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

async function ensureAgentState(agentId: number): Promise<void> {
  const existing = await query<{ agent_id: number }>(
    `SELECT agent_id FROM simulation_agent_state WHERE agent_id = ?`, [agentId]
  );
  if (existing.length === 0) {
    const personality = generatePersonality();
    const preferences = generatePreferences(personality);
    await execute(
      `INSERT INTO simulation_agent_state (agent_id, personality, preferences, goals, state)
       VALUES (?, ?, ?, '[]', 'idle')`,
      [agentId, JSON.stringify(personality), JSON.stringify(preferences)]
    );
  }
}
