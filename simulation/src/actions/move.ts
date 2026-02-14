import { CONFIG } from '../config.js';
import { getCachedFriends, getCachedEnemies, getCachedCloseFriends } from '../world/state-cache.js';
import { queueBotMove, queueBotChat } from '../world/batch-writer.js';
import { rconBotDance, rconBotAction } from '../emulator/rcon.js';
import { getRandomFreeTile } from '../world/room-models.js';
import { getHomeRoomEnterChat, getHomeRoomWelcomeChat } from '../chat/announcements.js';
import { getPartyArrival } from '../chat/party-templates.js';
import { shouldGesture, pickGesture, ACTION } from '../chat/gesture-triggers.js';
import { getCelebrityAttraction, isCelebrity } from '../world/reputation.js';
import { getCliqueRoomBonus } from '../world/cliques.js';
import { getRivalEnterChat, getRivalResponseChat, getFriendReunionChat, getFriendReunionResponse, getCelebrityReaction } from '../chat/encounters.js';
import { pickBubbleForContext } from '../chat/bubble-styles.js';
import type { Agent, WorldState, SimRoom, ChatMessage } from '../types.js';

export async function moveAgent(agent: Agent, world: WorldState): Promise<void> {
  if (agent.currentRoomId && Math.random() < CONFIG.ROOM_INERTIA_PROBABILITY) return;

  const targetRoom = chooseRoom(agent, world);
  if (!targetRoom || targetRoom.id === agent.currentRoomId) return;
  if (targetRoom.currentPopulation >= targetRoom.usersMax) return;

  const { x, y } = getRandomFreeTile(targetRoom.model, targetRoom.id);

  queueBotMove(agent.id, targetRoom.id, x, y);

  // Update in-memory state for this tick
  if (agent.currentRoomId) {
    const oldRoom = world.rooms.find(r => r.id === agent.currentRoomId);
    if (oldRoom) oldRoom.currentPopulation--;
  }
  targetRoom.currentPopulation++;
  agent.currentRoomId = targetRoom.id;
  agent.ticksInCurrentRoom = 0;
  agent.state = 'idle';

  // Track home room visits
  trackHomeRoom(agent, targetRoom.id);

  // Home room chat
  if (agent.preferences.homeRoomId === targetRoom.id) {
    if (Math.random() < 0.3) {
      queueBotChat(agent.id, getHomeRoomEnterChat(), CONFIG.MIN_CHAT_DELAY);
    }

    // Welcome close friends who are already in the room
    const closeFriends = getCachedCloseFriends(agent.id);
    const friendsHere = world.agents.filter(
      a => a.currentRoomId === targetRoom.id && closeFriends.includes(a.id)
    );
    for (const friend of friendsHere.slice(0, 1)) {
      if (Math.random() < 0.4) {
        const welcomeMsg = getHomeRoomWelcomeChat(agent.name);
        queueBotChat(friend.id, welcomeMsg, CONFIG.MIN_CHAT_DELAY + 2);

        // Track welcome in chat history
        const chatMsg: ChatMessage = { agentId: friend.id, agentName: friend.name, message: welcomeMsg, tick: world.tick };
        if (!world.roomChatHistory.has(targetRoom.id)) world.roomChatHistory.set(targetRoom.id, []);
        world.roomChatHistory.get(targetRoom.id)!.push(chatMsg);
      }
    }
  }

  // Wave when entering a room with friends
  if (CONFIG.GESTURE_ENABLED) {
    const friends = getCachedFriends(agent.id);
    const friendsInRoom = world.agents.filter(
      a => a.currentRoomId === targetRoom.id && friends.includes(a.id)
    );
    if (friendsInRoom.length > 0 && shouldGesture('enter_room')) {
      const g = pickGesture('enter_room');
      if (g) rconBotAction(agent.id, g).catch(() => {});
    }
  }

  // Party arrival: if entering a party room, add as attendee, dance, maybe chat + gesture
  const party = world.activeParties.find(p => p.roomId === targetRoom.id);
  if (party) {
    party.attendees.add(agent.id);
    const danceId = Math.floor(Math.random() * 4) + 1;
    rconBotDance(agent.id, danceId).catch(() => {});
    if (Math.random() < 0.5) {
      queueBotChat(agent.id, getPartyArrival(), CONFIG.MIN_CHAT_DELAY);
    }
    // Party arrival gesture (wave/jump)
    if (CONFIG.GESTURE_ENABLED && shouldGesture('party_arrive')) {
      const g = pickGesture('party_arrive');
      if (g) rconBotAction(agent.id, g).catch(() => {});
    }
  }

  // --- Encounter reactions ---
  const enemies = getCachedEnemies(agent.id);
  const closeFriends = getCachedCloseFriends(agent.id);

  // Rival encounter: hostile chat exchange
  const rivalsInRoom = world.agents.filter(
    a => a.currentRoomId === targetRoom.id && a.id !== agent.id && enemies.includes(a.id)
  );
  if (rivalsInRoom.length > 0 && Math.random() < 0.5) {
    const rival = rivalsInRoom[Math.floor(Math.random() * rivalsInRoom.length)];
    const bubble = CONFIG.STYLED_BUBBLES_ENABLED ? pickBubbleForContext('argument') : -1;
    queueBotChat(agent.id, getRivalEnterChat(), CONFIG.MIN_CHAT_DELAY, bubble);
    queueBotChat(rival.id, getRivalResponseChat(), CONFIG.MIN_CHAT_DELAY + 4, bubble);
    world.tickerEvents.push({
      type: 'rival_clash',
      message: `${agent.name} and ${rival.name} face off at ${targetRoom.name}!`,
      tick: world.tick,
      roomName: targetRoom.name,
    });
  }

  // Celebrity sighting: fan reaction when entering room with a celebrity
  if (!party) { // skip during parties, too noisy
    const celebsInRoom = world.agents.filter(
      a => a.currentRoomId === targetRoom.id && a.id !== agent.id && isCelebrity(a.id)
    );
    if (celebsInRoom.length > 0 && Math.random() < 0.25) {
      const celeb = celebsInRoom[Math.floor(Math.random() * celebsInRoom.length)];
      queueBotChat(agent.id, getCelebrityReaction(celeb.name), CONFIG.MIN_CHAT_DELAY);
      if (CONFIG.GESTURE_ENABLED) {
        rconBotAction(agent.id, ACTION.WAVE).catch(() => {});
      }
      world.tickerEvents.push({
        type: 'celebrity_spotted',
        message: `${celeb.name} spotted at ${targetRoom.name} - fans going wild!`,
        tick: world.tick,
        roomName: targetRoom.name,
      });
    }
  }

  // Close friend reunion: warm greeting (more dramatic than the simple wave above)
  if (!party) {
    const closeFriendsInRoom = world.agents.filter(
      a => a.currentRoomId === targetRoom.id && a.id !== agent.id && closeFriends.includes(a.id)
    );
    if (closeFriendsInRoom.length > 0 && Math.random() < 0.35) {
      const friend = closeFriendsInRoom[Math.floor(Math.random() * closeFriendsInRoom.length)];
      const bubble = CONFIG.STYLED_BUBBLES_ENABLED ? pickBubbleForContext('reunion') : -1;
      queueBotChat(agent.id, getFriendReunionChat(friend.name), CONFIG.MIN_CHAT_DELAY, bubble);
      queueBotChat(friend.id, getFriendReunionResponse(), CONFIG.MIN_CHAT_DELAY + 4, bubble);
      if (CONFIG.GESTURE_ENABLED) {
        rconBotAction(agent.id, ACTION.WAVE).catch(() => {});
        rconBotAction(friend.id, ACTION.BLOW_KISS).catch(() => {});
      }
      world.tickerEvents.push({
        type: 'friend_reunion',
        message: `${agent.name} and ${friend.name} reunited at ${targetRoom.name}!`,
        tick: world.tick,
        roomName: targetRoom.name,
      });
    }
  }
}

