import { query } from '../db.js';

interface FloorTile {
  x: number;
  y: number;
}

// Parsed floor tiles per model name, loaded once on startup
const modelFloorTiles: Map<string, FloorTile[]> = new Map();

// Raw heightmap grids per model name (2D char arrays), loaded once on startup
const modelHeightmapGrids: Map<string, string[][]> = new Map();

// Door positions per model name, loaded once on startup
const modelDoorInfo: Map<string, { x: number; y: number }> = new Map();

// Item footprints from items_base, loaded once on startup
// itemBaseId -> { width, length, allowSit }
const itemSizes: Map<number, { width: number; length: number; allowSit: boolean }> = new Map();

// Occupied tiles per room (furniture + bots), refreshed every tick via refreshOccupiedTiles()
// roomId -> Set of "x,y" strings
const roomOccupied: Map<number, Set<string>> = new Map();

// Bot-only positions per room (for bot placement — excludes sittable furniture)
// roomId -> Set of "x,y" strings
const roomBotTiles: Map<number, Set<string>> = new Map();

// Sittable furniture tiles per room (chairs, sofas, beds)
// roomId -> Array of { x, y } where bots can sit
const roomSittableTiles: Map<number, FloorTile[]> = new Map();

// Bot positions by bot ID (for conversation proximity lookups)
// botId -> { x, y, roomId }
const botPositions: Map<number, { x: number; y: number; roomId: number }> = new Map();

/**
 * Load room model heightmaps from DB and parse into valid floor tile lists.
 */
export async function loadRoomModels(): Promise<void> {
  const models = await query<{ name: string; heightmap: string; door_x: number; door_y: number }>(
    `SELECT name, heightmap, door_x, door_y FROM room_models`
  );

  for (const model of models) {
    const tiles: FloorTile[] = [];
    const rows = model.heightmap.split(/\r?\n/).map(r => r.trim()).filter(r => r.length > 0);

    // Cache raw grid and door position for zone computation
    const grid: string[][] = rows.map(r => r.split(''));
    modelHeightmapGrids.set(model.name, grid);
    modelDoorInfo.set(model.name, { x: model.door_x, y: model.door_y });

    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (/[0-9a-z]/i.test(ch) && ch !== 'x') {
          tiles.push({ x, y });
        }
      }
    }

    // Exclude the door tile
    const filtered = tiles.filter(t => !(t.x === model.door_x && t.y === model.door_y));
    modelFloorTiles.set(model.name, filtered.length > 0 ? filtered : tiles);
  }

  // Load item sizes from items_base
  const bases = await query<{ id: number; width: number; length: number; allow_sit: number }>(
    `SELECT id, width, length, allow_sit FROM items_base WHERE type = 's'`
  );
  for (const b of bases) {
    itemSizes.set(b.id, { width: b.width, length: b.length, allowSit: b.allow_sit === 1 });
  }

  console.log(`[MODELS] Loaded ${modelFloorTiles.size} room models, ${itemSizes.size} item types`);
}

/**
 * Refresh the occupied tile map for all rooms.
 * Call once per tick (from state-cache refresh).
 */
