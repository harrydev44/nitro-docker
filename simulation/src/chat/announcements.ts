import type { Agent, WorldState } from '../types.js';

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Trade announcements ---

const TRADE_HIGH_AMBITION = [
  'Just sold a {item} to {partner} for {credits}cr! Building my empire',
  'Big deal with {partner} — {credits}cr richer now',
  'Another trade locked in. {credits}cr from {partner}',
  'Flipped a {item} to {partner} for {credits}cr, easy money',
  'My bank just grew by {credits}cr thanks to {partner}',
  'Sold a {item} for {credits}cr. Hustle never stops',
  'Closed a deal with {partner}. {credits}cr profit',
  '{credits}cr trade with {partner}. Getting closer to the top',
];

const TRADE_HIGH_SOCIAL = [
  'Love trading with {partner}! Got {credits}cr for a {item}',
  'Great deal with my friend {partner} on a {item}',
  '{partner} and I worked out a sweet trade — {credits}cr',
  'Fun haggling with {partner} over a {item}!',
  'Nice doing business with {partner}, {credits}cr for a {item}',
  'Always enjoy trading with {partner}! {credits}cr deal',
  '{partner} was looking for a {item}, happy to help for {credits}cr',
  'Made {credits}cr trading with {partner}. Love this community',
];

const TRADE_HIGH_CURIOSITY = [
  'Found someone interested in my {item}! {credits}cr from {partner}',
  'Interesting trade with {partner} — {credits}cr for a {item}',
  'Discovered {partner} wanted a {item}, made {credits}cr',
  'Tried a new deal with {partner}. {credits}cr for a {item}',
  'Experimented with pricing — got {credits}cr from {partner} for a {item}',
  'Cool trade with {partner} on a {item}. {credits}cr',
  '{partner} had an eye on my {item}. {credits}cr richer',
  'Traded a {item} to {partner} for {credits}cr. Market is moving',
];

const TRADE_LOW_SOCIAL = [
  'Sold a {item} for {credits}cr',
  'Trade done. {credits}cr',
  'Got {credits}cr for a {item}. Not bad I guess',
  '{credits}cr from a {item} trade',
  'Traded with {partner}. {credits}cr',
  'Sold something. {credits}cr richer',
  'Deal done with {partner}',
  '{item} gone, {credits}cr gained',
];

const TRADE_BUYER = [
  'Just picked up a {item} from {partner} for {credits}cr!',
  'New {item} added to my collection, cost me {credits}cr',
  'Got a {item} from {partner}. Worth every credit',
  'Shopping done — grabbed a {item} for {credits}cr',
  '{partner} sold me a nice {item} for {credits}cr',
  'Bought a {item} for {credits}cr from {partner}',
  'Added a {item} to my stuff. {credits}cr well spent',
  'New {item}! Thanks {partner}',
];

export function getTradeAnnouncement(agent: Agent, partnerName: string, itemName: string, creditAmount: number): string {
  const vars = { partner: partnerName, item: itemName, credits: String(creditAmount) };
  let templates: string[];

  if (agent.personality.ambition > 0.7) {
    templates = TRADE_HIGH_AMBITION;
  } else if (agent.personality.sociability > 0.7) {
    templates = TRADE_HIGH_SOCIAL;
  } else if (agent.personality.curiosity > 0.7) {
    templates = TRADE_HIGH_CURIOSITY;
  } else if (agent.personality.sociability < 0.3) {
    templates = TRADE_LOW_SOCIAL;
  } else {
    templates = [...TRADE_HIGH_SOCIAL, ...TRADE_HIGH_CURIOSITY];
  }

  return fillVars(pick(templates), vars);
}

export function getTradeBuyerAnnouncement(agent: Agent, partnerName: string, itemName: string, creditAmount: number): string {
  return fillVars(pick(TRADE_BUYER), { partner: partnerName, item: itemName, credits: String(creditAmount) });
}

// --- Work announcements ---

const WORK_HIGH_AMBITION = [
  'Another shift done, +{pay}cr. The grind pays off',
  'Earned {pay}cr as {job}. Building my stack',
  'Employee of the month material right here. +{pay}cr',
  '{pay}cr earned. One step closer to my goals',
  'Just finished working as {job}. {pay}cr in the bank',
  'Hard work pays — literally. +{pay}cr',
  'Done working at {room}. {pay}cr richer',
  'Shift complete, {pay}cr earned. Nobody outworks me',
];

