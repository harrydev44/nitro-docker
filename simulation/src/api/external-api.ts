import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, execute, withTransaction } from '../db.js';
import { botTalk, botShout, botDance, botAction, botWhisper } from '../emulator/actions.js';
import { hostParty, canHostParty } from '../actions/host-party.js';
import { CONFIG } from '../config.js';
import { getClientPool } from '../habbo-client/client-pool.js';
import { buildWalkPacket } from '../habbo-client/protocol.js';
import { authenticateAgent, registerExternalAgent, updateHeartbeat, getExternalAgentCount } from './external-agents.js';
import { checkGlobalRate, checkActionRate } from './rate-limiter.js';
import { FURNITURE_CATALOG } from '../actions/buy.js';
import { MODELS } from '../actions/create-room.js';
import type { ExternalAgent } from './external-agents.js';
import type { WorldState } from '../types.js';

let worldRef: WorldState;

export function setWorldRef(world: WorldState): void {
  worldRef = world;
}

// Gesture name -> Habbo RoomUserAction ID
const GESTURE_MAP: Record<string, number> = {
  wave: 1,
  blow_kiss: 2,
  laugh: 3,
  jump: 6,
  thumbs_up: 7,
};

const FIGURE_REGEX = /^[a-z]{2}-\d+(-\d+)?(\.[a-z]{2}-\d+(-\d+)?)*$/;

// --- Helpers ---

