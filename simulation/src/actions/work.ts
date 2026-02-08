import { CONFIG, JOB_TYPES } from '../config.js';
import { queueBotChat, queueCreditChange, queueRelationshipChange, queueMemory, queueAgentState } from '../world/batch-writer.js';
import { completeGoal } from '../engine/goals.js';
import type { Agent, WorldState } from '../types.js';

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

  // Work chat line
  const workLines = [
    'Back to work...',
    'Another day, another credit',
    `Working as ${jobName}`,
    'This pays well enough',
    'Almost done with this shift',
    'Gotta hustle',
    'The grind never stops',
  ];
  const chatLine = workLines[Math.floor(Math.random() * workLines.length)];
  if (Math.random() < 0.3) {
    queueBotChat(agent.id, chatLine, CONFIG.MIN_CHAT_DELAY + 5);
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
    agent.state = 'idle';
    agent.ticksWorking = 0;
    completeGoal(agent, 'work');
    completeGoal(agent, 'earn');

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
