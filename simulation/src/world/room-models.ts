import { query } from '../db.js';

interface FloorTile {
  x: number;
  y: number;
}

// Parsed floor tiles per model name, loaded once on startup
const modelFloorTiles: Map<string, FloorTile[]> = new Map();

/**
 * Load room model heightmaps from DB and parse into valid floor tile lists.
 * Heightmap format: rows separated by \n, each char is a tile.
 *   'x' = wall/void (not walkable)
 *   '0'-'9' = floor at that height level (walkable)
 * Coordinates: row index = y, column index = x
 */
export async function loadRoomModels(): Promise<void> {
  const models = await query<{ name: string; heightmap: string; door_x: number; door_y: number }>(
    `SELECT name, heightmap, door_x, door_y FROM room_models`
  );

  for (const model of models) {
    const tiles: FloorTile[] = [];
    // Heightmaps in DB use literal \r\n or \n as row separators
    const rows = model.heightmap.split(/\r?\n/).map(r => r.trim()).filter(r => r.length > 0);

    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        // '0'-'9' or 'a'-'z' = walkable floor, 'x' = wall/void
        if (/[0-9a-z]/i.test(ch) && ch !== 'x') {
          tiles.push({ x, y });
        }
      }
    }

    // Exclude the door tile — bots shouldn't stand in the doorway
    const filtered = tiles.filter(t => !(t.x === model.door_x && t.y === model.door_y));

    modelFloorTiles.set(model.name, filtered.length > 0 ? filtered : tiles);
  }

  console.log(`[MODELS] Loaded ${modelFloorTiles.size} room models with floor tiles`);
}

/**
 * Get a random valid floor tile for a given room model.
 * Falls back to (2,2) if model not found.
 */
export function getRandomFloorTile(model: string): { x: number; y: number } {
  const tiles = modelFloorTiles.get(model);
  if (!tiles || tiles.length === 0) {
    return { x: 2, y: 2 };
  }
  return tiles[Math.floor(Math.random() * tiles.length)];
}

/**
 * Get all valid floor tiles for a model (for furniture placement —
 * can be used to avoid placing on occupied tiles).
 */
export function getFloorTiles(model: string): FloorTile[] {
  return modelFloorTiles.get(model) || [{ x: 2, y: 2 }];
}