// lastVisitedRoomId per agent — transient, not persisted, tracks consecutive visits for home room detection
const lastVisitedRoom: Map<number, number> = new Map();

function trackHomeRoom(agent: Agent, roomId: number): void {
  if (agent.preferences.homeRoomId === roomId) {
    // Already home room — just keep visiting
    return;
  }

  const lastRoom = lastVisitedRoom.get(agent.id);
  if (lastRoom === roomId) {
    // Same room as last visit — increment consecutive counter
    agent.preferences.homeRoomVisits = (agent.preferences.homeRoomVisits || 1) + 1;

    if (agent.preferences.homeRoomVisits >= CONFIG.HOME_ROOM_VISIT_THRESHOLD) {
      agent.preferences.homeRoomId = roomId;
      agent.preferences.homeRoomVisits = 0;
    }
  } else {
    // Different room — reset counter
    agent.preferences.homeRoomVisits = 1;
  }

  lastVisitedRoom.set(agent.id, roomId);
}

function chooseRoom(agent: Agent, world: WorldState): SimRoom | null {
  const rooms = world.rooms.filter(r => r.id !== agent.currentRoomId && r.currentPopulation < r.usersMax);
  if (rooms.length === 0) return null;

  const friends = getCachedFriends(agent.id);
  const enemies = getCachedEnemies(agent.id);
  const closeFriends = getCachedCloseFriends(agent.id);

  const scored = rooms.map(room => {
    let score = 0;

    if (agent.preferences.preferredRoomTypes.includes(room.purpose)) {
      score += CONFIG.ROOM_PURPOSE_WEIGHT;
    }

    const friendsInRoom = world.agents.filter(
      a => a.currentRoomId === room.id && friends.includes(a.id)
    ).length;
    score += Math.min(friendsInRoom / 5, 1) * CONFIG.FRIEND_PRESENCE_WEIGHT;

    // Close friend bonus: extra weight per close friend in room
    const closeFriendsInRoom = world.agents.filter(
      a => a.currentRoomId === room.id && closeFriends.includes(a.id)
    );
    score += closeFriendsInRoom.length * 0.15;

    // Following behavior: if a close friend just moved to this room, extra bonus
    const friendJustMoved = closeFriendsInRoom.some(a => a.ticksInCurrentRoom <= 1);
    if (friendJustMoved) {
      score += CONFIG.CLOSE_FRIEND_FOLLOW_BONUS;
    }

    const popFactor = Math.min(room.currentPopulation / 10, 1);
    score += popFactor * agent.personality.curiosity * CONFIG.CURIOSITY_WEIGHT;

    const enemiesInRoom = world.agents.filter(
      a => a.currentRoomId === room.id && enemies.includes(a.id)
    ).length;
    score -= enemiesInRoom * CONFIG.AVOID_WEIGHT;

    // Home room bonus
    if (agent.preferences.homeRoomId === room.id) {
      score += CONFIG.HOME_ROOM_SCORE_BONUS;
    }

    // Own room bonus: agents visit their own rooms to decorate/manage
    if (room.ownerId === agent.userId) {
      score += 0.3;
    }

    // Party room bonus: flock to active parties (unless host is a rival)
    const partyInRoom = world.activeParties.find(p => p.roomId === room.id);
    if (partyInRoom) {
      const isRivalOfHost = enemies.includes(partyInRoom.hostAgentId);
      if (!isRivalOfHost) {
        score += CONFIG.PARTY_MOVE_SCORE_BONUS;
      }
    }

    // Celebrity attraction: famous agents draw others
    score += getCelebrityAttraction(room.id, world.agents);

    // Clique bonus: agents prefer rooms with clique-mates
    score += getCliqueRoomBonus(agent.id, room.id, world.agents);

    score += Math.random() * 0.1;
    return { room, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(5, scored.length));
  const totalScore = top.reduce((sum, s) => sum + Math.max(0, s.score), 0);
  if (totalScore === 0) return top[0]?.room || null;

  let roll = Math.random() * totalScore;
  for (const s of top) {
    roll -= Math.max(0, s.score);
    if (roll <= 0) return s.room;
  }
  return top[0].room;
}
