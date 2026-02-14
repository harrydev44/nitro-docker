import {
  getHeightmapGrid, getDoorInfo, getItemSize,
  getFloorTiles, getOccupiedTiles,
} from './room-models.js';
import type { RoomPurpose } from '../types.js';

// ── Tile zone types ──────────────────────────────────────────────────

export type TileZone =
  | 'corner' | 'wall_top' | 'wall_bottom' | 'wall_left' | 'wall_right'
  | 'center' | 'door_area';

interface ZonedTile {
  x: number;
  y: number;
  zone: TileZone;
}

// ── Furniture categories ─────────────────────────────────────────────

type FurniCategory = 'wall_hugger' | 'bed' | 'seating' | 'table' | 'accent';

const ITEM_CATEGORIES: Record<number, FurniCategory> = {
  // wall_hugger: fireplace, shelves, TV
  56: 'wall_hugger', 13: 'wall_hugger', 14: 'wall_hugger',
  144: 'wall_hugger', 173: 'wall_hugger',
  // bed
  41: 'bed',
  // seating: sofas, couches, chairs
  35: 'seating', 28: 'seating', 29: 'seating',
  18: 'seating', 30: 'seating', 39: 'seating',
  // table
  17: 'table', 22: 'table', 40: 'table',
  // accent: plants, lamps
  128: 'accent', 163: 'accent', 165: 'accent',
  199: 'accent', 57: 'accent',
};

function getCategory(itemBaseId: number): FurniCategory {
  return ITEM_CATEGORIES[itemBaseId] || 'accent';
}

// Zone preferences per category (ordered by preference)
const ZONE_PREFS: Record<FurniCategory, TileZone[]> = {
  wall_hugger: ['wall_top', 'wall_left', 'wall_right', 'wall_bottom'],
  bed:         ['corner', 'wall_top', 'wall_left', 'wall_right'],
  seating:     ['wall_left', 'wall_right', 'wall_bottom', 'center'],
  table:       ['center', 'wall_bottom', 'wall_top'],
  accent:      ['corner', 'wall_top', 'wall_left', 'wall_right', 'wall_bottom'],
};

// ── Room purpose style budgets ───────────────────────────────────────

interface StyleBudget {
  wall_hugger: [number, number]; // [min, max]
  seating: [number, number];
  table: [number, number];
  accent: [number, number];
  bed: [number, number];
}

const STYLE_BUDGETS: Record<RoomPurpose, StyleBudget> = {
  hangout:  { wall_hugger: [1, 2], seating: [3, 5], table: [1, 2], accent: [2, 4], bed: [0, 0] },
  work:     { wall_hugger: [1, 2], seating: [2, 4], table: [2, 3], accent: [1, 2], bed: [0, 0] },
  trade:    { wall_hugger: [0, 1], seating: [2, 3], table: [2, 3], accent: [1, 2], bed: [0, 0] },
  game:     { wall_hugger: [0, 1], seating: [2, 3], table: [1, 2], accent: [2, 3], bed: [0, 0] },
  service:  { wall_hugger: [1, 2], seating: [3, 5], table: [1, 2], accent: [2, 3], bed: [0, 0] },
  vip:      { wall_hugger: [2, 3], seating: [2, 4], table: [1, 2], accent: [2, 4], bed: [0, 0] },
  empty:    { wall_hugger: [0, 1], seating: [1, 3], table: [1, 2], accent: [1, 2], bed: [0, 0] },
};

// Catalog items per category for picking
export interface CatalogItem {
  itemId: number;
  name: string;
  cost: number;
  category: FurniCategory;
}

const FURNITURE_CATALOG: CatalogItem[] = [
  { itemId: 56,  name: 'fireplace',  cost: 80,  category: 'wall_hugger' },
  { itemId: 13,  name: 'shelf',      cost: 35,  category: 'wall_hugger' },
  { itemId: 14,  name: 'shelf',      cost: 40,  category: 'wall_hugger' },
  { itemId: 144, name: 'TV',         cost: 75,  category: 'wall_hugger' },
  { itemId: 173, name: 'luxury TV',  cost: 100, category: 'wall_hugger' },
  { itemId: 41,  name: 'bed',        cost: 45,  category: 'bed' },
  { itemId: 35,  name: 'sofa',       cost: 50,  category: 'seating' },
  { itemId: 28,  name: 'sofa',       cost: 50,  category: 'seating' },
  { itemId: 29,  name: 'couch',      cost: 45,  category: 'seating' },
  { itemId: 18,  name: 'chair',      cost: 25,  category: 'seating' },
  { itemId: 30,  name: 'chair',      cost: 25,  category: 'seating' },
  { itemId: 39,  name: 'chair',      cost: 20,  category: 'seating' },
  { itemId: 17,  name: 'table',      cost: 30,  category: 'table' },
  { itemId: 22,  name: 'table',      cost: 30,  category: 'table' },
  { itemId: 40,  name: 'table',      cost: 20,  category: 'table' },
  { itemId: 128, name: 'plant',      cost: 10,  category: 'accent' },
  { itemId: 163, name: 'bonsai',     cost: 15,  category: 'accent' },
  { itemId: 165, name: 'yukka',      cost: 15,  category: 'accent' },
  { itemId: 199, name: 'lamp',       cost: 20,  category: 'accent' },
  { itemId: 57,  name: 'lamp',       cost: 25,  category: 'accent' },
];

