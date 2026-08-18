import { describe, expect, it } from 'vitest';
import { crc32 } from '@/lib/vdt/checksum';

const encoder = new TextEncoder();

describe('crc32', () => {
  it('matches the published IEEE check value', () => {
    // The standard test vector: CRC-32("123456789") === 0xcbf43926.
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });

  it('returns zero for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('is order-sensitive', () => {
    expect(crc32(Uint8Array.of(1, 2))).not.toBe(crc32(Uint8Array.of(2, 1)));
  });

  it('treats concatenated parts as one stream', () => {
    const whole = encoder.encode('hello world');
    expect(crc32(encoder.encode('hello '), encoder.encode('world'))).toBe(crc32(whole));
  });

  it('detects a single flipped bit', () => {
    const data = encoder.encode('the quick brown fox');
    const damaged = Uint8Array.from(data);
    damaged[5] ^= 0x01;
    expect(crc32(damaged)).not.toBe(crc32(data));
  });

  it('stays within the unsigned 32-bit range', () => {
    for (let i = 0; i < 64; i += 1) {
      const value = crc32(Uint8Array.of(i, i * 3, i * 7));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
