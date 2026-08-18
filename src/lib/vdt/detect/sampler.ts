/**
 * Resamples a photographed symbol back onto its module grid.
 *
 * Each module is read at several points inside its footprint and decided by
 * majority. Single-point sampling is fine on a synthetic render but fails on real
 * captures, where JPEG ringing and sensor noise routinely flip the exact centre
 * pixel of an otherwise clean module.
 */

import { BitMatrix } from '../bitMatrix';
import type { PerspectiveTransform } from './perspective';
import { isDark, type BinaryImage } from './types';

/** Sample offsets within a module, as fractions of the module pitch. */
const SAMPLE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [-0.22, 0],
  [0.22, 0],
  [0, -0.22],
  [0, 0.22],
];

export function sampleGrid(
  image: BinaryImage,
  transform: PerspectiveTransform,
  size: number,
): BitMatrix | null {
  const matrix = new BitMatrix(size);

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      let dark = 0;

      for (const [offsetX, offsetY] of SAMPLE_OFFSETS) {
        const point = transform.transform({ x: col + 0.5 + offsetX, y: row + 0.5 + offsetY });
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

        const x = Math.round(point.x);
        const y = Math.round(point.y);
        // A symbol that falls off the edge of the sensor cannot be decoded, so
        // bail immediately rather than filling the matrix with false lights.
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
        if (isDark(image, x, y)) dark += 1;
      }

      matrix.set(row, col, dark * 2 > SAMPLE_OFFSETS.length);
    }
  }

  return matrix;
}
