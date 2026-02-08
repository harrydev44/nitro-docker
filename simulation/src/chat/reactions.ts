import type { Agent } from '../types.js';

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fill(template: string, name: string): string {
  return template.replace('{name}', name);
}

type ReactionType = 'supportive' | 'question' | 'neutral' | 'snarky' | 'dismissive' | 'jealous';

const SUPPORTIVE = [
  'Nice one {name}!',
  'Congrats {name}!',
  'You earned it {name}',
  'Way to go {name}!',
  'That\'s awesome {name}!',
  'Happy for you {name}',
];

const QUESTION = [
  'How\'d you manage that {name}?',
  'Where {name}?',
  'Can I come {name}?',
  'Wait really {name}?',
  'How much was it {name}?',
  'Tell me more {name}',
];

const NEUTRAL = [
  'Cool',
  'Interesting',
  'Huh okay',
  'Nice',
  'Oh word',
  'That\'s something',
];

const SNARKY = [
  'Must be nice {name}',
  'Lucky you {name}...',
  'I could do better {name}',
  'Sure {name}, whatever you say',
  'Oh wow {name}, so impressive...',
  'Right {name}...',
];

const DISMISSIVE = [
  'K',
  'Nobody asked {name}',
  'And?',
  'Cool story {name}',
  'Sure thing {name}',
  'Whatever',
];

const JEALOUS = [
  'How come I never get deals like that',
  'Wish I had your luck {name}',
  'That should\'ve been mine {name}',
  'I\'m stuck here while {name} gets all the breaks',
  'Of course it\'s {name} again',
  '{name} always gets the best stuff',
];

const TEMPLATES: Record<ReactionType, string[]> = {
  supportive: SUPPORTIVE,
  question: QUESTION,
  neutral: NEUTRAL,
  snarky: SNARKY,
  dismissive: DISMISSIVE,
  jealous: JEALOUS,
};

interface ReactionResult {
  message: string;
  type: ReactionType;
  relationshipDelta: number;
}

export function getReaction(reactor: Agent, announcerName: string, relationshipScore: number): ReactionResult | null {
  const reactionType = chooseReactionType(reactor, relationshipScore);
  if (!reactionType) return null;

  const templates = TEMPLATES[reactionType];
  const message = fill(pick(templates), announcerName);

  let relationshipDelta = 0;
  if (reactionType === 'supportive') relationshipDelta = 1;
  else if (reactionType === 'snarky' || reactionType === 'jealous') relationshipDelta = -1;
  else if (reactionType === 'dismissive') relationshipDelta = -1;

  return { message, type: reactionType, relationshipDelta };
}

function chooseReactionType(reactor: Agent, score: number): ReactionType | null {
  const roll = Math.random();

  if (score >= 50) {
    // Close friend
    if (roll < 0.70) return 'supportive';
    if (roll < 0.90) return 'question';
    return 'neutral';
  } else if (score >= 20) {
    // Friend
    if (roll < 0.40) return 'supportive';
    if (roll < 0.70) return 'question';
    return 'neutral';
  } else if (score >= 0) {
    // Neutral
    if (roll < 0.50) return 'neutral';
    if (roll < 0.80) return 'question';
    return 'dismissive';
  } else {
    // Rival (score < 0)
    if (roll < 0.50) return 'snarky';
    if (roll < 0.80) return 'dismissive';
    return 'jealous';
  }
}
