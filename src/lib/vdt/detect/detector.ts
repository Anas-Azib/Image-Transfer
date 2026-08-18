/**
 * End-to-end symbol detection: camera pixels → decoded VDT frame.
 *
 * The stages are deliberately ordered cheapest-first so that the common case —
 * a camera frame containing no symbol at all — is rejected after the finder scan
 * and never reaches Reed–Solomon.
 *
 *   1. downscale + adaptive threshold
 *   2. find the 1:1:3:1:1 finder patterns
 *   3. pick and orient a triple of them
 *   4. estimate the symbol's module count
 *   5. refine the geometry with the alignment pattern, fit a homography
 *   6. resample onto the module grid
 *   7. score the function patterns, then Reed–Solomon + CRC
 */

import {
  FINDER_SIZE,
  MAX_ANALYSIS_EDGE_PX,
  SUPPORTED_GRID_SIZES,
  type EccLevel,
  type GridSize,
} from '../constants';
import { landmarkPoints } from '../layout';
import { decodeSymbol, functionPatternScore, type DecodedSymbol } from '../decoding';
import type { BitMatrix } from '../bitMatrix';
import { prepareCapture } from './binarize';
import { findAlignmentPattern } from './alignment';
import { findFinderPatterns, orderFinders, selectFinderTriple } from './finder';
import { PerspectiveTransform } from './perspective';
import { sampleGrid } from './sampler';
import { distance, type BinaryImage, type OrderedFinders, type Point } from './types';

/**
 * Minimum share of function modules that must match before a decode is even
 * attempted. Set from measurement: correct grids sit above 0.95, wrong sizes and
 * mis-registered grids fall below 0.8.
 */
const MIN_FUNCTION_PATTERN_SCORE = 0.82;

export interface DetectionHints {
  /** ECC level of the transfer already in progress, tried first when known. */
  eccLevel?: EccLevel;
  /** Symbol size seen most recently, tried first when known. */
  gridSize?: GridSize;
  /** Cap on the working resolution used for analysis. */
  maxAnalysisEdge?: number;
}

export interface DetectionResult extends DecodedSymbol {
  gridSize: GridSize;
  /** Fraction of function modules that matched — a geometry-quality signal. */
  functionPatternScore: number;
  /** Whether the capture had to be un-mirrored to decode. */
  mirrored: boolean;
}

export interface DetectionDiagnostics {
  finderCandidates: number;
  /** How far the pipeline got, for the "searching / aligning" UI states. */
  stage: 'no-finders' | 'partial-finders' | 'geometry-failed' | 'undecodable' | 'decoded';
}

export interface DetectionOutcome {
  result: DetectionResult | null;
  diagnostics: DetectionDiagnostics;
}

/**
 * Module count implied by the spacing of the finder centres.
 *
 * Each edge is measured against the mean module pitch of the two finders that
 * bound it rather than a single global pitch: under perspective the near and far
 * ends of an edge genuinely differ in scale, and averaging per-edge tracks that.
 * The answer only ranks the candidate sizes — the function-pattern score and the
 * CRC make the final call — so a rough estimate is sufficient.
 */
function estimateGridSize(finders: OrderedFinders): number {
  const topPitch = (finders.topLeft.moduleSize + finders.topRight.moduleSize) / 2;
  const leftPitch = (finders.topLeft.moduleSize + finders.bottomLeft.moduleSize) / 2;
  if (topPitch <= 0 || leftPitch <= 0) return Number.NaN;

  const acrossTop = distance(finders.topLeft, finders.topRight) / topPitch;
  const downLeft = distance(finders.topLeft, finders.bottomLeft) / leftPitch;

  // Finder centres sit FINDER_SIZE/2 in from each edge, so the centre-to-centre
  // span is `size - FINDER_SIZE` modules.
  return (acrossTop + downLeft) / 2 + FINDER_SIZE;
}

/** Supported sizes ordered by how well they match the measured geometry. */
function candidateSizes(estimate: number, preferred?: GridSize): GridSize[] {
  const ranked = [...SUPPORTED_GRID_SIZES].sort(
    (a, b) => Math.abs(a - estimate) - Math.abs(b - estimate),
  );
  if (!preferred) return ranked;
  return [preferred, ...ranked.filter((size) => size !== preferred)];
}

/**
 * Fits module space onto image space from four correspondences: the three finder
 * centres plus one bottom-right reference. `fourthModulePoint` states which
 * module-space coordinate `fourthImagePoint` actually represents — the alignment
 * centre once it has been located, or the extrapolated virtual corner before
 * that. Mixing the two up misregisters the whole grid.
 */
function buildTransform(
  size: number,
  finders: OrderedFinders,
  fourthModulePoint: Point,
  fourthImagePoint: Point,
): PerspectiveTransform | null {
  const modules = landmarkPoints(size);
  try {
    return PerspectiveTransform.quadrilateralToQuadrilateral(
      [modules.topLeft, modules.topRight, fourthModulePoint, modules.bottomLeft],
      [finders.topLeft, finders.topRight, fourthImagePoint, finders.bottomLeft],
    );
  } catch {
    return null;
  }
}

