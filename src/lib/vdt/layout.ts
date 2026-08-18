/**
 * Geometry of a VDT symbol.
 *
 * Every symbol is a square of `size × size` modules built from:
 *
 *   • three 7×7 concentric-square finder patterns (top-left, top-right,
 *     bottom-left) with a one-module light separator. Three rather than four is
 *     deliberate — the missing corner makes orientation unambiguous.
 *   • one 5×5 alignment pattern near the bottom-right corner. It supplies the
 *     fourth point correspondence the perspective transform needs, and it
 *     re-anchors the sampling grid when the screen is photographed at an angle.
 *   • alternating timing patterns on row 6 and column 6, used to validate the
 *     inferred module pitch.
 *
 * Everything else carries data, written in a QR-style two-column serpentine so
 * that the eight bits of a byte always land inside a compact 2×4 tile. Localised
 * damage (glare, a fingerprint, a moiré band) therefore corrupts few *bytes*,
 * which is exactly what a byte-oriented Reed–Solomon code repairs best.
 */

import {
  ALIGNMENT_INSET,
  ALIGNMENT_SIZE,
  DEFAULT_ECC_LEVEL,
  ECC_RATIO,
  FINDER_SEPARATOR,
  FINDER_SIZE,
  FRAME_HEADER_SIZE,
  RS_MAX_CODEWORD,
  SUPPORTED_GRID_SIZES,
  TIMING_INDEX,
  type EccLevel,
  type GridSize,
} from './constants';

export interface Point {
  x: number;
  y: number;
}

export interface SymbolCapacity {
  /** Modules available to the codeword. */
  dataModules: number;
  /** Whole bytes the symbol can carry, i.e. the Reed–Solomon codeword length. */
  codewordBytes: number;
}

export interface FrameGeometry extends SymbolCapacity {
  size: GridSize;
  eccLevel: EccLevel;
  /** Reed–Solomon parity symbols per frame. */
  parityLength: number;
  /** Codeword bytes available to header + payload + padding. */
  messageLength: number;
  /** Payload bytes a single frame can carry. */
  payloadCapacity: number;
}

const FINDER_BLOCK = FINDER_SIZE + FINDER_SEPARATOR;

export function isSupportedGridSize(size: number): size is GridSize {
  return (SUPPORTED_GRID_SIZES as readonly number[]).includes(size);
}

/** Centre of the bottom-right alignment pattern, in module indices. */
export function alignmentCenter(size: number): { row: number; col: number } {
  const index = size - 1 - ALIGNMENT_INSET + 1;
  return { row: index, col: index };
}

function inFinderBlock(size: number, row: number, col: number): boolean {
  const inTopLeft = row < FINDER_BLOCK && col < FINDER_BLOCK;
  const inTopRight = row < FINDER_BLOCK && col >= size - FINDER_BLOCK;
  const inBottomLeft = row >= size - FINDER_BLOCK && col < FINDER_BLOCK;
  return inTopLeft || inTopRight || inBottomLeft;
}

function inAlignmentBlock(size: number, row: number, col: number): boolean {
  const { row: centerRow, col: centerCol } = alignmentCenter(size);
  const radius = (ALIGNMENT_SIZE - 1) / 2;
  return (
    row >= centerRow - radius &&
    row <= centerRow + radius &&
    col >= centerCol - radius &&
    col <= centerCol + radius
  );
}

function inTimingPattern(size: number, row: number, col: number): boolean {
  const start = FINDER_BLOCK;
  const end = size - FINDER_BLOCK - 1;
  if (row === TIMING_INDEX && col >= start && col <= end) return true;
  if (col === TIMING_INDEX && row >= start && row <= end) return true;
  return false;
}

/** `true` for modules owned by the protocol rather than by the payload. */
export function isFunctionModule(size: number, row: number, col: number): boolean {
  return (
    inFinderBlock(size, row, col) ||
    inAlignmentBlock(size, row, col) ||
    inTimingPattern(size, row, col)
  );
}

/**
 * Value of a function module. Only meaningful when
 * {@link isFunctionModule} is `true` for the same coordinates.
 */