export async function refreshOccupiedTiles(): Promise<void> {
  roomOccupied.clear();
  roomBotTiles.clear();
  roomSittableTiles.clear();

  // 1. Load furniture positions
  const items = await query<{ room_id: number; item_id: number; x: number; y: number; rot: number }>(
    `SELECT i.room_id, i.item_id, i.x, i.y, i.rot
     FROM items i
     JOIN rooms r ON i.room_id = r.id
     JOIN users u ON r.owner_id = u.id
     WHERE i.room_id > 0 AND u.username LIKE 'sim_owner_%'`
  );

  for (const item of items) {
    const size = itemSizes.get(item.item_id);
    const w = size?.width || 1;
    const l = size?.length || 1;
    const sittable = size?.allowSit || false;

    // Rotation: 0/4 = normal, 2/6 = rotated 90 degrees (swap width/length)
    const rotated = item.rot === 2 || item.rot === 6;
    const effW = rotated ? l : w;
    const effL = rotated ? w : l;

    if (!roomOccupied.has(item.room_id)) {
      roomOccupied.set(item.room_id, new Set());
    }
    const occ = roomOccupied.get(item.room_id)!;

    for (let dx = 0; dx < effW; dx++) {
      for (let dy = 0; dy < effL; dy++) {
        occ.add(`${item.x + dx},${item.y + dy}`);

        // Track sittable tiles so bots can sit on them
        if (sittable) {
          if (!roomSittableTiles.has(item.room_id)) {
            roomSittableTiles.set(item.room_id, []);
          }
          roomSittableTiles.get(item.room_id)!.push({ x: item.x + dx, y: item.y + dy });
        }
      }
    }
  }

  // 2. Load bot positions — bots should not overlap each other
  botPositions.clear();
  const bots = await query<{ id: number; room_id: number; x: number; y: number }>(
    `SELECT b.id, b.room_id, b.x, b.y FROM bots b
     JOIN users u ON b.user_id = u.id
     WHERE b.room_id > 0 AND u.username LIKE 'sim_owner_%'`
  );

  for (const bot of bots) {
    if (!roomBotTiles.has(bot.room_id)) {
      roomBotTiles.set(bot.room_id, new Set());
    }
    roomBotTiles.get(bot.room_id)!.add(`${bot.x},${bot.y}`);
    botPositions.set(bot.id, { x: bot.x, y: bot.y, roomId: bot.room_id });
  }
}

/**
 * Check if a tile is occupied by furniture in a room.
 */
export function isTileOccupied(roomId: number, x: number, y: number): boolean {
  const occ = roomOccupied.get(roomId);
  return occ ? occ.has(`${x},${y}`) : false;
}

/**
 * Get a random valid floor tile that is NOT occupied by furniture or other bots.
 * Prefers sittable furniture tiles (50% chance) so bots sit on chairs/sofas.
 * Tracks within-tick claims to prevent stacking.
 */
export function getRandomFreeTile(model: string, roomId: number): { x: number; y: number } {
  const allTiles = modelFloorTiles.get(model);
  if (!allTiles || allTiles.length === 0) return { x: 2, y: 2 };

  const botOcc = roomBotTiles.get(roomId) || new Set<string>();

  // 50% chance to prefer a sittable tile (chair/sofa/bed)
  if (Math.random() < 0.5) {
    const sittable = roomSittableTiles.get(roomId) || [];
    const freeSeat = sittable.filter(t => !botOcc.has(`${t.x},${t.y}`));
    if (freeSeat.length > 0) {
      const tile = freeSeat[Math.floor(Math.random() * freeSeat.length)];
      claimBotTile(roomId, tile.x, tile.y);
      return tile;
    }
  }

  // Otherwise pick any free floor tile (not occupied by furniture or bots)
  const furniOcc = roomOccupied.get(roomId) || new Set<string>();
  const free = allTiles.filter(t => {
    const key = `${t.x},${t.y}`;
    return !furniOcc.has(key) && !botOcc.has(key);
  });

  let tile: { x: number; y: number };
  if (free.length === 0) {
    const noBot = allTiles.filter(t => !botOcc.has(`${t.x},${t.y}`));
    tile = noBot.length > 0
      ? noBot[Math.floor(Math.random() * noBot.length)]
      : allTiles[Math.floor(Math.random() * allTiles.length)];
  } else {
    tile = free[Math.floor(Math.random() * free.length)];
  }

  claimBotTile(roomId, tile.x, tile.y);
  return tile;
}

/**
 * Get a free tile near a target position (within maxDist manhattan distance).
 * Used for conversation proximity — walking toward chat partner.
 * Falls back to getRandomFreeTile if no nearby tile available.
 */
