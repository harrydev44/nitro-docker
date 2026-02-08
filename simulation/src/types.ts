export interface Agent {
  id: number;           // bots.id in DB
  userId: number;       // owner user_id
  name: string;
  personality: PersonalityTraits;
  preferences: AgentPreferences;
  goals: Goal[];
  currentRoomId: number | null;
  credits: number;
  state: AgentState;
  ticksSinceLastAction: number;
  ticksInCurrentRoom: number;
  ticksWorking: number;
}

export type AgentState = 'idle' | 'chatting' | 'trading' | 'working' | 'moving' | 'decorating' | 'buying';

export interface PersonalityTraits {
  sociability: number;    // 0-1: how likely to chat
  ambition: number;       // 0-1: how likely to work/trade
  curiosity: number;      // 0-1: how likely to explore new rooms
  friendliness: number;   // 0-1: how positive in interactions
  impulsiveness: number;  // 0-1: how random vs planned decisions are
}

export interface AgentPreferences {
  preferredRoomTypes: RoomPurpose[];
  socialCircleSize: number;  // how many friends they maintain
  wealthGoal: number;        // target credits
}

export interface Goal {
  type: GoalType;
  priority: number;       // 0-1
  targetId?: number;      // room or agent id
  progress?: number;      // 0-1
  createdAtTick: number;
  expiresAtTick: number;
}

export type GoalType = 'socialize' | 'earn' | 'explore' | 'decorate' | 'trade' | 'work';

export type RoomPurpose = 'hangout' | 'trade' | 'work' | 'game' | 'service' | 'empty' | 'vip';

export interface SimRoom {
  id: number;
  name: string;
  ownerId: number;
  ownerName: string;
  model: string;
  purpose: RoomPurpose;
  currentPopulation: number;
  usersMax: number;
  tradeMode: number;
}

export interface RoomStats {
  roomId: number;
  visitCount: number;
  currentPopulation: number;
  peakPopulation: number;
  purpose: RoomPurpose;
}

export interface Memory {
  id: number;
  agentId: number;
  targetAgentId: number | null;
  eventType: MemoryEventType;
  sentiment: number;       // -1.0 to 1.0
  summary: string;
  roomId: number | null;
  createdAt: Date;
}

export type MemoryEventType = 'chat' | 'trade' | 'work_together' | 'gift' | 'conflict' | 'room_visit';

export interface Relationship {
  agentId: number;
  targetAgentId: number;
  score: number;           // -100 to 100
  interactionCount: number;
  lastInteraction: Date | null;
}

export interface MarketPrice {
  itemBaseId: number;
  avgPrice: number;
  lastTradePrice: number;
  tradeCount: number;
}

export interface TradeOffer {
  fromAgentId: number;
  toAgentId: number;
  offeredItemIds: number[];
  offeredCredits: number;
  requestedItemIds: number[];
  requestedCredits: number;
}

export type ActionType = 'move' | 'chat' | 'trade' | 'work' | 'decorate' | 'buy' | 'create_room' | 'idle';

export interface ActionScore {
  action: ActionType;
  score: number;
  targetId?: number;
}

export interface WorldState {
  rooms: SimRoom[];
  agents: Agent[];
  tick: number;
  roomChatHistory: Map<number, ChatMessage[]>;
}

export interface ChatMessage {
  agentId: number;
  agentName: string;
  message: string;
  tick: number;
}

export interface JobSlot {
  roomId: number;
  jobType: string;
  payPerTick: number;
  maxWorkers: number;
  currentWorkers: number;
}
