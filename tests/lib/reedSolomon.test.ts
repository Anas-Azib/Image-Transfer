import { describe, expect, it } from 'vitest';
import { ReedSolomonError, decode, encode, generatorPolynomial } from '@/lib/vdt/reedSolomon';

function randomBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (state >>> 16) & 0xff;
  }
  return out;
}

describe('reed–solomon', () => {
  it('produces a generator polynomial of the expected degree', () => {
    expect(generatorPolynomial(10)).toHaveLength(11);
  });

  it('is systematic: the data section is preserved verbatim', () => {
    const data = randomBytes(60, 1);
    const codeword = encode(data, 20);
    expect(codeword).toHaveLength(80);
    expect(codeword.slice(0, 60)).toEqual(data);
  });

  it('round-trips an undamaged codeword', () => {
    const data = randomBytes(100, 7);
    const result = decode(encode(data, 30), 30);
    expect(result.data).toEqual(data);
    expect(result.correctedErrors).toBe(0);
  });

  it('repairs up to floor(parity / 2) corrupted symbols', () => {
    const parity = 32;
    const data = randomBytes(120, 42);
    const codeword = encode(data, parity);

    for (let errors = 1; errors <= parity / 2; errors += 1) {
      const damaged = Uint8Array.from(codeword);
      for (let i = 0; i < errors; i += 1) {
        const position = (i * 11 + 3) % damaged.length;
        damaged[position] ^= 0xa5 ^ i;
      }
      const result = decode(damaged, parity);
      expect(result.data, `failed with ${errors} errors`).toEqual(data);
      expect(result.correctedErrors).toBe(errors);
    }
  });

  it('repairs damage that lands inside the parity section', () => {
    const parity = 20;
    const data = randomBytes(50, 9);
    const damaged = Uint8Array.from(encode(data, parity));
    damaged[damaged.length - 1] ^= 0xff;
    damaged[damaged.length - 5] ^= 0x3c;
    expect(decode(damaged, parity).data).toEqual(data);
  });

  it('rejects a codeword damaged beyond the correction capability', () => {
    const parity = 10;
    const data = randomBytes(40, 3);
    const damaged = Uint8Array.from(encode(data, parity));
    for (let i = 0; i < 12; i += 1) damaged[i * 3] ^= 0x7f;
    expect(() => decode(damaged, parity)).toThrow(ReedSolomonError);
  });

  it('refuses codewords larger than the field allows', () => {
    expect(() => encode(new Uint8Array(250), 20)).toThrow(ReedSolomonError);
  });
});
