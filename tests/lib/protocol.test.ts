import { describe, expect, it } from 'vitest';
import {
  ProtocolError,
  createTransferId,
  decodeFramePacket,
  decodeManifest,
  encodeFramePacket,
  encodeManifest,
} from '@/lib/vdt/protocol';
import { FRAME_HEADER_SIZE, HEADER_OFFSET_VERSION, PROTOCOL_VERSION } from '@/lib/vdt/constants';

const header = {
  transferId: 0xdeadbeef,
  frameIndex: 41,
  totalFrames: 512,
  payloadLength: 0,
};

function payload(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 31 + 7) & 0xff);
}

describe('frame packets', () => {
  it('round-trips every header field', () => {
    const body = payload(64);
    const decoded = decodeFramePacket(encodeFramePacket({ ...header, payloadLength: 64 }, body));

    expect(decoded.version).toBe(PROTOCOL_VERSION);
    expect(decoded.transferId).toBe(0xdeadbeef);
    expect(decoded.frameIndex).toBe(41);
    expect(decoded.totalFrames).toBe(512);
    expect(decoded.payloadLength).toBe(64);
    expect(decoded.payload).toEqual(body);
  });

  it('handles an empty payload', () => {
    const decoded = decodeFramePacket(encodeFramePacket(header, new Uint8Array(0)));
    expect(decoded.payload).toHaveLength(0);
  });

  it('ignores trailing padding beyond the declared payload', () => {
    const body = payload(20);
    const packet = encodeFramePacket({ ...header, payloadLength: 20 }, body);
    const padded = new Uint8Array(packet.length + 40);
    padded.set(packet, 0);
    padded.fill(0xec, packet.length);

    expect(decodeFramePacket(padded).payload).toEqual(body);
  });

  it('rejects a bad magic byte', () => {
    const packet = encodeFramePacket(header, payload(8));
    packet[0] ^= 0xff;
    expect(() => decodeFramePacket(packet)).toThrow(
      expect.objectContaining({ code: 'bad-magic' }),
    );
  });

  it('rejects an incompatible protocol version', () => {
    const packet = encodeFramePacket(header, payload(8));
    packet[HEADER_OFFSET_VERSION] = PROTOCOL_VERSION + 1;
    expect(() => decodeFramePacket(packet)).toThrow(
      expect.objectContaining({ code: 'unsupported-version' }),
    );
  });

  it('rejects a payload byte corrupted in flight', () => {
    const packet = encodeFramePacket({ ...header, payloadLength: 32 }, payload(32));
    packet[FRAME_HEADER_SIZE + 5] ^= 0x40;
    expect(() => decodeFramePacket(packet)).toThrow(
      expect.objectContaining({ code: 'checksum-mismatch' }),
    );
  });

  it('rejects a corrupted header field', () => {
    const packet = encodeFramePacket({ ...header, payloadLength: 32 }, payload(32));
    packet[7] ^= 0x08; // inside frameIndex
    expect(() => decodeFramePacket(packet)).toThrow(
      expect.objectContaining({ code: 'checksum-mismatch' }),
    );
  });

  it('rejects a truncated message', () => {
    expect(() => decodeFramePacket(new Uint8Array(4))).toThrow(ProtocolError);
  });

  it('refuses to build a frame whose index exceeds the total', () => {
    expect(() =>
      encodeFramePacket({ ...header, frameIndex: 512, totalFrames: 512 }, new Uint8Array(0)),
    ).toThrow(ProtocolError);
  });
});

describe('stream manifest', () => {
  const manifest = {
    byteLength: 123456,
    checksum: 0xabcd1234,
    width: 1024,
    height: 768,
    mimeType: 'image/webp',
    fileName: 'holiday-photo.webp',
  };

  it('round-trips', () => {
    const encoded = encodeManifest(manifest);
    const decoded = decodeManifest(encoded);
    expect(decoded.manifest).toEqual(manifest);
    expect(decoded.byteLength).toBe(encoded.length);
  });

  it('survives multi-byte characters in the file name', () => {
    const withUnicode = { ...manifest, fileName: 'фото-Ω-😀.webp' };
    expect(decodeManifest(encodeManifest(withUnicode)).manifest.fileName).toBe(withUnicode.fileName);
  });

  it('reports where the file bytes begin', () => {
    const encoded = encodeManifest(manifest);
    const stream = new Uint8Array(encoded.length + 10);
    stream.set(encoded, 0);
    expect(decodeManifest(stream).byteLength).toBe(encoded.length);
  });

  it('rejects a stream that does not start with a manifest', () => {
    expect(() => decodeManifest(new Uint8Array(40))).toThrow(
      expect.objectContaining({ code: 'malformed-manifest' }),
    );
  });

  it('rejects inconsistent length fields', () => {
    const encoded = encodeManifest(manifest);
    encoded[19] = 200; // mimeLength no longer matches the total
    expect(() => decodeManifest(encoded)).toThrow(
      expect.objectContaining({ code: 'malformed-manifest' }),
    );
  });
});

describe('transfer identifiers', () => {
  it('produces non-zero 32-bit values', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = createTransferId();
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(id)).toBe(true);
    }
  });
});
