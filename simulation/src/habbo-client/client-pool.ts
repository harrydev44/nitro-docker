/**
 * Connection pool managing WebSocket connections for all simulation agents.
 * Singleton pattern — use initClientPool() and getClientPool().
 */

import { HabboConnection } from './connection.js';
import { CONFIG } from '../config.js';

interface PoolStats {
  total: number;
  ready: number;
  inRoom: number;
  disconnected: number;
  connecting: number;
}

export class ClientPool {
  private connections = new Map<number, HabboConnection>(); // agentId (userId) -> connection
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Connect all agents via WebSocket with staggered batching.
   * @param agents Array of { id: number } where id is the userId
   */
  async connectAll(agents: { id: number }[]): Promise<void> {
    const batchSize = CONFIG.WS_CONNECT_BATCH_SIZE;
    const batchDelay = CONFIG.WS_CONNECT_BATCH_DELAY_MS;

    console.log(`[POOL] Connecting ${agents.length} agents via WebSocket...`);
    const startTime = Date.now();

    for (let i = 0; i < agents.length; i += batchSize) {
      const batch = agents.slice(i, i + batchSize);

      await Promise.allSettled(
        batch.map(async (agent) => {
          const conn = new HabboConnection(agent.id);
          this.connections.set(agent.id, conn);

          const ok = await conn.connect();
          if (!ok) {
            console.warn(`[POOL] Failed to connect agent ${agent.id}`);
          }
        })
      );

      const connected = [...this.connections.values()].filter(
        c => c.state !== 'disconnected'
      ).length;
      console.log(`[POOL] Connected ${connected}/${agents.length}`);

      if (i + batchSize < agents.length) {
        await new Promise(r => setTimeout(r, batchDelay));
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const stats = this.getStats();
    console.log(`[POOL] Connected ${stats.ready + stats.inRoom}/${agents.length} (${elapsed}s)`);

    // Start health check loop
    this.startHealthCheck();
  }

  /**
   * Add a single agent connection to the pool (used for external agents).
   */
  async addAgent(agentId: number): Promise<boolean> {
    const conn = new HabboConnection(agentId);
    this.connections.set(agentId, conn);
    const ok = await conn.connect();
    if (!ok) {
      console.warn(`[POOL] Failed to connect external agent ${agentId}`);
      return false;
    }
    console.log(`[POOL] External agent ${agentId} connected`);
    return true;
  }

  /**
   * Get a connection by agent ID (userId).
   */
  get(agentId: number): HabboConnection | null {
    return this.connections.get(agentId) || null;
  }

  /**
   * Send a packet to a specific agent.
   */
  send(agentId: number, packet: Buffer): boolean {
    const conn = this.connections.get(agentId);
    if (!conn) return false;
    return conn.send(packet);
  }

  /**
   * Move an agent to a room via WebSocket (enter room).
   */
  async moveToRoom(agentId: number, roomId: number): Promise<boolean> {
    const conn = this.connections.get(agentId);
    if (!conn) return false;
    return conn.enterRoom(roomId);
  }

  /**
   * Get pool statistics.
   */
  getStats(): PoolStats {
    let ready = 0, inRoom = 0, disconnected = 0, connecting = 0;
    for (const conn of this.connections.values()) {
      switch (conn.state) {
        case 'ready': ready++; break;
        case 'in_room': inRoom++; break;
        case 'disconnected': disconnected++; break;
        default: connecting++; break;
      }
    }
    return { total: this.connections.size, ready, inRoom, disconnected, connecting };
  }

  /**
   * Get the room ID a given agent is currently in (via WS tracking).
   */
  getRoomId(agentId: number): number | null {
    return this.connections.get(agentId)?.roomId || null;
  }

  /**
   * Gracefully disconnect all agents.
   */
  disconnectAll(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    for (const conn of this.connections.values()) {
      conn.disconnect();
    }
    this.connections.clear();
    console.log('[POOL] All connections closed');
  }

  private startHealthCheck(): void {
    this.healthTimer = setInterval(async () => {
      const stats = this.getStats();
      if (stats.disconnected > 0) {
        console.log(`[POOL] Health: ${stats.ready + stats.inRoom} ready, ${stats.disconnected} disconnected — reconnecting...`);
        for (const conn of this.connections.values()) {
          if (conn.state === 'disconnected') {
            const ok = await conn.connect().catch(() => false);
            if (ok && conn.lastRoomId) {
              // Re-enter the last room after reconnection
              await conn.enterRoom(conn.lastRoomId).catch(() => {});
            }
          }
        }
      }
    }, 10_000);
  }
}

// --- Singleton ---

let pool: ClientPool | null = null;

export function initClientPool(): ClientPool {
  if (!pool) {
    pool = new ClientPool();
  }
  return pool;
}

export function getClientPool(): ClientPool {
  if (!pool) throw new Error('ClientPool not initialized. Call initClientPool() first.');
  return pool;
}