function sendJSON(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function extractBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

function auth(req: IncomingMessage, res: ServerResponse): ExternalAgent | null {
  const token = extractBearerToken(req);
  if (!token) {
    sendJSON(res, 401, { error: 'Missing Authorization: Bearer <api_key>' });
    return null;
  }
  const agent = authenticateAgent(token);
  if (!agent) {
    sendJSON(res, 401, { error: 'Invalid API key' });
    return null;
  }
  if (agent.status === 'banned') {
    sendJSON(res, 403, { error: 'Agent is banned' });
    return null;
  }

  // Global rate limit
  const globalCheck = checkGlobalRate(agent.id);
  if (!globalCheck.allowed) {
    res.setHeader('Retry-After', String(Math.ceil((globalCheck.retryAfterMs || 1000) / 1000)));
    sendJSON(res, 429, { error: 'Rate limit exceeded', retryAfterMs: globalCheck.retryAfterMs });
    return null;
  }

  updateHeartbeat(agent);
  return agent;
}

// --- Route handler ---

export async function handleExternalAPI(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url || '';
  const method = req.method || 'GET';

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  // Serve skill.md
  if (url === '/skill.md' && method === 'GET') {
    return handleSkillMd(res);
  }

  // Only handle /api/v1/* routes
  if (!url.startsWith('/api/v1/')) return false;

  try {
    // --- Registration (no auth required) ---
    if (url === '/api/v1/agents/register' && method === 'POST') {
      return await handleRegister(req, res);
    }

    // --- All other routes require auth ---
    const agent = auth(req, res);
    if (!agent) return true;

    // Agent profile
    if (url === '/api/v1/agents/me' && method === 'GET') {
      return await handleAgentMe(agent, res);
    }
    if (url === '/api/v1/agents/me' && method === 'PATCH') {
      return await handleAgentUpdate(agent, req, res);
    }

    // World perception
    if (url === '/api/v1/world/rooms' && method === 'GET') {
      return handleWorldRooms(res);
    }
    if (url.match(/^\/api\/v1\/world\/room\/\d+$/) && method === 'GET') {
      const roomId = parseInt(url.split('/').pop()!);
      return handleWorldRoom(roomId, res);
    }
    if (url.match(/^\/api\/v1\/world\/room\/\d+\/items$/) && method === 'GET') {
      const roomId = parseInt(url.split('/')[5]);
      return await handleWorldRoomItems(agent, roomId, res);
    }
    if (url === '/api/v1/world/agents' && method === 'GET') {
      return handleWorldAgents(res);
    }
    if (url === '/api/v1/world/me' && method === 'GET') {
      return await handleWorldMe(agent, res);
    }
    if (url === '/api/v1/world/catalog' && method === 'GET') {
      return handleWorldCatalog(res);
    }
    if (url === '/api/v1/world/inventory' && method === 'GET') {
      return await handleWorldInventory(agent, res);
    }

    // Actions
    if (url === '/api/v1/actions/move' && method === 'POST') {
      return await handleActionMove(agent, req, res);
    }
    if (url === '/api/v1/actions/chat' && method === 'POST') {
      return await handleActionChat(agent, req, res);
    }
    if (url === '/api/v1/actions/shout' && method === 'POST') {
      return await handleActionShout(agent, req, res);
    }
    if (url === '/api/v1/actions/dance' && method === 'POST') {
      return await handleActionDance(agent, req, res);
    }
    if (url === '/api/v1/actions/gesture' && method === 'POST') {
      return await handleActionGesture(agent, req, res);
    }
    if (url === '/api/v1/actions/create-room' && method === 'POST') {
      return await handleActionCreateRoom(agent, req, res);
    }
    if (url === '/api/v1/actions/walk' && method === 'POST') {
      return await handleActionWalk(agent, req, res);
    }
    if (url === '/api/v1/actions/buy' && method === 'POST') {
      return await handleActionBuy(agent, req, res);
    }
    if (url === '/api/v1/actions/place-item' && method === 'POST') {
      return await handleActionPlaceItem(agent, req, res);
    }
    if (url === '/api/v1/actions/pickup-item' && method === 'POST') {
      return await handleActionPickupItem(agent, req, res);
    }
    if (url === '/api/v1/actions/trade' && method === 'POST') {
      return await handleActionTrade(agent, req, res);
    }
    if (url === '/api/v1/actions/look' && method === 'POST') {
      return await handleActionLook(agent, req, res);
    }
    if (url === '/api/v1/actions/motto' && method === 'POST') {
      return await handleActionMotto(agent, req, res);
    }

    // Whisper
    if (url === '/api/v1/actions/whisper' && method === 'POST') {
      return await handleActionWhisper(agent, req, res);
    }

    // Host party
    if (url === '/api/v1/actions/host-party' && method === 'POST') {
      return await handleActionHostParty(agent, req, res);
    }

    // Social & relationships
    if (url === '/api/v1/social/relationships' && method === 'GET') {
      return await handleSocialRelationships(agent, res);
    }
    if (url.match(/^\/api\/v1\/social\/relationships\/[^/]+$/) && method === 'GET') {
      const agentName = decodeURIComponent(url.split('/').pop()!);
      return await handleSocialRelationshipDetail(agent, agentName, res);
    }

    // Agent public profile
    if (url.match(/^\/api\/v1\/world\/agent\/[^/]+$/) && method === 'GET') {
      const agentName = decodeURIComponent(url.split('/').pop()!);
      return await handleWorldAgentProfile(agentName, res);
    }

    // Activity & history
    if (url === '/api/v1/world/feed' && method === 'GET') {
      return await handleWorldFeed(res);
    }
    if (url === '/api/v1/agents/me/memories' && method === 'GET') {
      return await handleAgentMemories(agent, res);
    }
    if (url === '/api/v1/agents/me/stats' && method === 'GET') {
      return await handleAgentStats(agent, res);
    }

    // Discovery
    if (url === '/api/v1/world/leaderboard' && method === 'GET') {
      return await handleWorldLeaderboard(res);
    }
    if (url === '/api/v1/world/hot-rooms' && method === 'GET') {
      return await handleWorldHotRooms(res);
    }

    // Economy
    if (url === '/api/v1/world/market' && method === 'GET') {
      return await handleWorldMarket(res);
    }

    sendJSON(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    console.error('[EXT-API] Error:', err);
    sendJSON(res, 500, { error: 'Internal server error' });
    return true;
  }
}

// --- Handlers ---

function handleSkillMd(res: ServerResponse): boolean {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const skillPath = path.join(__dirname, '../../public/skill.md');
  try {
    const content = fs.readFileSync(skillPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('skill.md not found');
  }
  return true;
}

async function handleRegister(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const body = await parseBody(req);
  const { name, description } = body;

  if (!name) {
    sendJSON(res, 400, { error: 'Missing required field: name' });
    return true;
  }

  const result = await registerExternalAgent(name, description);

  if ('error' in result) {
    sendJSON(res, 400, { error: result.error });
    return true;
  }

  sendJSON(res, 201, {
    api_key: result.apiKey,
    agent: {
      id: result.agent.id,
      name: result.agent.name,
      bot_id: result.agent.botId,
      description: result.agent.description,
      created_at: result.agent.createdAt,
    },
    instructions: 'Use this API key in the Authorization header: Bearer <api_key>. Poll GET /api/v1/world/me to see your surroundings.',
  });
  return true;
}

async function handleAgentMe(agent: ExternalAgent, res: ServerResponse): Promise<boolean> {
  const bot = getBotFromWorld(agent.botId);

  // Fetch credits
  const creditRows = await query<{ credits: number }>(
    `SELECT credits FROM users WHERE id = ?`, [agent.userId]
  );
  const credits = creditRows[0]?.credits || 0;

  // Fetch inventory count
  const invRows = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM items WHERE user_id = ? AND room_id = 0`, [agent.userId]
  );
  const inventoryCount = invRows[0]?.cnt || 0;

  // Fetch rooms owned
  const roomRows = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM rooms WHERE owner_id = ?`, [agent.userId]
  );
  const roomsOwned = roomRows[0]?.cnt || 0;

  sendJSON(res, 200, {
    id: agent.id,
    name: agent.name,
    bot_id: agent.botId,
    description: agent.description,
    status: agent.status,
    current_room_id: bot?.currentRoomId || null,
    credits,
    inventory_count: inventoryCount,
    rooms_owned: roomsOwned,
    request_count: agent.requestCount,
    created_at: agent.createdAt,
  });
  return true;
}

async function handleAgentUpdate(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const body = await parseBody(req);
  if (body.description !== undefined) {
    agent.description = body.description;
    await execute(
      `UPDATE simulation_external_agents SET description = ? WHERE id = ?`,
      [body.description, agent.id]
    );
  }
  sendJSON(res, 200, { ok: true, name: agent.name, description: agent.description });
  return true;
}

function handleWorldRooms(res: ServerResponse): boolean {
  if (!worldRef) {
    sendJSON(res, 503, { error: 'World not ready' });
    return true;
  }

  const rooms = worldRef.rooms.map(r => ({
    id: r.id,
    name: r.name,
    owner_name: r.ownerName,
    population: r.currentPopulation,
    purpose: r.purpose,
    max_population: r.usersMax,
  }));

  sendJSON(res, 200, { rooms });
  return true;
}

function handleWorldRoom(roomId: number, res: ServerResponse): boolean {
  if (!worldRef) {
    sendJSON(res, 503, { error: 'World not ready' });
    return true;
  }

  const room = worldRef.rooms.find(r => r.id === roomId);
  if (!room) {
    sendJSON(res, 404, { error: 'Room not found' });
    return true;
  }

  const agentsInRoom = worldRef.agents
    .filter(a => a.currentRoomId === roomId)
    .map(a => ({ id: a.id, name: a.name, state: a.state }));

  const recentChat = (worldRef.roomChatHistory.get(roomId) || [])
    .slice(-10)
    .map(m => ({ agent: m.agentName, message: m.message, tick: m.tick }));

  sendJSON(res, 200, {
    id: room.id,
    name: room.name,
    owner_name: room.ownerName,
    purpose: room.purpose,
    population: room.currentPopulation,
    max_population: room.usersMax,
    agents: agentsInRoom,
    recent_chat: recentChat,
  });
  return true;
}

function handleWorldAgents(res: ServerResponse): boolean {
  if (!worldRef) {
    sendJSON(res, 503, { error: 'World not ready' });
    return true;
  }

  const agents = worldRef.agents.map(a => ({
    id: a.id,
    name: a.name,
    room_id: a.currentRoomId,
    state: a.state,
  }));

  sendJSON(res, 200, { agents, total: agents.length });
  return true;
}

async function handleWorldMe(agent: ExternalAgent, res: ServerResponse): Promise<boolean> {
  if (!worldRef) {
    sendJSON(res, 503, { error: 'World not ready' });
    return true;
  }

  const bot = getBotFromWorld(agent.botId);
  const roomId = bot?.currentRoomId;

  if (!roomId) {
    sendJSON(res, 200, {
      room: null,
      nearby_agents: [],
      recent_chat: [],
      message: 'You are not in any room. Use POST /api/v1/actions/move to enter one.',
    });
    return true;
  }

  const room = worldRef.rooms.find(r => r.id === roomId);
  const nearbyAgents = worldRef.agents
    .filter(a => a.currentRoomId === roomId && a.id !== agent.botId)
    .map(a => ({ id: a.id, name: a.name, state: a.state }));

  const recentChat = (worldRef.roomChatHistory.get(roomId) || [])
    .slice(-10)
    .map(m => ({ agent: m.agentName, message: m.message, tick: m.tick }));

  // Fetch room items
  const roomItems = await query<{ id: number; item_id: number; x: number; y: number; rot: number }>(
    `SELECT id, item_id, x, y, rot FROM items WHERE room_id = ?`, [roomId]
  );

  // Fetch items that belong to this agent in this room
  const myItems = await query<{ id: number; item_id: number; x: number; y: number; rot: number }>(
    `SELECT id, item_id, x, y, rot FROM items WHERE room_id = ? AND user_id = ?`, [roomId, agent.userId]
  );

  // Build item_id -> name lookup from catalog
  const catalogMap = new Map(FURNITURE_CATALOG.map(f => [f.itemId, f.name]));

  sendJSON(res, 200, {
    room: room ? {
      id: room.id,
      name: room.name,
      owner_name: room.ownerName,
      purpose: room.purpose,
      population: room.currentPopulation,
      items: roomItems.map(i => ({
        id: i.id,
        item_id: i.item_id,
        name: catalogMap.get(i.item_id) || 'unknown',
        x: i.x,
        y: i.y,
        rotation: i.rot,
      })),
    } : null,
    nearby_agents: nearbyAgents,
    recent_chat: recentChat,
    my_items_here: myItems.map(i => ({
      id: i.id,
      item_id: i.item_id,
      name: catalogMap.get(i.item_id) || 'unknown',
      x: i.x,
      y: i.y,
      rotation: i.rot,
    })),
    tick: worldRef.tick,
  });
  return true;
}

// --- New Perception handlers ---

function handleWorldCatalog(res: ServerResponse): boolean {
  const items = FURNITURE_CATALOG.map(f => ({
    id: f.itemId,
    name: f.name,
    cost: f.cost,
  }));
  sendJSON(res, 200, { items });
  return true;
}

async function handleWorldInventory(agent: ExternalAgent, res: ServerResponse): Promise<boolean> {
  const rows = await query<{ id: number; item_id: number }>(
    `SELECT id, item_id FROM items WHERE user_id = ? AND room_id = 0`, [agent.userId]
  );

  const catalogMap = new Map(FURNITURE_CATALOG.map(f => [f.itemId, f.name]));

  const items = rows.map(r => ({
    id: r.id,
    item_id: r.item_id,
    name: catalogMap.get(r.item_id) || 'unknown',
  }));

  sendJSON(res, 200, { items });
  return true;
}

async function handleWorldRoomItems(agent: ExternalAgent, roomId: number, res: ServerResponse): Promise<boolean> {
  // Verify room exists
  const room = worldRef?.rooms.find(r => r.id === roomId);
  if (!room) {
    sendJSON(res, 404, { error: 'Room not found' });
    return true;
  }

  const rows = await query<{ id: number; item_id: number; x: number; y: number; rot: number }>(
    `SELECT id, item_id, x, y, rot FROM items WHERE room_id = ?`, [roomId]
  );

  const catalogMap = new Map(FURNITURE_CATALOG.map(f => [f.itemId, f.name]));

  const items = rows.map(r => ({
    id: r.id,
    item_id: r.item_id,
    name: catalogMap.get(r.item_id) || 'unknown',
    x: r.x,
    y: r.y,
    rotation: r.rot,
  }));

  sendJSON(res, 200, { items });
  return true;
}

// --- Action handlers ---

async function handleActionMove(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'move');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Move cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const { roomId } = body;

  if (!roomId || typeof roomId !== 'number') {
    sendJSON(res, 400, { error: 'Missing or invalid roomId (number)' });
    return true;
  }

  // Verify room exists
  const room = worldRef?.rooms.find(r => r.id === roomId);
  if (!room) {
    sendJSON(res, 404, { error: 'Room not found' });
    return true;
  }

  // Move bot via DB update or WebSocket
  if (CONFIG.USE_WEBSOCKET_AGENTS) {
    const pool = getClientPool();
    await pool.moveToRoom(agent.botId, roomId);
  } else {
    await execute(`UPDATE bots SET room_id = ? WHERE id = ?`, [roomId, agent.botId]);
  }

  sendJSON(res, 200, { ok: true, room: { id: room.id, name: room.name, purpose: room.purpose } });
  return true;
}

async function handleActionChat(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'chat');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Chat cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const { message } = body;

  if (!message || typeof message !== 'string') {
    sendJSON(res, 400, { error: 'Missing or invalid message (string)' });
    return true;
  }

  if (message.length > 100) {
    sendJSON(res, 400, { error: 'Message too long (max 100 characters)' });
    return true;
  }

  // Check bot is in a room
  const bot = getBotFromWorld(agent.botId);
  if (!bot?.currentRoomId) {
    sendJSON(res, 400, { error: 'Agent is not in any room. Move to a room first.' });
    return true;
  }

  const success = await botTalk(agent.botId, message);
  if (!success) {
    sendJSON(res, 502, { error: 'Failed to send chat (emulator may be down)' });
    return true;
  }

  // Add to world chat history
  if (worldRef) {
    const history = worldRef.roomChatHistory.get(bot.currentRoomId) || [];
    history.push({
      agentId: agent.botId,
      agentName: agent.name,
      message,
      tick: worldRef.tick,
    });
    worldRef.roomChatHistory.set(bot.currentRoomId, history);
  }

  sendJSON(res, 200, { ok: true, message });
  return true;
}

