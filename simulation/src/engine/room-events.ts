import { CONFIG } from '../config.js';
import { botTalk } from '../emulator/actions.js';
import type { WorldState, WorldEvent, WorldEventType } from '../types.js';

const EVENT_TYPES: { type: WorldEventType; description: string; announcement: string }[] = [
  { type: 'happy_hour', description: 'Double work pay for everyone!', announcement: '** HAPPY HOUR! Work pays double right now! **' },
  { type: 'social_hour', description: 'Relationship gains are doubled!', announcement: '** SOCIAL HOUR! Make friends faster! **' },
  { type: 'treasure_hunt', description: 'Random credit drops in this room!', announcement: '** TREASURE HUNT! Credits are hiding in this room! **' },
  { type: 'market_boom', description: 'Catalog items cost less!', announcement: '** MARKET BOOM! Everything is cheaper! **' },
];

let lastEventTick = 0;

/**
 * Called every tick. Spawns new room events periodically and cleans up expired ones.
 */
export function tickRoomEvents(world: WorldState): void {
  const { tick } = world;

  // Clean up expired events
  const expired = world.activeEvents.filter(e => tick >= e.endTick);
  for (const event of expired) {
    world.tickerEvents.push({
      type: 'event_end',
      message: `${event.description} has ended in ${event.roomName}`,
      tick,
      roomName: event.roomName,
    });
    console.log(`[EVENT] ${event.type} ended in ${event.roomName}`);
  }
  world.activeEvents = world.activeEvents.filter(e => tick < e.endTick);

  // Spawn new event?
  if (world.activeEvents.length >= CONFIG.EVENT_MAX_ACTIVE) return;
  if (tick - lastEventTick < CONFIG.EVENT_INTERVAL_TICKS) return;

  // Pick a busy room (population > 0, no active event)
  const eventRoomIds = new Set(world.activeEvents.map(e => e.roomId));
  const candidates = world.rooms
    .filter(r => r.currentPopulation > 0 && !eventRoomIds.has(r.id))
    .sort((a, b) => b.currentPopulation - a.currentPopulation);

  if (candidates.length === 0) return;

  // Pick from top 5 busiest
  const room = candidates[Math.floor(Math.random() * Math.min(5, candidates.length))];
  const eventDef = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];

  const event: WorldEvent = {
    type: eventDef.type,
    roomId: room.id,
    roomName: room.name,
    startTick: tick,
    endTick: tick + CONFIG.EVENT_DURATION_TICKS,
    description: eventDef.description,
  };

  world.activeEvents.push(event);
  lastEventTick = tick;

  world.tickerEvents.push({
    type: 'event_start',
    message: `${eventDef.description} started in ${room.name}!`,
    tick,
    roomName: room.name,
  });

  // Announce in room chat via a random agent in the room
  const botsInRoom = world.agents.filter(a => a.currentRoomId === room.id);
  if (botsInRoom.length > 0) {
    const announcer = botsInRoom[Math.floor(Math.random() * botsInRoom.length)];
    botTalk(announcer.id, eventDef.announcement).catch(() => {});

    const history = world.roomChatHistory.get(room.id) || [];
    history.push({
      agentId: announcer.id,
      agentName: announcer.name,
      message: eventDef.announcement,
      tick,
      isAnnouncement: true,
    });
    world.roomChatHistory.set(room.id, history);
  }

  console.log(`[EVENT] ${eventDef.type} started in ${room.name} (ends tick ${event.endTick})`);
}

/**
 * Check if an event of given type is active in a specific room.
 */
export function hasActiveEvent(world: WorldState, roomId: number, type: WorldEventType): boolean {
  return world.activeEvents.some(e => e.roomId === roomId && e.type === type);
}

/**
 * Get all active events (for API).
 */
export function getActiveEvents(world: WorldState): WorldEvent[] {
  return world.activeEvents;
}
