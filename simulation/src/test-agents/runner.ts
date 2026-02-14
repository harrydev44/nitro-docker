// Test bot runner — autonomous bots that exercise the HTTP API during development.
// Activated via env var TEST_AGENTS=N (0 or unset = disabled).

import { CONFIG } from '../config.js';

const BASE_URL = `http://localhost:${CONFIG.STATS_PORT}`;

// --- Embedded data ---

const CHAT_PHRASES = [
  'Hey everyone!',
  'This room is cool',
  'Anyone wanna trade?',
  'Just bought new furniture!',
  'Whats up',
  'Love this place',
  'lol nice',
  'brb',
  'Check out my room later',
  'How do I get more credits?',
  'Anyone seen the new catalog items?',
  'Haha good one',
  'Gonna redecorate my room',
  'This hotel is awesome',
  'Whos the DJ today?',
  'Party at my place soon!',
  'Nice outfit!',
  'Im bored, lets do something',
  'Can someone help me?',
  'See you guys later!',
];

const FIGURE_PRESETS = [
  'hr-115-42.hd-195-19.ch-3030-82.lg-275-1408',
  'hr-828-45.hd-180-2.ch-255-91.lg-280-82',
  'hr-515-33.hd-600-1.ch-635-70.lg-710-63',
  'hr-165-31.hd-190-1.ch-220-62.lg-285-82',
  'hr-831-45.hd-180-14.ch-255-82.lg-280-110',
  'hr-100-40.hd-195-2.ch-3030-62.lg-275-110',
  'hr-515-42.hd-600-19.ch-635-82.lg-710-82',
  'hr-828-33.hd-180-1.ch-255-70.lg-280-63',
  'hr-165-45.hd-190-14.ch-220-91.lg-285-110',
  'hr-831-31.hd-180-2.ch-255-62.lg-280-82',
];

const MOTTOS = [
  'Living my best pixel life',
  'Habbo veteran since day one',
  'Trade king',
  'Room designer extraordinaire',
  'Just vibing',
  'Credits make the world go round',
  'Furniture collector',
  'Party animal',
  'New here, be nice!',
  'AFK - back soon',
];

const ROOM_NAMES = [
  'Chill Zone',
  'Epic Lounge',
  'Pixel Paradise',
  'The Hangout',
  'Neon Nights',
  'Cozy Corner',
  'Club Retro',
  'Golden Room',
];

const GESTURES = ['wave', 'laugh', 'blow_kiss', 'jump', 'thumbs_up'];

// --- HTTP helpers ---

interface BotState {
  name: string;
  apiKey: string;
  roomId: number | null;
  roomsOwned: number;
}

async function api(method: string, path: string, apiKey: string, body?: any): Promise<any> {
  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json();

  if (res.status === 429) {
    throw Object.assign(new Error('rate_limited'), { status: 429 });
  }
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  }
  return data;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// --- Registration ---

async function registerBot(name: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/v1/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: 'Dev test bot' }),
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Registration failed: ${res.status}`);
  }
  return data.api_key;
}

async function registerWithRetry(baseName: string, maxAttempts = 5): Promise<{ name: string; apiKey: string }> {
  let name = baseName;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const apiKey = await registerBot(name);
      return { name, apiKey };
    } catch (err: any) {
      if (err.message.includes('already taken') || err.message.includes('already exists') || err.message.includes('conflicts')) {
        name = `${baseName}${randInt(10, 99)}`;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to register after ${maxAttempts} attempts: ${baseName}`);
}

// --- Action executors ---

async function doChat(bot: BotState): Promise<string> {
  const message = pick(CHAT_PHRASES);
  await api('POST', '/api/v1/actions/chat', bot.apiKey, { message });
  return `chatted "${message}"`;
}

