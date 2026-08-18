/**
 * A software stand-in for "point a phone at a screen".
 *
 * The decoder is meant to survive perspective, defocus, sensor noise and glare,
 * and none of that is exercised by feeding it a pristine render. Every effect
 * here models a specific real-world failure mode, so a passing test says
 * something about the optical path rather than just about the codec.
 */

import { PerspectiveTransform } from '@/lib/vdt/detect/perspective';
import type { RgbaImage } from '@/lib/vdt/render';
import type { Point } from '@/lib/vdt/detect/types';

export interface CaptureOptions {
  /** Output frame size, i.e. the simulated sensor resolution. */
  outputWidth?: number;
  outputHeight?: number;
  /** Fraction of the symbol's width by which the far edge is foreshortened. */
  perspective?: number;
  /** In-plane rotation, in radians. */
  rotation?: number;
  /** Fraction of the frame's shorter edge the symbol occupies. */
  fill?: number;
  /** Box-blur radius in pixels — models defocus and motion smear. */
  blur?: number;
  /** Peak amplitude of the additive uniform noise, in luminance levels. */
  noise?: number;
  /** Strength of a corner-to-corner brightness ramp (specular glare). */
  glare?: number;
  /** Luminance of the surface behind the screen. */
  background?: number;
  /** Deterministic seed for the noise generator. */
  seed?: number;
  /** Horizontally mirror the capture, as a reflection would. */
  mirror?: boolean;
}

function createRandom(seed: number): () => number {
  let state = (seed || 1) >>> 0;
  return () => {
    // xorshift32 — deterministic, so a failing case is always reproducible.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

function bilinearSample(image: RgbaImage, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return null;

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, image.width - 1);
  const y1 = Math.min(y0 + 1, image.height - 1);
  const fx = x - x0;
  const fy = y - y0;

  const at = (px: number, py: number) => image.data[(py * image.width + px) * 4];
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

function boxBlur(gray: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius < 1) return gray;
  const horizontal = new Float32Array(gray.length);
  const output = new Float32Array(gray.length);
  const window = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let d = -radius; d <= radius; d += 1) {
        sum += gray[y * width + Math.min(width - 1, Math.max(0, x + d))];
      }
      horizontal[y * width + x] = sum / window;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let d = -radius; d <= radius; d += 1) {
        sum += horizontal[Math.min(height - 1, Math.max(0, y + d)) * width + x];
      }
      output[y * width + x] = sum / window;
    }
  }
  return output;
}

/** Corners of the symbol as they land on the simulated sensor. */
function targetQuad(options: Required<Pick<CaptureOptions, 'outputWidth' | 'outputHeight' | 'perspective' | 'rotation' | 'fill'>>): [Point, Point, Point, Point] {
  const { outputWidth, outputHeight, perspective, rotation, fill } = options;
  const centerX = outputWidth / 2;
  const centerY = outputHeight / 2;
  const half = (Math.min(outputWidth, outputHeight) * fill) / 2;

  // Foreshorten the bottom edge, as if the camera were held above the screen.
  const corners: Point[] = [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half * (1 - perspective), y: half },
    { x: -half * (1 - perspective), y: half },
  ];

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return corners.map((corner) => ({
    x: centerX + corner.x * cos - corner.y * sin,
    y: centerY + corner.x * sin + corner.y * cos,
  })) as [Point, Point, Point, Point];
}

export function simulateCapture(source: RgbaImage, options: CaptureOptions = {}): RgbaImage {
  const outputWidth = options.outputWidth ?? 960;
  const outputHeight = options.outputHeight ?? 720;
  const perspective = options.perspective ?? 0;
  const rotation = options.rotation ?? 0;
  const fill = options.fill ?? 0.8;
  const background = options.background ?? 70;
  const random = createRandom(options.seed ?? 12345);

  const quad = targetQuad({ outputWidth, outputHeight, perspective, rotation, fill });
  const sourceQuad: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: source.width - 1, y: 0 },
    { x: source.width - 1, y: source.height - 1 },
    { x: 0, y: source.height - 1 },
  ];
  const toSource = PerspectiveTransform.quadrilateralToQuadrilateral(quad, sourceQuad);

  const gray = new Float32Array(outputWidth * outputHeight);
  gray.fill(background);

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const point = toSource.transform({ x, y });
      const sampled = bilinearSample(source, point.x, point.y);
      if (sampled !== null) gray[y * outputWidth + x] = sampled;
    }
  }

  const blurred = boxBlur(gray, outputWidth, outputHeight, Math.round(options.blur ?? 0));

  const data = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  const glare = options.glare ?? 0;
  const noise = options.noise ?? 0;

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const index = y * outputWidth + x;
      let value = blurred[index];

      if (glare > 0) {
        // A soft hotspot near the top-left, falling off across the frame.
        const dx = x / outputWidth;
        const dy = y / outputHeight;
        const falloff = Math.max(0, 1 - Math.hypot(dx, dy));
        value = value * (1 - glare * falloff) + 255 * glare * falloff;
      }
      if (noise > 0) value += (random() - 0.5) * 2 * noise;

      const sx = options.mirror ? outputWidth - 1 - x : x;
      const offset = (y * outputWidth + sx) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }

  return { data, width: outputWidth, height: outputHeight };
}
