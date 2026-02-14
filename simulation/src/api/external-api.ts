import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, execute } from '../db.js';
import { rconBotTalk, rconBotShout, rconBotDance, rconBotAction } from '../emulator/rcon.js';
import { authenticateAgent, registerExternalAgent, updateHeartbeat, getExternalAgentCount } from './external-agents.js';
import { checkGlobalRate, checkActionRate } from './rate-limiter.js';
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
      return handleAgentMe(agent, res);
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
    if (url === '/api/v1/world/agents' && method === 'GET') {
      return handleWorldAgents(res);
    }
    if (url === '/api/v1/world/me' && method === 'GET') {
      return handleWorldMe(agent, res);
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

function handleAgentMe(agent: ExternalAgent, res: ServerResponse): boolean {
  // Get bot's current room from world state
  const bot = getBotFromWorld(agent.botId);
  sendJSON(res, 200, {
    id: agent.id,
    name: agent.name,
    bot_id: agent.botId,
    description: agent.description,
    status: agent.status,
    current_room_id: bot?.currentRoomId || null,
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

function handleWorldMe(agent: ExternalAgent, res: ServerResponse): boolean {
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

  sendJSON(res, 200, {
    room: room ? { id: room.id, name: room.name, purpose: room.purpose, population: room.currentPopulation } : null,
    nearby_agents: nearbyAgents,
    recent_chat: recentChat,
    tick: worldRef.tick,
  });
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

  // Move bot via DB update
  await execute(`UPDATE bots SET room_id = ? WHERE id = ?`, [roomId, agent.botId]);

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

  const success = await rconBotTalk(agent.botId, message);
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

  const success = await rconBotShout(agent.botId, message);
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

  const success = await rconBotDance(agent.botId, style);
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

  const success = await rconBotAction(agent.botId, actionId);
  if (!success) {
    sendJSON(res, 502, { error: 'Failed to gesture (emulator may be down)' });
    return true;
  }

  sendJSON(res, 200, { ok: true, gesture: type });
  return true;
}

// --- Helpers ---

function getBotFromWorld(botId: number) {
  if (!worldRef) return null;
  return worldRef.agents.find(a => a.id === botId) || null;
}
