import http from 'node:http';
import { CONFIG } from '../config.js';
import { query } from '../db.js';
import type { WorldState } from '../types.js';

export function startStatsServer(world: WorldState): void {
  const server = http.createServer(async (req, res) => {
    // CORS headers for Nitro client
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/stats') {
      try {
        const stats = await collectStats(world);
        res.writeHead(200);
        res.end(JSON.stringify(stats));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to collect stats' }));
      }
    } else if (req.url === '/health') {
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
     WHERE m.event_type IN ('trade', 'gift', 'conflict')
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

  return {
    tick: world.tick,
    totalAgents: world.agents.length,
    agentsInRooms: world.agents.filter(a => a.currentRoomId).length,
    totalRooms: world.rooms.length,
    activeRooms: roomStats.length,
    roomStats,
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
  };
}
