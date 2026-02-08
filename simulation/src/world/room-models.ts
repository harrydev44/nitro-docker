import { query } from '../db.js';

interface FloorTile {
  x: number;
  y: number;
}

// Parsed floor tiles per model name, loaded once on startup
const modelFloorTiles: Map<string, FloorTile[]> = new Map();

// Item footprints from items_base, loaded once on startup
// itemBaseId -> { width, length, allowSit }
const itemSizes: Map<number, { width: number; length: number; allowSit: boolean }> = new Map();

// Occupied tiles per room, refreshed every tick via refreshOccupiedTiles()
// roomId -> Set of "x,y" strings
const roomOccupied: Map<number, Set<string>> = new Map();

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
      }
    }
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
 * Get a random valid floor tile that is NOT occupied by furniture.
 * For placing bots.
 */
export function getRandomFreeTile(model: string, roomId: number): { x: number; y: number } {
  const allTiles = modelFloorTiles.get(model);
  if (!allTiles || allTiles.length === 0) return { x: 2, y: 2 };

  const occ = roomOccupied.get(roomId);
  if (!occ || occ.size === 0) {
    return allTiles[Math.floor(Math.random() * allTiles.length)];
  }

  const free = allTiles.filter(t => !occ.has(`${t.x},${t.y}`));
  if (free.length === 0) {
    // Room totally full of furniture — fallback to any floor tile
    return allTiles[Math.floor(Math.random() * allTiles.length)];
  }
  return free[Math.floor(Math.random() * free.length)];
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
