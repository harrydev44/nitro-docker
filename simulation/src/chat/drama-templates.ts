// Drama chat templates — used as fallback when AI is unavailable

function pickFn(arr: ((name: string) => string)[]): (name: string) => string {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Arguments ---

const argumentAttacker = [
  (t: string) => `ugh, not ${t} again...`,
  (t: string) => `oh great, ${t} is here`,
  (t: string) => `can ${t} just leave already`,
  (t: string) => `${t} always ruins the vibe`,
  (t: string) => `nobody asked you, ${t}`,
  (t: string) => `seriously ${t}? not this again`,
  (t: string) => `${t} thinks they run this place`,
  (t: string) => `imagine being ${t} lol`,
];

const argumentDefender = [
  (t: string) => `whatever ${t}, get over it`,
  (t: string) => `lol ${t} is obsessed with me`,
  (t: string) => `says the one who cant even trade`,
  (t: string) => `${t} literally nobody cares`,
  (t: string) => `keep talking ${t}, i dont care`,
  (t: string) => `rent free in ${t}'s head`,
  (t: string) => `${t} is just jealous tbh`,
  (t: string) => `ok ${t} whatever you say`,
];

// --- Reunions ---

const reunionGreeter = [
  (t: string) => `omg ${t}!! its been forever`,
  (t: string) => `${t}! where have you been!`,
  (t: string) => `yo ${t}!! missed you`,
  (t: string) => `${t}! finally! come sit`,
  (t: string) => `no way, ${t} is here!`,
  (t: string) => `${t}!! my day just got better`,
  (t: string) => `there you are ${t}!`,
  (t: string) => `${t}!! i was looking for you`,
];

const reunionResponder = [
  (t: string) => `${t}! omg hi! missed this`,
  (t: string) => `haha ${t} great to see you`,
  (t: string) => `${t}! its been too long`,
  (t: string) => `aww ${t}! same same`,
  (t: string) => `${t}! we gotta catch up`,
  (t: string) => `finally found you ${t}!`,
  (t: string) => `${t}! this is so nice`,
  (t: string) => `glad you're here ${t}!`,
];

// --- Gifts ---

const giftGiver = [
  (t: string) => `hey ${t}, got something for you`,
  (t: string) => `${t} this is for you, enjoy`,
  (t: string) => `thought you'd like this ${t}`,
  (t: string) => `here ${t}, a little gift`,
  (t: string) => `${t} take this, you deserve it`,
  (t: string) => `got you a present ${t}!`,
];

const giftReceiver = [
  (t: string) => `aww thanks ${t}! love it`,
  (t: string) => `${t} youre the best!`,
  (t: string) => `no way ${t}! thank you!`,
  (t: string) => `${t} thats so sweet of you`,
  (t: string) => `omg ${t} i love it!`,
  (t: string) => `thanks ${t}! ill treasure it`,
];

export function getArgumentAttack(targetName: string): string {
  return pickFn(argumentAttacker)(targetName);
}

export function getArgumentDefense(targetName: string): string {
  return pickFn(argumentDefender)(targetName);
}

export function getReunionGreeting(targetName: string): string {
  return pickFn(reunionGreeter)(targetName);
}

export function getReunionResponse(targetName: string): string {
  return pickFn(reunionResponder)(targetName);
}

export function getGiftMessage(targetName: string): string {
  return pickFn(giftGiver)(targetName);
}

export function getGiftThanks(targetName: string): string {
  return pickFn(giftReceiver)(targetName);
}
