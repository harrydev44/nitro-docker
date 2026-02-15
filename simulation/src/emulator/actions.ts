/**
 * Unified action dispatcher — switches between RCON (bot mode) and WebSocket (user mode)
 * based on USE_WEBSOCKET_AGENTS config flag.
 *
 * All action files should import from here instead of directly from rcon.ts.
 */

import { CONFIG } from '../config.js';
import { rconBotTalk, rconBotDance, rconBotAction, rconBotShout, rconBotEffect } from './rcon.js';
import { wsBotTalk, wsBotDance, wsBotAction, wsBotShout, wsBotEffect, wsBotWhisper } from './ws-actions.js';

export const botTalk = CONFIG.USE_WEBSOCKET_AGENTS ? wsBotTalk : rconBotTalk;
export const botShout = CONFIG.USE_WEBSOCKET_AGENTS ? wsBotShout : rconBotShout;
export const botDance = CONFIG.USE_WEBSOCKET_AGENTS ? wsBotDance : rconBotDance;
export const botAction = CONFIG.USE_WEBSOCKET_AGENTS ? wsBotAction : rconBotAction;
export const botEffect = CONFIG.USE_WEBSOCKET_AGENTS ? wsBotEffect : rconBotEffect;
// Whisper: WS mode sends whisper packet; RCON mode falls back to regular talk
export const botWhisper: (agentId: number, targetName: string, message: string) => Promise<boolean> =
  CONFIG.USE_WEBSOCKET_AGENTS ? wsBotWhisper : (id, _target, msg) => rconBotTalk(id, msg);
