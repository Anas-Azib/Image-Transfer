/**
 * Paints a module grid.
 *
 * Two renderers over one code path: a DOM-free rasterizer (used by the
 * automated tests, which drive the decoder without a camera) and a canvas
 * painter (used on the transmitting device).
 */

import type { BitMatrix } from './bitMatrix';
import { QUIET_ZONE_MODULES } from './constants';

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RasterOptions {
  /** Edge length of one module, in pixels. */
  moduleSize?: number;
  /** Blank border, in modules. Below 4 the finder scanner starts to miss edges. */
  quietZone?: number;
  darkValue?: number;
  lightValue?: number;
}

export function rasterizeMatrix(matrix: BitMatrix, options: RasterOptions = {}): RgbaImage {
  const moduleSize = Math.max(1, Math.round(options.moduleSize ?? 8));
  const quietZone = options.quietZone ?? QUIET_ZONE_MODULES;
  const dark = options.darkValue ?? 0;
  const light = options.lightValue ?? 255;

  const modules = matrix.size + quietZone * 2;
  const edge = modules * moduleSize;
  const data = new Uint8ClampedArray(edge * edge * 4);
  data.fill(255); // opaque light background

  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      const value = matrix.get(row, col) ? dark : light;
      if (value === 255) continue;

      const originX = (col + quietZone) * moduleSize;
      const originY = (row + quietZone) * moduleSize;
      for (let y = 0; y < moduleSize; y += 1) {
        let offset = ((originY + y) * edge + originX) * 4;
        for (let x = 0; x < moduleSize; x += 1) {
          data[offset] = value;
          data[offset + 1] = value;
          data[offset + 2] = value;
          offset += 4;
        }
      }
    }
  }

  return { data, width: edge, height: edge };
}

export interface CanvasPaintOptions {
  /** Device-pixel edge of the square area to fill. */
  size: number;
  quietZone?: number;
  darkColor?: string;
  lightColor?: string;
}

/**
 * Draws a symbol into a 2D canvas context.
 *
 * Module edges are snapped to whole device pixels: a symbol rendered on
 * fractional boundaries produces grey seams, which the camera reads as extra
 * runs and the finder scanner then rejects.
 */
export function paintMatrix(
  context: CanvasRenderingContext2D,
  matrix: BitMatrix,
  options: CanvasPaintOptions,
): void {
  const quietZone = options.quietZone ?? QUIET_ZONE_MODULES;
  const modules = matrix.size + quietZone * 2;
  const moduleSize = Math.max(1, Math.floor(options.size / modules));
  const drawn = moduleSize * modules;
  const offset = Math.floor((options.size - drawn) / 2);

  context.imageSmoothingEnabled = false;
  context.fillStyle = options.lightColor ?? '#ffffff';
  context.fillRect(0, 0, options.size, options.size);

  context.fillStyle = options.darkColor ?? '#000000';
  for (let row = 0; row < matrix.size; row += 1) {
    const y = offset + (row + quietZone) * moduleSize;
    let runStart = -1;

    for (let col = 0; col <= matrix.size; col += 1) {
      const dark = col < matrix.size && matrix.get(row, col);
      if (dark && runStart < 0) {
        runStart = col;
      } else if (!dark && runStart >= 0) {
        // Fill horizontal runs in one call — an order of magnitude fewer
        // fillRect calls than one per module, which matters at 10 fps.
        const x = offset + (runStart + quietZone) * moduleSize;
        context.fillRect(x, y, (col - runStart) * moduleSize, moduleSize);
        runStart = -1;
      }
    }
  }
}
