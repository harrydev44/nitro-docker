import { CONFIG } from '../config.js';
import { queueBotChat, queueBotShout, queueRelationshipChange, queueMemory } from '../world/batch-writer.js';
import { getCachedRelationship } from '../world/state-cache.js';
import {
  getArgumentAttack, getArgumentDefense,
  getReunionGreeting, getReunionResponse,
  getGiftMessage, getGiftThanks,
} from '../chat/drama-templates.js';
import { pickBubbleForContext } from '../chat/bubble-styles.js';
import { shouldGesture, pickGesture } from '../chat/gesture-triggers.js';
import { botAction, botEffect } from '../emulator/actions.js';
import type { Agent, WorldState } from '../types.js';

// Per-agent cooldown tracking (transient, not persisted)
const dramaCooldowns = new Map<number, number>();

export async function executeDrama(agent: Agent, world: WorldState): Promise<void> {
  if (!agent.currentRoomId) return;

  // Check cooldown
  const lastDrama = dramaCooldowns.get(agent.id);
  if (lastDrama !== undefined && world.tick - lastDrama < CONFIG.DRAMA_COOLDOWN_TICKS) return;

  const roommates = world.agents.filter(
    a => a.id !== agent.id && a.currentRoomId === agent.currentRoomId
  );
  if (roommates.length === 0) return;

  const room = world.rooms.find(r => r.id === agent.currentRoomId);
  if (!room) return;

  // Check each roommate for drama opportunities (prioritize arguments > reunions > gifts)
  for (const target of roommates) {
    const rel = getCachedRelationship(agent.id, target.id);
    if (!rel) continue;

    // Check target cooldown too
    const targetLastDrama = dramaCooldowns.get(target.id);
    if (targetLastDrama !== undefined && world.tick - targetLastDrama < CONFIG.DRAMA_COOLDOWN_TICKS) continue;

    // ARGUMENT: rivals in same room
    if (rel.score <= CONFIG.DRAMA_ARGUMENT_THRESHOLD && Math.random() < 0.6) {
      await executeArgument(agent, target, world, room.name);
      return;
    }

    // REUNION: close friends meeting
    if (rel.score >= CONFIG.DRAMA_REUNION_THRESHOLD && Math.random() < 0.7) {
      await executeReunion(agent, target, world, room.name);
      return;
    }

    // GIFT: friends with friendly personality
    if (rel.score >= CONFIG.DRAMA_GIFT_THRESHOLD && agent.personality.friendliness > 0.5 && Math.random() < 0.3) {
      await executeGift(agent, target, world, room.name);
      return;
    }
  }
}

async function executeArgument(agent: Agent, target: Agent, world: WorldState, roomName: string): Promise<void> {
  let attackMsg: string;
  let defenseMsg: string;

  attackMsg = getArgumentAttack(target.name);
  defenseMsg = getArgumentDefense(agent.name);

  // Attacker SHOUTS with angry bubble, defender talks with dark bubble
  const attackBubble = CONFIG.STYLED_BUBBLES_ENABLED ? pickBubbleForContext('argument') : -1;
  const defenseBubble = CONFIG.STYLED_BUBBLES_ENABLED ? pickBubbleForContext('argument') : -1;
  queueBotShout(agent.id, attackMsg, attackBubble);
  queueBotChat(target.id, defenseMsg, CONFIG.MIN_CHAT_DELAY + 3, defenseBubble);

  // Effects: angry effect on attacker
  if (CONFIG.EFFECT_ENABLED) {
    botEffect(agent.id, 5, 15).catch(() => {});
  }

  queueRelationshipChange(agent.id, target.id, CONFIG.DRAMA_ARGUMENT_RELATIONSHIP_DELTA);
  queueRelationshipChange(target.id, agent.id, CONFIG.DRAMA_ARGUMENT_RELATIONSHIP_DELTA);

  queueMemory({
    agentId: agent.id, targetAgentId: target.id,
    eventType: 'argument', sentiment: -0.7,
    summary: `Argued with ${target.name} in ${roomName}`,
    roomId: agent.currentRoomId,
  });
  queueMemory({
    agentId: target.id, targetAgentId: agent.id,
    eventType: 'argument', sentiment: -0.7,
    summary: `Got into argument with ${agent.name} in ${roomName}`,
    roomId: agent.currentRoomId,
  });

  dramaCooldowns.set(agent.id, world.tick);
  dramaCooldowns.set(target.id, world.tick);
  agent.state = 'drama';

  world.tickerEvents.push({
    type: 'argument',
    message: `HEATED: ${agent.name} and ${target.name} arguing at ${roomName}!`,
    tick: world.tick,
    roomName,
  });
  console.log(`[DRAMA] Argument: ${agent.name} vs ${target.name} in ${roomName}`);
}