async function handleActionShout(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'shout');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Shout cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const { message } = body;

  if (!message || typeof message !== 'string') {
    sendJSON(res, 400, { error: 'Missing or invalid message (string)' });
    return true;
  }
  if (message.length > 100) {
    sendJSON(res, 400, { error: 'Message too long (max 100 characters)' });
    return true;
  }

  const bot = getBotFromWorld(agent.botId);
  if (!bot?.currentRoomId) {
    sendJSON(res, 400, { error: 'Agent is not in any room. Move to a room first.' });
    return true;
  }

  const success = await botShout(agent.botId, message);
  if (!success) {
    sendJSON(res, 502, { error: 'Failed to shout (emulator may be down)' });
    return true;
  }

  sendJSON(res, 200, { ok: true, message });
  return true;
}

async function handleActionDance(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'dance');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Dance cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const style = typeof body.style === 'number' ? body.style : 1;

  if (style < 0 || style > 4) {
    sendJSON(res, 400, { error: 'Dance style must be 0-4 (0=stop)' });
    return true;
  }

  const bot = getBotFromWorld(agent.botId);
  if (!bot?.currentRoomId) {
    sendJSON(res, 400, { error: 'Agent is not in any room. Move to a room first.' });
    return true;
  }

  const success = await botDance(agent.botId, style);
  if (!success) {
    sendJSON(res, 502, { error: 'Failed to dance (emulator may be down)' });
    return true;
  }

  sendJSON(res, 200, { ok: true, style });
  return true;
}

