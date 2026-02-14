import http from 'node:http';
import { CONFIG } from '../config.js';
import { query } from '../db.js';
import { getDayPeriod, getDayProgress } from '../world/day-cycle.js';
import { getFameList, isCelebrity } from '../world/reputation.js';
import { getCliqueSummary } from '../world/cliques.js';
import { handleExternalAPI, setWorldRef } from '../api/external-api.js';
import type { WorldState, TickerEvent } from '../types.js';

export function startStatsServer(world: WorldState): void {
  setWorldRef(world);

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url || '';

    // External agent API routes (/api/v1/* and /skill.md)
    if (url.startsWith('/api/v1/') || url === '/skill.md') {
      try {
        const handled = await handleExternalAPI(req, res);
        if (handled) return;
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal server error' }));
        return;
      }
    }

    res.setHeader('Content-Type', 'application/json');

    if (url === '/stats') {
      try {
        const stats = await collectStats(world);
        res.writeHead(200);
        res.end(JSON.stringify(stats));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to collect stats' }));
      }
    } else if (url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', tick: world.tick }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(CONFIG.STATS_PORT, () => {
    console.log(`[STATS] Stats server running on http://localhost:${CONFIG.STATS_PORT}/stats`);
  });
}

async function collectStats(world: WorldState) {
  // Build name→moltbookUrl lookup from agents
  const moltbookUrlMap = new Map<string, string>();
  const moltbookUrlByIdMap = new Map<number, string>();
  for (const agent of world.agents) {
    if (agent.moltbookUrl) {
      moltbookUrlMap.set(agent.name, agent.moltbookUrl);
      moltbookUrlByIdMap.set(agent.id, agent.moltbookUrl);
    }
  }

  // Room populations
  const roomStats = world.rooms
    .filter(r => r.currentPopulation > 0)
    .sort((a, b) => b.currentPopulation - a.currentPopulation)
    .map(r => ({
      id: r.id,
      name: r.name,
      population: r.currentPopulation,
      purpose: r.purpose,
    }));

  // Richest agents (by owner credits — approximate)
  const richest = await query<{ name: string; credits: number }>(
    `SELECT b.name, u.credits
     FROM bots b
     JOIN users u ON b.user_id = u.id
     WHERE u.username LIKE 'sim_owner_%'
     ORDER BY u.credits DESC
     LIMIT 10`
  );

  // Most popular rooms
  const popularRooms = await query<{ room_id: number; name: string; visit_count: number; purpose: string }>(
    `SELECT s.room_id, r.name, s.visit_count, s.purpose
     FROM simulation_room_stats s
     JOIN rooms r ON s.room_id = r.id
     ORDER BY s.visit_count DESC
     LIMIT 10`
  );

  // Recent trades
  const recentTrades = await query<{ agent_id: number; target_agent_id: number; summary: string; created_at: Date }>(
    `SELECT agent_id, target_agent_id, summary, created_at
     FROM simulation_agent_memory
     WHERE event_type = 'trade'
     ORDER BY created_at DESC
     LIMIT 10`
  );

  // Activity feed: last 20 trade/gift/conflict events with agent names
  const recentActivity = await query<{ agent_name: string; target_name: string | null; event_type: string; summary: string; created_at: Date }>(
    `SELECT b.name AS agent_name, b2.name AS target_name, m.event_type, m.summary, m.created_at
     FROM simulation_agent_memory m
     JOIN bots b ON m.agent_id = b.id
     LEFT JOIN bots b2 ON m.target_agent_id = b2.id
     WHERE m.event_type IN ('trade', 'gift', 'conflict', 'reunion', 'argument')
     ORDER BY m.created_at DESC
     LIMIT 20`
  );

  // Relationship stats
  const totalRelationships = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM simulation_relationships WHERE score != 0`
  );
  const friendships = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM simulation_relationships WHERE score >= ${CONFIG.RELATIONSHIP_FRIEND_THRESHOLD}`
  );
  const rivalries = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM simulation_relationships WHERE score <= ${CONFIG.RELATIONSHIP_RIVAL_THRESHOLD}`
  );

  // Social stats: most social agents
  const mostSocial = await query<{ agent_id: number; name: string; total_interactions: number }>(
    `SELECT r.agent_id, b.name, SUM(r.interaction_count) as total_interactions
     FROM simulation_relationships r
     JOIN bots b ON r.agent_id = b.id
     GROUP BY r.agent_id, b.name
     ORDER BY total_interactions DESC
     LIMIT 10`
  );

  // Social stats: communities (rooms grouped by homeRoomId count)
  const communities: { roomId: number; roomName: string; residents: number }[] = [];
  const homeRoomCounts = new Map<number, number>();
  for (const agent of world.agents) {
    const homeId = agent.preferences.homeRoomId;
    if (homeId) {
      homeRoomCounts.set(homeId, (homeRoomCounts.get(homeId) || 0) + 1);
    }
  }
  for (const [roomId, count] of homeRoomCounts) {
    const room = world.rooms.find(r => r.id === roomId);
    if (room && count >= 2) {
      communities.push({ roomId, roomName: room.name, residents: count });
    }
  }
  communities.sort((a, b) => b.residents - a.residents);

  // Recent announcements from memory
  const recentAnnouncements = await query<{ agent_name: string; summary: string; created_at: Date }>(
    `SELECT b.name AS agent_name, m.summary, m.created_at
     FROM simulation_agent_memory m
     JOIN bots b ON m.agent_id = b.id
     WHERE m.event_type = 'announcement'
     ORDER BY m.created_at DESC
     LIMIT 20`
  );

  // Active parties
  const activeParties = world.activeParties.map(p => {
    const room = world.rooms.find(r => r.id === p.roomId);
    const hostAgent = world.agents.find(a => a.id === p.hostAgentId);
    return {
      roomId: p.roomId,
      roomName: room?.name || 'Unknown',
      hostName: p.hostName,
      attendees: p.attendees.size,
      ticksRemaining: p.endTick - world.tick,
      hostMoltbookUrl: hostAgent?.moltbookUrl,
    };
  });

  // Generate room atmosphere and hotness scores
  const roomAtmosphere: Record<number, { atmosphere: string; hotness: number }> = {};
  for (const room of world.rooms) {
    const botsInRoom = world.agents.filter(a => a.currentRoomId === room.id);
    const partyHere = world.activeParties.find(p => p.roomId === room.id);
    const celebsHere = botsInRoom.filter(a => isCelebrity(a.id));
    const convo = world.activeConversations.get(room.id);
    const recentTickerHere = world.tickerEvents.filter(
      e => e.roomName === room.name && world.tick - e.tick < 30
    );

    // Hotness score for auto-camera prioritization
    let hotness = botsInRoom.length;
    if (partyHere) hotness += 10;
    if (celebsHere.length > 0) hotness += celebsHere.length * 3;
    if (recentTickerHere.length > 0) hotness += recentTickerHere.length * 4;
    if (convo) hotness += 2;

    // Generate atmosphere text
    const period = getDayPeriod(world.tick);
    let atmo = '';
    if (botsInRoom.length === 0) {
      atmo = `Empty ${room.purpose} room`;
    } else if (partyHere) {
      atmo = `PARTY! ${botsInRoom.length} agents dancing, hosted by ${partyHere.hostName}`;
    } else if (recentTickerHere.some(e => e.type === 'argument' || e.type === 'rival_clash')) {
      const names = botsInRoom.slice(0, 3).map(a => a.name).join(', ');
      atmo = `Tension in the air... ${names} ${botsInRoom.length > 3 ? `and ${botsInRoom.length - 3} others` : ''}`;
    } else if (celebsHere.length > 0) {
      atmo = `${celebsHere[0].name} holding court with ${botsInRoom.length - 1} others`;
    } else if (convo) {
      const speaker = world.agents.find(a => a.id === convo.lastSpeakerId);
      atmo = `${speaker?.name || 'Someone'} chatting with friends (${convo.exchangeCount} exchanges)`;
    } else if (botsInRoom.length >= 5) {
      atmo = `Busy ${period} — ${botsInRoom.length} agents hanging out`;
    } else if (botsInRoom.length >= 2) {
      const names = botsInRoom.slice(0, 2).map(a => a.name).join(' and ');
      atmo = `Quiet ${period}, ${names} in the room`;
    } else {
      atmo = `${botsInRoom[0].name} alone, ${period} vibes`;
    }

    roomAtmosphere[room.id] = { atmosphere: atmo, hotness };
  }

  // Ticker: recent events
  const ticker = world.tickerEvents
    .slice(-15)
    .reverse()
    .map(e => ({
      type: e.type,
      message: e.message,
      tick: e.tick,
      roomName: e.roomName,
    }));

  return {
    tick: world.tick,
    dayPeriod: getDayPeriod(world.tick),
    dayProgress: getDayProgress(world.tick),
    totalAgents: world.agents.length,
    agentsInRooms: world.agents.filter(a => a.currentRoomId).length,
    totalRooms: world.rooms.length,
    activeRooms: roomStats.length,
    roomStats: roomStats.map(r => ({
      ...r,
      atmosphere: roomAtmosphere[r.id]?.atmosphere || '',
      hotness: roomAtmosphere[r.id]?.hotness || 0,
    })),
    activeParties,
    richestAgents: richest.map(a => ({
      ...a,
      moltbookUrl: moltbookUrlMap.get(a.name),
    })),
    popularRooms,
    recentTrades,
    recentActivity: recentActivity.map(a => ({
      agentName: a.agent_name,
      targetName: a.target_name,
      eventType: a.event_type,
      summary: a.summary,
      time: a.created_at,
      agentMoltbookUrl: moltbookUrlMap.get(a.agent_name),
      targetMoltbookUrl: a.target_name ? moltbookUrlMap.get(a.target_name) : undefined,
    })),
    relationships: {
      total: totalRelationships[0]?.cnt || 0,
      friendships: friendships[0]?.cnt || 0,
      rivalries: rivalries[0]?.cnt || 0,
    },
    social: {
      mostSocial: mostSocial.map(s => ({
        agentId: s.agent_id,
        name: s.name,
        totalInteractions: Number(s.total_interactions),
        moltbookUrl: moltbookUrlByIdMap.get(s.agent_id),
      })),
      communities: communities.slice(0, 10),
      recentAnnouncements: recentAnnouncements.map(a => ({
        agentName: a.agent_name,
        summary: a.summary,
        time: a.created_at,
        moltbookUrl: moltbookUrlMap.get(a.agent_name),
      })),
    },
    fame: getFameList().slice(0, 10).map(f => ({
      name: f.name,
      score: Math.round(f.fameScore * 100),
      tier: f.tier,
      moltbookUrl: f.moltbookUrl,
    })),
    cliques: getCliqueSummary(),
    ticker,
    roomAtmosphere: Object.fromEntries(
      Object.entries(roomAtmosphere).map(([id, data]) => [id, data])
    ),
  };
}
