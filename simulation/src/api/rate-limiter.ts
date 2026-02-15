// Per-agent rate limiting for external API

interface RateBucket {
  timestamps: number[];  // timestamps of recent requests
}

interface ActionCooldown {
  lastUsed: number;      // timestamp of last use
}

// Rate limit config (seconds between allowed actions)
const ACTION_COOLDOWNS: Record<string, number> = {
  chat: 8,
  move: 10,
  shout: 30,
  dance: 5,
  gesture: 5,
  create_room: 60,
  walk: 2,
  buy: 5,
  place_item: 3,
  pickup_item: 3,
  trade: 15,
  look: 30,
  motto: 30,
  whisper: 5,
  host_party: 120,
};

const GLOBAL_LIMIT = 60;          // requests per minute
const GLOBAL_WINDOW_MS = 60_000;

// agentId -> global rate bucket
const globalBuckets = new Map<number, RateBucket>();
// "agentId:action" -> cooldown tracker
const actionCooldowns = new Map<string, ActionCooldown>();

export function checkGlobalRate(agentId: number): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  let bucket = globalBuckets.get(agentId);
  if (!bucket) {
    bucket = { timestamps: [] };
    globalBuckets.set(agentId, bucket);
  }

  // Prune timestamps older than window
  bucket.timestamps = bucket.timestamps.filter(t => now - t < GLOBAL_WINDOW_MS);

  if (bucket.timestamps.length >= GLOBAL_LIMIT) {
    const oldest = bucket.timestamps[0];
    return { allowed: false, retryAfterMs: GLOBAL_WINDOW_MS - (now - oldest) };
  }

  bucket.timestamps.push(now);
  return { allowed: true };
}

export function checkActionRate(agentId: number, action: string): { allowed: boolean; retryAfterMs?: number } {
  const cooldownSec = ACTION_COOLDOWNS[action];
  if (!cooldownSec) return { allowed: true }; // no cooldown for this action

  const key = `${agentId}:${action}`;
  const now = Date.now();
  const cooldown = actionCooldowns.get(key);

  if (cooldown) {
    const elapsed = now - cooldown.lastUsed;
    const cooldownMs = cooldownSec * 1000;
    if (elapsed < cooldownMs) {
      return { allowed: false, retryAfterMs: cooldownMs - elapsed };
    }
  }

  actionCooldowns.set(key, { lastUsed: now });
  return { allowed: true };
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, bucket] of globalBuckets) {
    bucket.timestamps = bucket.timestamps.filter(t => now - t < GLOBAL_WINDOW_MS);
    if (bucket.timestamps.length === 0) globalBuckets.delete(id);
  }
  for (const [key, cd] of actionCooldowns) {
    if (now - cd.lastUsed > 120_000) actionCooldowns.delete(key);
  }
}, 300_000);
