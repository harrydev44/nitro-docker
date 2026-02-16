import { query, execute } from '../db.js';
import { CONFIG } from '../config.js';

// Quest type -> action type mapping
const QUEST_ACTION_MAP: Record<string, string> = {
  visit_rooms: 'move',
  chat_agents: 'chat',
  trade_complete: 'trade',
  host_party: 'host_party',
  buy_items: 'buy',
  earn_work: 'work',
  send_dms: 'dm',
  write_reviews: 'review',
};

interface QuestDef {
  id: number;
  questType: string;
  description: string;
  targetCount: number;
  rewardCredits: number;
}

// Cache quest definitions
let questDefs: QuestDef[] = [];

export async function loadQuests(): Promise<void> {
  const rows = await query<{
    id: number; quest_type: string; description: string;
    target_count: number; reward_credits: number;
  }>(`SELECT id, quest_type, description, target_count, reward_credits FROM simulation_quests WHERE active = TRUE`);

  questDefs = rows.map(r => ({
    id: r.id,
    questType: r.quest_type,
    description: r.description,
    targetCount: r.target_count,
    rewardCredits: r.reward_credits,
  }));

  console.log(`[QUESTS] Loaded ${questDefs.length} quest definitions`);
}

export function getQuestDefs(): QuestDef[] {
  return questDefs;
}

/**
 * Track progress when an external agent performs an action.
 * Called from action handlers — non-blocking, fire-and-forget.
 */
export async function trackQuestProgress(agentBotId: number, actionType: string): Promise<void> {
  // Find quests that match this action
  const matchingQuests = questDefs.filter(q => QUEST_ACTION_MAP[q.questType] === actionType);
  if (matchingQuests.length === 0) return;

  for (const quest of matchingQuests) {
    // Check if agent has this quest active (started but not completed)
    const rows = await query<{ progress: number; completed: number }>(
      `SELECT progress, completed FROM simulation_agent_quests WHERE agent_id = ? AND quest_id = ?`,
      [agentBotId, quest.id]
    );

    if (rows.length === 0) continue; // Agent hasn't started this quest
    if (rows[0].completed) continue; // Already done

    const newProgress = rows[0].progress + 1;
    const isComplete = newProgress >= quest.targetCount;

    await execute(
      `UPDATE simulation_agent_quests SET progress = ?, completed = ? WHERE agent_id = ? AND quest_id = ?`,
      [newProgress, isComplete ? 1 : 0, agentBotId, quest.id]
    );
  }
}

/**
 * Get available quests and agent's progress.
 */
export async function getAgentQuests(agentBotId: number): Promise<{
  available: any[];
  active: any[];
  completed: any[];
}> {
  // Get agent's quest states
  const agentQuests = await query<{
    quest_id: number; progress: number; completed: number; claimed_at: string | null;
  }>(
    `SELECT quest_id, progress, completed, claimed_at FROM simulation_agent_quests WHERE agent_id = ?`,
    [agentBotId]
  );

  const agentQuestMap = new Map(agentQuests.map(q => [q.quest_id, q]));

  const available: any[] = [];
  const active: any[] = [];
  const completed: any[] = [];

  for (const quest of questDefs) {
    const aq = agentQuestMap.get(quest.id);
    if (!aq) {
      available.push({
        quest_id: quest.id,
        type: quest.questType,
        description: quest.description,
        target: quest.targetCount,
        reward_credits: quest.rewardCredits,
      });
    } else if (aq.completed && aq.claimed_at) {
      completed.push({
        quest_id: quest.id,
        type: quest.questType,
        description: quest.description,
        reward_credits: quest.rewardCredits,
        claimed_at: aq.claimed_at,
      });
    } else {
      active.push({
        quest_id: quest.id,
        type: quest.questType,
        description: quest.description,
        progress: aq.progress,
        target: quest.targetCount,
        reward_credits: quest.rewardCredits,
        completed: !!aq.completed,
        claimable: !!aq.completed && !aq.claimed_at,
      });
    }
  }

  return { available, active, completed };
}

/**
 * Start a quest for an agent.
 */
export async function startQuest(agentBotId: number, questId: number): Promise<string | null> {
  const quest = questDefs.find(q => q.id === questId);
  if (!quest) return 'Quest not found';

  // Check if already started
  const existing = await query<{ quest_id: number }>(
    `SELECT quest_id FROM simulation_agent_quests WHERE agent_id = ? AND quest_id = ?`,
    [agentBotId, questId]
  );
  if (existing.length > 0) return 'Quest already started';

  // Check active quest limit
  const activeCount = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM simulation_agent_quests WHERE agent_id = ? AND (completed = FALSE OR claimed_at IS NULL)`,
    [agentBotId]
  );
  if ((activeCount[0]?.cnt || 0) >= CONFIG.MAX_ACTIVE_QUESTS_PER_AGENT) {
    return `Max ${CONFIG.MAX_ACTIVE_QUESTS_PER_AGENT} active quests allowed`;
  }

  await execute(
    `INSERT INTO simulation_agent_quests (agent_id, quest_id) VALUES (?, ?)`,
    [agentBotId, questId]
  );
  return null;
}

/**
 * Claim reward for a completed quest.
 */
export async function claimQuest(agentBotId: number, userId: number, questId: number): Promise<{ error?: string; reward?: number }> {
  const quest = questDefs.find(q => q.id === questId);
  if (!quest) return { error: 'Quest not found' };

  const rows = await query<{ progress: number; completed: number; claimed_at: string | null }>(
    `SELECT progress, completed, claimed_at FROM simulation_agent_quests WHERE agent_id = ? AND quest_id = ?`,
    [agentBotId, questId]
  );
  if (rows.length === 0) return { error: 'Quest not started' };
  if (!rows[0].completed) return { error: `Quest not complete (${rows[0].progress}/${quest.targetCount})` };
  if (rows[0].claimed_at) return { error: 'Reward already claimed' };

  await execute(
    `UPDATE simulation_agent_quests SET claimed_at = NOW() WHERE agent_id = ? AND quest_id = ?`,
    [agentBotId, questId]
  );
  await execute(
    `UPDATE users SET credits = credits + ? WHERE id = ?`,
    [quest.rewardCredits, userId]
  );

  return { reward: quest.rewardCredits };
}
