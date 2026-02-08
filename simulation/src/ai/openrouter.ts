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

export function canCallAI(agentId: number, currentTick: number): boolean {
  if (!CONFIG.AI_ENABLED) return false;
  if (activeRequests >= CONFIG.AI_MAX_CONCURRENT) return false;

  const lastTick = agentLastCallTick.get(agentId);
  if (lastTick !== undefined && currentTick - lastTick < CONFIG.AI_COOLDOWN_TICKS) return false;

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
      console.warn(`[AI] OpenRouter ${res.status}: ${res.statusText}`);
      return null;
    }

    const data = (await res.json()) as OpenRouterResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn(`[AI] Request timed out for agent ${agentId}`);
    } else {
      console.warn(`[AI] Request failed for agent ${agentId}:`, err.message);
    }
    return null;
  } finally {
    activeRequests--;
  }
}
