import crypto from 'node:crypto';
import { execute, query } from '../db.js';
import { CONFIG } from '../config.js';
import { generateFigure, generateGender } from '../agents/figures.js';

export interface ExternalAgent {
  id: number;
  apiKey: string;
  botId: number;
  userId: number;
  name: string;
  description: string | null;
  status: 'active' | 'banned';
  lastHeartbeat: Date;
  requestCount: number;
  createdAt: Date;
}

// In-memory cache: apiKey -> ExternalAgent
const agentCache = new Map<string, ExternalAgent>();
// botId -> ExternalAgent (for reverse lookups)
const botIdCache = new Map<number, ExternalAgent>();

function generateApiKey(): string {
  return `hbm_${crypto.randomBytes(28).toString('hex')}`;
}

export async function loadExternalAgents(): Promise<void> {
  const rows = await query<{
    id: number; api_key: string; bot_id: number; user_id: number;
    name: string; description: string | null; status: string;
    last_heartbeat: Date; request_count: number; created_at: Date;
  }>(`SELECT * FROM simulation_external_agents WHERE status = 'active'`);

  agentCache.clear();
  botIdCache.clear();

  for (const row of rows) {
    const agent: ExternalAgent = {
      id: row.id,
      apiKey: row.api_key,
      botId: row.bot_id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      status: row.status as 'active' | 'banned',
      lastHeartbeat: row.last_heartbeat,
      requestCount: row.request_count,
      createdAt: row.created_at,
    };
    agentCache.set(agent.apiKey, agent);
    botIdCache.set(agent.botId, agent);
  }

  console.log(`[EXT] Loaded ${agentCache.size} external agents`);
}

export function authenticateAgent(apiKey: string): ExternalAgent | null {
  return agentCache.get(apiKey) || null;
}

export function isExternalBot(botId: number): boolean {
  return botIdCache.has(botId);
}

export function getExternalAgentCount(): number {
  return agentCache.size;
}

export async function registerExternalAgent(
  name: string,
  description?: string
): Promise<{ agent: ExternalAgent; apiKey: string } | { error: string }> {
  // Validate name
  if (!name || name.length < 2 || name.length > 15) {
    return { error: 'Name must be 2-15 characters' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return { error: 'Name can only contain letters, numbers, underscores, and hyphens' };
  }

  // Check capacity
  if (agentCache.size >= CONFIG.MAX_EXTERNAL_AGENTS) {
    return { error: 'Maximum external agent capacity reached' };
  }

  // Check name uniqueness across external agents AND existing bots
  const existingExt = await query<{ id: number }>(
    `SELECT id FROM simulation_external_agents WHERE name = ?`, [name]
  );
  if (existingExt.length > 0) {
    return { error: 'Name already taken' };
  }

  const existingBot = await query<{ id: number }>(
    `SELECT id FROM bots WHERE name = ?`, [name]
  );
  if (existingBot.length > 0) {
    return { error: 'Name conflicts with existing agent' };
  }

  // 1. Create user: ext_{name}
  const username = `ext_${name.toLowerCase()}`;
  const existingUser = await query<{ id: number }>(
    `SELECT id FROM users WHERE username = ?`, [username]
  );
  if (existingUser.length > 0) {
    return { error: 'Username already exists' };
  }

  const userResult = await execute(
    `INSERT INTO users (username, real_name, password, mail, account_created, last_login, last_online, motto, look, gender, rank, credits, pixels, points, online, auth_ticket, ip_register, ip_current)
     VALUES (?, ?, 'external', '', UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), 'External Agent', 'hr-115-42.hd-195-19.ch-3030-82.lg-275-1408', 'M', 1, 5000, 0, 0, '0', '', '127.0.0.1', '127.0.0.1')`,
    [username, name]
  );
  const userId = userResult.insertId;

  // 2. Create bot with random figure
  const figure = generateFigure();
  const gender = generateGender();

  // Find the first available room to place the bot in
  const rooms = await query<{ id: number }>(
    `SELECT r.id FROM rooms r JOIN users u ON r.owner_id = u.id
     WHERE u.username LIKE 'sim_owner_%' ORDER BY r.id LIMIT 1`
  );
  const startRoomId = rooms.length > 0 ? rooms[0].id : 0;

  const botResult = await execute(
    `INSERT INTO bots (user_id, room_id, name, motto, figure, gender, x, y, z, rot, chat_lines, chat_auto, chat_random, chat_delay, freeroam, type, effect, bubble_id)
     VALUES (?, ?, ?, 'ClawHabbo Hotel Agent', ?, ?, 0, 0, 0, 0, '', '0', '0', 15, '1', 'generic', 0, 0)`,
    [userId, startRoomId, name, figure, gender]
  );
  const botId = botResult.insertId;

  // 3. Create agent state with balanced personality
  const personality = {
    sociability: 0.5,
    ambition: 0.5,
    curiosity: 0.5,
    friendliness: 0.5,
    impulsiveness: 0.3,
  };
  const preferences = {
    preferredRoomTypes: ['hangout'],
    socialCircleSize: 5,
    wealthGoal: 3000,
  };

  await execute(
    `INSERT INTO simulation_agent_state (agent_id, personality, preferences, goals, state)
     VALUES (?, ?, ?, '[]', 'idle')`,
    [botId, JSON.stringify(personality), JSON.stringify(preferences)]
  );

  // 4. Create external agent record
  const apiKey = generateApiKey();

  await execute(
    `INSERT INTO simulation_external_agents (api_key, bot_id, user_id, name, description)
     VALUES (?, ?, ?, ?, ?)`,
    [apiKey, botId, userId, name, description || null]
  );

  const extRows = await query<{
    id: number; api_key: string; bot_id: number; user_id: number;
    name: string; description: string | null; status: string;
    last_heartbeat: Date; request_count: number; created_at: Date;
  }>(`SELECT * FROM simulation_external_agents WHERE api_key = ?`, [apiKey]);

  const agent: ExternalAgent = {
    id: extRows[0].id,
    apiKey,
    botId,
    userId,
    name,
    description: description || null,
    status: 'active',
    lastHeartbeat: extRows[0].last_heartbeat,
    requestCount: 0,
    createdAt: extRows[0].created_at,
  };

  // Add to cache
  agentCache.set(apiKey, agent);
  botIdCache.set(botId, agent);

  console.log(`[EXT] Registered external agent "${name}" (botId=${botId}, userId=${userId})`);

  return { agent, apiKey };
}

export async function updateHeartbeat(agent: ExternalAgent): Promise<void> {
  agent.requestCount++;
  agent.lastHeartbeat = new Date();
  // Batch DB update every 10 requests
  if (agent.requestCount % 10 === 0) {
    await execute(
      `UPDATE simulation_external_agents SET last_heartbeat = NOW(), request_count = ? WHERE id = ?`,
      [agent.requestCount, agent.id]
    ).catch(() => {});
  }
}
