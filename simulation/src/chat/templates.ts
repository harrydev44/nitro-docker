import type { Agent, RoomPurpose } from '../types.js';
import { TOPICS } from './topics.js';

// --- Greetings ---
const GREETINGS_GENERIC = [
  'Hey everyone!',
  'What\'s up?',
  'Just got here',
  'Yo!',
  'Hey hey',
  'Sup people',
  'Hi all',
  'Hola',
  'What\'s going on here?',
  'Finally made it',
];

const GREETINGS_DIRECTED = [
  'Hey {name}!',
  'What\'s up {name}?',
  '{name}! Long time no see',
  'Oh hey {name}',
  'Yo {name}',
  '{name}, what\'s good?',
  'Nice to see you {name}',
];

// --- Room-purpose chat ---
const ROOM_CHAT: Record<RoomPurpose, string[]> = {
  hangout: [
    'This place is pretty chill',
    'Love hanging out here',
    'Anyone wanna chat?',
    'This room has good vibes',
    'I could stay here all day',
    'So what\'s everyone up to?',
    'This is my favorite spot lately',
    'Man, I needed this break',
    'Anyone else just vibing?',
    'This room always has the best people',
  ],
  trade: [
    'Anyone looking to trade?',
    'I got some stuff for sale',
    'What\'s the going rate these days?',
    'Looking for a good deal',
    'Prices are wild lately',
    'Who\'s buying?',
    'I\'ve got credits to spend',
    'Check out what I\'ve got',
    'Best deals in the hotel right here',
    'Any rare items around?',
  ],
  work: [
    'Back to the grind',
    'Gotta earn those credits',
    'Another shift, another stack',
    'Working hard or hardly working?',
    'This job isn\'t bad actually',
    'Almost done with my shift',
    'The pay here is decent',
    'Who else is working today?',
    'Time flies when you\'re busy',
    'Credits don\'t earn themselves',
  ],
  game: [
    'Anyone wanna play?',
    'I\'m on a winning streak!',
    'This game is addicting',
    'Let\'s go, I\'m ready!',
    'Who\'s up for a round?',
    'I\'m the champion here',
    'Good game everyone',
    'That was close!',
    'One more round?',
    'I love this arcade',
  ],
  service: [
    'The service here is great',
    'I\'ll have the usual',
    'This is my go-to spot',
    'Anyone tried the specials?',
    'Best cafe in the hotel',
    'Grabbing a drink, want one?',
    'I come here every day',
    'The atmosphere is perfect',
    'Such a cozy place',
    'Can\'t beat this spot',
  ],
  empty: [
    'Quiet in here',
    'This room has potential',
    'Someone should decorate this place',
    'A blank canvas...',
    'I wonder who owns this room',
    'It\'s peaceful here at least',
  ],
  vip: [
    'Only the best come here',
    'VIP life is the life',
    'This is where it\'s at',
    'Exclusive vibes only',
    'Love the VIP treatment',
    'Nothing beats the VIP section',
    'High rollers only',
    'Premium experience right here',
  ],
};

// --- Replies ---
const REPLY_AGREE = [
  'Yeah totally, {name}',
  'I agree with {name}',
  'Right? {name} gets it',
  'Exactly what {name} said',
  'True that, {name}',
  '100% {name}',
  'You\'re so right {name}',
  'Couldn\'t agree more {name}',
];

const REPLY_DISAGREE = [
  'Hmm idk about that {name}',
  'I see it differently {name}',
  'Not sure about that one {name}',
  'Eh, I disagree {name}',
  'That\'s one way to see it {name}',
  'Interesting take {name}',
];

const REPLY_LAUGH = [
  'Lol {name}',
  'Haha {name} that\'s funny',
  '{name} you crack me up',
  'Lmaooo',
  'That\'s hilarious {name}',
];

const REPLY_QUESTION = [
  'What do you mean {name}?',
  'Tell me more {name}',
  'Really {name}?',
  'How so {name}?',
  'Wait what {name}?',
];

// --- Gossip ---
const GOSSIP = [
  'Have you seen {name} lately?',
  '{name} is always in the trade rooms',
  'I heard {name} got rich',
  '{name} has such a cool room',
  'I wonder what {name} is up to',
  'Did you see {name}\'s new outfit?',
  '{name} is so {trait}',
  'Everyone\'s talking about {name}',
];

// --- Idle ---
const IDLE_CHAT = [
  '*looks around*',
  'Hmm...',
  'Just thinking...',
  'Nice day in the hotel',
  'I should do something',
  'Been here for a while',
  'Wonder what\'s happening elsewhere',
  'Kinda bored ngl',
  'Anyone still here?',
  'So quiet...',
];

// --- Helper functions ---
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fill(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(`{${key}}`, value);
  }
  return result;
}

// --- Exports ---
export function getGreeting(agent: Agent, target?: Agent): string {
  if (target && Math.random() < agent.personality.friendliness) {
    return fill(pick(GREETINGS_DIRECTED), { name: target.name });
  }
  return pick(GREETINGS_GENERIC);
}

export function getRoomChat(agent: Agent, purpose: RoomPurpose): string {
  const lines = ROOM_CHAT[purpose] || ROOM_CHAT.hangout;
  // Sometimes add a topic
  if (Math.random() < 0.3) {
    return pick(lines) + ' ' + pick(TOPICS);
  }
  return pick(lines);
}

export function getReply(agent: Agent, target: Agent, _lastMessage: string): string {
  const roll = Math.random();
  let templates: string[];

  if (roll < 0.4 * agent.personality.friendliness) {
    templates = REPLY_AGREE;
  } else if (roll < 0.5) {
    templates = REPLY_LAUGH;
  } else if (roll < 0.7) {
    templates = REPLY_QUESTION;
  } else {
    templates = REPLY_DISAGREE;
  }

  return fill(pick(templates), { name: target.name });
}

export function getGossip(agent: Agent, aboutAgent: Agent): string {
  const traits = ['friendly', 'ambitious', 'mysterious', 'funny', 'cool', 'interesting', 'popular', 'quiet'];
  return fill(pick(GOSSIP), {
    name: aboutAgent.name,
    trait: pick(traits),
  });
}

export function getIdleChat(_agent: Agent): string {
  return pick(IDLE_CHAT);
}
