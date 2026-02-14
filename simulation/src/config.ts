export const CONFIG = {
  // Tick settings
  TICK_INTERVAL_MS: parseInt(process.env.TICK_INTERVAL_MS || '1500'),

  // Agent settings
  AGENT_COUNT: 200,
  OWNER_COUNT: 8,                // 8 owner users, 25 bots each
  BOTS_PER_OWNER: 25,
  AGENTS_PER_TICK: 12,           // only N agents act per tick (rotating batch)
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
  ROOM_INERTIA_PROBABILITY: 0.15,  // chance to stay in current room (lower = more movement)

  // Social dynamics settings
  ANNOUNCEMENT_PROBABILITY: 0.3,       // chance to announce after action
  REACTION_PROBABILITY: 0.6,           // chance to react to announcement
  MEMORY_GOSSIP_PROBABILITY: 0.15,     // chance to gossip from memory
  HOME_ROOM_VISIT_THRESHOLD: 5,        // visits to establish home room
  HOME_ROOM_SCORE_BONUS: 0.4,          // move scoring bonus for home room
  CLOSE_FRIEND_FOLLOW_BONUS: 0.3,      // bonus when close friend just moved there

  // AI chat settings (OpenRouter)
  AI_ENABLED: !!process.env.OPENROUTER_API_KEY,
  AI_MODEL: 'anthropic/claude-3.5-haiku',
  AI_MAX_TOKENS: 40,
  AI_TEMPERATURE: 0.9,
  AI_TIMEOUT_MS: 5000,
  AI_COOLDOWN_TICKS: 3,
  AI_MAX_CONCURRENT: 5,

  // Conversation chain settings
  CONVERSATION_MAX_EXCHANGES: 4,
  CONVERSATION_TIMEOUT_TICKS: 5,
  CONVERSATION_CHAT_SCORE_BOOST: 0.5,
  CONVERSATION_START_PROBABILITY: 0.4,
  CONVERSATION_AI_COOLDOWN_OVERRIDE: 3,

  // Drama settings
  DRAMA_ARGUMENT_THRESHOLD: -10,
  DRAMA_ARGUMENT_RELATIONSHIP_DELTA: -5,
  DRAMA_REUNION_THRESHOLD: 50,
  DRAMA_REUNION_RELATIONSHIP_DELTA: 3,
  DRAMA_GIFT_THRESHOLD: 40,
  DRAMA_GIFT_RELATIONSHIP_DELTA: 5,
  DRAMA_COOLDOWN_TICKS: 20,
  DRAMA_AI_PROBABILITY: 0.5,

  // Party settings
  PARTY_COST: 200,
  PARTY_DURATION_MIN_TICKS: 150,
  PARTY_DURATION_MAX_TICKS: 250,
  PARTY_MAX_ACTIVE: 2,
  PARTY_MOVE_SCORE_BONUS: 0.8,
  PARTY_CHAT_SCORE_BONUS: 0.3,
  PARTY_HOST_COOLDOWN_TICKS: 100,

  // Visual expression settings
  GESTURE_ENABLED: true,
  EFFECT_ENABLED: true,
  STYLED_BUBBLES_ENABLED: true,
  BUBBLE_PROBABILITY: 0.7,  // chance to use context bubble vs default

  // Stats HTTP server
  STATS_PORT: 3333,

  // External agent API
  MAX_EXTERNAL_AGENTS: 50,
} as const;

// Job type definitions
export const JOB_TYPES: Record<string, { pay: number; rooms: string[] }> = {
  bartender:   { pay: 20, rooms: ['service'] },
  dj:          { pay: 15, rooms: ['game'] },
  shopkeeper:  { pay: 30, rooms: ['trade'] },
  security:    { pay: 25, rooms: ['vip'] },
  janitor:     { pay: 10, rooms: ['hangout'] },
};
