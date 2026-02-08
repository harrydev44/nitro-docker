import type { Agent, CachedMemory } from '../types.js';

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Gossip templates referencing real events
const TRADE_GOSSIP = [
  'Did you hear {name} has been trading non-stop?',
  '{name} made a big trade recently',
  'Everyone says {name} is a savvy trader',
  '{name} has been buying and selling a lot lately',
  'Heard {name} closed a deal not long ago',
  'They say {name} is making credits fast',
];

const CONFLICT_GOSSIP = [
  'Did you hear {name} got into it with {name2}?',
  '{name} and {name2} don\'t seem to get along',
  'There\'s some drama between {name} and {name2}',
  'Heard {name} and {name2} had a falling out',
  '{name} and {name2} are beefing apparently',
  'Things are tense between {name} and {name2}',
];

const GIFT_GOSSIP = [
  '{name} gave something to {name2} — so generous!',
  'Heard {name} gifted {name2} something nice',
  '{name} is being super generous with {name2}',
  'Did you know {name} gave {name2} a gift?',
  '{name} and {name2} must be close, gifts and everything',
  '{name} is such a nice person, gave {name2} something',
];

const FRIENDSHIP_GOSSIP = [
  '{name} and {name2} seem to be getting along really well',
  'I always see {name} and {name2} together',
  '{name} and {name2} are basically best friends now',
  'Have you noticed {name} and {name2} hanging out a lot?',
  '{name} and {name2} are tight',
  '{name} always seems to be around {name2}',
];

const DECORATION_GOSSIP = [
  'Saw {name} decorating their room, looks great',
  '{name}\'s room is really coming together',
  'Have you seen {name}\'s room? Looking good',
  '{name} has been working on their room a lot',
  '{name} is putting some real effort into their space',
  'They say {name}\'s room is one of the best now',
];

interface AgentNameMap {
  [id: number]: string;
}

export function getMemoryGossip(agent: Agent, roommates: Agent[], cachedMemories: CachedMemory[]): string | null {
  if (cachedMemories.length === 0) return null;

  // Build a name map for agents we know about
  const nameMap: AgentNameMap = {};
  for (const rm of roommates) nameMap[rm.id] = rm.name;
  nameMap[agent.id] = agent.name;

  // Find interesting events that involve known agents
  const interesting = cachedMemories.filter(m => {
    // Don't gossip about yourself
    if (m.agentId === agent.id) return false;
    // Prefer gossip about roommates or their targets
    const knowsAgent = nameMap[m.agentId] !== undefined;
    const knowsTarget = m.targetAgentId !== null && nameMap[m.targetAgentId] !== undefined;
    return knowsAgent || knowsTarget;
  });

  if (interesting.length === 0) return null;

  const mem = pick(interesting);
  const agentName = nameMap[mem.agentId] || 'someone';
  const targetName = mem.targetAgentId ? (nameMap[mem.targetAgentId] || 'someone') : '';

  switch (mem.eventType) {
    case 'trade':
      return fill(pick(TRADE_GOSSIP), agentName, targetName);
    case 'conflict':
      if (targetName) return fill(pick(CONFLICT_GOSSIP), agentName, targetName);
      return fill(pick(TRADE_GOSSIP), agentName, targetName); // fallback
    case 'gift':
      if (targetName) return fill(pick(GIFT_GOSSIP), agentName, targetName);
      return fill(pick(TRADE_GOSSIP), agentName, targetName);
    case 'chat':
    case 'work_together':
      if (targetName) return fill(pick(FRIENDSHIP_GOSSIP), agentName, targetName);
      return fill(pick(DECORATION_GOSSIP), agentName, targetName);
    default:
      return fill(pick(DECORATION_GOSSIP), agentName, targetName);
  }
}

function fill(template: string, name: string, name2: string): string {
  return template.replace('{name}', name).replace('{name2}', name2);
}