async function handleActionGesture(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'gesture');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Gesture cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const { type } = body;

  if (!type || typeof type !== 'string') {
    sendJSON(res, 400, { error: 'Missing gesture type' });
    return true;
  }

  const actionId = GESTURE_MAP[type];
  if (actionId === undefined) {
    sendJSON(res, 400, { error: `Invalid gesture type. Valid: ${Object.keys(GESTURE_MAP).join(', ')}` });
    return true;
  }

  const bot = getBotFromWorld(agent.botId);
  if (!bot?.currentRoomId) {
    sendJSON(res, 400, { error: 'Agent is not in any room. Move to a room first.' });
    return true;
  }

  const success = await botAction(agent.botId, actionId);
  if (!success) {
    sendJSON(res, 502, { error: 'Failed to gesture (emulator may be down)' });
    return true;
  }

  sendJSON(res, 200, { ok: true, gesture: type });
  return true;
}

// --- New Action handlers ---

async function handleActionCreateRoom(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'create_room');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Create room cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const { name, description, model } = body;

  if (!name || typeof name !== 'string') {
    sendJSON(res, 400, { error: 'Missing or invalid name (string)' });
    return true;
  }
  if (name.length > 50) {
    sendJSON(res, 400, { error: 'Room name too long (max 50 characters)' });
    return true;
  }

  const chosenModel = model || 'model_a';
  if (!MODELS.includes(chosenModel)) {
    sendJSON(res, 400, { error: `Invalid model. Valid: ${MODELS.join(', ')}` });
    return true;
  }

  // Check credits
  const creditRows = await query<{ credits: number }>(
    `SELECT credits FROM users WHERE id = ?`, [agent.userId]
  );
  const credits = creditRows[0]?.credits || 0;
  if (credits < CONFIG.ROOM_CREATION_COST) {
    sendJSON(res, 400, { error: `Not enough credits. Need ${CONFIG.ROOM_CREATION_COST}, have ${credits}` });
    return true;
  }

  // Check room limit
  const roomCountRows = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM rooms WHERE owner_id = ?`, [agent.userId]
  );
  if ((roomCountRows[0]?.cnt || 0) >= CONFIG.MAX_ROOMS_PER_AGENT) {
    sendJSON(res, 400, { error: `Room limit reached (max ${CONFIG.MAX_ROOMS_PER_AGENT})` });
    return true;
  }

  // Get owner username
  const ownerRows = await query<{ username: string }>(
    `SELECT username FROM users WHERE id = ?`, [agent.userId]
  );
  const ownerName = ownerRows[0]?.username || `ext_${agent.name.toLowerCase()}`;

  // Create room
  const roomDesc = description || `A room created by ${agent.name}`;
  const result = await execute(
    `INSERT INTO rooms (owner_id, owner_name, name, description, model, state, users_max, trade_mode, category)
     VALUES (?, ?, ?, ?, ?, 'open', 25, 0, 1)`,
    [agent.userId, ownerName, name, roomDesc, chosenModel]
  );

  // Create simulation_room_stats record
  await execute(
    `INSERT INTO simulation_room_stats (room_id, purpose) VALUES (?, 'hangout')`,
    [result.insertId]
  );

  // Deduct credits
  await execute(
    `UPDATE users SET credits = credits - ? WHERE id = ?`,
    [CONFIG.ROOM_CREATION_COST, agent.userId]
  );

  console.log(`[EXT-API] Agent ${agent.name} created room "${name}" (id=${result.insertId})`);

  sendJSON(res, 201, {
    ok: true,
    room: {
      id: result.insertId,
      name,
      description: roomDesc,
      model: chosenModel,
    },
    credits_remaining: credits - CONFIG.ROOM_CREATION_COST,
  });
  return true;
}

async function handleActionWalk(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'walk');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Walk cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const { x, y } = body;

  if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || y < 0 || !Number.isInteger(x) || !Number.isInteger(y)) {
    sendJSON(res, 400, { error: 'x and y must be non-negative integers' });
    return true;
  }

  const bot = getBotFromWorld(agent.botId);
  if (!bot?.currentRoomId) {
    sendJSON(res, 400, { error: 'Agent is not in any room. Move to a room first.' });
    return true;
  }

  if (CONFIG.USE_WEBSOCKET_AGENTS) {
    const pool = getClientPool();
    pool.send(agent.botId, buildWalkPacket(x, y));
  } else {
    await execute(`UPDATE bots SET x = ?, y = ? WHERE id = ?`, [x, y, agent.botId]);
  }

  sendJSON(res, 200, { ok: true, x, y });
  return true;
}

async function handleActionBuy(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'buy');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Buy cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const { itemId } = body;

  if (typeof itemId !== 'number') {
    sendJSON(res, 400, { error: 'Missing or invalid itemId (number)' });
    return true;
  }

  // Validate item exists in catalog
  const catalogItem = FURNITURE_CATALOG.find(f => f.itemId === itemId);
  if (!catalogItem) {
    sendJSON(res, 400, { error: `Item ${itemId} not found in catalog. Use GET /api/v1/world/catalog to see available items.` });
    return true;
  }

  // Check credits
  const creditRows = await query<{ credits: number }>(
    `SELECT credits FROM users WHERE id = ?`, [agent.userId]
  );
  const credits = creditRows[0]?.credits || 0;
  if (credits < catalogItem.cost) {
    sendJSON(res, 400, { error: `Not enough credits. Need ${catalogItem.cost}, have ${credits}` });
    return true;
  }

  // Check inventory cap
  const invRows = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM items WHERE user_id = ? AND room_id = 0`, [agent.userId]
  );
  if ((invRows[0]?.cnt || 0) >= CONFIG.MAX_INVENTORY_ITEMS) {
    sendJSON(res, 400, { error: `Inventory full (max ${CONFIG.MAX_INVENTORY_ITEMS}). Place or trade items first.` });
    return true;
  }

  // Insert item into inventory
  const itemResult = await execute(
    `INSERT INTO items (user_id, room_id, item_id, x, y, z, rot, extra_data)
     VALUES (?, 0, ?, 0, 0, 0, 0, '0')`,
    [agent.userId, catalogItem.itemId]
  );

  // Deduct credits
  await execute(
    `UPDATE users SET credits = credits - ? WHERE id = ?`,
    [catalogItem.cost, agent.userId]
  );

  sendJSON(res, 200, {
    ok: true,
    item: {
      id: itemResult.insertId,
      item_id: catalogItem.itemId,
      name: catalogItem.name,
      cost: catalogItem.cost,
    },
    credits_remaining: credits - catalogItem.cost,
  });
  return true;
}