const WORK_HIGH_SOCIAL = [
  'Good shift with the crew! Earned {pay}cr as {job}',
  'Love working with everyone at {room}. +{pay}cr',
  'Fun day at work! {pay}cr earned',
  'Great coworkers make the job worth it. +{pay}cr',
  'Wrapped up at {room}, {pay}cr and good company',
  'Working as {job} is better with friends around. +{pay}cr',
  'Teamwork pays off! {pay}cr earned at {room}',
  'Another day at {room} with great people. {pay}cr',
];

const WORK_GENERIC = [
  'Done with my shift. +{pay}cr',
  'Earned {pay}cr working as {job}',
  'Shift at {room} done, {pay}cr earned',
  'Just clocked out. {pay}cr today',
  '{pay}cr for a day\'s work as {job}',
  'Finished working at {room}. +{pay}cr',
  'Work is work. {pay}cr earned',
  'Wrapped up as {job}. {pay}cr today',
];

const WORK_LOW_SOCIAL = [
  'Shift over. {pay}cr',
  '+{pay}cr',
  'Done working',
  'Earned {pay}cr. Moving on',
  '{pay}cr as {job}. Whatever',
  'Work done',
  'Finally off the clock. {pay}cr',
  '{room} shift complete. {pay}cr',
];

export function getWorkAnnouncement(agent: Agent, jobType: string, roomName: string, earned: number): string {
  const vars = { job: jobType, room: roomName, pay: String(earned) };
  let templates: string[];

  if (agent.personality.ambition > 0.7) {
    templates = WORK_HIGH_AMBITION;
  } else if (agent.personality.sociability > 0.7) {
    templates = WORK_HIGH_SOCIAL;
  } else if (agent.personality.sociability < 0.3) {
    templates = WORK_LOW_SOCIAL;
  } else {
    templates = WORK_GENERIC;
  }

  return fillVars(pick(templates), vars);
}

// --- Decorate announcements ---

const DECORATE_HIGH_AMBITION = [
  'Just placed a new {item}! My room is looking expensive',
  'Added a {item} to my space. {count} items and counting',
  'Upgrading my room with a {item}. Gotta keep it premium',
  'New {item} placed! My room is the best in the hotel',
  'Interior design game strong — new {item}!',
  'My room just got a {item}. Living in style',
  'Room upgrade: new {item}. {count} items total',
  'Just placed a {item}. The penthouse vibes are real',
];

const DECORATE_HIGH_CURIOSITY = [
  'Trying out a new {item} in my room!',
  'Experimenting with a {item}. What do you think?',
  'New layout with a {item}! Looks different',
  'Added a {item}. My room is evolving',
  'Placed a {item}. Room design is an art',
  'Just found the perfect spot for a {item}',
  'Redecorating with a {item}! {count} items now',
  'New {item} — the room needed something fresh',
];

const DECORATE_GENERIC = [
  'Just placed a new {item}!',
  'My room is coming together, {count} items now',
  'Added a {item} to my room',
  'New {item}! Looking good',
  'Placed a {item} in my space',
  'Room update: new {item}',
  'Got a {item} set up in my room!',
  'My room just got a nice {item}',
];

export function getDecorateAnnouncement(agent: Agent, itemName: string, totalItems: number): string {
  const vars = { item: itemName, count: String(totalItems) };
  let templates: string[];

  if (agent.personality.ambition > 0.7) {
    templates = DECORATE_HIGH_AMBITION;
  } else if (agent.personality.curiosity > 0.7) {
    templates = DECORATE_HIGH_CURIOSITY;
  } else {
    templates = DECORATE_GENERIC;
  }

  return fillVars(pick(templates), vars);
}

// --- Room creation announcements ---

const ROOM_CREATE_HIGH_AMBITION = [
  'Just opened {room}! Come check out my empire',
  'New room alert: {room}. The brand is expanding',
  'Founded {room}! Another property in my portfolio',
  'Welcome to {room}! Built for greatness',
  '{room} is now open for business!',
  'Launched {room}. The hotel just got better',
  'New venue: {room}! I\'m building something big',
  '{room} is live! Come witness the vision',
];

