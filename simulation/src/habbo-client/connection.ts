/**
 * Single WebSocket connection manager for one Habbo agent.
 * Handles authentication, keepalive, room entry, and reconnection.
 */

import WebSocket from 'ws';
import { execute } from '../db.js';
import { PacketReader } from './packet.js';
import { IN, buildLoginPacket, buildPongPacket, buildEnterRoomPacket, buildHeightmapRequestPacket } from './protocol.js';
import { CONFIG } from '../config.js';

export type ConnectionState = 'disconnected' | 'connecting' | 'authenticating' | 'ready' | 'in_room';

const KEEPALIVE_INTERVAL_MS = 25_000;

export class HabboConnection {
  userId: number;
  state: ConnectionState = 'disconnected';
  roomId: number | null = null;
  lastRoomId: number | null = null; // remembers room for reconnection

  private ws: WebSocket | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private pendingBuffer: Buffer = Buffer.alloc(0);

  // Resolve callbacks for async operations
  private loginResolve: ((ok: boolean) => void) | null = null;
  private roomResolve: ((ok: boolean) => void) | null = null;

  constructor(userId: number) {
    this.userId = userId;
  }

  /**
   * Connect to the emulator via WebSocket and authenticate.
   * Sets auth_ticket in DB, opens WS, sends login packet, waits for OK.
   */
  async connect(): Promise<boolean> {
    if (this.state !== 'disconnected') return true;

    this.state = 'connecting';
    const ssoTicket = `agent_${this.userId}_${Date.now()}`;

    // Set SSO ticket in DB for this user
    await execute(
      `UPDATE users SET auth_ticket = ? WHERE id = ?`,
      [ssoTicket, this.userId]
    );

    return new Promise<boolean>((resolve) => {
      const wsUrl = CONFIG.WS_EMULATOR_URL;

      try {
        this.ws = new WebSocket(wsUrl);
      } catch {
        this.state = 'disconnected';
        resolve(false);
        return;
      }

      const timeout = setTimeout(() => {
        this.loginResolve = null;
        this.cleanup();
        resolve(false);
      }, 10_000);

      this.ws.binaryType = 'nodebuffer';

      this.ws.on('open', () => {
        this.state = 'authenticating';
        this.send(buildLoginPacket(ssoTicket));
        this.loginResolve = (ok) => {
          clearTimeout(timeout);
          this.loginResolve = null;
          if (ok) {
            this.state = 'ready';
            this.startKeepalive();
          } else {
            this.cleanup();
          }
          resolve(ok);
        };
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        const reasonStr = reason?.toString() || '';
        console.warn(`[WS] Agent ${this.userId} closed (code=${code}, reason="${reasonStr}", state=${this.state})`);
        if (this.loginResolve) {
          clearTimeout(timeout);
          this.loginResolve = null;
          this.cleanup();
          resolve(false);
          return;
        }
        this.cleanup();
        // Don't auto-reconnect here — let the pool health check handle it
        // to avoid competing reconnection attempts
      });

      this.ws.on('error', (err: Error) => {
        console.warn(`[WS] Agent ${this.userId} error: ${err.message}`);
        if (this.loginResolve) {
          clearTimeout(timeout);
          this.loginResolve = null;
          this.cleanup();
          resolve(false);
        }
      });
    });
  }

  /**
   * Enter a room by sending RequestRoomLoadEvent.
   */
  async enterRoom(roomId: number): Promise<boolean> {
    if (this.state !== 'ready' && this.state !== 'in_room') return false;

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.roomResolve = null;
        resolve(false);
      }, 5_000);

      this.roomResolve = (ok) => {
        clearTimeout(timeout);
        this.roomResolve = null;
        if (ok) {
          this.roomId = roomId;
          this.lastRoomId = roomId;
          this.state = 'in_room';
        }
        resolve(ok);
      };

      this.send(buildEnterRoomPacket(roomId));
    });
  }

  /**
   * Send a raw binary packet. Returns false if not connected.
   */
  send(packet: Buffer): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(packet);
    return true;
  }

  /**
   * Gracefully disconnect.
   */
  disconnect(): void {
    this.cleanup();
  }

  /**
   * Handle incoming binary data (may contain multiple packets).
   */
  private handleMessage(data: Buffer): void {
    // Accumulate data
    this.pendingBuffer = this.pendingBuffer.length > 0
      ? Buffer.concat([this.pendingBuffer, data])
      : data;

    // Process complete packets
    while (this.pendingBuffer.length >= 4) {
      const packetLen = this.pendingBuffer.readInt32BE(0);
      const totalLen = 4 + packetLen; // 4B length prefix + payload

      if (this.pendingBuffer.length < totalLen) break; // incomplete

      const packetData = this.pendingBuffer.subarray(4, totalLen);
      this.pendingBuffer = this.pendingBuffer.subarray(totalLen);

      if (packetData.length < 2) continue;

      const reader = new PacketReader(packetData);
      const msgId = reader.readShort();

      this.handlePacket(msgId, reader);
    }
  }

  private handlePacket(msgId: number, _reader: PacketReader): void {
    switch (msgId) {
      case IN.SecureLoginOKComposer:
        if (this.loginResolve) this.loginResolve(true);
        break;

      case IN.PingComposer:
        this.send(buildPongPacket());
        break;

      case IN.RoomOpenComposer:
        // Complete handshake: send RequestHeightmapEvent so emulator clears loadingRoom
        this.send(buildHeightmapRequestPacket());
        if (this.roomResolve) this.roomResolve(true);
        break;
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      this.send(buildPongPacket());
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private cleanup(): void {
    this.stopKeepalive();
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.state = 'disconnected';
    this.roomId = null;
    this.pendingBuffer = Buffer.alloc(0);
  }
}