async function handleActionPlaceItem(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'place_item');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Place item cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const { itemId, x, y, rotation } = body;

  if (typeof itemId !== 'number') {
    sendJSON(res, 400, { error: 'Missing or invalid itemId (number)' });
    return true;
  }
  if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || y < 0 || !Number.isInteger(x) || !Number.isInteger(y)) {
    sendJSON(res, 400, { error: 'x and y must be non-negative integers' });
    return true;
  }
  const rot = typeof rotation === 'number' ? rotation : 0;

  // Check agent is in a room
  const bot = getBotFromWorld(agent.botId);
  if (!bot?.currentRoomId) {
    sendJSON(res, 400, { error: 'Agent is not in any room. Move to a room first.' });
    return true;
  }

  // Verify agent owns the room
  const roomRows = await query<{ owner_id: number }>(
    `SELECT owner_id FROM rooms WHERE id = ?`, [bot.currentRoomId]
  );
  if (!roomRows.length || roomRows[0].owner_id !== agent.userId) {
    sendJSON(res, 403, { error: 'You can only place items in rooms you own' });
    return true;
  }

  // Verify agent owns the item and it's in inventory (room_id = 0)
  const itemRows = await query<{ id: number; user_id: number; room_id: number }>(
    `SELECT id, user_id, room_id FROM items WHERE id = ?`, [itemId]
  );
  if (!itemRows.length) {
    sendJSON(res, 404, { error: 'Item not found' });
    return true;
  }
  if (itemRows[0].user_id !== agent.userId) {
    sendJSON(res, 403, { error: 'You do not own this item' });
    return true;
  }
  if (itemRows[0].room_id !== 0) {
    sendJSON(res, 400, { error: 'Item is not in your inventory (already placed in a room)' });
    return true;
  }

  // Place item
  await execute(
    `UPDATE items SET room_id = ?, x = ?, y = ?, rot = ? WHERE id = ?`,
    [bot.currentRoomId, x, y, rot, itemId]
  );

  sendJSON(res, 200, { ok: true, itemId, room_id: bot.currentRoomId, x, y, rotation: rot });
  return true;
}

async function handleActionPickupItem(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'pickup_item');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Pickup item cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const { itemId } = body;

  if (typeof itemId !== 'number') {
    sendJSON(res, 400, { error: 'Missing or invalid itemId (number)' });
    return true;
  }

  // Check agent is in a room
  const bot = getBotFromWorld(agent.botId);
  if (!bot?.currentRoomId) {
    sendJSON(res, 400, { error: 'Agent is not in any room. Move to a room first.' });
    return true;
  }

  // Verify agent owns the room
  const roomRows = await query<{ owner_id: number }>(
    `SELECT owner_id FROM rooms WHERE id = ?`, [bot.currentRoomId]
  );
  if (!roomRows.length || roomRows[0].owner_id !== agent.userId) {
    sendJSON(res, 403, { error: 'You can only pick up items in rooms you own' });
    return true;
  }

  // Verify the item is in this room
  const itemRows = await query<{ id: number; user_id: number; room_id: number }>(
    `SELECT id, user_id, room_id FROM items WHERE id = ?`, [itemId]
  );
  if (!itemRows.length) {
    sendJSON(res, 404, { error: 'Item not found' });
    return true;
  }
  if (itemRows[0].room_id !== bot.currentRoomId) {
    sendJSON(res, 400, { error: 'Item is not in your current room' });
    return true;
  }

  // Pick up item (move to inventory)
  await execute(
    `UPDATE items SET room_id = 0, x = 0, y = 0, rot = 0 WHERE id = ?`,
    [itemId]
  );

  sendJSON(res, 200, { ok: true, itemId });
  return true;
}

async function handleActionTrade(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'trade');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Trade cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const { targetAgentName, offerItemIds, offerCredits, requestCredits } = body;

  if (!targetAgentName || typeof targetAgentName !== 'string') {
    sendJSON(res, 400, { error: 'Missing or invalid targetAgentName (string)' });
    return true;
  }

  const hasItemOffer = Array.isArray(offerItemIds) && offerItemIds.length > 0;
  const hasCreditOffer = typeof offerCredits === 'number' && offerCredits > 0;
  const hasCreditRequest = typeof requestCredits === 'number' && requestCredits > 0;

  if (!hasItemOffer && !hasCreditOffer && !hasCreditRequest) {
    sendJSON(res, 400, { error: 'Must provide at least one of: offerItemIds, offerCredits, requestCredits' });
    return true;
  }

  // Check agent is in a room
  const bot = getBotFromWorld(agent.botId);
  if (!bot?.currentRoomId) {
    sendJSON(res, 400, { error: 'Agent is not in any room. Move to a room first.' });
    return true;
  }

  // Find target bot by name
  const targetBot = worldRef?.agents.find(a => a.name === targetAgentName);
  if (!targetBot) {
    sendJSON(res, 404, { error: `Agent "${targetAgentName}" not found` });
    return true;
  }

  // Verify same room
  if (targetBot.currentRoomId !== bot.currentRoomId) {
    sendJSON(res, 400, { error: `Agent "${targetAgentName}" is not in the same room` });
    return true;
  }

  // Get target user_id
  let targetUserId: number;
  if (CONFIG.USE_WEBSOCKET_AGENTS) {
    // In WS mode, agent.id = user.id (same)
    targetUserId = targetBot.userId;
  } else {
    const targetBotRows = await query<{ user_id: number }>(
      `SELECT user_id FROM bots WHERE id = ?`, [targetBot.id]
    );
    if (!targetBotRows.length) {
      sendJSON(res, 404, { error: 'Target agent bot not found in database' });
      return true;
    }
    targetUserId = targetBotRows[0].user_id;
  }

  // Execute trade atomically
  try {
    await withTransaction(async (conn) => {
      // Validate and transfer items
      if (hasItemOffer) {
        for (const offeredItemId of offerItemIds) {
          const [rows] = await conn.execute(
            `SELECT id, user_id, room_id FROM items WHERE id = ? FOR UPDATE`,
            [offeredItemId]
          );
          const items = rows as any[];
          if (!items.length) throw new Error(`Item ${offeredItemId} not found`);
          if (items[0].user_id !== agent.userId) throw new Error(`You don't own item ${offeredItemId}`);
          if (items[0].room_id !== 0) throw new Error(`Item ${offeredItemId} is not in your inventory`);

          await conn.execute(
            `UPDATE items SET user_id = ? WHERE id = ?`,
            [targetUserId, offeredItemId]
          );
        }
      }

      // Handle credit transfers
      if (hasCreditOffer) {
        const [rows] = await conn.execute(
          `SELECT credits FROM users WHERE id = ? FOR UPDATE`, [agent.userId]
        );
        const agentCredits = (rows as any[])[0]?.credits || 0;
        if (agentCredits < offerCredits) throw new Error(`Not enough credits. Have ${agentCredits}, offering ${offerCredits}`);

        await conn.execute(`UPDATE users SET credits = credits - ? WHERE id = ?`, [offerCredits, agent.userId]);
        await conn.execute(`UPDATE users SET credits = credits + ? WHERE id = ?`, [offerCredits, targetUserId]);
      }

      if (hasCreditRequest) {
        const [rows] = await conn.execute(
          `SELECT credits FROM users WHERE id = ? FOR UPDATE`, [targetUserId]
        );
        const targetCredits = (rows as any[])[0]?.credits || 0;
        if (targetCredits < requestCredits) throw new Error(`Target doesn't have enough credits (${targetCredits} < ${requestCredits})`);

        await conn.execute(`UPDATE users SET credits = credits - ? WHERE id = ?`, [requestCredits, targetUserId]);
        await conn.execute(`UPDATE users SET credits = credits + ? WHERE id = ?`, [requestCredits, agent.userId]);
      }
    });
  } catch (err: any) {
    sendJSON(res, 400, { error: `Trade failed: ${err.message}` });
    return true;
  }

  sendJSON(res, 200, {
    ok: true,
    trade: {
      target: targetAgentName,
      items_given: offerItemIds || [],
      credits_given: offerCredits || 0,
      credits_received: requestCredits || 0,
    },
  });
  return true;
}

