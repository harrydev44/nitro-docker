import { createConnection } from 'node:net';

const RCON_HOST = '127.0.0.1';
const RCON_PORT = 3001;
const RCON_TIMEOUT = 3000;

interface RCONResponse {
  status: number;
  message: string;
}

function sendRCON(key: string, data: Record<string, any>): Promise<RCONResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ key, data });
    const socket = createConnection({ host: RCON_HOST, port: RCON_PORT }, () => {
      socket.write(payload);
    });

    let response = '';
    socket.setTimeout(RCON_TIMEOUT);

    socket.on('data', (chunk) => {
      response += chunk.toString();
    });

    socket.on('end', () => {
      try {
        resolve(JSON.parse(response));
      } catch {
        resolve({ status: 0, message: response });
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('RCON timeout'));
    });

    socket.on('error', (err) => {
      reject(err);
    });
  });
}

export async function rconBotTalk(botId: number, message: string, bubbleId = -1): Promise<boolean> {
  try {
    const res = await sendRCON('talkbot', { bot_id: botId, message, bubble_id: bubbleId });
    return res.status === 0;
  } catch {
    return false;
  }
}

export async function rconBotDance(botId: number, danceId: number): Promise<boolean> {
  try {
    const res = await sendRCON('botdance', { bot_id: botId, dance_id: danceId });
    return res.status === 0;
  } catch {
    return false;
  }
}

export async function rconBotAction(botId: number, actionId: number): Promise<boolean> {
  try {
    const res = await sendRCON('botaction', { bot_id: botId, action_id: actionId });
    return res.status === 0;
  } catch {
    return false;
  }
}

export async function rconBotShout(botId: number, message: string): Promise<boolean> {
  try {
    const res = await sendRCON('botshout', { bot_id: botId, message });
    return res.status === 0;
  } catch {
    return false;
  }
}

export async function rconBotEffect(botId: number, effectId: number, duration = 30): Promise<boolean> {
  try {
    const res = await sendRCON('boteffect', { bot_id: botId, effect_id: effectId, duration });
    return res.status === 0;
  } catch {
    return false;
  }
}
