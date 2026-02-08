import { execute } from '../db.js';
import { CONFIG } from '../config.js';
import { adjustRelationship } from '../agents/relationships.js';
import { addMemory } from '../agents/memory.js';
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

  // Decide what kind of message to send
  if (history.length === 0 || agent.ticksInCurrentRoom <= 1) {
    // Just arrived or empty room — greet
    const target = roommates[Math.floor(Math.random() * roommates.length)];
    message = getGreeting(agent, target);
  } else if (Math.random() < CONFIG.REPLY_PROBABILITY && history.length > 0) {
    // Reply to last message
    const lastMsg = history[history.length - 1];
    const lastSpeaker = world.agents.find(a => a.id === lastMsg.agentId);
    if (lastSpeaker && lastSpeaker.id !== agent.id) {
      message = getReply(agent, lastSpeaker, lastMsg.message);
    } else {
      message = getRoomChat(agent, room.purpose);
    }
  } else if (Math.random() < 0.2 && agent.personality.sociability > 0.6) {
    // Gossip
    const aboutAgent = world.agents[Math.floor(Math.random() * world.agents.length)];
    message = getGossip(agent, aboutAgent);
  } else {
    // Context-appropriate chat or idle
    message = Math.random() < 0.6
      ? getRoomChat(agent, room.purpose)
      : getIdleChat(agent);
  }

  // Write chat line to bot record
  // Use \r delimiter as required by Arcturus
  await execute(
    `UPDATE bots SET chat_lines = ?, chat_auto = '1', chat_random = '1', chat_delay = ? WHERE id = ?`,
    [message, CONFIG.MIN_CHAT_DELAY, agent.id]
  );

  // Track in room chat history
  const chatMsg: ChatMessage = {
    agentId: agent.id,
    agentName: agent.name,
    message,
    tick: world.tick,
  };
  if (!world.roomChatHistory.has(agent.currentRoomId)) {
    world.roomChatHistory.set(agent.currentRoomId, []);
  }
  world.roomChatHistory.get(agent.currentRoomId)!.push(chatMsg);

  // Positive interaction with roommates
  for (const mate of roommates.slice(0, 3)) {
    await adjustRelationship(agent.id, mate.id, CONFIG.RELATIONSHIP_CHAT_POSITIVE);
  }

  // Memory
  if (roommates.length > 0) {
    const target = roommates[0];
    await addMemory(agent.id, target.id, 'chat', 0.3, `Chatted in ${room.name}`, room.id);
  }

  agent.state = 'chatting';
}