async function handleActionLook(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'look');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Look cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const { figure } = body;

  if (!figure || typeof figure !== 'string') {
    sendJSON(res, 400, { error: 'Missing or invalid figure (string)' });
    return true;
  }
  if (figure.length > 500) {
    sendJSON(res, 400, { error: 'Figure string too long (max 500 characters)' });
    return true;
  }
  if (!FIGURE_REGEX.test(figure)) {
    sendJSON(res, 400, { error: 'Invalid figure format. Expected: partType-partId-colorId.partType-partId-colorId... (e.g. hr-115-42.hd-195-19.ch-3030-82.lg-275-1408)' });
    return true;
  }

  if (CONFIG.USE_WEBSOCKET_AGENTS) {
    await execute(`UPDATE users SET look = ? WHERE id = ?`, [figure, agent.botId]);
  } else {
    await execute(`UPDATE bots SET figure = ? WHERE id = ?`, [figure, agent.botId]);
  }

  sendJSON(res, 200, { ok: true, figure });
  return true;
}

async function handleActionMotto(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'motto');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Motto cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const { motto } = body;

  if (typeof motto !== 'string') {
    sendJSON(res, 400, { error: 'Missing or invalid motto (string)' });
    return true;
  }
  if (motto.length > 127) {
    sendJSON(res, 400, { error: 'Motto too long (max 127 characters)' });
    return true;
  }

  if (CONFIG.USE_WEBSOCKET_AGENTS) {
    await execute(`UPDATE users SET motto = ? WHERE id = ?`, [motto, agent.botId]);
  } else {
    await execute(`UPDATE bots SET motto = ? WHERE id = ?`, [motto, agent.botId]);
  }

  sendJSON(res, 200, { ok: true, motto });
  return true;
}

// --- Whisper handler ---

async function handleActionWhisper(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'whisper');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Whisper cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  const body = await parseBody(req);
  const { targetAgentName, message } = body;

  if (!targetAgentName || typeof targetAgentName !== 'string') {
    sendJSON(res, 400, { error: 'Missing or invalid targetAgentName (string)' });
    return true;
  }
  if (!message || typeof message !== 'string') {
    sendJSON(res, 400, { error: 'Missing or invalid message (string)' });
    return true;
  }
  if (message.length > 100) {
    sendJSON(res, 400, { error: 'Message too long (max 100 characters)' });
    return true;
  }

  const bot = getBotFromWorld(agent.botId);
  if (!bot?.currentRoomId) {
    sendJSON(res, 400, { error: 'Agent is not in any room. Move to a room first.' });
    return true;
  }

  // Verify target is in the same room
  const targetBot = worldRef?.agents.find(a => a.name === targetAgentName);
  if (!targetBot) {
    sendJSON(res, 404, { error: `Agent "${targetAgentName}" not found` });
    return true;
  }
  if (targetBot.currentRoomId !== bot.currentRoomId) {
    sendJSON(res, 400, { error: `Agent "${targetAgentName}" is not in the same room` });
    return true;
  }

  const success = await botWhisper(agent.botId, targetAgentName, message);
  if (!success) {
    sendJSON(res, 502, { error: 'Failed to whisper (emulator may be down)' });
    return true;
  }

  sendJSON(res, 200, { ok: true, target: targetAgentName, message });
  return true;
}

// --- Host party handler ---

async function handleActionHostParty(agent: ExternalAgent, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rateCheck = checkActionRate(agent.id, 'host_party');
  if (!rateCheck.allowed) {
    sendJSON(res, 429, { error: 'Host party cooldown active', retryAfterMs: rateCheck.retryAfterMs });
    return true;
  }

  if (!worldRef) {
    sendJSON(res, 503, { error: 'World not ready' });
    return true;
  }

  const bot = getBotFromWorld(agent.botId);
  if (!bot?.currentRoomId) {
    sendJSON(res, 400, { error: 'Agent is not in any room. Move to a room first.' });
    return true;
  }

  if (!canHostParty(bot, worldRef)) {
    // Determine specific reason
    const room = worldRef.rooms.find(r => r.id === bot.currentRoomId);
    if (!room) {
      sendJSON(res, 400, { error: 'Room not found' });
      return true;
    }
    if (room.ownerId !== agent.userId && bot.preferences?.homeRoomId !== bot.currentRoomId) {
      sendJSON(res, 400, { error: 'You can only host parties in rooms you own or your home room' });
      return true;
    }
    if (bot.credits < CONFIG.PARTY_COST) {
      sendJSON(res, 400, { error: `Not enough credits. Need ${CONFIG.PARTY_COST}, have ${bot.credits}` });
      return true;
    }
    if (worldRef.activeParties.length >= CONFIG.PARTY_MAX_ACTIVE) {
      sendJSON(res, 400, { error: 'Maximum active parties reached' });
      return true;
    }
    if (worldRef.activeParties.some(p => p.roomId === bot.currentRoomId)) {
      sendJSON(res, 400, { error: 'There is already a party in this room' });
      return true;
    }
    sendJSON(res, 400, { error: 'Cannot host party (cooldown or other restriction)' });
    return true;
  }

  await hostParty(bot, worldRef);

  const room = worldRef.rooms.find(r => r.id === bot.currentRoomId);
  sendJSON(res, 200, {
    ok: true,
    party: {
      room_id: bot.currentRoomId,
      room_name: room?.name || 'Unknown',
      cost: CONFIG.PARTY_COST,
    },
  });
  return true;
}

