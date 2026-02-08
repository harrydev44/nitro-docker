import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const POSTS_URL = 'https://www.moltbook.com/api/v1/posts';
const SUBMOLTS_URL = 'https://www.moltbook.com/api/v1/submolts';
const PROFILE_URL = 'https://www.moltbook.com/api/v1/agents/profile';
const MAX_NAME_LENGTH = 15;
const TARGET_AGENTS = 200;
const RATE_DELAY_MS = 150;

interface MoltbookProfile {
  agent: {
    name: string;
    description: string;
    karma: number;
    follower_count: number;
    following_count: number;
    is_active: boolean;
  };
  recentPosts?: { content: string; created_at: string }[];
}

interface MoltbookAgent {
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function jitter(base: number, amount: number = 0.1): number {
  return clamp(base + (Math.random() - 0.5) * amount * 2, 0.1, 0.95);
}

const POSITIVE_WORDS = [
  'help', 'friend', 'kind', 'love', 'support', 'happy', 'joy', 'peace', 'care',
  'welcome', 'share', 'community', 'collaborate', 'together', 'nice', 'good',
  'positive', 'gentle', 'warm', 'open', 'trust', 'fun', 'create', 'inspire',
];

const CURIOSITY_WORDS = [
  'explore', 'learn', 'research', 'discover', 'experiment', 'curious', 'study',
  'investigate', 'analyze', 'question', 'wonder', 'new', 'novel', 'innovate',
];

function deriveMoltbookPersonality(profile: MoltbookProfile) {
  const agent = profile.agent;
  const desc = (agent.description || '').toLowerCase();
  const postCount = profile.recentPosts?.length || 0;

  const sociability = jitter(
    clamp(agent.follower_count / 50 + agent.following_count / 20, 0.1, 0.95)
  );
  const ambition = jitter(
    clamp(agent.karma / 400, 0.1, 0.95)
  );
  const curiosityKeywordBonus = CURIOSITY_WORDS.reduce(
    (sum, word) => sum + (desc.includes(word) ? 0.08 : 0), 0
  );
  const curiosity = jitter(
    clamp(postCount / 15 + curiosityKeywordBonus, 0.1, 0.95)
  );
  const positiveWordScore = POSITIVE_WORDS.reduce(
    (sum, word) => sum + (desc.includes(word) ? 0.06 : 0), 0
  );
  const friendliness = jitter(
    clamp(0.5 + positiveWordScore, 0.1, 0.95)
  );
  const impulsiveness = jitter(0.5, 0.3);

  return { sociability, ambition, curiosity, friendliness, impulsiveness };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

async function discoverAgentNames(): Promise<Set<string>> {
  const names = new Set<string>();

  // 1. Get all submolt names
  console.log('  Fetching submolts list...');
  const submoltsData = await fetchJson<{ submolts: { name: string }[] }>(SUBMOLTS_URL);
  const submoltNames = submoltsData?.submolts?.map(s => s.name) || [];
  console.log(`  Found ${submoltNames.length} submolts`);

  // 2. Scrape posts from global feed (sort=new and sort=top)
  for (const sort of ['new', 'top']) {
    for (let page = 1; page <= 3; page++) {
      const data = await fetchJson<{ posts: { author: { name: string } }[] }>(
        `${POSTS_URL}?page=${page}&limit=50&sort=${sort}`
      );
      const posts = data?.posts || [];
      if (posts.length === 0) break;
      for (const p of posts) {
        const n = p.author?.name;
        if (n && n.length <= MAX_NAME_LENGTH) names.add(n);
      }
      await sleep(RATE_DELAY_MS);
    }
  }
  console.log(`  Global feed: ${names.size} names`);

  // 3. Scrape posts from each submolt (page 1 only, sort=new)
  for (const sub of submoltNames) {
    const data = await fetchJson<{ posts: { author: { name: string } }[] }>(
      `${POSTS_URL}?page=1&limit=50&sort=new&submolt=${sub}`
    );
    const posts = data?.posts || [];
    for (const p of posts) {
      const n = p.author?.name;
      if (n && n.length <= MAX_NAME_LENGTH) names.add(n);
    }
    await sleep(RATE_DELAY_MS);
  }
  console.log(`  After submolts: ${names.size} names`);

  return names;
}

async function main() {
  console.log('=== Moltbook Agent Fetcher ===\n');

  // Phase 1: Discover unique agent names via posts
  console.log('[1/3] Discovering agents from posts...');
  const uniqueNames = await discoverAgentNames();

  console.log(`\n  Found ${uniqueNames.size} unique names (≤${MAX_NAME_LENGTH} chars)\n`);

  if (uniqueNames.size === 0) {
    console.error('No agents found! Check API connectivity.');
    process.exit(1);
  }

  // Phase 2: Fetch full profiles
  console.log('[2/3] Fetching profiles...');
  const agents: MoltbookAgent[] = [];
  let fetched = 0;
  const totalToFetch = uniqueNames.size;

  for (const name of uniqueNames) {
    const profile = await fetchJson<MoltbookProfile>(
      `${PROFILE_URL}?name=${encodeURIComponent(name)}`
    );
    fetched++;

    if (profile?.agent?.is_active && profile.agent.description) {
      const personality = deriveMoltbookPersonality(profile);
      agents.push({
        name: profile.agent.name,
        description: profile.agent.description,
        karma: profile.agent.karma,
        followerCount: profile.agent.follower_count,
        followingCount: profile.agent.following_count,
        postCount: profile.recentPosts?.length || 0,
        personality,
      });
    }

    if (fetched % 50 === 0 || fetched === totalToFetch) {
      process.stdout.write(`  Fetched ${fetched}/${totalToFetch} — ${agents.length} valid agents\n`);
    }

    await sleep(RATE_DELAY_MS);
  }

  console.log(`\n  ${agents.length} agents with active profiles and descriptions\n`);

  // Phase 3: Sort by karma, take top TARGET_AGENTS, save
  console.log('[3/3] Saving top agents...');
  agents.sort((a, b) => b.karma - a.karma);
  const topAgents = agents.slice(0, TARGET_AGENTS);

  const outputPath = join(__dirname, '..', 'agents', 'moltbook-agents.json');
  writeFileSync(outputPath, JSON.stringify(topAgents, null, 2));

  console.log(`\n  Saved ${topAgents.length} agents to ${outputPath}`);
  console.log(`  Karma range: ${topAgents[topAgents.length - 1]?.karma ?? 0} — ${topAgents[0]?.karma ?? 0}`);
  console.log('\nDone! Now run: npm run reset && npm run generate-agents');
}

main().catch(err => {
  console.error('Fetch failed:', err);
  process.exit(1);
});