export function functionModuleValue(size: number, row: number, col: number): boolean {
  if (inTimingPattern(size, row, col)) {
    return (row === TIMING_INDEX ? col : row) % 2 === 0;
  }

  if (inAlignmentBlock(size, row, col)) {
    const { row: centerRow, col: centerCol } = alignmentCenter(size);
    const ring = Math.max(Math.abs(row - centerRow), Math.abs(col - centerCol));
    // 5×5: dark outer ring, light ring, dark centre.
    return ring !== 1;
  }

  // Finder pattern, or the light separator that surrounds it. The top-right and
  // bottom-left finders are flush with their outer edge, so the separator ends
  // up on the inner side and maps to a negative local coordinate.
  let localRow = row;
  let localCol = col;
  if (col >= size - FINDER_BLOCK) localCol = col - (size - FINDER_SIZE);
  if (row >= size - FINDER_BLOCK) localRow = row - (size - FINDER_SIZE);

  const outsideFinder =
    localRow < 0 || localCol < 0 || localRow >= FINDER_SIZE || localCol >= FINDER_SIZE;
  if (outsideFinder) return false; // separator

  const ring = Math.max(Math.abs(localRow - 3), Math.abs(localCol - 3));
  // 7×7: dark 1:1:3:1:1 concentric squares.
  return ring !== 2;
}

/**
 * Fixed mask XORed onto every data module.
 *
 * A checkerboard keeps the symbol visually busy so the binarizer always sees
 * both polarities locally, and it prevents a run of 0x00 payload bytes from
 * turning into a large blank area that the finder scanner could mistake for
 * quiet zone.
 */
export function maskBit(row: number, col: number): boolean {
  return (row + col) % 2 === 0;
}

const orderCache = new Map<number, Int32Array>();

/**
 * Data module placement order: two-column strips walked right-to-left, each
 * strip traversed in the opposite vertical direction to the previous one.
 * Returns flat `row * size + col` indices.
 */
export function dataModuleOrder(size: number): Int32Array {
  const cached = orderCache.get(size);
  if (cached) return cached;

  const positions: number[] = [];
  let upward = true;

  for (let right = size - 1; right >= 0; right -= 2) {
    // Column 6 is entirely timing; skipping it keeps strips aligned like QR does.
    const rightCol = right <= TIMING_INDEX ? right - 1 : right;
    if (rightCol < 0) break;

    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = rightCol - offset;
        if (col < 0) continue;
        if (isFunctionModule(size, row, col)) continue;
        positions.push(row * size + col);
      }
    }
    upward = !upward;
  }

  const order = Int32Array.from(positions);
  orderCache.set(size, order);
  return order;
}

export function symbolCapacity(size: number): SymbolCapacity {
  const dataModules = dataModuleOrder(size).length;
  return { dataModules, codewordBytes: Math.min(dataModules >> 3, RS_MAX_CODEWORD) };
}

/**
 * Splits a symbol's capacity into Reed–Solomon parity, header and payload.
 * The encoder and the decoder both derive their sizes from this single source.
 */
export function frameGeometry(size: GridSize, eccLevel: EccLevel = DEFAULT_ECC_LEVEL): FrameGeometry {
  const { dataModules, codewordBytes } = symbolCapacity(size);

  // Keep parity even so the correction capability (⌊parity/2⌋) is exact, and
  // never let the message section shrink below a header plus a useful payload.
  const requested = Math.round(codewordBytes * ECC_RATIO[eccLevel]);
  const maxParity = codewordBytes - FRAME_HEADER_SIZE - 1;
  const parityLength = Math.max(4, Math.min(requested + (requested % 2), maxParity));

  const messageLength = codewordBytes - parityLength;
  const payloadCapacity = messageLength - FRAME_HEADER_SIZE;

  if (payloadCapacity <= 0) {
    throw new RangeError(`grid size ${size} cannot carry a payload at ECC level "${eccLevel}"`);
  }

  return {
    size,
    eccLevel,
    dataModules,
    codewordBytes,
    parityLength,
    messageLength,
    payloadCapacity,
  };
}

/**
 * Module-space landmarks used to register a captured symbol.
 *
 * `bottomRightCorner` is where a *fourth* finder centre would sit if the symbol
 * had one. Nothing is printed there, but extrapolating the parallelogram from
 * the three real finders lands on exactly this coordinate, which makes it the
 * correct module-space partner for that first-pass affine estimate. Pairing the
 * extrapolated point with `alignment` instead would misregister the grid by
 * three modules — enough to lose the alignment pattern entirely.
 */
export function landmarkPoints(size: number): {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  bottomRightCorner: Point;
  alignment: Point;
} {
  const finderOffset = FINDER_SIZE / 2;
  const { row } = alignmentCenter(size);
  return {
    topLeft: { x: finderOffset, y: finderOffset },
    topRight: { x: size - finderOffset, y: finderOffset },
    bottomLeft: { x: finderOffset, y: size - finderOffset },
    bottomRightCorner: { x: size - finderOffset, y: size - finderOffset },
    alignment: { x: row + 0.5, y: row + 0.5 },
  };
}
