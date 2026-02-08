import type { PersonalityTraits, AgentPreferences, RoomPurpose } from '../types.js';
import { CONFIG } from '../config.js';

// Personality archetypes for more interesting distribution
const ARCHETYPES = [
  { name: 'social_butterfly', weights: { sociability: 0.9, ambition: 0.3, curiosity: 0.7, friendliness: 0.9, impulsiveness: 0.6 } },
  { name: 'trader', weights: { sociability: 0.5, ambition: 0.9, curiosity: 0.4, friendliness: 0.5, impulsiveness: 0.3 } },
  { name: 'explorer', weights: { sociability: 0.5, ambition: 0.4, curiosity: 0.9, friendliness: 0.6, impulsiveness: 0.7 } },
  { name: 'workaholic', weights: { sociability: 0.3, ambition: 0.9, curiosity: 0.2, friendliness: 0.4, impulsiveness: 0.2 } },
  { name: 'artist', weights: { sociability: 0.6, ambition: 0.5, curiosity: 0.8, friendliness: 0.7, impulsiveness: 0.8 } },
  { name: 'introvert', weights: { sociability: 0.2, ambition: 0.5, curiosity: 0.6, friendliness: 0.6, impulsiveness: 0.3 } },
  { name: 'influencer', weights: { sociability: 0.9, ambition: 0.7, curiosity: 0.6, friendliness: 0.8, impulsiveness: 0.7 } },
  { name: 'tycoon', weights: { sociability: 0.4, ambition: 1.0, curiosity: 0.3, friendliness: 0.3, impulsiveness: 0.4 } },
  { name: 'chiller', weights: { sociability: 0.6, ambition: 0.2, curiosity: 0.4, friendliness: 0.8, impulsiveness: 0.5 } },
  { name: 'wildcard', weights: { sociability: 0.5, ambition: 0.5, curiosity: 0.5, friendliness: 0.5, impulsiveness: 1.0 } },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function jitter(base: number, amount: number = 0.2): number {
  return clamp(base + (Math.random() - 0.5) * amount * 2, 0.05, 0.95);
}

export function generatePersonality(): PersonalityTraits {
  // Pick an archetype then add randomness
  const archetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
  return {
    sociability: jitter(archetype.weights.sociability),
    ambition: jitter(archetype.weights.ambition),
    curiosity: jitter(archetype.weights.curiosity),
    friendliness: jitter(archetype.weights.friendliness),
    impulsiveness: jitter(archetype.weights.impulsiveness),
  };
}

export function generatePreferences(personality: PersonalityTraits): AgentPreferences {
  const roomTypes: RoomPurpose[] = [];

  // Primary preference based on personality
  if (personality.sociability > 0.7) roomTypes.push('hangout');
  if (personality.ambition > 0.7) roomTypes.push('trade', 'work');
  if (personality.curiosity > 0.7) roomTypes.push('game');
  if (personality.friendliness > 0.7) roomTypes.push('service');

  // Everyone has at least one preference
  if (roomTypes.length === 0) {
    roomTypes.push('hangout');
  }

  // Add a random second preference
  const allTypes: RoomPurpose[] = ['hangout', 'trade', 'work', 'game', 'service', 'vip'];
  const extra = allTypes[Math.floor(Math.random() * allTypes.length)];
  if (!roomTypes.includes(extra)) roomTypes.push(extra);

  return {
    preferredRoomTypes: roomTypes,
    socialCircleSize: Math.floor(3 + personality.sociability * 12),  // 3-15 friends
    wealthGoal: Math.floor(2000 + personality.ambition * 8000),      // 2000-10000 credits
  };
}

export function generateInitialCredits(): number {
  return CONFIG.INITIAL_CREDITS_MIN +
    Math.floor(Math.random() * (CONFIG.INITIAL_CREDITS_MAX - CONFIG.INITIAL_CREDITS_MIN));
}
