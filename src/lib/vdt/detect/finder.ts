/**
 * Locates the three concentric-square finder patterns.
 *
 * The scan looks for the 1:1:3:1:1 dark/light/dark/light/dark run signature that
 * a horizontal line through a finder centre always produces — the property that
 * makes this marker shape rotation-invariant and cheap to spot. Every horizontal
 * hit is then re-verified vertically and diagonally before it is accepted, which
 * is what keeps text, window frames and screen bezels out of the results.
 */

import { FINDER_MIN_CONFIRMATIONS, FINDER_RATIO_TOLERANCE } from '../constants';
import { distance, isDark, type BinaryImage, type FinderPattern, type OrderedFinders } from './types';

const RUN_COUNT = 5;
const CENTER_RUN_INDEX = 2;
/** Total modules across a finder: 1 + 1 + 3 + 1 + 1. */
const FINDER_MODULES = 7;

/** Rows are sampled in steps of roughly a third of a finder height. */
function scanStep(height: number): number {
  return Math.max(1, Math.floor(height / 180));
}

function matchesFinderRatio(runs: Int32Array): boolean {
  let total = 0;
  for (let i = 0; i < RUN_COUNT; i += 1) {
    const count = runs[i];
    if (count === 0) return false;
    total += count;
  }
  if (total < FINDER_MODULES) return false;

  const moduleSize = total / FINDER_MODULES;
  const tolerance = moduleSize * FINDER_RATIO_TOLERANCE;

  return (
    Math.abs(moduleSize - runs[0]) < tolerance &&
    Math.abs(moduleSize - runs[1]) < tolerance &&
    Math.abs(moduleSize * 3 - runs[2]) < tolerance * 3 &&
    Math.abs(moduleSize - runs[3]) < tolerance &&
    Math.abs(moduleSize - runs[4]) < tolerance
  );
}

/** Centre of the middle (3-module) run, given the coordinate just past its end. */
function centerFromEnd(runs: Int32Array, end: number): number {
  return end - runs[4] - runs[3] - runs[2] / 2;
}

/**
 * Re-runs the ratio test along a line through a candidate centre.
 * `axis` selects the direction; returns the refined coordinate or `NaN`.
 */
function crossCheck(
  image: BinaryImage,
  centerX: number,
  centerY: number,
  axis: 'vertical' | 'horizontal' | 'diagonal-down' | 'diagonal-up',
  maxCount: number,
  originalTotal: number,
): number {
  const stepX = axis === 'vertical' ? 0 : 1;
  const stepY = axis === 'horizontal' ? 0 : axis === 'diagonal-up' ? -1 : 1;

  const runs = new Int32Array(RUN_COUNT);
  let x = centerX;
  let y = centerY;

  // Walk backwards out of the centre run, then through the two runs before it.
  while (x >= 0 && y >= 0 && isDark(image, x, y)) {
    runs[2] += 1;
    if (runs[2] > maxCount) return NaN;
    x -= stepX;
    y -= stepY;
  }
  if (x < 0 || y < 0) return NaN;

  while (x >= 0 && y >= 0 && !isDark(image, x, y) && runs[1] <= maxCount) {
    runs[1] += 1;
    x -= stepX;
    y -= stepY;
  }
  if (x < 0 || y < 0 || runs[1] > maxCount) return NaN;

  while (x >= 0 && y >= 0 && isDark(image, x, y) && runs[0] <= maxCount) {
    runs[0] += 1;
    x -= stepX;
    y -= stepY;
  }
  if (runs[0] > maxCount) return NaN;

  // Then forwards through the centre run and the two runs after it.
  x = centerX + stepX;
  y = centerY + stepY;
  while (y >= 0 && y < image.height && x >= 0 && x < image.width && isDark(image, x, y)) {
    runs[2] += 1;
    if (runs[2] > maxCount) return NaN;
    x += stepX;
    y += stepY;
  }
  if (y < 0 || y >= image.height || x < 0 || x >= image.width) return NaN;

  while (
    y >= 0 &&
    y < image.height &&
    x >= 0 &&
    x < image.width &&
    !isDark(image, x, y) &&
    runs[3] < maxCount
  ) {
    runs[3] += 1;
    x += stepX;
    y += stepY;
  }
  if (y < 0 || y >= image.height || x < 0 || x >= image.width || runs[3] >= maxCount) return NaN;

  while (
    y >= 0 &&
    y < image.height &&
    x >= 0 &&
    x < image.width &&
    isDark(image, x, y) &&
    runs[4] < maxCount
  ) {
    runs[4] += 1;
    x += stepX;
    y += stepY;
  }
  if (runs[4] >= maxCount) return NaN;

  if (!matchesFinderRatio(runs)) return NaN;

  // The perpendicular measurement must agree with the horizontal one to within
  // ~40%; anything further apart is a coincidence rather than a finder.
  //
  // This comparison is deliberately skipped on diagonal scans. Runs are counted
  // in steps, not pixels, so a diagonal step covers √2 pixels: for an upright
  // symbol the step counts happen to match the axis-aligned ones, but at 45° the
  // relationship inverts and a legitimate finder measures ~30% short. The ratio
  // test above is what actually validates the shape; the total is only a
  // same-scale sanity check between the two axis-aligned passes.
  if (axis === 'vertical' || axis === 'horizontal') {
    let total = 0;
    for (let i = 0; i < RUN_COUNT; i += 1) total += runs[i];
    if (Math.abs(total - originalTotal) * 5 >= originalTotal * 2) return NaN;
  }

  const end = axis === 'vertical' ? y : x;
  return centerFromEnd(runs, end);
}