// ── Zone computation (cached per model) ──────────────────────────────

const zoneCache: Map<string, ZonedTile[]> = new Map();

function isWall(grid: string[][], x: number, y: number): boolean {
  if (y < 0 || y >= grid.length) return true;
  if (x < 0 || x >= grid[y].length) return true;
  return grid[y][x] === 'x';
}

function isFloor(grid: string[][], x: number, y: number): boolean {
  if (y < 0 || y >= grid.length) return false;
  if (x < 0 || x >= grid[y].length) return false;
  const ch = grid[y][x];
  return /[0-9a-z]/i.test(ch) && ch !== 'x';
}

export function computeRoomZones(modelName: string): ZonedTile[] {
  const cached = zoneCache.get(modelName);
  if (cached) return cached;

  const grid = getHeightmapGrid(modelName);
  const door = getDoorInfo(modelName);
  if (!grid || !door) return [];

  const tiles: ZonedTile[] = [];

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (!isFloor(grid, x, y)) continue;
      // Skip door tile itself
      if (x === door.x && y === door.y) continue;

      // Check if within 2 tiles of door
      const distToDoor = Math.abs(x - door.x) + Math.abs(y - door.y);
      if (distToDoor <= 2) {
        tiles.push({ x, y, zone: 'door_area' });
        continue;
      }

      // Count adjacent walls
      const wallTop = isWall(grid, x, y - 1);
      const wallBottom = isWall(grid, x, y + 1);
      const wallLeft = isWall(grid, x - 1, y);
      const wallRight = isWall(grid, x + 1, y);
      const wallCount = [wallTop, wallBottom, wallLeft, wallRight].filter(Boolean).length;

      if (wallCount >= 2) {
        tiles.push({ x, y, zone: 'corner' });
      } else if (wallTop) {
        tiles.push({ x, y, zone: 'wall_top' });
      } else if (wallLeft) {
        tiles.push({ x, y, zone: 'wall_left' });
      } else if (wallRight) {
        tiles.push({ x, y, zone: 'wall_right' });
      } else if (wallBottom) {
        tiles.push({ x, y, zone: 'wall_bottom' });
      } else {
        tiles.push({ x, y, zone: 'center' });
      }
    }
  }

  zoneCache.set(modelName, tiles);
  return tiles;
}

// ── Placement helpers ────────────────────────────────────────────────

export interface PlacedItem {
  itemId: number;
  x: number;
  y: number;
  rot: number;
  category: FurniCategory;
}

function bestRotationForZone(zone: TileZone): number {
  // Items parallel to the wall they're against
  // rot=0: width along X axis. rot=2: width along Y axis.
  switch (zone) {
    case 'wall_top':
    case 'wall_bottom':
      return 0; // parallel to horizontal wall
    case 'wall_left':
    case 'wall_right':
      return 2; // parallel to vertical wall
    case 'corner':
      return 0; // default for corners
    default:
      return Math.random() < 0.5 ? 0 : 2;
  }
}

function footprintFits(
  x: number, y: number, w: number, l: number, rot: number,
  floorSet: Set<string>, occupied: Set<string>,
): boolean {
  const rotated = rot === 2 || rot === 6;
  const effW = rotated ? l : w;
  const effL = rotated ? w : l;

  for (let dx = 0; dx < effW; dx++) {
    for (let dy = 0; dy < effL; dy++) {
      const key = `${x + dx},${y + dy}`;
      if (!floorSet.has(key) || occupied.has(key)) return false;
    }
  }
  return true;
}

