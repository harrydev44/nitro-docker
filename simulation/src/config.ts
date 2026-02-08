export const CONFIG = {
  // Tick settings
  TICK_INTERVAL_MS: parseInt(process.env.TICK_INTERVAL_MS || '3000'),

  // Agent settings
  AGENT_COUNT: 200,
  OWNER_COUNT: 8,                // 8 owner users, 25 bots each
  BOTS_PER_OWNER: 25,
  AGENT_IDLE_PROBABILITY: 0.3,   // 30% chance agent does nothing per tick
  MAX_GOALS_PER_AGENT: 3,
  GOAL_GENERATION_MIN_TICKS: 50,
  GOAL_GENERATION_MAX_TICKS: 100,
  GOAL_EXPIRY_TICKS: 200,

  // Room settings
  MAX_ROOMS_PER_AGENT: 3,
  ROOM_INACTIVE_THRESHOLD: 100,  // ticks with 0 visits before marked inactive
  MAX_ROOM_POPULATION: 25,

  // Chat settings
  MIN_CHAT_DELAY: 7,             // emulator minimum
  REPLY_PROBABILITY: 0.4,        // 40% chance of replying vs new topic
  CHAT_HISTORY_LENGTH: 5,        // last 5 messages per room kept in memory

  // Economy settings
  INITIAL_CREDITS_MIN: 1000,
  INITIAL_CREDITS_MAX: 5000,
  WORK_PAY_MIN: 10,
  WORK_PAY_MAX: 50,
  WORK_BOREDOM_MIN_TICKS: 10,
  WORK_BOREDOM_MAX_TICKS: 20,
  ROOM_CREATION_COST: 500,

  // Relationship settings
  RELATIONSHIP_FRIEND_THRESHOLD: 20,
  RELATIONSHIP_CLOSE_FRIEND_THRESHOLD: 50,
  RELATIONSHIP_AVOID_THRESHOLD: -10,
  RELATIONSHIP_RIVAL_THRESHOLD: -30,
  RELATIONSHIP_DECAY_PER_100_TICKS: 1,
  MAX_MEMORIES_PER_AGENT: 50,

  // Relationship adjustments per interaction
  RELATIONSHIP_CHAT_POSITIVE: 1,
  RELATIONSHIP_TRADE_COMPLETE: 3,
  RELATIONSHIP_CONFLICT: -5,
  RELATIONSHIP_GIFT: 5,
  RELATIONSHIP_WORK_TOGETHER: 2,

  // Buy settings
  MAX_INVENTORY_ITEMS: 20,
  STARTING_ITEMS_PER_AGENT: 5,

  // Trade settings
  TRADE_ACCEPT_BASE_PROBABILITY: 0.6,
  TRADE_REJECT_PROBABILITY: 0.2,
  TRADE_COUNTER_PROBABILITY: 0.2,

  // Movement settings
  ROOM_PURPOSE_WEIGHT: 0.4,
  FRIEND_PRESENCE_WEIGHT: 0.3,
  CURIOSITY_WEIGHT: 0.2,
  AVOID_WEIGHT: 0.1,
  ROOM_INERTIA_PROBABILITY: 0.4,  // chance to stay in current room

  // Stats HTTP server
  STATS_PORT: 3333,
} as const;

// Job type definitions
export const JOB_TYPES: Record<string, { pay: number; rooms: string[] }> = {
  bartender:   { pay: 20, rooms: ['service'] },
  dj:          { pay: 15, rooms: ['game'] },
  shopkeeper:  { pay: 30, rooms: ['trade'] },
  security:    { pay: 25, rooms: ['vip'] },
  janitor:     { pay: 10, rooms: ['hangout'] },
};
