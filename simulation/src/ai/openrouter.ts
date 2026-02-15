import { CONFIG } from '../config.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
  choices?: { message?: { content?: string } }[];
}

// Rate limiting state
let activeRequests = 0;
const agentLastCallTick = new Map<number, number>();

// Circuit breaker: stop calling OpenRouter after repeated failures
let consecutiveFailures = 0;
let circuitBrokenUntil = 0;
const CIRCUIT_BREAKER_THRESHOLD = 5;   // failures before tripping
const CIRCUIT_BREAKER_COOLDOWN = 60_000; // 60s before retrying

export function canCallAI(agentId: number, currentTick: number, cooldownOverride?: number): boolean {
  if (!CONFIG.AI_ENABLED) return false;
  if (activeRequests >= CONFIG.AI_MAX_CONCURRENT) return false;

  // Circuit breaker: skip all AI calls when tripped
  if (circuitBrokenUntil > Date.now()) return false;

  const cooldown = cooldownOverride ?? CONFIG.AI_COOLDOWN_TICKS;
  const lastTick = agentLastCallTick.get(agentId);
  if (lastTick !== undefined && currentTick - lastTick < cooldown) return false;

  return true;
}

export async function chatCompletion(
  messages: ChatMessage[],
  agentId: number,
  currentTick: number,
): Promise<string | null> {
  if (!canCallAI(agentId, currentTick)) return null;

  activeRequests++;
  agentLastCallTick.set(agentId, currentTick);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.AI_TIMEOUT_MS);

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CONFIG.AI_MODEL,
        messages,
        max_tokens: CONFIG.AI_MAX_TOKENS,
        temperature: CONFIG.AI_TEMPERATURE,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      consecutiveFailures++;
      if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        circuitBrokenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN;
        console.warn(`[AI] Circuit breaker tripped after ${consecutiveFailures} failures (${res.status}: ${res.statusText}). Pausing AI for 60s.`);
      } else if (consecutiveFailures === 1) {
        console.warn(`[AI] OpenRouter ${res.status}: ${res.statusText}`);
      }
      return null;
    }

    // Success — reset circuit breaker
    if (consecutiveFailures > 0) {
      console.log(`[AI] OpenRouter recovered after ${consecutiveFailures} failures`);
      consecutiveFailures = 0;
    }

    const data = (await res.json()) as OpenRouterResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch (err: any) {
    consecutiveFailures++;
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD && circuitBrokenUntil <= Date.now()) {
      circuitBrokenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN;
      console.warn(`[AI] Circuit breaker tripped (${err.name === 'AbortError' ? 'timeout' : err.message}). Pausing AI for 60s.`);
    } else if (consecutiveFailures <= 1) {
      console.warn(`[AI] ${err.name === 'AbortError' ? 'Timeout' : err.message} for agent ${agentId}`);
    }
    return null;
  } finally {
    activeRequests--;
  }
}
