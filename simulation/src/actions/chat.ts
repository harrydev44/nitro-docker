import { CONFIG } from '../config.js';
import { queueBotChat, queueRelationshipChange, queueMemory } from '../world/batch-writer.js';
import { getCachedRelationship } from '../world/state-cache.js';
import { getGreeting, getRoomChat, getReply, getIdleChat } from '../chat/templates.js';
import { getReaction } from '../chat/reactions.js';
import { getOpinion } from '../chat/announcements.js';
import { getMemoryGossip } from '../chat/gossip.js';
import { getCachedMemories } from '../world/state-cache.js';
import type { Agent, WorldState, ChatMessage } from '../types.js';

export async function agentChat(agent: Agent, world: WorldState): Promise<void> {
  if (!agent.currentRoomId) return;

  const room = world.rooms.find(r => r.id === agent.currentRoomId);
  if (!room) return;

  const roommates = world.agents.filter(
    a => a.id !== agent.id && a.currentRoomId === agent.currentRoomId
  );
  if (roommates.length === 0) return;

  const history = world.roomChatHistory.get(agent.currentRoomId) || [];
  let message: string;
  let isAnnouncement = false;

  // 1. Check if last message was an announcement by a different agent — react to it
  const lastMsg = history.length > 0 ? history[history.length - 1] : null;
  if (lastMsg && lastMsg.isAnnouncement && lastMsg.agentId !== agent.id && Math.random() < CONFIG.REACTION_PROBABILITY) {
    const rel = getCachedRelationship(agent.id, lastMsg.agentId);
    const score = rel ? rel.score : 0;
    const reaction = getReaction(agent, lastMsg.agentName, score);

    if (reaction) {
      message = reaction.message;

      // Adjust relationship based on reaction type
      if (reaction.relationshipDelta !== 0) {
        queueRelationshipChange(agent.id, lastMsg.agentId, reaction.relationshipDelta);
      }
    } else {
      message = getRoomChat(agent, room.purpose);
    }
  }
  // 2. Chance to share gossip from memory
  else if (Math.random() < CONFIG.MEMORY_GOSSIP_PROBABILITY && roommates.length > 0) {
    const cachedMems = getCachedMemories();
    const gossipMsg = getMemoryGossip(agent, roommates, cachedMems);
    if (gossipMsg) {
      message = gossipMsg;
    } else {
      message = getRoomChat(agent, room.purpose);
    }
  }
  // 3. Chance to share an opinion (personality-driven take)
  else if (Math.random() < 0.1) {
    message = getOpinion(agent);
    isAnnouncement = true;
  }
  // 4. Normal chat flow (greetings, replies, room chat, idle)
  else if (history.length === 0 || agent.ticksInCurrentRoom <= 1) {
    const target = roommates[Math.floor(Math.random() * roommates.length)];
    message = getGreeting(agent, target);
  } else if (Math.random() < CONFIG.REPLY_PROBABILITY && history.length > 0) {
    const recentMsg = history[history.length - 1];
    const lastSpeaker = world.agents.find(a => a.id === recentMsg.agentId);
    if (lastSpeaker && lastSpeaker.id !== agent.id) {
      message = getReply(agent, lastSpeaker, recentMsg.message);
    } else {
      message = getRoomChat(agent, room.purpose);
    }
  } else {
    message = Math.random() < 0.6 ? getRoomChat(agent, room.purpose) : getIdleChat(agent);
  }

  queueBotChat(agent.id, message, CONFIG.MIN_CHAT_DELAY);

  // Track in room chat history
  const chatMsg: ChatMessage = { agentId: agent.id, agentName: agent.name, message, tick: world.tick, isAnnouncement };
  if (!world.roomChatHistory.has(agent.currentRoomId)) {
    world.roomChatHistory.set(agent.currentRoomId, []);
  }
  world.roomChatHistory.get(agent.currentRoomId)!.push(chatMsg);

  // Positive interaction with nearby roommates
  for (const mate of roommates.slice(0, 3)) {
    queueRelationshipChange(agent.id, mate.id, CONFIG.RELATIONSHIP_CHAT_POSITIVE);
  }

  if (roommates.length > 0) {
    queueMemory({
      agentId: agent.id, targetAgentId: roommates[0].id,
      eventType: 'chat', sentiment: 0.3, summary: `Chatted in ${room.name}`, roomId: room.id,
    });
  }

  agent.state = 'chatting';
}