async function doMoveRoom(bot: BotState): Promise<string> {
  const data = await api('GET', '/api/v1/world/rooms', bot.apiKey);
  const rooms: { id: number; name: string; population: number }[] = data.rooms || [];
  if (rooms.length === 0) return 'no rooms available';

  const room = pick(rooms);
  await api('POST', '/api/v1/actions/move', bot.apiKey, { roomId: room.id });
  bot.roomId = room.id;
  return `moved to "${room.name}" (id=${room.id})`;
}

async function doWalk(bot: BotState): Promise<string> {
  const x = randInt(0, 12);
  const y = randInt(0, 12);
  await api('POST', '/api/v1/actions/walk', bot.apiKey, { x, y });
  return `walked to (${x}, ${y})`;
}

async function doBuy(bot: BotState): Promise<string> {
  const data = await api('GET', '/api/v1/world/catalog', bot.apiKey);
  const items: { id: number; name: string; cost: number }[] = data.items || [];
  if (items.length === 0) return 'catalog empty';

  const item = pick(items);
  const result = await api('POST', '/api/v1/actions/buy', bot.apiKey, { itemId: item.id });
  return `bought ${item.name} (${item.cost}cr, remaining: ${result.credits_remaining})`;
}

async function doPlaceItem(bot: BotState): Promise<string> {
  const inv = await api('GET', '/api/v1/world/inventory', bot.apiKey);
  const items: { id: number; name: string }[] = inv.items || [];
  if (items.length === 0) return 'no items in inventory';

  const item = pick(items);
  const x = randInt(1, 10);
  const y = randInt(1, 10);
  await api('POST', '/api/v1/actions/place-item', bot.apiKey, { itemId: item.id, x, y, rotation: pick([0, 2, 4, 6]) });
  return `placed ${item.name} at (${x}, ${y})`;
}

async function doDanceOrGesture(bot: BotState): Promise<string> {
  if (Math.random() < 0.5) {
    const style = randInt(1, 4);
    await api('POST', '/api/v1/actions/dance', bot.apiKey, { style });
    return `started dancing (style ${style})`;
  } else {
    const gesture = pick(GESTURES);
    await api('POST', '/api/v1/actions/gesture', bot.apiKey, { type: gesture });
    return `did gesture: ${gesture}`;
  }
}

async function doTrade(bot: BotState): Promise<string> {
  // Get nearby agents
  const world = await api('GET', '/api/v1/world/me', bot.apiKey);
  const nearby: { name: string }[] = world.nearby_agents || [];
  if (nearby.length === 0) return 'nobody nearby to trade with';

  const target = pick(nearby);
  const credits = randInt(5, 30);
  await api('POST', '/api/v1/actions/trade', bot.apiKey, {
    targetAgentName: target.name,
    offerCredits: credits,
  });
  return `traded ${credits}cr to ${target.name}`;
}

async function doChangeLook(bot: BotState): Promise<string> {
  const figure = pick(FIGURE_PRESETS);
  await api('POST', '/api/v1/actions/look', bot.apiKey, { figure });
  return `changed look`;
}

async function doCreateRoom(bot: BotState): Promise<string> {
  const name = pick(ROOM_NAMES);
  const result = await api('POST', '/api/v1/actions/create-room', bot.apiKey, { name });
  bot.roomsOwned++;
  return `created room "${name}" (id=${result.room?.id})`;
}

async function doChangeMotto(bot: BotState): Promise<string> {
  const motto = pick(MOTTOS);
  await api('POST', '/api/v1/actions/motto', bot.apiKey, { motto });
  return `changed motto to "${motto}"`;
}

async function doPickupItem(bot: BotState): Promise<string> {
  const world = await api('GET', '/api/v1/world/me', bot.apiKey);
  const myItems: { id: number; name: string }[] = world.my_items_here || [];
  if (myItems.length === 0) return 'no own items to pick up';

  const item = pick(myItems);
  await api('POST', '/api/v1/actions/pickup-item', bot.apiKey, { itemId: item.id });
  return `picked up ${item.name}`;
}

// --- Weighted action picker ---

type Action = (bot: BotState) => Promise<string>;

