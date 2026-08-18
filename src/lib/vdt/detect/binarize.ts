/**
 * Camera pixels → luminance → binary ink map.
 *
 * A single global threshold is useless here: the subject is an emissive screen,
 * so captures routinely carry a glare hotspot at one corner and heavy vignetting
 * at the others. The block-adaptive ("hybrid") threshold below computes a local
 * black point per 8×8 tile and smooths it across neighbouring tiles, which keeps
 * modules separable across that gradient.
 */

import { BINARIZER_BLOCK_SIZE, BINARIZER_MIN_DYNAMIC_RANGE } from '../constants';
import type { BinaryImage, LuminanceImage } from './types';

/** ITU-R BT.601 luma, in fixed point, ignoring the alpha channel. */
export function toLuminance(rgba: Uint8ClampedArray, width: number, height: number): LuminanceImage {
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 1, p += 4) {
    data[i] = (rgba[p] * 77 + rgba[p + 1] * 151 + rgba[p + 2] * 28) >> 8;
  }
  return { data, width, height };
}

/**
 * Box-filter downscale to `maxEdge` on the longer side.
 *
 * Analysis resolution is capped because detection cost is linear in pixel count
 * while accuracy saturates once a module spans ~3 px. Averaging (rather than
 * nearest-neighbour) also suppresses the moiré that a camera sensor produces
 * against a pixel grid.
 */
export function downscaleLuminance(image: LuminanceImage, maxEdge: number): LuminanceImage {
  const longest = Math.max(image.width, image.height);
  if (longest <= maxEdge) return image;

  const factor = Math.ceil(longest / maxEdge);
  const width = Math.floor(image.width / factor);
  const height = Math.floor(image.height / factor);
  const data = new Uint8ClampedArray(width * height);
  const area = factor * factor;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        const row = (y * factor + dy) * image.width + x * factor;
        for (let dx = 0; dx < factor; dx += 1) sum += image.data[row + dx];
      }
      data[y * width + x] = sum / area;
    }
  }

  return { data, width, height };
}

function computeBlackPoints(
  image: LuminanceImage,
  blocksWide: number,
  blocksHigh: number,
): Int32Array {
  const { data, width, height } = image;
  const blackPoints = new Int32Array(blocksWide * blocksHigh);
  const blockArea = BINARIZER_BLOCK_SIZE * BINARIZER_BLOCK_SIZE;

  for (let by = 0; by < blocksHigh; by += 1) {
    const yStart = Math.min(by * BINARIZER_BLOCK_SIZE, height - BINARIZER_BLOCK_SIZE);
    for (let bx = 0; bx < blocksWide; bx += 1) {
      const xStart = Math.min(bx * BINARIZER_BLOCK_SIZE, width - BINARIZER_BLOCK_SIZE);

      let sum = 0;
      let min = 0xff;
      let max = 0;
      for (let dy = 0; dy < BINARIZER_BLOCK_SIZE; dy += 1) {
        const offset = (yStart + dy) * width + xStart;
        for (let dx = 0; dx < BINARIZER_BLOCK_SIZE; dx += 1) {
          const value = data[offset + dx];
          sum += value;
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }

      let average: number;
      if (max - min > BINARIZER_MIN_DYNAMIC_RANGE) {
        average = sum / blockArea;
      } else {
        // Flat block: assume it is all background (quiet zone, or the inside of
        // a large dark run) and bias towards light unless the neighbours, which
        // have already been resolved, say the region is genuinely dark.
        average = min / 2;
        if (by > 0 && bx > 0) {
          const neighbourAverage =
            (blackPoints[(by - 1) * blocksWide + bx] +
              2 * blackPoints[by * blocksWide + bx - 1] +
              blackPoints[(by - 1) * blocksWide + bx - 1]) /
            4;
          if (min < neighbourAverage) average = neighbourAverage;
        }
      }
      blackPoints[by * blocksWide + bx] = average;
    }
  }

  return blackPoints;
}

export function binarize(image: LuminanceImage): BinaryImage {
  const { data, width, height } = image;
  const out = new Uint8Array(width * height);

  if (width < BINARIZER_BLOCK_SIZE || height < BINARIZER_BLOCK_SIZE) {
    // Too small to tile — fall back to a global mean.
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i];
    const threshold = sum / data.length;
    for (let i = 0; i < data.length; i += 1) out[i] = data[i] < threshold ? 1 : 0;
    return { data: out, width, height };
  }

  const blocksWide = Math.ceil(width / BINARIZER_BLOCK_SIZE);
  const blocksHigh = Math.ceil(height / BINARIZER_BLOCK_SIZE);
  const blackPoints = computeBlackPoints(image, blocksWide, blocksHigh);

  for (let by = 0; by < blocksHigh; by += 1) {
    const yStart = Math.min(by * BINARIZER_BLOCK_SIZE, height - BINARIZER_BLOCK_SIZE);
    for (let bx = 0; bx < blocksWide; bx += 1) {
      const xStart = Math.min(bx * BINARIZER_BLOCK_SIZE, width - BINARIZER_BLOCK_SIZE);

      // Average the black points over a 5×5 block window so the threshold moves
      // smoothly instead of stepping at every tile boundary.
      let sum = 0;
      let count = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        const ny = by + dy;
        if (ny < 0 || ny >= blocksHigh) continue;
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = bx + dx;
          if (nx < 0 || nx >= blocksWide) continue;
          sum += blackPoints[ny * blocksWide + nx];
          count += 1;
        }
      }
      const threshold = sum / count;

      for (let dy = 0; dy < BINARIZER_BLOCK_SIZE; dy += 1) {
        const offset = (yStart + dy) * width + xStart;
        for (let dx = 0; dx < BINARIZER_BLOCK_SIZE; dx += 1) {
          out[offset + dx] = data[offset + dx] <= threshold ? 1 : 0;
        }
      }
    }
  }

  return { data: out, width, height };
}

/** Convenience wrapper: RGBA capture → downscaled, thresholded ink map. */
export function prepareCapture(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  maxEdge: number,
): { luminance: LuminanceImage; binary: BinaryImage } {
  const luminance = downscaleLuminance(toLuminance(rgba, width, height), maxEdge);
  return { luminance, binary: binarize(luminance) };
}
