/**
 * WebSocket-based action functions — drop-in replacement for rcon.ts.
 * Each function sends a packet via the agent's WebSocket connection.
 */

import { getClientPool } from '../habbo-client/client-pool.js';
import {
  buildTalkPacket,
  buildShoutPacket,
  buildDancePacket,
  buildActionPacket,
  buildWhisperPacket,
} from '../habbo-client/protocol.js';
import { rconBotEffect } from './rcon.js';

export async function wsBotTalk(agentId: number, message: string, bubbleId = -1): Promise<boolean> {
  const pool = getClientPool();
  return pool.send(agentId, buildTalkPacket(message, bubbleId < 0 ? 0 : bubbleId));
}

export async function wsBotShout(agentId: number, message: string): Promise<boolean> {
  const pool = getClientPool();
  return pool.send(agentId, buildShoutPacket(message));
}

export async function wsBotDance(agentId: number, danceId: number): Promise<boolean> {
  const pool = getClientPool();
  return pool.send(agentId, buildDancePacket(danceId));
}

export async function wsBotAction(agentId: number, actionId: number): Promise<boolean> {
  const pool = getClientPool();
  return pool.send(agentId, buildActionPacket(actionId));
}

export async function wsBotWhisper(agentId: number, targetName: string, message: string): Promise<boolean> {
  const pool = getClientPool();
  return pool.send(agentId, buildWhisperPacket(targetName, message));
}

/**
 * Effects stay as RCON — real users can't activate arbitrary effects via packets.
 * This is the hybrid fallback.
 */
export async function wsBotEffect(agentId: number, effectId: number, duration = 30): Promise<boolean> {
  return rconBotEffect(agentId, effectId, duration);
}
