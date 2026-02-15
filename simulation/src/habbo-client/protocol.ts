/**
 * Habbo packet IDs and message builder functions.
 * IDs are for the Arcturus emulator (Habbo 2020+ protocol).
 */

import { PacketWriter } from './packet.js';

// --- Outgoing (client → server) packet IDs ---
export const OUT = {
  SecureLoginEvent: 2419,
  PongEvent: 2596,
  RequestRoomLoadEvent: 2312,
  RequestHeightmapEvent: 3898,
  RoomUserTalkEvent: 1314,
  RoomUserShoutEvent: 2085,
  RoomUserWalkEvent: 3320,
  RoomUserDanceEvent: 2080,
  RoomUserActionEvent: 2456,
} as const;

// --- Incoming (server → client) packet IDs ---
export const IN = {
  SecureLoginOKComposer: 2491,
  PingComposer: 3928,
  RoomOpenComposer: 758,
} as const;

// --- Message builders ---

export function buildLoginPacket(ssoTicket: string): Buffer {
  return new PacketWriter(OUT.SecureLoginEvent)
    .writeString(ssoTicket)
    .writeInt(0) // unknown/unused
    .build();
}

export function buildPongPacket(): Buffer {
  return new PacketWriter(OUT.PongEvent)
    .writeInt(0) // Emulator's PingEvent.handle() calls readInt() — must include payload
    .build();
}

export function buildEnterRoomPacket(roomId: number): Buffer {
  return new PacketWriter(OUT.RequestRoomLoadEvent)
    .writeInt(roomId)
    .writeString('') // password
    .writeInt(0)      // unknown
    .build();
}

export function buildHeightmapRequestPacket(): Buffer {
  return new PacketWriter(OUT.RequestHeightmapEvent).build();
}

export function buildTalkPacket(message: string, bubbleId = 0): Buffer {
  return new PacketWriter(OUT.RoomUserTalkEvent)
    .writeString(message)
    .writeInt(bubbleId)
    .build();
}

export function buildShoutPacket(message: string, bubbleId = 0): Buffer {
  return new PacketWriter(OUT.RoomUserShoutEvent)
    .writeString(message)
    .writeInt(bubbleId)
    .build();
}

export function buildWalkPacket(x: number, y: number): Buffer {
  return new PacketWriter(OUT.RoomUserWalkEvent)
    .writeInt(x)
    .writeInt(y)
    .build();
}

export function buildDancePacket(danceId: number): Buffer {
  return new PacketWriter(OUT.RoomUserDanceEvent)
    .writeInt(danceId)
    .build();
}

export function buildActionPacket(actionId: number): Buffer {
  return new PacketWriter(OUT.RoomUserActionEvent)
    .writeInt(actionId)
    .build();
}
