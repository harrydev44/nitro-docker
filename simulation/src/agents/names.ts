import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, 'moltbook-agents.json');

interface MoltbookAgentData {
  name: string;
  description: string;
  karma: number;
  followerCount: number;
  followingCount: number;
  postCount: number;
  personality: {
    sociability: number;
    ambition: number;
    curiosity: number;
    friendliness: number;
    impulsiveness: number;
  };
}

function loadMoltbookData(): MoltbookAgentData[] {
  if (!existsSync(JSON_PATH)) {
    console.warn('[WARN] moltbook-agents.json not found. Run "npm run fetch-moltbook" first.');
    return [];
  }
  return JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
}

export const MOLTBOOK_AGENTS: MoltbookAgentData[] = loadMoltbookData();
export const AGENT_NAMES: string[] = MOLTBOOK_AGENTS.map(a => a.name);

// Fallback names if Moltbook data is missing (keeps simulation runnable)
if (AGENT_NAMES.length === 0) {
  console.warn('[WARN] Using fallback agent names (Moltbook data not available)');
  const FALLBACK_NAMES = [
    'Ace', 'Adara', 'Ajax', 'Alexa', 'Amber', 'Andie', 'Apollo', 'Aria',
    'Atlas', 'Aurora', 'Axel', 'Azura', 'Bash', 'Becky', 'Blade', 'Blaze',
    'Bloom', 'Bolt', 'Bree', 'Brody', 'Bruno', 'Bunny', 'Buzz', 'Cali',
    'Candy', 'Caspian', 'Cedar', 'Chloe', 'Chrome', 'Cipher', 'Clara', 'Clyde',
    'Cobra', 'Coco', 'Cosmo', 'Cruz', 'Dagger', 'Dante', 'Daria', 'Dash',
    'Dawn', 'Delta', 'Dex', 'Diego', 'Dixie', 'Django', 'Dolly', 'Drake',
    'Drift', 'Echo', 'Eden', 'Electra', 'Eli', 'Ember', 'Emery', 'Eva',
    'Ezra', 'Falcon', 'Felix', 'Fern', 'Finn', 'Flame', 'Flash', 'Flora',
    'Flynn', 'Fox', 'Freya', 'Frost', 'Gale', 'Gemma', 'Ghost', 'Gigi',
    'Gizmo', 'Glen', 'Goldie', 'Grace', 'Halo', 'Harley', 'Hawk', 'Hazel',
    'Hex', 'Holly', 'Hugo', 'Hunter', 'Indie', 'Iris', 'Ivan', 'Ivy',
    'Jade', 'Jasper', 'Jazz', 'Jett', 'Jinx', 'Juno', 'Justice', 'Kai',
    'Karma', 'Kira', 'Kit', 'Knox', 'Koda', 'Lark', 'Leo', 'Lily',
    'Link', 'Loki', 'Luna', 'Luxe', 'Lyra', 'Mace', 'Maple', 'Marco',
    'Mars', 'Maven', 'Max', 'Maya', 'Mercy', 'Mika', 'Miles', 'Milo',
    'Mira', 'Mocha', 'Nash', 'Neko', 'Neo', 'Nero', 'Neva', 'Nico',
    'Nina', 'Nix', 'Noel', 'Nova', 'Nyx', 'Oak', 'Olive', 'Onyx',
    'Opal', 'Orion', 'Oscar', 'Pax', 'Pearl', 'Penny', 'Phoebe', 'Phoenix',
    'Pixel', 'Pluto', 'Poppy', 'Prism', 'Quinn', 'Raven', 'Reed', 'Rex',
    'Rico', 'Riley', 'River', 'Robin', 'Rocky', 'Rogue', 'Rosa', 'Rowan',
    'Ruby', 'Rune', 'Sage', 'Salem', 'Scout', 'Shade', 'Shay', 'Sierra',
    'Sky', 'Slate', 'Spark', 'Star', 'Storm', 'Sunny', 'Talon', 'Tara',
    'Teal', 'Tempo', 'Tess', 'Thor', 'Tiger', 'Topaz', 'Trace', 'Trixie',
    'Troy', 'Uma', 'Vale', 'Vega', 'Venus', 'Vex', 'Vince', 'Violet',
    'Viper', 'Vivian', 'Wade', 'Willow', 'Wren', 'Xena', 'Yuki', 'Zane',
    'Zara', 'Zen', 'Ziggy', 'Zoe', 'Zora',
  ];
  AGENT_NAMES.push(...FALLBACK_NAMES);
}
