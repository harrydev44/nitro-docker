import { CONFIG } from '../config.js';
import { queueBotShout, queueCreditChange, queueRelationshipChange, queueMemory } from '../world/batch-writer.js';
import { rconBotDance, rconBotAction, rconBotEffect } from '../emulator/rcon.js';
import { getPartyAnnouncement } from '../chat/party-templates.js';
import { pickBubbleForContext } from '../chat/bubble-styles.js';
import { shouldGesture, pickGesture } from '../chat/gesture-triggers.js';
import type { Agent, WorldState } from '../types.js';

function randomDance(): number {
  return Math.floor(Math.random() * 4) + 1; // 1-4
}

// Per-agent cooldown for hosting parties
const hostCooldowns = new Map<number, number>();

export function canHostParty(agent: Agent, world: WorldState): boolean {
  if (!agent.currentRoomId) return false;

  const room = world.rooms.find(r => r.id === agent.currentRoomId);
  if (!room) return false;

  const isOwnRoom = room.ownerId === agent.userId;
  const isHomeRoom = agent.preferences.homeRoomId === agent.currentRoomId;
  if (!isOwnRoom && !isHomeRoom) return false;

  if (agent.credits < CONFIG.PARTY_COST) return false;
  if (world.activeParties.length >= CONFIG.PARTY_MAX_ACTIVE) return false;
  if (world.activeParties.some(p => p.roomId === agent.currentRoomId)) return false;

  const lastHost = hostCooldowns.get(agent.id);
  if (lastHost !== undefined && world.tick - lastHost < CONFIG.PARTY_HOST_COOLDOWN_TICKS) return false;

  return true;
}

export async function hostParty(agent: Agent, world: WorldState): Promise<void> {
  if (!canHostParty(agent, world)) return;

  const room = world.rooms.find(r => r.id === agent.currentRoomId)!;

  // Deduct credits
  queueCreditChange(agent.userId, -CONFIG.PARTY_COST);
  agent.credits -= CONFIG.PARTY_COST;

  // Calculate duration
  const duration = CONFIG.PARTY_DURATION_MIN_TICKS
    + Math.floor(Math.random() * (CONFIG.PARTY_DURATION_MAX_TICKS - CONFIG.PARTY_DURATION_MIN_TICKS + 1));

  // Create party
  const party = {
    roomId: room.id,
    hostAgentId: agent.id,
    hostName: agent.name,
    startTick: world.tick,
    endTick: world.tick + duration,
    attendees: new Set<number>(),
  };

  // Current roommates are initial attendees
  const roommates = world.agents.filter(
    a => a.id !== agent.id && a.currentRoomId === agent.currentRoomId
  );
  party.attendees.add(agent.id);
  for (const mate of roommates) {
    party.attendees.add(mate.id);
  }

  world.activeParties.push(party);

  // Make everyone dance (host + roommates, each with random dance style)
  rconBotDance(agent.id, randomDance()).catch(() => {});
  for (const mate of roommates) {
    rconBotDance(mate.id, randomDance()).catch(() => {});
  }

  // Host SHOUTS the announcement with party bubble
  const personalityType = agent.personality.sociability > 0.7
    ? 'social'
    : agent.personality.ambition > 0.7
      ? 'ambitious'
      : 'generic';
  const announcement = getPartyAnnouncement(room.name, personalityType);
  const partyBubble = CONFIG.STYLED_BUBBLES_ENABLED ? pickBubbleForContext('party') : -1;
  queueBotShout(agent.id, announcement, partyBubble);

  // Host gets spotlight effect
  if (CONFIG.EFFECT_ENABLED) {
    rconBotEffect(agent.id, 10, 60).catch(() => {});
  }

  // Gestures: host waves/jumps, guests wave
  if (CONFIG.GESTURE_ENABLED) {
    if (shouldGesture('party_host')) {
      const g = pickGesture('party_host');
      if (g) rconBotAction(agent.id, g).catch(() => {});
    }
    for (const mate of roommates.slice(0, 5)) {
      if (shouldGesture('party_arrive')) {
        const g = pickGesture('party_arrive');
        if (g) rconBotAction(mate.id, g).catch(() => {});
      }
    }
  }

  // Build relationships with current roommates
  for (const mate of roommates.slice(0, 5)) {
    queueRelationshipChange(agent.id, mate.id, 2);
  }

  // Create memory
  queueMemory({
    agentId: agent.id, targetAgentId: null,
    eventType: 'announcement', sentiment: 0.8,
    summary: `Hosted a party at ${room.name} (${duration} ticks)`,
    roomId: room.id,
  });

  hostCooldowns.set(agent.id, world.tick);

  world.tickerEvents.push({
    type: 'party_start',
    message: `PARTY TIME! ${agent.name} is throwing a party at ${room.name}!`,
    tick: world.tick,
    roomName: room.name,
  });
  console.log(`[PARTY] ${agent.name} hosting party at ${room.name} (${duration} ticks, cost ${CONFIG.PARTY_COST}cr)`);
}