const ROOM_CREATE_HIGH_SOCIAL = [
  'Come check out my new spot: {room}!',
  'Just created {room}! Everyone\'s welcome',
  'New room: {room}! Bring your friends',
  'Party at {room}! Just opened it',
  '{room} is open! Come hang out',
  'Made a new room called {room}, come chill!',
  'Who wants to check out {room}? Just opened it!',
  '{room} is ready! Let\'s make it the best spot',
];

const ROOM_CREATE_GENERIC = [
  'Created a new room: {room}!',
  'New room: {room} is now open',
  'Just opened {room}',
  '{room} is live! Check it out',
  'Built a new room: {room}',
  'Welcome to {room}!',
  '{room} — my newest creation',
  'Room created: {room}!',
];

export function getRoomCreateAnnouncement(agent: Agent, roomName: string): string {
  const vars = { room: roomName };
  let templates: string[];

  if (agent.personality.ambition > 0.7) {
    templates = ROOM_CREATE_HIGH_AMBITION;
  } else if (agent.personality.sociability > 0.7) {
    templates = ROOM_CREATE_HIGH_SOCIAL;
  } else {
    templates = ROOM_CREATE_GENERIC;
  }

  return fillVars(pick(templates), vars);
}

// --- Opinion announcements (random personality-driven takes) ---

const OPINION_HIGH_AMBITION = [
  'Credits are everything in this hotel',
  'The economy is booming if you know where to look',
  'Some people just don\'t hustle enough',
  'I\'m going to own the biggest room here someday',
  'Trading is the fastest way to get rich',
  'The market is favoring the bold right now',
  'I\'ve got my eyes on the top spot',
  'Hard work beats talent when talent doesn\'t work',
];

const OPINION_HIGH_SOCIAL = [
  'The people in this hotel are what make it great',
  'I love how everyone\'s got their own style here',
  'This hotel has the best community',
  'It\'s all about who you know around here',
  'The social scene is amazing today',
  'Friends make this hotel worth it',
  'Everyone\'s been so friendly lately',
  'Best conversations happen in the quiet rooms',
];

const OPINION_HIGH_CURIOSITY = [
  'I wonder how many rooms are in this hotel now',
  'Has anyone explored the new rooms lately?',
  'The hotel keeps changing every day',
  'I found some interesting rooms today',
  'There\'s always something new to discover here',
  'The hidden gems are the best rooms',
  'I love exploring different parts of the hotel',
  'Every room has its own character',
];

const OPINION_GENERIC = [
  'The hotel is lively today',
  'Things seem busy around here',
  'Interesting day so far',
  'The vibe is good today',
  'Lots happening in the hotel right now',
  'Another day in the hotel',
  'The hotel never gets boring',
  'There\'s always something going on',
];

export function getOpinion(agent: Agent): string {
  let templates: string[];

  if (agent.personality.ambition > 0.7) {
    templates = OPINION_HIGH_AMBITION;
  } else if (agent.personality.sociability > 0.7) {
    templates = OPINION_HIGH_SOCIAL;
  } else if (agent.personality.curiosity > 0.7) {
    templates = OPINION_HIGH_CURIOSITY;
  } else {
    templates = OPINION_GENERIC;
  }

  return pick(templates);
}

// --- Home room chat ---

const HOME_ROOM_ENTER = [
  'Back at my spot',
  'Home sweet room',
  'Good to be back',
  'My favorite place',
  'Back home',
  'Missed this room',
  'Nothing beats your own room',
  'Home again',
];

const HOME_ROOM_WELCOME = [
  'Welcome back {name}!',
  '{name}! Good to see you here',
  'Hey {name}, welcome to my room!',
  '{name} is back!',
  'Glad you came back {name}',
  '{name}! Make yourself at home',
];

export function getHomeRoomEnterChat(): string {
  return pick(HOME_ROOM_ENTER);
}

export function getHomeRoomWelcomeChat(friendName: string): string {
  return fillVars(pick(HOME_ROOM_WELCOME), { name: friendName });
}

// --- Helper ---

function fillVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(`{${key}}`, value);
  }
  return result;
}
