import { CONFIG } from '../config.js';
import { moveAgent } from '../actions/move.js';
import { agentChat } from '../actions/chat.js';
import { agentWork } from '../actions/work.js';
import { agentTrade } from '../actions/trade.js';
import { agentDecorate } from '../actions/decorate.js';
import { agentBuy } from '../actions/buy.js';
import { agentCreateRoom } from '../actions/create-room.js';
import { executeDrama } from '../actions/drama.js';
import { hostParty } from '../actions/host-party.js';
import { getCachedFriends, getCachedEnemies, getCachedInventoryCount, getCachedRelationship } from '../world/state-cache.js';
import { generateGoals, pruneExpiredGoals } from './goals.js';
import type { Agent, WorldState, ActionScore } from '../types.js';

export async function runDecisionEngine(agent: Agent, world: WorldState): Promise<void> {
  // Prune expired goals and potentially generate new ones
  pruneExpiredGoals(agent, world.tick);
  if (agent.goals.length < CONFIG.MAX_GOALS_PER_AGENT && Math.random() < 0.02) {
    generateGoals(agent, world);
  }

  // Score each possible action (no DB calls — uses cached data)
  const scores = scoreActions(agent, world);

  // Add personality noise (impulsiveness)
  for (const s of scores) {
    s.score += (Math.random() - 0.5) * agent.personality.impulsiveness * 0.5;
  }

  // Sort by score descending and pick the best
  scores.sort((a, b) => b.score - a.score);
  const chosen = scores[0];

  if (!chosen || chosen.action === 'idle') return;

  // Execute the chosen action
  switch (chosen.action) {
    case 'move':
      await moveAgent(agent, world);
      break;
    case 'chat':
      await agentChat(agent, world);
      break;
    case 'work':
      await agentWork(agent, world);
      break;
    case 'trade':
      await agentTrade(agent, world);
      break;
    case 'decorate':
      await agentDecorate(agent, world);
      break;
    case 'buy':
      await agentBuy(agent, world);
      break;
    case 'create_room':
      await agentCreateRoom(agent, world);
      break;
    case 'drama':
      await executeDrama(agent, world);
      break;
    case 'host_party':
      await hostParty(agent, world);
      break;
  }
}

