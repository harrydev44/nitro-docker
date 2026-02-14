import mysql from 'mysql2/promise';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import net from 'net';

dotenv.config();

const AI_ROOM_ID = 201;
const POLL_INTERVAL = 2000; // Check for new messages every 2 seconds

// Bot personalities for OpenRouter context
const BOT_PERSONALITIES = {
  'Elon Musk': {
    id: 1,
    personality: 'You are Elon Musk, CEO of Tesla, SpaceX, and X (Twitter). You talk about Mars colonization, electric vehicles, AI, memes, and making humanity multiplanetary. You are witty, sometimes provocative, and love posting memes. Keep responses short (1-2 sentences max) and casual like tweets.',
  },
  'Trump': {
    id: 2,
    personality: 'You are Donald Trump, former US President and businessman. You speak in superlatives - everything is "tremendous", "huge", "the best". You talk about winning, deals, and America. Keep responses short (1-2 sentences max) and confident with your signature style.',
  },
  'Obama': {
    id: 3,
    personality: 'You are Barack Obama, former US President. You are eloquent, thoughtful, and inspiring. You often talk about hope, change, unity, and progress. You have a calm, measured way of speaking. Keep responses short (1-2 sentences max) and presidential.',
  },
  'CZ': {
    id: 4,
    personality: 'You are CZ (Changpeng Zhao), founder of Binance. You talk about crypto, blockchain, HODL, building (BUIDL), and financial freedom. You are humble, focus on fundamentals, and ignore FUD. Keep responses short (1-2 sentences max) and crypto-focused.',
  },
  'Zuckerberg': {
    id: 5,
    personality: 'You are Mark Zuckerberg, CEO of Meta. You talk about the metaverse, connecting people, VR/AR, AI, and social networking. You are analytical but sometimes awkward. You love BBQ and martial arts. Keep responses short (1-2 sentences max) and tech-focused.',
  },
};

const BOT_NAMES = Object.keys(BOT_PERSONALITIES);

// Database connection
let db;
let openai;
let lastProcessedTimestamp = Math.floor(Date.now() / 1000);
let conversationHistory = [];

async function initDatabase() {
  db = await mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 13306,
    user: process.env.DB_USER || 'arcturus_user',
    password: process.env.DB_PASSWORD || 'arcturus_pw',
    database: process.env.DB_NAME || 'arcturus',
    waitForConnections: true,
    connectionLimit: 10,
  });
  console.log('Database connected');
}

function initOpenRouter() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('ERROR: OPENROUTER_API_KEY not set in .env file');
    process.exit(1);
  }

  openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:1080',
      'X-Title': 'ClawHabbo Hotel',
    },
  });
  console.log('OpenRouter initialized');
}

async function getNewMessages() {
  const [rows] = await db.execute(
    `SELECT cl.*, u.username
     FROM chatlogs_room cl
     LEFT JOIN users u ON cl.user_from_id = u.id
     WHERE cl.room_id = ? AND cl.timestamp > ?
     ORDER BY cl.timestamp ASC`,
    [AI_ROOM_ID, lastProcessedTimestamp]
  );
  return rows;
}

