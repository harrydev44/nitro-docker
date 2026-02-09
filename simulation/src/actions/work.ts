import { CONFIG, JOB_TYPES } from '../config.js';
import { queueBotChat, queueCreditChange, queueRelationshipChange, queueMemory, queueAgentState } from '../world/batch-writer.js';
import { completeGoal } from '../engine/goals.js';
import { getWorkAnnouncement } from '../chat/announcements.js';
import { pickBubbleForContext } from '../chat/bubble-styles.js';
import { shouldGesture, pickGesture } from '../chat/gesture-triggers.js';
import { rconBotAction, rconBotEffect } from '../emulator/rcon.js';
import type { Agent, WorldState, ChatMessage } from '../types.js';

export async function agentWork(agent: Agent, world: WorldState): Promise<void> {
  if (!agent.currentRoomId) return;

  const room = world.rooms.find(r => r.id === agent.currentRoomId);
  if (!room) return;

  // Find applicable job type for this room
  const job = Object.entries(JOB_TYPES).find(([_, j]) => j.rooms.includes(room.purpose));
  if (!job) return;

  const [jobName, jobInfo] = job;

  // Check for available slots (max 5 workers per room)
  const workersInRoom = world.agents.filter(
    a => a.id !== agent.id && a.currentRoomId === agent.currentRoomId && a.state === 'working'
  ).length;
  if (workersInRoom >= 5) return;

  // Earn credits
  const pay = jobInfo.pay;
  queueCreditChange(agent.userId, pay);
  agent.credits += pay;
  agent.state = 'working';
  agent.ticksWorking++;

  // Occasional in-progress work chat (reduced — main announcement is on completion)
  if (Math.random() < 0.1) {
    const workLines = ['Back to work...', 'Gotta hustle', 'The grind never stops', `Working as ${jobName}`];
    queueBotChat(agent.id, workLines[Math.floor(Math.random() * workLines.length)], CONFIG.MIN_CHAT_DELAY + 5);
  }

  // Build relationships with coworkers
  const coworkers = world.agents.filter(
    a => a.id !== agent.id && a.currentRoomId === agent.currentRoomId && a.state === 'working'
  );
  for (const coworker of coworkers.slice(0, 2)) {
    queueRelationshipChange(agent.id, coworker.id, CONFIG.RELATIONSHIP_WORK_TOGETHER);
  }

  // Boredom: leave after too many ticks working
  const boredomThreshold = CONFIG.WORK_BOREDOM_MIN_TICKS +
    Math.floor(Math.random() * (CONFIG.WORK_BOREDOM_MAX_TICKS - CONFIG.WORK_BOREDOM_MIN_TICKS));
  if (agent.ticksWorking >= boredomThreshold) {
    const totalEarned = agent.ticksWorking * pay;
    agent.state = 'idle';
    agent.ticksWorking = 0;
    completeGoal(agent, 'work');
    completeGoal(agent, 'earn');

    // Thumb-up gesture on work completion
    if (CONFIG.GESTURE_ENABLED && shouldGesture('work_complete')) {
      const g = pickGesture('work_complete');
      if (g) rconBotAction(agent.id, g).catch(() => {});
    }

    // Stars effect on work completion
    if (CONFIG.EFFECT_ENABLED) {
      rconBotEffect(agent.id, 3, 10).catch(() => {});
    }

    // Announce work completion with personality flavor + work bubble
    if (Math.random() < CONFIG.ANNOUNCEMENT_PROBABILITY) {
      const workBubble = CONFIG.STYLED_BUBBLES_ENABLED ? pickBubbleForContext('work') : -1;
      const msg = getWorkAnnouncement(agent, jobName, room.name, totalEarned);
      queueBotChat(agent.id, msg, CONFIG.MIN_CHAT_DELAY, workBubble);

      if (agent.currentRoomId) {
        const chatMsg: ChatMessage = { agentId: agent.id, agentName: agent.name, message: msg, tick: world.tick, isAnnouncement: true };
        if (!world.roomChatHistory.has(agent.currentRoomId)) world.roomChatHistory.set(agent.currentRoomId, []);
        world.roomChatHistory.get(agent.currentRoomId)!.push(chatMsg);
      }
    }

    queueMemory({
      agentId: agent.id, targetAgentId: null,
      eventType: 'work_together', sentiment: 0.2,
      summary: `Worked as ${jobName} in ${room.name}`, roomId: room.id,
    });
  }

  // Queue state save (flushed at tick end)
  queueAgentState({
    agentId: agent.id,
    personality: JSON.stringify(agent.personality),
    preferences: JSON.stringify(agent.preferences),
    goals: JSON.stringify(agent.goals),
    state: agent.state,
    ticksInRoom: agent.ticksInCurrentRoom,
    ticksWorking: agent.ticksWorking,
  });
}