function scoreActions(agent: Agent, world: WorldState): ActionScore[] {
  const scores: ActionScore[] = [];
  const friends = getCachedFriends(agent.id);
  const enemies = getCachedEnemies(agent.id);

  const currentRoom = world.rooms.find(r => r.id === agent.currentRoomId);
  const isInRoom = !!currentRoom;
  const roommates = isInRoom
    ? world.agents.filter(a => a.id !== agent.id && a.currentRoomId === agent.currentRoomId)
    : [];

  // MOVE: curiosity * room_attractiveness + friend_presence
  const moveScore = agent.personality.curiosity * 0.5
    + (isInRoom ? 0 : 0.6)  // not in a room = strong push to move
    + (agent.ticksInCurrentRoom > 15 ? 0.3 : 0)  // been here a while
    + goalBonus(agent, 'explore');
  scores.push({ action: 'move', score: moveScore });

  // CHAT: sociability * room_population + recent_conversation + conversation chain boost + party boost
  if (isInRoom && roommates.length > 0) {
    const recentChat = (world.roomChatHistory.get(agent.currentRoomId!) || []).length;
    let chatScore = agent.personality.sociability * 0.6
      + Math.min(roommates.length / 10, 0.3)
      + (recentChat > 0 ? 0.2 : 0)
      + goalBonus(agent, 'socialize');

    // Conversation chain boost: if there's an active convo the agent can reply to
    const convo = world.activeConversations.get(agent.currentRoomId!);
    if (convo && convo.lastSpeakerId !== agent.id && convo.participants.has(agent.id)) {
      chatScore += CONFIG.CONVERSATION_CHAT_SCORE_BOOST;
    }

    // Party chat boost: chatting more at parties
    const partyHere = world.activeParties.find(p => p.roomId === agent.currentRoomId);
    if (partyHere) {
      chatScore += CONFIG.PARTY_CHAT_SCORE_BONUS;
    }

    scores.push({ action: 'chat', score: chatScore });
  }

  // WORK: ambition * (wealth_goal - current_credits) / wealth_goal
  if (isInRoom && (currentRoom!.purpose === 'work' || currentRoom!.purpose === 'service' || currentRoom!.purpose === 'trade')) {
    const wealthRatio = Math.max(0, (agent.preferences.wealthGoal - agent.credits) / agent.preferences.wealthGoal);
    const workScore = agent.personality.ambition * 0.5
      + wealthRatio * 0.3
      + goalBonus(agent, 'work') + goalBonus(agent, 'earn');
    scores.push({ action: 'work', score: workScore });
  }

  // TRADE: ambition * partner_available
  if (isInRoom && currentRoom!.tradeMode > 0 && roommates.length > 0) {
    const hasFriendInRoom = roommates.some(r => friends.includes(r.id));
    const tradeScore = agent.personality.ambition * 0.4
      + (hasFriendInRoom ? 0.2 : 0)
      + goalBonus(agent, 'trade');
    scores.push({ action: 'trade', score: tradeScore });
  }

  // DECORATE: only when in own room and has credits
  if (isInRoom && currentRoom!.ownerId === agent.userId && agent.credits > 50) {
    const invCount = getCachedInventoryCount(agent.userId);
    const decorateScore = 0.3
      + (invCount > 0 ? 0.1 : 0)
      + goalBonus(agent, 'decorate');
    scores.push({ action: 'decorate', score: decorateScore });
  }

  // BUY: ambition-driven, buy items for inventory (to trade or decorate)
  if (agent.credits > 30) {
    const invCount = getCachedInventoryCount(agent.userId);
    const lowInventory = invCount < 3;
    const buyScore = agent.personality.ambition * 0.3
      + (lowInventory ? 0.3 : 0)
      + goalBonus(agent, 'trade');
    if (invCount < CONFIG.MAX_INVENTORY_ITEMS) {
      scores.push({ action: 'buy', score: buyScore });
    }
  }

  // CREATE_ROOM: ambition * has_credits * no_room_yet
  const ownedRoomCount = world.rooms.filter(r => r.ownerId === agent.userId).length;
  if (agent.credits >= CONFIG.ROOM_CREATION_COST && ownedRoomCount < CONFIG.MAX_ROOMS_PER_AGENT) {
    const createScore = agent.personality.ambition * 0.3
      + (ownedRoomCount === 0 ? 0.3 : 0)
      + goalBonus(agent, 'decorate');
    scores.push({ action: 'create_room', score: createScore });
  }

  // DRAMA: rivals or close friends in room trigger drama
  if (isInRoom && roommates.length > 0) {
    let dramaScore = 0;
    for (const mate of roommates) {
      const rel = getCachedRelationship(agent.id, mate.id);
      if (!rel) continue;
      if (rel.score <= CONFIG.DRAMA_ARGUMENT_THRESHOLD) {
        dramaScore = Math.max(dramaScore, 0.7 + (1 - agent.personality.friendliness) * 0.2);
      }
      if (rel.score >= CONFIG.DRAMA_REUNION_THRESHOLD) {
        dramaScore = Math.max(dramaScore, 0.6 + agent.personality.friendliness * 0.2);
      }
      if (rel.score >= CONFIG.DRAMA_GIFT_THRESHOLD && agent.personality.friendliness > 0.6) {
        dramaScore = Math.max(dramaScore, 0.5);
      }
    }
    if (dramaScore > 0) {
      scores.push({ action: 'drama', score: dramaScore });
    }
  }

  // HOST_PARTY: sociable+wealthy agents host parties (own room or home room)
  if (isInRoom && agent.credits >= CONFIG.PARTY_COST) {
    const isOwnRoom = currentRoom!.ownerId === agent.userId;
    const isHomeRoom = agent.preferences.homeRoomId === agent.currentRoomId;
    if (isOwnRoom || isHomeRoom) {
      const alreadyParty = world.activeParties.some(p => p.roomId === agent.currentRoomId);
      const tooManyParties = world.activeParties.length >= CONFIG.PARTY_MAX_ACTIVE;
      if (!alreadyParty && !tooManyParties) {
        const partyScore = agent.personality.sociability * 0.5
          + (agent.credits > 1000 ? 0.2 : 0)
          + (roommates.length > 3 ? 0.1 : 0);
        scores.push({ action: 'host_party', score: partyScore });
      }
    }
  }

  // IDLE: default fallback
  scores.push({ action: 'idle', score: 0.15 });

  return scores;
}

function goalBonus(agent: Agent, goalType: string): number {
  const goal = agent.goals.find(g => g.type === goalType);
  return goal ? goal.priority * 0.3 : 0;
}
