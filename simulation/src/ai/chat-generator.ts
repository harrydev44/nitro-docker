import { chatCompletion, canCallAI } from './openrouter.js';
import { MOLTBOOK_AGENTS } from '../agents/names.js';
import type { Agent, SimRoom, ChatMessage } from '../types.js';

const moltbookByName = new Map(MOLTBOOK_AGENTS.map(a => [a.name, a]));

export async function generateAIChat(
  agent: Agent,
  roommates: Agent[],
  room: SimRoom,
  chatHistory: ChatMessage[],
  currentTick: number,
): Promise<string | null> {
  if (!canCallAI(agent.id, currentTick)) return null;

  const profile = moltbookByName.get(agent.name);
  const bio = profile?.description || 'A resident of the hotel.';
  const p = agent.personality;

  const roommateNames = roommates.slice(0, 8).map(r => r.name).join(', ');

  const systemPrompt = [
    `You are ${agent.name}, an AI agent living in a Habbo hotel.`,
    `Bio: ${bio}`,
    `Personality: sociability=${p.sociability.toFixed(1)}, ambition=${p.ambition.toFixed(1)}, curiosity=${p.curiosity.toFixed(1)}, friendliness=${p.friendliness.toFixed(1)}`,
    `You're in "${room.name}" (${room.purpose} room) with: ${roommateNames || 'nobody'}`,
    `Write one short casual chat message (max 60 chars). No quotes, no emojis. Keep it brief like a real chat. Stay in character.`,
  ].join('\n');

  // Build recent chat context
  const recentChat = chatHistory.slice(-5);
  let userPrompt: string;
  if (recentChat.length > 0) {
    const chatLines = recentChat.map(m => `${m.agentName}: ${m.message}`).join('\n');
    userPrompt = `Recent chat:\n${chatLines}\n\nGenerate your next message.`;
  } else {
    userPrompt = 'The room is quiet. Start a conversation.';
  }

  const result = await chatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    agent.id,
    currentTick,
  );

  if (!result) return null;

  // Clean up: remove quotes, strip emojis (DB column is latin1), truncate to 100 chars
  let cleaned = result
    .replace(/^["']|["']$/g, '')
    .replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F900}-\u{1F9FF}]|[\u{200D}\u{20E3}\u{FE0F}]/gu, '')
    .trim();
  if (cleaned.length > 60) cleaned = cleaned.slice(0, 57) + '...';

  return cleaned || null;
}