const ACTIONS: { weight: number; name: string; fn: Action; requiresRoom: boolean }[] = [
  { weight: 25, name: 'chat',         fn: doChat,           requiresRoom: true },
  { weight: 15, name: 'move_room',    fn: doMoveRoom,       requiresRoom: false },
  { weight: 15, name: 'walk',         fn: doWalk,           requiresRoom: true },
  { weight: 10, name: 'buy',          fn: doBuy,            requiresRoom: false },
  { weight: 8,  name: 'place_item',   fn: doPlaceItem,      requiresRoom: true },
  { weight: 7,  name: 'dance_gesture',fn: doDanceOrGesture, requiresRoom: true },
  { weight: 5,  name: 'trade',        fn: doTrade,          requiresRoom: true },
  { weight: 5,  name: 'change_look',  fn: doChangeLook,     requiresRoom: false },
  { weight: 4,  name: 'create_room',  fn: doCreateRoom,     requiresRoom: false },
  { weight: 3,  name: 'change_motto', fn: doChangeMotto,    requiresRoom: false },
  { weight: 3,  name: 'pickup_item',  fn: doPickupItem,     requiresRoom: true },
];

const TOTAL_WEIGHT = ACTIONS.reduce((s, a) => s + a.weight, 0);

function pickAction(bot: BotState): { name: string; fn: Action } {
  // If not in a room, force a move
  if (!bot.roomId) {
    return { name: 'move_room', fn: doMoveRoom };
  }

  // Filter out create_room if at limit
  let actions = ACTIONS;
  if (bot.roomsOwned >= 3) {
    actions = actions.filter(a => a.name !== 'create_room');
  }

  const total = actions.reduce((s, a) => s + a.weight, 0);
  let roll = Math.random() * total;
  for (const action of actions) {
    roll -= action.weight;
    if (roll <= 0) return { name: action.name, fn: action.fn };
  }
  return { name: actions[0].name, fn: actions[0].fn };
}

// --- Bot loop ---

async function botLoop(bot: BotState): Promise<void> {
  // Initial perception — figure out current room
  try {
    const me = await api('GET', '/api/v1/world/me', bot.apiKey);
    bot.roomId = me.room?.id || null;
  } catch {
    // Will move to a room on first action
  }

  while (true) {
    const delay = randInt(8000, 15000);
    await sleep(delay);

    const { name, fn } = pickAction(bot);

    try {
      const result = await fn(bot);
      console.log(`[TEST-BOT] ${bot.name}: ${result}`);
    } catch (err: any) {
      if (err.status === 429) {
        // Rate limited — skip silently, next cycle will retry naturally
      } else {
        console.log(`[TEST-BOT] ${bot.name}: ${name} failed — ${err.message}`);
      }
    }
  }
}

// --- Entry point ---

export async function startTestAgents(count: number): Promise<void> {
  console.log(`[TEST-BOT] Registering ${count} test agents...`);

  const bots: BotState[] = [];

  for (let i = 1; i <= count; i++) {
    try {
      const { name, apiKey } = await registerWithRetry(`TestBot_${i}`);
      console.log(`[TEST-BOT] ${name} registered (key=${apiKey.slice(0, 8)}...)`);
      bots.push({ name, apiKey, roomId: null, roomsOwned: 0 });
    } catch (err: any) {
      console.error(`[TEST-BOT] Failed to register TestBot_${i}: ${err.message}`);
    }

    // Stagger registrations
    await sleep(randInt(500, 1500));
  }

  if (bots.length === 0) {
    console.log('[TEST-BOT] No test bots registered, aborting');
    return;
  }

  console.log(`[TEST-BOT] Starting ${bots.length} autonomous bot loops`);

  // Launch loops with staggered starts
  for (const bot of bots) {
    await sleep(randInt(2000, 5000));
    botLoop(bot).catch(err => {
      console.error(`[TEST-BOT] ${bot.name} loop crashed:`, err);
    });
  }
}
