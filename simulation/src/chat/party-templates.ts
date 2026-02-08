// Party chat templates

const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
function pickFn(arr: ((s: string) => string)[]): (s: string) => string {
  return arr[Math.floor(Math.random() * arr.length)];
}

const partyAnnouncements = [
  (room: string) => `party at ${room}!! everyone come`,
  (room: string) => `throwing a party at ${room}, join up!`,
  (room: string) => `${room} is live, get in here!`,
  (room: string) => `party time at ${room}!`,
  (room: string) => `who wants to party? ${room} NOW`,
  (room: string) => `big event at ${room}, dont miss it`,
];

const socialAnnouncements = [
  (room: string) => `omg party at ${room}! everyone come hang`,
  (room: string) => `${room} party lets goooo`,
  (room: string) => `party at my place! ${room}!`,
];

const ambitiousAnnouncements = [
  (room: string) => `VIP event at ${room}, be there`,
  (room: string) => `exclusive party at ${room}`,
  (room: string) => `the place to be tonight: ${room}`,
];

const arrivalMessages = [
  'ayy the party is here!',
  'lets goo party time',
  'this place is buzzing',
  'heard there was a party',
  'wooo made it!',
  'the vibe is immaculate',
  'ok this is lit',
  'im here for the party!',
];

const partyVibeMessages = [
  'this party is amazing',
  'best party ever tbh',
  'love the energy in here',
  'whos the dj lol',
  'this room is packed!',
  'vibes are unmatched rn',
];

export function getPartyAnnouncement(roomName: string, personality: 'social' | 'ambitious' | 'generic'): string {
  switch (personality) {
    case 'social': return pickFn(socialAnnouncements)(roomName);
    case 'ambitious': return pickFn(ambitiousAnnouncements)(roomName);
    default: return pickFn(partyAnnouncements)(roomName);
  }
}

export function getPartyArrival(): string {
  return pick(arrivalMessages);
}

export function getPartyVibe(): string {
  return pick(partyVibeMessages);
}