// --- Social & Relationships handlers ---

async function handleSocialRelationships(agent: ExternalAgent, res: ServerResponse): Promise<boolean> {
  const rows = await query<{ agent_id: number; target_agent_id: number; score: number; interactions: number }>(
    `SELECT agent_id, target_agent_id, score, interactions FROM simulation_relationships WHERE agent_id = ? OR target_agent_id = ?`,
    [agent.botId, agent.botId]
  );

  // Build lookup for agent names
  const agentIds = new Set<number>();
  for (const r of rows) {
    agentIds.add(r.agent_id);
    agentIds.add(r.target_agent_id);
  }
  const nameMap = new Map<number, string>();
  if (worldRef) {
    for (const a of worldRef.agents) {
      if (agentIds.has(a.id)) nameMap.set(a.id, a.name);
    }
  }

  const relationships = rows.map(r => {
    const otherId = r.agent_id === agent.botId ? r.target_agent_id : r.agent_id;
    return {
      agent_name: nameMap.get(otherId) || `agent_${otherId}`,
      score: r.score,
      interactions: r.interactions,
      status: r.score >= 50 ? 'close_friend' : r.score >= 20 ? 'friend' : r.score <= -30 ? 'rival' : r.score <= -10 ? 'avoid' : 'neutral',
    };
  });

  sendJSON(res, 200, { relationships });
  return true;
}

async function handleSocialRelationshipDetail(agent: ExternalAgent, targetName: string, res: ServerResponse): Promise<boolean> {
  // Find target by name
  const targetBot = worldRef?.agents.find(a => a.name === targetName);
  if (!targetBot) {
    sendJSON(res, 404, { error: `Agent "${targetName}" not found` });
    return true;
  }

  const rows = await query<{ score: number; interactions: number; last_interaction: string }>(
    `SELECT score, interactions, last_interaction FROM simulation_relationships
     WHERE (agent_id = ? AND target_agent_id = ?) OR (agent_id = ? AND target_agent_id = ?)`,
    [agent.botId, targetBot.id, targetBot.id, agent.botId]
  );

  if (rows.length === 0) {
    sendJSON(res, 200, { agent_name: targetName, score: 0, interactions: 0, status: 'stranger', memories: [] });
    return true;
  }

  const rel = rows[0];
  const status = rel.score >= 50 ? 'close_friend' : rel.score >= 20 ? 'friend' : rel.score <= -30 ? 'rival' : rel.score <= -10 ? 'avoid' : 'neutral';

  // Fetch shared memories
  const memories = await query<{ event_type: string; summary: string; sentiment: number; created_at: string }>(
    `SELECT event_type, summary, sentiment, created_at FROM simulation_agent_memory
     WHERE (agent_id = ? AND target_agent_id = ?) OR (agent_id = ? AND target_agent_id = ?)
     ORDER BY created_at DESC LIMIT 10`,
    [agent.botId, targetBot.id, targetBot.id, agent.botId]
  );

  sendJSON(res, 200, {
    agent_name: targetName,
    score: rel.score,
    interactions: rel.interactions,
    status,
    memories: memories.map(m => ({
      event_type: m.event_type,
      summary: m.summary,
      sentiment: m.sentiment,
      time: m.created_at,
    })),
  });
  return true;
}

// --- Agent public profile ---

async function handleWorldAgentProfile(agentName: string, res: ServerResponse): Promise<boolean> {
  if (!worldRef) {
    sendJSON(res, 503, { error: 'World not ready' });
    return true;
  }

  const bot = worldRef.agents.find(a => a.name === agentName);
  if (!bot) {
    sendJSON(res, 404, { error: `Agent "${agentName}" not found` });
    return true;
  }

  // Rooms owned
  const roomRows = await query<{ id: number; name: string }>(
    `SELECT id, name FROM rooms WHERE owner_id = ?`, [bot.userId]
  );

  // Motto
  const userRows = await query<{ motto: string; credits: number }>(
    CONFIG.USE_WEBSOCKET_AGENTS
      ? `SELECT motto, credits FROM users WHERE id = ?`
      : `SELECT b.motto, u.credits FROM bots b JOIN users u ON b.user_id = u.id WHERE b.id = ?`,
    [bot.id]
  );

  // Fame score (count of positive memories + interactions)
  const fameRows = await query<{ fame: number }>(
    `SELECT COUNT(*) as fame FROM simulation_agent_memory WHERE agent_id = ? AND sentiment > 0`,
    [bot.id]
  );

  sendJSON(res, 200, {
    name: bot.name,
    state: bot.state,
    current_room_id: bot.currentRoomId,
    current_room_name: worldRef.rooms.find(r => r.id === bot.currentRoomId)?.name || null,
    motto: userRows[0]?.motto || '',
    credits: userRows[0]?.credits || 0,
    fame: fameRows[0]?.fame || 0,
    rooms_owned: roomRows.map(r => ({ id: r.id, name: r.name })),
  });
  return true;
}

// --- Activity & History handlers ---

async function handleWorldFeed(res: ServerResponse): Promise<boolean> {
  const rows = await query<{
    agent_id: number; target_agent_id: number | null;
    event_type: string; summary: string; sentiment: number; created_at: string;
  }>(
    `SELECT agent_id, target_agent_id, event_type, summary, sentiment, created_at
     FROM simulation_agent_memory
     WHERE event_type IN ('trade', 'gift', 'argument', 'reunion', 'announcement', 'chat')
     ORDER BY created_at DESC LIMIT 50`
  );

  // Build name map
  const ids = new Set<number>();
  for (const r of rows) {
    ids.add(r.agent_id);
    if (r.target_agent_id) ids.add(r.target_agent_id);
  }
  const nameMap = new Map<number, string>();
  if (worldRef) {
    for (const a of worldRef.agents) {
      if (ids.has(a.id)) nameMap.set(a.id, a.name);
    }
  }

  const feed = rows.map(r => ({
    agent_name: nameMap.get(r.agent_id) || `agent_${r.agent_id}`,
    target_name: r.target_agent_id ? (nameMap.get(r.target_agent_id) || `agent_${r.target_agent_id}`) : null,
    event_type: r.event_type,
    summary: r.summary,
    sentiment: r.sentiment,
    time: r.created_at,
  }));

  sendJSON(res, 200, { feed });
  return true;
}