/**
 * Produces the candidate module→image mappings for one symbol size.
 *
 * Stage one extrapolates the missing corner as a parallelogram, which is exact
 * only when the capture has no projective component. Stage two uses that
 * estimate to predict where the alignment pattern should be, template-matches
 * it, and refits — recovering the terms an affine fit cannot express.
 *
 * Both transforms are returned rather than just the refined one. A rotated but
 * head-on capture is *already* perfectly described by the affine fit, and there
 * a spurious alignment match actively makes things worse; the caller scores the
 * candidates and keeps whichever actually registers the grid better.
 */
function registerSymbol(
  binary: BinaryImage,
  size: number,
  finders: OrderedFinders,
): PerspectiveTransform[] {
  const modules = landmarkPoints(size);
  const extrapolatedCorner: Point = {
    x: finders.topRight.x + finders.bottomLeft.x - finders.topLeft.x,
    y: finders.topRight.y + finders.bottomLeft.y - finders.topLeft.y,
  };

  const affine = buildTransform(size, finders, modules.bottomRightCorner, extrapolatedCorner);
  if (!affine) return [];

  const predicted = affine.transform(modules.alignment);
  const neighbour = affine.transform({ x: modules.alignment.x + 1, y: modules.alignment.y });
  const affinePitch = distance(predicted, neighbour);

  // Under a projective view the module pitch scales multiplicatively along each
  // axis, so the pitch at the unseen fourth corner is well approximated by
  // pitch(TR) · pitch(BL) / pitch(TL). That is measured directly from the three
  // finders, which makes it far more trustworthy near the bottom-right than the
  // affine fit — the affine fit is precisely what is wrong out there.
  const cornerPitch =
    (finders.topRight.moduleSize * finders.bottomLeft.moduleSize) / finders.topLeft.moduleSize;

  const located = findAlignmentPattern(binary, predicted, [cornerPitch, affinePitch]);
  if (!located) return [affine];

  const refined = buildTransform(size, finders, modules.alignment, located);
  return refined ? [refined, affine] : [affine];
}

function tryDecodeMatrix(
  matrix: BitMatrix,
  size: GridSize,
  score: number,
  hints: DetectionHints,
): DetectionResult | null {
  const decoded = decodeSymbol(matrix, hints.eccLevel);
  if (decoded) return { ...decoded, gridSize: size, functionPatternScore: score, mirrored: false };

  const flipped = matrix.transpose();
  const mirroredDecode = decodeSymbol(flipped, hints.eccLevel);
  if (mirroredDecode) {
    return {
      ...mirroredDecode,
      gridSize: size,
      functionPatternScore: functionPatternScore(flipped),
      mirrored: true,
    };
  }

  return null;
}

/**
 * Runs detection over one captured frame.
 *
 * `rgba` is consumed read-only, so the caller is free to reuse its buffer.
 */
export function detectFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  hints: DetectionHints = {},
): DetectionOutcome {
  const { binary } = prepareCapture(
    rgba,
    width,
    height,
    hints.maxAnalysisEdge ?? MAX_ANALYSIS_EDGE_PX,
  );

  const candidates = findFinderPatterns(binary);
  if (candidates.length < 3) {
    return {
      result: null,
      diagnostics: {
        finderCandidates: candidates.length,
        stage: candidates.length === 0 ? 'no-finders' : 'partial-finders',
      },
    };
  }

  const triple = selectFinderTriple(candidates);
  if (!triple) {
    return {
      result: null,
      diagnostics: { finderCandidates: candidates.length, stage: 'partial-finders' },
    };
  }

  const finders = orderFinders(triple);
  const estimate = estimateGridSize(finders);
  if (!Number.isFinite(estimate)) {
    return {
      result: null,
      diagnostics: { finderCandidates: candidates.length, stage: 'geometry-failed' },
    };
  }

  for (const size of candidateSizes(estimate, hints.gridSize)) {
    const sampled = registerSymbol(binary, size, finders)
      .map((transform) => sampleGrid(binary, transform, size))
      .filter((matrix): matrix is BitMatrix => matrix !== null)
      .map((matrix) => ({ matrix, score: functionPatternScore(matrix) }))
      .filter((candidate) => candidate.score >= MIN_FUNCTION_PATTERN_SCORE)
      .sort((a, b) => b.score - a.score);

    for (const { matrix, score } of sampled) {
      const result = tryDecodeMatrix(matrix, size, score, hints);
      if (result) {
        return {
          result,
          diagnostics: { finderCandidates: candidates.length, stage: 'decoded' },
        };
      }
    }
  }

  return {
    result: null,
    diagnostics: { finderCandidates: candidates.length, stage: 'undecodable' },
  };
}
