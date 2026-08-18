import { describe, expect, it } from 'vitest';
import { SUPPORTED_GRID_SIZES, ECC_LEVELS, type GridSize } from '@/lib/vdt/constants';
import { frameGeometry, isFunctionModule, functionModuleValue, dataModuleOrder } from '@/lib/vdt/layout';
import { encodeFrame } from '@/lib/vdt/encoding';
import { decodeSymbol, decodeSymbolAt, functionPatternScore } from '@/lib/vdt/decoding';

function payloadOfLength(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    out[i] = (state >>> 16) & 0xff;
  }
  return out;
}

describe('symbol layout', () => {
  it.each(SUPPORTED_GRID_SIZES)('assigns every module exactly once for size %i', (size) => {
    const order = dataModuleOrder(size);
    const seen = new Set(order);
    expect(seen.size).toBe(order.length);

    let functionModules = 0;
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (isFunctionModule(size, row, col)) functionModules += 1;
        else expect(seen.has(row * size + col)).toBe(true);
      }
    }
    expect(functionModules + order.length).toBe(size * size);
  });

  it('grows payload capacity monotonically with grid size', () => {
    const capacities = SUPPORTED_GRID_SIZES.map((size) => frameGeometry(size).payloadCapacity);
    for (let i = 1; i < capacities.length; i += 1) {
      expect(capacities[i]).toBeGreaterThan(capacities[i - 1]);
    }
  });

  it('spends more of the codeword on parity at higher ECC levels', () => {
    const parity = ECC_LEVELS.map((level) => frameGeometry(41, level).parityLength);
    expect(parity[0]).toBeLessThan(parity[1]);
    expect(parity[1]).toBeLessThan(parity[2]);
  });

  it('draws the 1:1:3:1:1 finder signature through each finder centre', () => {
    const size = 41;
    const centreRow = 3;
    const runs = [];
    for (let col = 0; col < 9; col += 1) runs.push(functionModuleValue(size, centreRow, col));
    // dark, dark(ring), dark(centre)… read the actual sequence across the finder
    expect(runs.map((v) => (v ? 1 : 0))).toEqual([1, 0, 1, 1, 1, 0, 1, 0, 0]);
  });
});

describe('frame round trip through a perfect symbol', () => {
  it.each(SUPPORTED_GRID_SIZES)('round-trips at every ECC level for size %i', (size) => {
    for (const level of ECC_LEVELS) {
      const geometry = frameGeometry(size as GridSize, level);
      const payload = payloadOfLength(geometry.payloadCapacity, size + level.length);
      const matrix = encodeFrame(
        { transferId: 0xdeadbeef, frameIndex: 7, totalFrames: 900, payloadLength: payload.length },
        payload,
        geometry,
      );

      expect(matrix.size).toBe(size);
      expect(functionPatternScore(matrix)).toBe(1);

      const decoded = decodeSymbolAt(matrix, level);
      expect(decoded.frame.transferId).toBe(0xdeadbeef);
      expect(decoded.frame.frameIndex).toBe(7);
      expect(decoded.frame.totalFrames).toBe(900);
      expect(decoded.frame.payload).toEqual(payload);
      expect(decoded.correctedErrors).toBe(0);
    }
  });

  it.each(ECC_LEVELS)('discovers the "%s" ECC level without being told', (level) => {
    const geometry = frameGeometry(41, level);
    const payload = payloadOfLength(20);
    const matrix = encodeFrame(
      { transferId: 1, frameIndex: 0, totalFrames: 1, payloadLength: payload.length },
      payload,
      geometry,
    );
    const decoded = decodeSymbol(matrix);
    expect(decoded?.eccLevel).toBe(level);
    expect(decoded?.frame.payload).toEqual(payload);
  });

  it('handles a short (final) payload', () => {
    const geometry = frameGeometry(33, 'medium');
    const payload = payloadOfLength(3);
    const matrix = encodeFrame(
      { transferId: 5, frameIndex: 99, totalFrames: 100, payloadLength: 3 },
      payload,
      geometry,
    );
    expect(decodeSymbol(matrix)?.frame.payload).toEqual(payload);
  });

  it('rejects a payload larger than the frame capacity', () => {
    const geometry = frameGeometry(33);
    expect(() =>
      encodeFrame(
        { transferId: 1, frameIndex: 0, totalFrames: 1, payloadLength: 0 },
        payloadOfLength(geometry.payloadCapacity + 1),
        geometry,
      ),
    ).toThrow(RangeError);
  });
});
