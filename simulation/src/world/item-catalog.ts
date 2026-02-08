import { query } from '../db.js';

// In-memory map of item_base_id -> public_name, loaded once at startup
let itemNames: Map<number, string> = new Map();

export async function loadItemCatalog(): Promise<void> {
  const rows = await query<{ id: number; public_name: string }>(
    `SELECT id, public_name FROM items_base WHERE type = 's'`
  );
  itemNames = new Map(rows.map(r => [r.id, r.public_name]));
  console.log(`[CATALOG] Loaded ${itemNames.size} furniture names`);
}

export function getItemName(itemBaseId: number): string {
  return itemNames.get(itemBaseId) || 'furniture';
}
