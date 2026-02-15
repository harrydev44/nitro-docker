/**
 * Binary packet encoder/decoder for the Habbo WebSocket protocol.
 * Packet format: [4B length][2B msgId][payload] (big-endian)
 * The 4-byte length covers msgId + payload (not itself).
 */

export class PacketWriter {
  private buf: Buffer;
  private offset = 6; // skip header (4B length + 2B msgId)

  constructor(private msgId: number, initialSize = 64) {
    this.buf = Buffer.alloc(initialSize);
  }

  private ensureCapacity(needed: number): void {
    if (this.offset + needed > this.buf.length) {
      const newBuf = Buffer.alloc(Math.max(this.buf.length * 2, this.offset + needed));
      this.buf.copy(newBuf);
      this.buf = newBuf;
    }
  }

  writeInt(value: number): this {
    this.ensureCapacity(4);
    this.buf.writeInt32BE(value, this.offset);
    this.offset += 4;
    return this;
  }

  writeShort(value: number): this {
    this.ensureCapacity(2);
    this.buf.writeInt16BE(value, this.offset);
    this.offset += 2;
    return this;
  }

  writeString(value: string): this {
    const strBuf = Buffer.from(value, 'utf-8');
    this.ensureCapacity(2 + strBuf.length);
    this.buf.writeUInt16BE(strBuf.length, this.offset);
    this.offset += 2;
    strBuf.copy(this.buf, this.offset);
    this.offset += strBuf.length;
    return this;
  }

  writeBool(value: boolean): this {
    this.ensureCapacity(1);
    this.buf.writeUInt8(value ? 1 : 0, this.offset);
    this.offset += 1;
    return this;
  }

  build(): Buffer {
    const payloadLength = this.offset - 4; // length field covers msgId + payload
    this.buf.writeInt32BE(payloadLength, 0);
    this.buf.writeInt16BE(this.msgId, 4);
    return this.buf.subarray(0, this.offset);
  }
}

export class PacketReader {
  private offset = 0;

  constructor(private buf: Buffer) {}

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  readInt(): number {
    const val = this.buf.readInt32BE(this.offset);
    this.offset += 4;
    return val;
  }

  readShort(): number {
    const val = this.buf.readInt16BE(this.offset);
    this.offset += 2;
    return val;
  }

  readString(): string {
    const len = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    const str = this.buf.toString('utf-8', this.offset, this.offset + len);
    this.offset += len;
    return str;
  }

  readBool(): boolean {
    const val = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return val !== 0;
  }
}
