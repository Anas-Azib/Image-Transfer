/**
 * Locates the bottom-right alignment pattern.
 *
 * Three finders only pin down an affine mapping. The alignment pattern supplies
 * the fourth correspondence, and because it sits in the corner furthest from all
 * three finders it is exactly where an affine approximation is worst — so
 * finding it is what makes off-axis captures decode at all.
 *
 * The catch is circular: the prediction of where to look comes from the very
 * affine estimate the pattern is meant to correct. On a steeply angled capture
 * that prediction can be four or more modules out. The search therefore widens
 * in stages, and only pays for the large window when the small one comes up
 * empty. A coarse sweep locates the pattern, then a fine sweep centres it.
 */

import { ALIGNMENT_SIZE } from '../constants';
import { isDark, type BinaryImage, type Point } from './types';

/** Search radii, in modules, tried in order until the pattern is found. */
const SEARCH_RADII_MODULES = [3.5, 8, 16] as const;

/** Fraction of the 25 stencil cells that must agree before the match is trusted. */
const MIN_TEMPLATE_SCORE = 0.84;

const RADIUS = (ALIGNMENT_SIZE - 1) / 2;

/** Expected ink at a stencil cell: dark ring, light ring, dark centre. */
function expectedDark(dRow: number, dCol: number): boolean {
  return Math.max(Math.abs(dRow), Math.abs(dCol)) !== 1;
}

function templateScore(
  image: BinaryImage,
  centerX: number,
  centerY: number,
  moduleSize: number,
): number {
  let matched = 0;
  for (let dRow = -RADIUS; dRow <= RADIUS; dRow += 1) {
    for (let dCol = -RADIUS; dCol <= RADIUS; dCol += 1) {
      const x = Math.round(centerX + dCol * moduleSize);
      const y = Math.round(centerY + dRow * moduleSize);
      if (isDark(image, x, y) === expectedDark(dRow, dCol)) matched += 1;
    }
  }
  return matched / (ALIGNMENT_SIZE * ALIGNMENT_SIZE);
}

interface Match {
  x: number;
  y: number;
  score: number;
}

function sweep(
  image: BinaryImage,
  center: Point,
  moduleSize: number,
  radiusPx: number,
  stepPx: number,
): Match {
  const step = Math.max(1, Math.round(stepPx));
  let best: Match = { x: center.x, y: center.y, score: 0 };
  let plateauX = 0;
  let plateauY = 0;
  let plateauCount = 0;

  for (let dy = -radiusPx; dy <= radiusPx; dy += step) {
    for (let dx = -radiusPx; dx <= radiusPx; dx += step) {
      const x = center.x + dx;
      const y = center.y + dy;
      const score = templateScore(image, x, y, moduleSize);

      if (score > best.score) {
        best = { x, y, score };
        plateauX = x;
        plateauY = y;
        plateauCount = 1;
      } else if (score === best.score && score > 0) {
        // Several neighbouring offsets usually tie; their centroid is a better
        // sub-pixel estimate than whichever one happened to be visited first.
        plateauX += x;
        plateauY += y;
        plateauCount += 1;
      }
    }
  }

  if (plateauCount > 0) {
    best = { x: plateauX / plateauCount, y: plateauY / plateauCount, score: best.score };
  }
  return best;
}

/**
 * @param predicted where the first pass thinks the centre is
 * @param moduleSizes candidate local module pitches, in pixels, most likely
 *   first. The stencil spacing has to match the pitch *at this corner*, which on
 *   an angled capture is not the pitch anywhere else in the symbol — so the
 *   caller supplies more than one hypothesis rather than a single number.
 * @returns the refined centre, or `null` when the pattern cannot be found
 */
export function findAlignmentPattern(
  image: BinaryImage,
  predicted: Point,
  moduleSizes: readonly number[],
): Point | null {
  if (!Number.isFinite(predicted.x) || !Number.isFinite(predicted.y)) return null;

  const hypotheses = moduleSizes.filter((size) => Number.isFinite(size) && size > 0);
  if (hypotheses.length === 0) return null;

  // Radius is the outer loop: a nearby match under a slightly wrong pitch beats
  // a distant match under the right one, because the prediction error is bounded
  // and a far-away "match" is far more likely to be a coincidence.
  for (const radiusModules of SEARCH_RADII_MODULES) {
    for (const moduleSize of hypotheses) {
      const coarse = sweep(
        image,
        predicted,
        moduleSize,
        Math.max(2, radiusModules * moduleSize),
        Math.max(1, moduleSize / 2),
      );
      if (coarse.score < MIN_TEMPLATE_SCORE) continue;

      // Re-sweep the immediate neighbourhood at full resolution: the coarse grid
      // can land up to half a module away from the true centre.
      const fine = sweep(image, coarse, moduleSize, moduleSize, Math.max(1, moduleSize / 6));
      return fine.score >= coarse.score ? { x: fine.x, y: fine.y } : { x: coarse.x, y: coarse.y };
    }
  }

  return null;
}