function mergeCandidate(
  candidates: FinderPattern[],
  x: number,
  y: number,
  moduleSize: number,
): void {
  for (const candidate of candidates) {
    if (Math.abs(candidate.x - x) <= moduleSize && Math.abs(candidate.y - y) <= moduleSize) {
      const sizeDelta = Math.abs(candidate.moduleSize - moduleSize);
      if (sizeDelta > 1 && sizeDelta > candidate.moduleSize) continue;

      // Running average keeps the centre stable as more scan lines confirm it.
      const weight = candidate.confirmations;
      candidate.x = (candidate.x * weight + x) / (weight + 1);
      candidate.y = (candidate.y * weight + y) / (weight + 1);
      candidate.moduleSize = (candidate.moduleSize * weight + moduleSize) / (weight + 1);
      candidate.confirmations = weight + 1;
      return;
    }
  }
  candidates.push({ x, y, moduleSize, confirmations: 1 });
}

export function findFinderPatterns(image: BinaryImage): FinderPattern[] {
  const candidates: FinderPattern[] = [];
  const runs = new Int32Array(RUN_COUNT);
  const step = scanStep(image.height);

  for (let y = step - 1; y < image.height; y += step) {
    runs.fill(0);
    let state = 0;

    for (let x = 0; x < image.width; x += 1) {
      if (isDark(image, x, y)) {
        if ((state & 1) === 1) state += 1; // a light run just ended
        runs[state] += 1;
        continue;
      }

      if ((state & 1) === 1) {
        runs[state] += 1; // still inside a light run
        continue;
      }

      if (state !== 4) {
        state += 1;
        runs[state] += 1;
        continue;
      }

      if (matchesFinderRatio(runs)) {
        confirmCandidate(image, runs, y, x, candidates);
      }
      // Slide the window along by two runs so overlapping finders are still seen.
      runs[0] = runs[2];
      runs[1] = runs[3];
      runs[2] = runs[4];
      runs[3] = 1;
      runs[4] = 0;
      state = 3;
    }

    if (state === 4 && matchesFinderRatio(runs)) {
      confirmCandidate(image, runs, y, image.width, candidates);
    }
  }

  return candidates.filter((candidate) => candidate.confirmations >= FINDER_MIN_CONFIRMATIONS);
}

function confirmCandidate(
  image: BinaryImage,
  runs: Int32Array,
  row: number,
  end: number,
  candidates: FinderPattern[],
): void {
  let total = 0;
  for (let i = 0; i < RUN_COUNT; i += 1) total += runs[i];
  const maxCount = runs[CENTER_RUN_INDEX] * 2;

  const approximateX = Math.round(centerFromEnd(runs, end));
  const centerY = crossCheck(image, approximateX, row, 'vertical', maxCount, total);
  if (Number.isNaN(centerY)) return;

  const centerX = crossCheck(image, approximateX, Math.round(centerY), 'horizontal', maxCount, total);
  if (Number.isNaN(centerX)) return;

  // A diagonal pass rejects long dark bars (window frames, table edges) that can
  // satisfy both axis checks by accident.
  const diagonal = crossCheck(
    image,
    Math.round(centerX),
    Math.round(centerY),
    'diagonal-down',
    maxCount,
    total,
  );
  if (Number.isNaN(diagonal)) return;

  mergeCandidate(candidates, centerX, centerY, total / FINDER_MODULES);
}

/**
 * Picks the three most plausible finders: those whose module sizes agree most
 * closely, preferring well-confirmed candidates.
 */
export function selectFinderTriple(candidates: FinderPattern[]): FinderPattern[] | null {
  if (candidates.length < 3) return null;
  if (candidates.length === 3) return candidates;

  const ranked = [...candidates].sort((a, b) => b.confirmations - a.confirmations).slice(0, 8);

  let best: FinderPattern[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < ranked.length; i += 1) {
    for (let j = i + 1; j < ranked.length; j += 1) {
      for (let k = j + 1; k < ranked.length; k += 1) {
        const triple = [ranked[i], ranked[j], ranked[k]];
        const sizes = triple.map((pattern) => pattern.moduleSize);
        const mean = (sizes[0] + sizes[1] + sizes[2]) / 3;
        const spread = sizes.reduce((acc, size) => acc + Math.abs(size - mean), 0) / mean;

        // Prefer triples that form a large right-ish triangle: collinear or
        // tiny triples are almost always false positives.
        const [a, b, c] = triple;
        const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
        if (area < mean * mean * 4) continue;

        const score = spread;
        if (score < bestScore) {
          bestScore = score;
          best = triple;
        }
      }
    }
  }

  return best;
}

/**
 * Assigns the roles top-left / top-right / bottom-left.
 *
 * The corner opposite the longest side is the top-left (the right angle of the
 * L shape). A cross product then resolves which of the remaining two is the
 * top-right, which is what makes the symbol readable at any rotation.
 */
export function orderFinders(triple: readonly FinderPattern[]): OrderedFinders {
  const [p0, p1, p2] = triple;
  const d01 = distance(p0, p1);
  const d12 = distance(p1, p2);
  const d02 = distance(p0, p2);

  let corner: FinderPattern;
  let armA: FinderPattern;
  let armB: FinderPattern;

  if (d12 >= d01 && d12 >= d02) {
    [corner, armA, armB] = [p0, p1, p2];
  } else if (d02 >= d12 && d02 >= d01) {
    [corner, armA, armB] = [p1, p0, p2];
  } else {
    [corner, armA, armB] = [p2, p0, p1];
  }

  const crossZ =
    (armB.x - corner.x) * (armA.y - corner.y) - (armB.y - corner.y) * (armA.x - corner.x);
  if (crossZ < 0) [armA, armB] = [armB, armA];

  return { topLeft: corner, topRight: armB, bottomLeft: armA };
}
