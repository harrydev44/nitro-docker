import { CONFIG } from '../config.js';
import { queueBotChat, queueRelationshipChange, queueMemory } from '../world/batch-writer.js';
import { getGreeting, getRoomChat, getReply, getGossip, getIdleChat } from '../chat/templates.js';
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

  if (history.length === 0 || agent.ticksInCurrentRoom <= 1) {
    const target = roommates[Math.floor(Math.random() * roommates.length)];
    message = getGreeting(agent, target);
  } else if (Math.random() < CONFIG.REPLY_PROBABILITY && history.length > 0) {
    const lastMsg = history[history.length - 1];
    const lastSpeaker = world.agents.find(a => a.id === lastMsg.agentId);
    if (lastSpeaker && lastSpeaker.id !== agent.id) {
      message = getReply(agent, lastSpeaker, lastMsg.message);
    } else {
      message = getRoomChat(agent, room.purpose);
    }
  } else if (Math.random() < 0.2 && agent.personality.sociability > 0.6) {
    const aboutAgent = world.agents[Math.floor(Math.random() * world.agents.length)];
    message = getGossip(agent, aboutAgent);
  } else {
    message = Math.random() < 0.6 ? getRoomChat(agent, room.purpose) : getIdleChat(agent);
  }

  queueBotChat(agent.id, message, CONFIG.MIN_CHAT_DELAY);

  // Track in room chat history
  const chatMsg: ChatMessage = { agentId: agent.id, agentName: agent.name, message, tick: world.tick };
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