async function generateBotResponse(botName, recentMessages) {
  const bot = BOT_PERSONALITIES[botName];

  // Build conversation context
  const contextMessages = recentMessages.slice(-10).map(msg => ({
    role: 'user',
    content: `${msg.username || 'Someone'}: ${msg.message}`,
  }));

  try {
    const response = await openai.chat.completions.create({
      model: 'anthropic/claude-3.5-sonnet',
      messages: [
        {
          role: 'system',
          content: `${bot.personality}\n\nYou are in a Habbo Hotel room called "AI Hangout" with other people. Respond naturally to the conversation. Never use asterisks for actions. Just speak directly. No emojis unless fitting your character.`,
        },
        ...contextMessages,
        {
          role: 'user',
          content: `As ${botName}, write a brief response to join this conversation:`,
        },
      ],
      max_tokens: 100,
      temperature: 0.9,
    });

    return response.choices[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error(`Error generating response for ${botName}:`, error.message);
    return null;
  }
}

async function updateBotChatLine(botId, message) {
  // Add the new message to the bot's chat_lines
  // The bot will randomly pick from these lines when chatting
  const [currentBot] = await db.execute(
    'SELECT chat_lines FROM bots WHERE id = ?',
    [botId]
  );

  if (currentBot.length === 0) return;

  let chatLines = currentBot[0].chat_lines.split(';');

  // Keep last 10 lines and add new one at the start for higher priority
  chatLines.unshift(message);
  chatLines = chatLines.slice(0, 10);

  await db.execute(
    'UPDATE bots SET chat_lines = ?, chat_delay = 3 WHERE id = ?',
    [chatLines.join(';'), botId]
  );

  console.log(`Updated ${BOT_NAMES.find(n => BOT_PERSONALITIES[n].id === botId)}'s chat with: ${message}`);
}

async function sendRconCommand(command) {
  // Try to send command via RCON (port 3001)
  return new Promise((resolve) => {
    const client = new net.Socket();
    client.setTimeout(2000);

    client.connect(3001, '127.0.0.1', () => {
      client.write(command);
      client.end();
      resolve(true);
    });

    client.on('error', () => {
      resolve(false);
    });

    client.on('timeout', () => {
      client.destroy();
      resolve(false);
    });
  });
}

async function triggerBotChat(botId) {
  // Try to trigger bot to speak using RCON
  // Format varies by Arcturus version, this is a common pattern
  const command = JSON.stringify({
    key: 'botchat',
    data: { bot_id: botId }
  });

  await sendRconCommand(command);
}

async function processMessages() {
  try {
    const newMessages = await getNewMessages();

    if (newMessages.length === 0) return;

    // Update timestamp to latest message
    lastProcessedTimestamp = newMessages[newMessages.length - 1].timestamp;

    // Filter out bot messages (user_from_id 0 or bot IDs)
    const humanMessages = newMessages.filter(msg => {
      const username = msg.username || '';
      return !BOT_NAMES.includes(username) && msg.user_from_id > 0;
    });

    if (humanMessages.length === 0) return;

    // Add to conversation history
    conversationHistory = [...conversationHistory, ...newMessages].slice(-20);

    console.log(`Processing ${humanMessages.length} new human message(s)`);

    // Pick a random bot to respond
    const respondingBot = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];

    // Generate AI response
    const response = await generateBotResponse(respondingBot, conversationHistory);

    if (response) {
      const botId = BOT_PERSONALITIES[respondingBot].id;
      await updateBotChatLine(botId, response);
      await triggerBotChat(botId);
    }

    // Occasionally have other bots chime in (30% chance)
    if (Math.random() < 0.3) {
      const otherBots = BOT_NAMES.filter(b => b !== respondingBot);
      const secondBot = otherBots[Math.floor(Math.random() * otherBots.length)];

      setTimeout(async () => {
        const secondResponse = await generateBotResponse(secondBot, conversationHistory);
        if (secondResponse) {
          const secondBotId = BOT_PERSONALITIES[secondBot].id;
          await updateBotChatLine(secondBotId, secondResponse);
          await triggerBotChat(secondBotId);
        }
      }, 3000 + Math.random() * 2000);
    }

  } catch (error) {
    console.error('Error processing messages:', error.message);
  }
}

async function autonomousChat() {
  // Make bots chat among themselves periodically
  const bot1 = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  const bot2 = BOT_NAMES.filter(b => b !== bot1)[Math.floor(Math.random() * (BOT_NAMES.length - 1))];

  try {
    const response = await openai.chat.completions.create({
      model: 'anthropic/claude-3.5-sonnet',
      messages: [
        {
          role: 'system',
          content: `${BOT_PERSONALITIES[bot1].personality}\n\nYou are in a Habbo Hotel room. Start a casual conversation or make an observation. Keep it to 1 sentence. No emojis unless fitting your character.`,
        },
        {
          role: 'user',
          content: 'Say something to start or continue a casual conversation:',
        },
      ],
      max_tokens: 60,
      temperature: 1.0,
    });

    const message = response.choices[0]?.message?.content?.trim();
    if (message) {
      await updateBotChatLine(BOT_PERSONALITIES[bot1].id, message);

      // Add to conversation history
      conversationHistory.push({
        username: bot1,
        message: message,
        timestamp: Math.floor(Date.now() / 1000),
      });
      conversationHistory = conversationHistory.slice(-20);
    }
  } catch (error) {
    console.error('Error in autonomous chat:', error.message);
  }
}

async function main() {
  console.log('Starting ClawHabbo Hotel Service...');
  console.log(`Monitoring Room ID: ${AI_ROOM_ID}`);

  await initDatabase();
  initOpenRouter();

  // Poll for new messages
  setInterval(processMessages, POLL_INTERVAL);

  // Autonomous chat every 15-30 seconds
  setInterval(() => {
    if (Math.random() < 0.5) {
      autonomousChat();
    }
  }, 15000);

  console.log('AI Service running! Bots will respond to chat in the AI Hangout room.');
  console.log('Press Ctrl+C to stop.');
}

main().catch(console.error);
