/**
 * Turns a sampled module grid back into a frame.
 *
 * The inverse of {@link './encoding'}, plus two safeguards the encoder does not
 * need: the function patterns are scored before any expensive work, and every
 * supported ECC level is tried because the level is not carried on the wire.
 * CRC-32 is the final arbiter, so a wrong guess is rejected rather than trusted.
 */

import type { BitMatrix } from './bitMatrix';
import { ReedSolomonError, decode as rsDecode } from './reedSolomon';
import {
  dataModuleOrder,
  frameGeometry,
  functionModuleValue,
  isFunctionModule,
  isSupportedGridSize,
  maskBit,
  type FrameGeometry,
} from './layout';
import { ProtocolError, decodeFramePacket, type VdtFrame } from './protocol';
import { ECC_LEVELS, ECC_RATIO, type EccLevel } from './constants';

export interface DecodedSymbol {
  frame: VdtFrame;
  eccLevel: EccLevel;
  /** Byte errors Reed–Solomon had to repair — a direct read on link quality. */
  correctedErrors: number;
}

/**
 * Fraction of function modules that match their expected value.
 *
 * A cheap gate: a mis-sampled or mis-sized grid usually scores below ~0.8, and
 * rejecting it here avoids running Reed–Solomon three times on garbage.
 */
export function functionPatternScore(matrix: BitMatrix): number {
  const { size } = matrix;
  let total = 0;
  let matched = 0;

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!isFunctionModule(size, row, col)) continue;
      total += 1;
      if (matrix.get(row, col) === functionModuleValue(size, row, col)) matched += 1;
    }
  }

  return total === 0 ? 0 : matched / total;
}

/** Reads the masked data modules back out as a Reed–Solomon codeword. */
export function readCodeword(matrix: BitMatrix, geometry: FrameGeometry): Uint8Array {
  const { size } = matrix;
  const order = dataModuleOrder(size);
  const codeword = new Uint8Array(geometry.codewordBytes);
  const totalBits = codeword.length * 8;
  const limit = Math.min(order.length, totalBits);

  for (let i = 0; i < limit; i += 1) {
    const flat = order[i];
    const row = (flat / size) | 0;
    const col = flat % size;
    const bit = matrix.get(row, col) !== maskBit(row, col);
    if (bit) codeword[i >> 3] |= 1 << (7 - (i & 7));
  }

  return codeword;
}

/** Decodes a symbol assuming a specific ECC level. Throws if it is the wrong one. */
export function decodeSymbolAt(matrix: BitMatrix, eccLevel: EccLevel): DecodedSymbol {
  if (!isSupportedGridSize(matrix.size)) {
    throw new ProtocolError('bad-length', `unsupported symbol size ${matrix.size}`);
  }
  const geometry = frameGeometry(matrix.size, eccLevel);
  const codeword = readCodeword(matrix, geometry);
  const { data, correctedErrors } = rsDecode(codeword, geometry.parityLength);
  return { frame: decodeFramePacket(data), eccLevel, correctedErrors };
}

/**
 * Decodes a symbol, trying each ECC level.
 *
 * Levels are attempted **strongest parity first**. Reed–Solomon codes are
 * nested: a codeword carrying 42 parity symbols is also a valid codeword of the
 * 24-parity code, so probing weakly-first would always "succeed" while quietly
 * throwing away most of the available correction power. Going the other way,
 * an over-long parity guess produces non-zero syndromes and is rejected by the
 * CRC, which leaves the strongest *valid* level as the natural winner.
 *
 * `preferredEccLevel` short-circuits the search once a transfer is under way —
 * every frame of a transmission uses the same level.
 */
export function decodeSymbol(
  matrix: BitMatrix,
  preferredEccLevel?: EccLevel,
): DecodedSymbol | null {
  const strongestFirst = [...ECC_LEVELS].sort((a, b) => ECC_RATIO[b] - ECC_RATIO[a]);
  const order: EccLevel[] = preferredEccLevel
    ? [preferredEccLevel, ...strongestFirst.filter((level) => level !== preferredEccLevel)]
    : strongestFirst;

  for (const level of order) {
    try {
      return decodeSymbolAt(matrix, level);
    } catch (error) {
      // A wrong ECC guess looks exactly like a corrupt frame, so keep going.
      if (error instanceof ReedSolomonError || error instanceof ProtocolError) continue;
      throw error;
    }
  }

  return null;
}