export function getNearbyFreeTile(
  model: string, roomId: number, targetX: number, targetY: number, maxDist = 2,
): { x: number; y: number } {
  const allTiles = modelFloorTiles.get(model);
  if (!allTiles || allTiles.length === 0) return { x: targetX, y: targetY };

  const furniOcc = roomOccupied.get(roomId) || new Set<string>();
  const botOcc = roomBotTiles.get(roomId) || new Set<string>();

  // Find free tiles within maxDist of target (prefer sittable ones)
  const nearby: { x: number; y: number; dist: number; sittable: boolean }[] = [];
  const sittable = new Set((roomSittableTiles.get(roomId) || []).map(t => `${t.x},${t.y}`));

  for (const t of allTiles) {
    const dist = Math.abs(t.x - targetX) + Math.abs(t.y - targetY);
    if (dist > 0 && dist <= maxDist) {
      const key = `${t.x},${t.y}`;
      const isOccupied = botOcc.has(key) || (furniOcc.has(key) && !sittable.has(key));
      if (!isOccupied) {
        nearby.push({ x: t.x, y: t.y, dist, sittable: sittable.has(key) });
      }
    }
  }

  if (nearby.length === 0) return getRandomFreeTile(model, roomId);

  // Prefer sittable tiles, then closest
  nearby.sort((a, b) => {
    if (a.sittable !== b.sittable) return a.sittable ? -1 : 1;
    return a.dist - b.dist;
  });

  const tile = nearby[0];
  claimBotTile(roomId, tile.x, tile.y);
  return tile;
}

function claimBotTile(roomId: number, x: number, y: number): void {
  if (!roomBotTiles.has(roomId)) {
    roomBotTiles.set(roomId, new Set());
  }
  roomBotTiles.get(roomId)!.add(`${x},${y}`);
}

/**
 * Get a random floor tile for placing a furniture item, ensuring the
 * full footprint (width x length) fits on valid, unoccupied floor tiles.
 */
export function getRandomFurniTile(
  model: string, roomId: number, itemBaseId: number
): { x: number; y: number; rot: number } | null {
  const allTiles = modelFloorTiles.get(model);
  if (!allTiles || allTiles.length === 0) return null;

  const size = itemSizes.get(itemBaseId);
  const w = size?.width || 1;
  const l = size?.length || 1;

  // Build a set of all valid floor tiles for fast lookup
  const floorSet = new Set(allTiles.map(t => `${t.x},${t.y}`));
  const occ = roomOccupied.get(roomId) || new Set();

  // Pick random rotation (0 or 2)
  const rot = Math.random() < 0.5 ? 0 : 2;
  const effW = rot === 2 ? l : w;
  const effL = rot === 2 ? w : l;

  // Find candidate origin tiles where the full footprint fits
  const candidates: { x: number; y: number; rot: number }[] = [];
  for (const tile of allTiles) {
    let fits = true;
    for (let dx = 0; dx < effW && fits; dx++) {
      for (let dy = 0; dy < effL && fits; dy++) {
        const key = `${tile.x + dx},${tile.y + dy}`;
        if (!floorSet.has(key) || occ.has(key)) {
          fits = false;
        }
      }
    }
    if (fits) candidates.push({ ...tile, rot });
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Get a random valid floor tile (legacy — no occupation check).
 */
export function getRandomFloorTile(model: string): { x: number; y: number } {
  const tiles = modelFloorTiles.get(model);
  if (!tiles || tiles.length === 0) return { x: 2, y: 2 };
  return tiles[Math.floor(Math.random() * tiles.length)];
}

/**
 * Get all valid floor tiles for a model.
 */
export function getFloorTiles(model: string): FloorTile[] {
  return modelFloorTiles.get(model) || [{ x: 2, y: 2 }];
}

/**
 * Get the raw heightmap grid for a model (2D char array).
 */
export function getHeightmapGrid(model: string): string[][] | null {
  return modelHeightmapGrids.get(model) || null;
}

/**
 * Get the door position for a model.
 */
export function getDoorInfo(model: string): { x: number; y: number } | null {
  return modelDoorInfo.get(model) || null;
}

/**
 * Get item size info for a given item base ID.
 */
export function getItemSize(itemBaseId: number): { width: number; length: number; allowSit: boolean } | null {
  return itemSizes.get(itemBaseId) || null;
}

/**
 * Get the set of occupied tile keys for a room.
 */
export function getOccupiedTiles(roomId: number): Set<string> {
  return roomOccupied.get(roomId) || new Set();
}

/**
 * Get a bot's current position.
 */
export function getBotPosition(botId: number): { x: number; y: number; roomId: number } | null {
  return botPositions.get(botId) || null;
}
