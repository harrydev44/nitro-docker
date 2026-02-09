// Chat bubble style IDs — maps to RoomChatMessageBubbles enum in emulator
export const BUBBLE = {
  NORMAL: 0,
  RED: 3,
  BLUE: 4,
  YELLOW: 5,
  GREEN: 6,
  BLACK: 7,
  HEARTS: 16,
  ROSES: 17,
  PIG: 19,
  DOG: 20,
  DRAGON: 22,
  BATS: 24,
  STEAMPUNK: 26,
  THUNDER: 27,
  PIRATE: 29,
  RADIO: 38,
} as const;

// Context → array of candidate bubble IDs
const CONTEXT_BUBBLES: Record<string, number[]> = {
  argument: [BUBBLE.RED, BUBBLE.DRAGON, BUBBLE.BLACK, BUBBLE.BATS],
  reunion:  [BUBBLE.HEARTS, BUBBLE.ROSES, BUBBLE.YELLOW],
  gift:     [BUBBLE.HEARTS, BUBBLE.ROSES, BUBBLE.GREEN],
  party:    [BUBBLE.THUNDER, BUBBLE.PIRATE, BUBBLE.RADIO],
  work:     [BUBBLE.STEAMPUNK, BUBBLE.BLUE],
  trade:    [BUBBLE.GREEN, BUBBLE.YELLOW, BUBBLE.STEAMPUNK],
  gossip:   [BUBBLE.PIG, BUBBLE.DOG],
};

/** Pick a context-appropriate bubble (or NORMAL with 30% chance for variety). */
export function pickBubbleForContext(context: string, probability = 0.7): number {
  if (Math.random() > probability) return BUBBLE.NORMAL;
  const candidates = CONTEXT_BUBBLES[context];
  if (!candidates || candidates.length === 0) return BUBBLE.NORMAL;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
