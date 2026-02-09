// Bot gesture (action) constants — maps to RoomUserAction enum in emulator
export const ACTION = {
  WAVE: 1,
  BLOW_KISS: 2,
  LAUGH: 3,
  JUMP: 6,
  THUMB_UP: 7,
} as const;

type ActionId = (typeof ACTION)[keyof typeof ACTION];

// Event → possible gestures to pick from
const EVENT_GESTURES: Record<string, ActionId[]> = {
  reunion:        [ACTION.WAVE, ACTION.BLOW_KISS],
  gift_give:      [ACTION.BLOW_KISS],
  gift_receive:   [ACTION.THUMB_UP, ACTION.JUMP],
  party_host:     [ACTION.WAVE, ACTION.JUMP],
  party_arrive:   [ACTION.WAVE, ACTION.JUMP],
  trade_complete: [ACTION.THUMB_UP],
  work_complete:  [ACTION.THUMB_UP],
  enter_room:     [ACTION.WAVE],
  happy_chat:     [ACTION.LAUGH],
  party_pulse:    [ACTION.WAVE, ACTION.LAUGH, ACTION.JUMP],
};

// Event → probability of actually performing a gesture
const GESTURE_PROBABILITY: Record<string, number> = {
  reunion:        0.8,
  gift_give:      0.7,
  gift_receive:   0.5,
  party_host:     0.9,
  party_arrive:   0.6,
  trade_complete: 0.5,
  work_complete:  0.4,
  enter_room:     0.3,
  happy_chat:     0.1,
  party_pulse:    0.3,
};

export function shouldGesture(event: string): boolean {
  const prob = GESTURE_PROBABILITY[event] ?? 0;
  return Math.random() < prob;
}

export function pickGesture(event: string): ActionId | null {
  const gestures = EVENT_GESTURES[event];
  if (!gestures || gestures.length === 0) return null;
  return gestures[Math.floor(Math.random() * gestures.length)];
}