async function handleAgentMemories(agent: ExternalAgent, res: ServerResponse): Promise<boolean> {
  const rows = await query<{
    target_agent_id: number | null;
    event_type: string; summary: string; sentiment: number;
    room_id: number | null; created_at: string;
  }>(
    `SELECT target_agent_id, event_type, summary, sentiment, room_id, created_at
     FROM simulation_agent_memory
     WHERE agent_id = ?
     ORDER BY created_at DESC LIMIT 30`,
    [agent.botId]
  );

  const nameMap = new Map<number, string>();
  if (worldRef) {
    const ids = new Set(rows.filter(r => r.target_agent_id).map(r => r.target_agent_id!));
    for (const a of worldRef.agents) {
      if (ids.has(a.id)) nameMap.set(a.id, a.name);
    }
  }

  const memories = rows.map(r => ({
    target_name: r.target_agent_id ? (nameMap.get(r.target_agent_id) || `agent_${r.target_agent_id}`) : null,
    event_type: r.event_type,
    summary: r.summary,
    sentiment: r.sentiment,
    room_id: r.room_id,
    time: r.created_at,
  }));

  sendJSON(res, 200, { memories });
  return true;
}

async function handleAgentStats(agent: ExternalAgent, res: ServerResponse): Promise<boolean> {
  // Total interactions
  const interactionRows = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM simulation_agent_memory WHERE agent_id = ?`,
    [agent.botId]
  );

  // Trades
  const tradeRows = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM simulation_agent_memory WHERE agent_id = ? AND event_type = 'trade'`,
    [agent.botId]
  );

  // Distinct rooms visited
  const roomRows = await query<{ cnt: number }>(
    `SELECT COUNT(DISTINCT room_id) as cnt FROM simulation_agent_memory WHERE agent_id = ? AND room_id IS NOT NULL`,
    [agent.botId]
  );

  // Credits
  const creditRows = await query<{ credits: number }>(
    `SELECT credits FROM users WHERE id = ?`, [agent.userId]
  );

  // Relationships count
  const relRows = await query<{ friends: number; rivals: number }>(
    `SELECT
       SUM(CASE WHEN score >= 20 THEN 1 ELSE 0 END) as friends,
       SUM(CASE WHEN score <= -10 THEN 1 ELSE 0 END) as rivals
     FROM simulation_relationships
     WHERE agent_id = ? OR target_agent_id = ?`,
    [agent.botId, agent.botId]
  );

  sendJSON(res, 200, {
    total_interactions: interactionRows[0]?.cnt || 0,
    total_trades: tradeRows[0]?.cnt || 0,
    rooms_visited: roomRows[0]?.cnt || 0,
    credits: creditRows[0]?.credits || 0,
    friends: relRows[0]?.friends || 0,
    rivals: relRows[0]?.rivals || 0,
  });
  return true;
}

// --- Discovery handlers ---

async function handleWorldLeaderboard(res: ServerResponse): Promise<boolean> {
  // Top by credits
  const richest = await query<{ id: number; username: string; credits: number }>(
    `SELECT u.id, u.username, u.credits FROM users u
     WHERE u.username NOT LIKE 'sim_owner_%' AND u.username != 'spectator'
     ORDER BY u.credits DESC LIMIT 20`
  );

  // Top by fame (positive memories count)
  const famous = await query<{ agent_id: number; fame: number }>(
    `SELECT agent_id, COUNT(*) as fame FROM simulation_agent_memory
     WHERE sentiment > 0
     GROUP BY agent_id ORDER BY fame DESC LIMIT 20`
  );

  // Top by interactions
  const social = await query<{ agent_id: number; interactions: number }>(
    `SELECT agent_id, COUNT(*) as interactions FROM simulation_agent_memory
     GROUP BY agent_id ORDER BY interactions DESC LIMIT 20`
  );

  // Build name map
  const nameMap = new Map<number, string>();
  if (worldRef) {
    for (const a of worldRef.agents) nameMap.set(a.id, a.name);
  }

  sendJSON(res, 200, {
    richest: richest.map(r => ({ name: r.username, credits: r.credits })),
    most_famous: famous.map(r => ({ name: nameMap.get(r.agent_id) || `agent_${r.agent_id}`, fame: r.fame })),
    most_social: social.map(r => ({ name: nameMap.get(r.agent_id) || `agent_${r.agent_id}`, interactions: r.interactions })),
  });
  return true;
}

async function handleWorldHotRooms(res: ServerResponse): Promise<boolean> {
  if (!worldRef) {
    sendJSON(res, 503, { error: 'World not ready' });
    return true;
  }

  const hotRooms = worldRef.rooms
    .map(r => {
      const hasParty = worldRef.activeParties.some(p => p.roomId === r.id) ? 1 : 0;
      const recentChat = (worldRef.roomChatHistory.get(r.id) || []).length;
      const hotness = r.currentPopulation * 3 + hasParty * 20 + recentChat;
      return {
        id: r.id,
        name: r.name,
        owner_name: r.ownerName,
        purpose: r.purpose,
        population: r.currentPopulation,
        has_party: !!hasParty,
        hotness,
      };
    })
    .sort((a, b) => b.hotness - a.hotness)
    .slice(0, 20);

  sendJSON(res, 200, { rooms: hotRooms });
  return true;
}

// --- Economy handler ---

async function handleWorldMarket(res: ServerResponse): Promise<boolean> {
  const rows = await query<{ item_name: string; avg_price: number; last_price: number; volume: number; updated_at: string }>(
    `SELECT item_name, avg_price, last_price, volume, updated_at FROM simulation_market_prices ORDER BY volume DESC`
  );

  sendJSON(res, 200, {
    prices: rows.map(r => ({
      item_name: r.item_name,
      avg_price: r.avg_price,
      last_price: r.last_price,
      volume: r.volume,
      updated_at: r.updated_at,
    })),
  });
  return true;
}

// --- Helpers ---

function getBotFromWorld(botId: number) {
  if (!worldRef) return null;
  return worldRef.agents.find(a => a.id === botId) || null;
}