async function executeReunion(agent: Agent, target: Agent, world: WorldState, roomName: string): Promise<void> {
  let greetMsg: string;
  let responseMsg: string;

  greetMsg = getReunionGreeting(target.name);
  responseMsg = getReunionResponse(agent.name);

  // Reunion uses hearts/roses bubbles
  const greetBubble = CONFIG.STYLED_BUBBLES_ENABLED ? pickBubbleForContext('reunion') : -1;
  const responseBubble = CONFIG.STYLED_BUBBLES_ENABLED ? pickBubbleForContext('reunion') : -1;
  queueBotChat(agent.id, greetMsg, CONFIG.MIN_CHAT_DELAY, greetBubble);
  queueBotChat(target.id, responseMsg, CONFIG.MIN_CHAT_DELAY + 3, responseBubble);

  // Gestures: both agents wave or blow kiss
  if (CONFIG.GESTURE_ENABLED && shouldGesture('reunion')) {
    const g1 = pickGesture('reunion');
    const g2 = pickGesture('reunion');
    if (g1) botAction(agent.id, g1).catch(() => {});
    if (g2) botAction(target.id, g2).catch(() => {});
  }

  // Effects: hearts on both agents
  if (CONFIG.EFFECT_ENABLED) {
    botEffect(agent.id, 7, 20).catch(() => {});
    botEffect(target.id, 7, 20).catch(() => {});
  }

  queueRelationshipChange(agent.id, target.id, CONFIG.DRAMA_REUNION_RELATIONSHIP_DELTA);
  queueRelationshipChange(target.id, agent.id, CONFIG.DRAMA_REUNION_RELATIONSHIP_DELTA);

  queueMemory({
    agentId: agent.id, targetAgentId: target.id,
    eventType: 'reunion', sentiment: 0.8,
    summary: `Reunited with ${target.name} in ${roomName}`,
    roomId: agent.currentRoomId,
  });
  queueMemory({
    agentId: target.id, targetAgentId: agent.id,
    eventType: 'reunion', sentiment: 0.8,
    summary: `Reunited with ${agent.name} in ${roomName}`,
    roomId: agent.currentRoomId,
  });

  dramaCooldowns.set(agent.id, world.tick);
  dramaCooldowns.set(target.id, world.tick);
  agent.state = 'drama';

  world.tickerEvents.push({
    type: 'friend_reunion',
    message: `${agent.name} and ${target.name} share an emotional reunion at ${roomName}!`,
    tick: world.tick,
    roomName,
  });
  console.log(`[DRAMA] Reunion: ${agent.name} & ${target.name} in ${roomName}`);
}

async function executeGift(agent: Agent, target: Agent, world: WorldState, roomName: string): Promise<void> {
  let giveMsg: string;
  let thanksMsg: string;

  giveMsg = getGiftMessage(target.name);

  thanksMsg = getGiftThanks(agent.name);

  // Gift uses hearts/green bubbles
  const giveBubble = CONFIG.STYLED_BUBBLES_ENABLED ? pickBubbleForContext('gift') : -1;
  const thanksBubble = CONFIG.STYLED_BUBBLES_ENABLED ? pickBubbleForContext('gift') : -1;
  queueBotChat(agent.id, giveMsg, CONFIG.MIN_CHAT_DELAY, giveBubble);
  queueBotChat(target.id, thanksMsg, CONFIG.MIN_CHAT_DELAY + 3, thanksBubble);

  // Gestures: giver blows kiss, receiver thumbs up / jumps
  if (CONFIG.GESTURE_ENABLED) {
    if (shouldGesture('gift_give')) {
      const g = pickGesture('gift_give');
      if (g) botAction(agent.id, g).catch(() => {});
    }
    if (shouldGesture('gift_receive')) {
      const g = pickGesture('gift_receive');
      if (g) botAction(target.id, g).catch(() => {});
    }
  }

  // Effects: sparkle on receiver
  if (CONFIG.EFFECT_ENABLED) {
    botEffect(target.id, 4, 15).catch(() => {});
  }

  queueRelationshipChange(agent.id, target.id, CONFIG.DRAMA_GIFT_RELATIONSHIP_DELTA);
  queueRelationshipChange(target.id, agent.id, CONFIG.DRAMA_GIFT_RELATIONSHIP_DELTA);

  queueMemory({
    agentId: agent.id, targetAgentId: target.id,
    eventType: 'gift', sentiment: 0.6,
    summary: `Gave a gift to ${target.name} in ${roomName}`,
    roomId: agent.currentRoomId,
  });
  queueMemory({
    agentId: target.id, targetAgentId: agent.id,
    eventType: 'gift', sentiment: 0.6,
    summary: `Received a gift from ${agent.name} in ${roomName}`,
    roomId: agent.currentRoomId,
  });

  dramaCooldowns.set(agent.id, world.tick);
  dramaCooldowns.set(target.id, world.tick);
  agent.state = 'drama';

  world.tickerEvents.push({
    type: 'gift',
    message: `${agent.name} surprised ${target.name} with a gift at ${roomName}!`,
    tick: world.tick,
    roomName,
  });
  console.log(`[DRAMA] Gift: ${agent.name} -> ${target.name} in ${roomName}`);
}
