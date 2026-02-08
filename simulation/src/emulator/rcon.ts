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

export async function rconBotTalk(botId: number, message: string): Promise<boolean> {
  try {
    const res = await sendRCON('talkbot', { bot_id: botId, message });
    return res.status === 0;
  } catch {
    return false;
  }
}
