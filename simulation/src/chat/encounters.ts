function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Rival encounters ---

const RIVAL_ENTER = [
  'Ugh, not you again...',
  'Oh great, look who showed up',
  'I was having a good time until now',
  "Don't even look at me",
  "Of course YOU're here",
  "Can't go anywhere without running into you",
  'We need to stop meeting like this',
  'Seriously? This room too?',
  'Well, there goes the vibe',
  "You're still around?",
];

const RIVAL_RESPONSE = [
  "Trust me, I'm not thrilled either",
  'The feeling is mutual',
  "Don't flatter yourself",
  'I was here first',
  "Whatever, I'm ignoring you",
  'Stay on your side of the room',
  "I'm not leaving just because you're here",
  'Right back at you',
  'Try me',
  "You wish you were on my level",
];

// --- Close friend reunion ---

const FRIEND_REUNION = [
  "Bestie! It's been forever!",
  '{name}!! I missed you!',
  "There you are! Been looking for you",
  "Hey {name}! So glad you're here",
  'My favorite person just walked in!',
  '{name}! Come sit with me!',
  "The room just got better - {name} is here!",
  'Finally! {name} is in the building!',
  '{name}! We have so much to catch up on',
  "No way, {name}! What are the odds?",
];

const FRIEND_REUNION_RESPONSE = [
  'Aww missed you too!',
  "Let's catch up! So much to talk about",
  "Right back at ya! Where've you been?",
  'Yay! Room just got 100x better',
  'You always make my day better',
  'Finally someone fun to talk to!',
  'We have SO much to talk about',
  'My bestie is here!',
  "I was hoping I'd run into you!",
  "Get over here, I saved you a spot!",
];

// --- Celebrity sighting ---

const CELEBRITY_REACTION = [
  'OMG it\'s {name}!',
  'Is that really {name}?!',
  'Wait... {name} is in THIS room?!',
  'No way - {name} just walked in!',
  '{name} is here! I\'m starstruck',
  'THE {name}! Can\'t believe it!',
  'Everyone look! {name} is here!',
  '{name}!! Huge fan!',
  'A legend just entered the room...',
  '{name} in the building! This is huge',
];

export function getRivalEnterChat(): string {
  return pick(RIVAL_ENTER);
}

export function getRivalResponseChat(): string {
  return pick(RIVAL_RESPONSE);
}

export function getFriendReunionChat(name: string): string {
  return pick(FRIEND_REUNION).replace('{name}', name);
}

export function getFriendReunionResponse(): string {
  return pick(FRIEND_REUNION_RESPONSE);
}

export function getCelebrityReaction(name: string): string {
  return pick(CELEBRITY_REACTION).replace('{name}', name);
}
