import { CONFIG } from '../config.js';
import { queueBotChat, queueRelationshipChange, queueMemory } from '../world/batch-writer.js';
import { getCachedRelationship } from '../world/state-cache.js';
import { getGreeting, getRoomChat, getReply, getIdleChat } from '../chat/templates.js';
import { getReaction } from '../chat/reactions.js';
import { getOpinion } from '../chat/announcements.js';
import { getMemoryGossip } from '../chat/gossip.js';
import { getCachedMemories } from '../world/state-cache.js';
import { generateAIChat } from '../ai/chat-generator.js';
import { shouldGesture, pickGesture } from '../chat/gesture-triggers.js';
import { rconBotAction } from '../emulator/rcon.js';
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

  // 0. Check for active conversation in this room — reply to it (AI priority)
  const convo = world.activeConversations.get(agent.currentRoomId!);
  if (convo && convo.lastSpeakerId !== agent.id && convo.participants.has(agent.id)) {
    const aiReply = await generateAIChat(agent, roommates, room, history, world.tick, {
      lastSpeakerName: convo.lastSpeakerName,
      lastMessage: convo.lastMessage,
    });
    if (aiReply) {
      message = aiReply;
      // Update conversation state
      convo.lastSpeakerId = agent.id;
      convo.lastSpeakerName = agent.name;
      convo.lastMessage = message;
      convo.lastTick = world.tick;
      convo.exchangeCount++;

      queueBotChat(agent.id, message, CONFIG.MIN_CHAT_DELAY);
      trackChat(agent, world, room, roommates, message, false);
      return;
    }
    // AI unavailable — fall through to normal chat
  }

  // 1. ALWAYS try AI first — this is the primary chat path
  const aiMessage = await generateAIChat(agent, roommates, room, history, world.tick);
  if (aiMessage) {
    message = aiMessage;
  }
  // 2. Template fallbacks only when AI is on cooldown or unavailable
  else if (history.length === 0 || agent.ticksInCurrentRoom <= 1) {
    const target = roommates[Math.floor(Math.random() * roommates.length)];
    message = getGreeting(agent, target);
  } else if (Math.random() < 0.05) {
    message = getOpinion(agent);
    isAnnouncement = true;
  } else if (Math.random() < 0.08 && roommates.length > 0) {
    const cachedMems = getCachedMemories();
    const gossipMsg = getMemoryGossip(agent, roommates, cachedMems);
    message = gossipMsg || getRoomChat(agent, room.purpose);
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

  // Occasional laugh gesture during happy chat
  if (CONFIG.GESTURE_ENABLED && shouldGesture('happy_chat')) {
    const g = pickGesture('happy_chat');
    if (g) rconBotAction(agent.id, g).catch(() => {});
  }

  // Maybe start a new conversation chain
  if (!isAnnouncement && roommates.length > 0 && !world.activeConversations.has(agent.currentRoomId!)) {
    if (Math.random() < CONFIG.CONVERSATION_START_PROBABILITY) {
      const responder = roommates[Math.floor(Math.random() * roommates.length)];
      world.activeConversations.set(agent.currentRoomId!, {
        roomId: agent.currentRoomId!,
        participants: new Set([agent.id, responder.id]),
        lastTick: world.tick,
        exchangeCount: 1,
        lastMessage: message,
        lastSpeakerId: agent.id,
        lastSpeakerName: agent.name,
      });
    }
  }

  trackChat(agent, world, room, roommates, message, isAnnouncement);
}

function trackChat(
  agent: Agent,
  world: WorldState,
  room: { id: number; name: string },
  roommates: Agent[],
  message: string,
  isAnnouncement: boolean,
): void {
  const chatMsg: ChatMessage = { agentId: agent.id, agentName: agent.name, message, tick: world.tick, isAnnouncement };
  if (!world.roomChatHistory.has(room.id)) {
    world.roomChatHistory.set(room.id, []);
  }
  world.roomChatHistory.get(room.id)!.push(chatMsg);

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
