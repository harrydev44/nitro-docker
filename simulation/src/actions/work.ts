import { execute } from '../db.js';
import { CONFIG, JOB_TYPES } from '../config.js';
import { adjustRelationship } from '../agents/relationships.js';
import { addMemory } from '../agents/memory.js';
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
  await execute(
    `UPDATE users SET credits = credits + ? WHERE id = ?`,
    [pay, agent.userId]
  );
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
    await execute(
      `UPDATE bots SET chat_lines = ?, chat_auto = '1', chat_delay = ? WHERE id = ?`,
      [chatLine, CONFIG.MIN_CHAT_DELAY + 5, agent.id]
    );
  }

  // Build relationships with coworkers
  const coworkers = world.agents.filter(
    a => a.id !== agent.id && a.currentRoomId === agent.currentRoomId && a.state === 'working'
  );
  for (const coworker of coworkers.slice(0, 2)) {
    await adjustRelationship(agent.id, coworker.id, CONFIG.RELATIONSHIP_WORK_TOGETHER);
  }

  // Boredom: leave after too many ticks working
  const boredomThreshold = CONFIG.WORK_BOREDOM_MIN_TICKS +
    Math.floor(Math.random() * (CONFIG.WORK_BOREDOM_MAX_TICKS - CONFIG.WORK_BOREDOM_MIN_TICKS));
  if (agent.ticksWorking >= boredomThreshold) {
    agent.state = 'idle';
    agent.ticksWorking = 0;
    completeGoal(agent, 'work');
    completeGoal(agent, 'earn');

    await addMemory(agent.id, null, 'work_together', 0.2, `Worked as ${jobName} in ${room.name}`, room.id);
  }

  // Save state
  await execute(
    `INSERT INTO simulation_agent_state (agent_id, personality, preferences, goals, state, ticks_working)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE state = VALUES(state), ticks_working = VALUES(ticks_working), goals = VALUES(goals)`,
    [agent.id, JSON.stringify(agent.personality), JSON.stringify(agent.preferences),
     JSON.stringify(agent.goals), agent.state, agent.ticksWorking]
  );
}