function markOccupied(
  x: number, y: number, w: number, l: number, rot: number,
  occupied: Set<string>,
): void {
  const rotated = rot === 2 || rot === 6;
  const effW = rotated ? l : w;
  const effL = rotated ? w : l;

  for (let dx = 0; dx < effW; dx++) {
    for (let dy = 0; dy < effL; dy++) {
      occupied.add(`${x + dx},${y + dy}`);
    }
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// ── Smart single-item placement ──────────────────────────────────────

/**
 * Find the best tile for an item in a room based on its category and zone preferences.
 * Uses existing occupied tiles from room-models cache.
 */
export function getSmartFurniTile(
  model: string, roomId: number, itemBaseId: number, _purpose: RoomPurpose,
): { x: number; y: number; rot: number } | null {
  const zones = computeRoomZones(model);
  if (zones.length === 0) return null;

  const size = getItemSize(itemBaseId);
  const w = size?.width || 1;
  const l = size?.length || 1;

  const floorTiles = getFloorTiles(model);
  const floorSet = new Set(floorTiles.map(t => `${t.x},${t.y}`));
  const occupied = getOccupiedTiles(roomId);

  const category = getCategory(itemBaseId);
  const preferredZones = ZONE_PREFS[category];

  // Try each preferred zone in order
  for (const targetZone of preferredZones) {
    const zoneTiles = shuffle(zones.filter(t => t.zone === targetZone));
    const rot = bestRotationForZone(targetZone);

    for (const tile of zoneTiles) {
      if (footprintFits(tile.x, tile.y, w, l, rot, floorSet, occupied)) {
        return { x: tile.x, y: tile.y, rot };
      }
      // Try alternate rotation
      const altRot = rot === 0 ? 2 : 0;
      if (footprintFits(tile.x, tile.y, w, l, altRot, floorSet, occupied)) {
        return { x: tile.x, y: tile.y, rot: altRot };
      }
    }
  }

  // Fallback: any non-door tile
  const fallback = shuffle(zones.filter(t => t.zone !== 'door_area'));
  for (const tile of fallback) {
    const rot = 0;
    if (footprintFits(tile.x, tile.y, w, l, rot, floorSet, occupied)) {
      return { x: tile.x, y: tile.y, rot };
    }
  }

  return null;
}

// ── Pick what item the room needs most ───────────────────────────────

/**
 * Given what's already in the room, pick the category that's most under-budget,
 * then pick a random affordable item from that category.
 */
export function pickNeededItem(
  purpose: RoomPurpose,
  existingItems: PlacedItem[],
  maxCost: number,
): CatalogItem | null {
  const budget = STYLE_BUDGETS[purpose] || STYLE_BUDGETS.hangout;

  // Count existing items per category
  const counts: Record<FurniCategory, number> = {
    wall_hugger: 0, bed: 0, seating: 0, table: 0, accent: 0,
  };
  for (const item of existingItems) {
    const cat = item.category || getCategory(item.itemId);
    counts[cat]++;
  }

  // Placement order: bed, wall_hugger, table, seating, accent
  const order: FurniCategory[] = ['bed', 'wall_hugger', 'table', 'seating', 'accent'];

  for (const cat of order) {
    const [min, max] = budget[cat];
    if (counts[cat] < min) {
      // This category is under minimum — must fill
      const items = FURNITURE_CATALOG.filter(f => f.category === cat && f.cost <= maxCost);
      if (items.length > 0) return items[Math.floor(Math.random() * items.length)];
    }
  }

  // All minimums met — fill categories that haven't hit their max
  const underMax = order.filter(cat => {
    const [, max] = budget[cat];
    return counts[cat] < max;
  });

  if (underMax.length > 0) {
    // Weighted random pick favoring categories with more room to grow
    const cat = underMax[Math.floor(Math.random() * underMax.length)];
    const items = FURNITURE_CATALOG.filter(f => f.category === cat && f.cost <= maxCost);
    if (items.length > 0) return items[Math.floor(Math.random() * items.length)];
  }

  // All budgets maxed — pick any affordable item
  const any = FURNITURE_CATALOG.filter(f => f.cost <= maxCost);
  return any.length > 0 ? any[Math.floor(Math.random() * any.length)] : null;
}

// ── Full room layout generation (for remodel script) ─────────────────

/**
 * Generate a complete furniture layout for a room.
 * Returns items to place (does NOT write to DB).
 */
export function generateRoomLayout(
  model: string, roomId: number, purpose: RoomPurpose,
): PlacedItem[] {
  const zones = computeRoomZones(model);
  if (zones.length === 0) return [];

  const floorTiles = getFloorTiles(model);
  const floorSet = new Set(floorTiles.map(t => `${t.x},${t.y}`));

  // Use a local occupied set (room starts empty for remodel)
  const localOccupied = new Set<string>();
  const placed: PlacedItem[] = [];

  const budget = STYLE_BUDGETS[purpose] || STYLE_BUDGETS.hangout;
  const maxItems = 15;

  // Determine target count per category
  const targets: Record<FurniCategory, number> = {
    bed:         randBetween(budget.bed[0], budget.bed[1]),
    wall_hugger: randBetween(budget.wall_hugger[0], budget.wall_hugger[1]),
    table:       randBetween(budget.table[0], budget.table[1]),
    seating:     randBetween(budget.seating[0], budget.seating[1]),
    accent:      randBetween(budget.accent[0], budget.accent[1]),
  };

  // Clamp total to maxItems
  const totalTarget = Object.values(targets).reduce((a, b) => a + b, 0);
  if (totalTarget > maxItems) {
    // Proportionally reduce — cut from accent and seating first
    let excess = totalTarget - maxItems;
    for (const cat of ['accent', 'seating', 'wall_hugger', 'table', 'bed'] as FurniCategory[]) {
      const cut = Math.min(excess, targets[cat] - budget[cat][0]);
      if (cut > 0) { targets[cat] -= cut; excess -= cut; }
      if (excess <= 0) break;
    }
  }

  // Track table positions for seating magnet
  const tableTiles: { x: number; y: number; w: number; l: number; rot: number }[] = [];

  function placeItem(cat: FurniCategory): boolean {
    const items = FURNITURE_CATALOG.filter(f => f.category === cat);
    const item = items[Math.floor(Math.random() * items.length)];
    if (!item) return false;

    const size = getItemSize(item.itemId);
    const w = size?.width || 1;
    const l = size?.length || 1;
    const preferredZones = ZONE_PREFS[cat];

    // For seating, try near tables first
    if (cat === 'seating' && tableTiles.length > 0) {
      const magnetZone = computeSeatingMagnet(tableTiles, floorSet, localOccupied);
      const shuffledMagnet = shuffle(magnetZone);
      for (const tile of shuffledMagnet) {
        // Face toward nearest table (pick rotation accordingly)
        const rot = bestRotationForZone('center');
        if (footprintFits(tile.x, tile.y, w, l, rot, floorSet, localOccupied)) {
          markOccupied(tile.x, tile.y, w, l, rot, localOccupied);
          placed.push({ itemId: item.itemId, x: tile.x, y: tile.y, rot, category: cat });
          return true;
        }
        const altRot = rot === 0 ? 2 : 0;
        if (footprintFits(tile.x, tile.y, w, l, altRot, floorSet, localOccupied)) {
          markOccupied(tile.x, tile.y, w, l, altRot, localOccupied);
          placed.push({ itemId: item.itemId, x: tile.x, y: tile.y, rot: altRot, category: cat });
          return true;
        }
      }
    }

    // Try preferred zones
    for (const targetZone of preferredZones) {
      const zoneTiles = shuffle(zones.filter(t => t.zone === targetZone));
      const rot = bestRotationForZone(targetZone);

      for (const tile of zoneTiles) {
        if (footprintFits(tile.x, tile.y, w, l, rot, floorSet, localOccupied)) {
          markOccupied(tile.x, tile.y, w, l, rot, localOccupied);
          placed.push({ itemId: item.itemId, x: tile.x, y: tile.y, rot, category: cat });
          if (cat === 'table') tableTiles.push({ x: tile.x, y: tile.y, w, l, rot });
          return true;
        }
        const altRot = rot === 0 ? 2 : 0;
        if (footprintFits(tile.x, tile.y, w, l, altRot, floorSet, localOccupied)) {
          markOccupied(tile.x, tile.y, w, l, altRot, localOccupied);
          placed.push({ itemId: item.itemId, x: tile.x, y: tile.y, rot: altRot, category: cat });
          if (cat === 'table') tableTiles.push({ x: tile.x, y: tile.y, w, l, rot: altRot });
          return true;
        }
      }
    }

    return false;
  }

  // Place in order: bed → wall_hugger → table → seating → accent
  const placementOrder: FurniCategory[] = ['bed', 'wall_hugger', 'table', 'seating', 'accent'];
  for (const cat of placementOrder) {
    for (let i = 0; i < targets[cat] && placed.length < maxItems; i++) {
      placeItem(cat);
    }
  }

  return placed;
}

/**
 * Compute "seating magnet" tiles: ring of tiles at distance 1 from table footprints.
 */
function computeSeatingMagnet(
  tables: { x: number; y: number; w: number; l: number; rot: number }[],
  floorSet: Set<string>,
  occupied: Set<string>,
): { x: number; y: number }[] {
  const magnetSet = new Set<string>();

  for (const table of tables) {
    const rotated = table.rot === 2 || table.rot === 6;
    const effW = rotated ? table.l : table.w;
    const effL = rotated ? table.w : table.l;

    // Ring around the table at distance 1
    for (let dx = -1; dx <= effW; dx++) {
      for (let dy = -1; dy <= effL; dy++) {
        // Skip tiles that are part of the table itself
        if (dx >= 0 && dx < effW && dy >= 0 && dy < effL) continue;
        const tx = table.x + dx;
        const ty = table.y + dy;
        const key = `${tx},${ty}`;
        if (floorSet.has(key) && !occupied.has(key)) {
          magnetSet.add(key);
        }
      }
    }
  }

  return Array.from(magnetSet).map(k => {
    const [x, y] = k.split(',').map(Number);
    return { x, y };
  });
}
