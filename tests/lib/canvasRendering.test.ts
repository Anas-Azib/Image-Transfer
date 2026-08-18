/**
 * Covers the renderer the *browser* actually uses.
 *
 * There are two rasterizers in the codebase: `rasterizeMatrix`, a pure function
 * the rest of the suite feeds to the detector, and `paintMatrix`, which draws to
 * a real canvas and is what a transmitting device runs. Only exercising the
 * first would leave the shipped path untested — and it is the riskier of the
 * two, because it snaps modules to whole device pixels, centres the symbol in a
 * box that is rarely an exact multiple of the module size, and merges runs into
 * single `fillRect` calls.
 *
 * So: record the draw calls against a stub context, replay them into a pixel
 * buffer, and send that through the same detector. If the geometry is wrong by
 * even one pixel of accumulated offset, the symbol stops decoding.
 */

import { describe, expect, it } from 'vitest';
import { paintMatrix, type RgbaImage } from '@/lib/vdt/render';
import { frameGeometry } from '@/lib/vdt/layout';
import { encodeFrame } from '@/lib/vdt/encoding';
import { detectFrame } from '@/lib/vdt/detect/detector';
import { QUIET_ZONE_MODULES, SUPPORTED_GRID_SIZES } from '@/lib/vdt/constants';
import { simulateCapture } from '../helpers/syntheticCamera';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

/** Minimal 2D context that records what was drawn. */
function recordingContext(): { context: CanvasRenderingContext2D; rects: Rect[] } {
  const rects: Rect[] = [];
  const context = {
    fillStyle: '#000000',
    imageSmoothingEnabled: true,
    fillRect(x: number, y: number, width: number, height: number) {
      rects.push({ x, y, width, height, color: String(context.fillStyle) });
    },
  };
  return { context: context as unknown as CanvasRenderingContext2D, rects };
}

/** Replays recorded rectangles into an RGBA buffer, in draw order. */
function replay(rects: readonly Rect[], size: number): RgbaImage {
  const data = new Uint8ClampedArray(size * size * 4).fill(255);

  for (const rect of rects) {
    const value = rect.color === '#ffffff' ? 255 : 0;
    const x0 = Math.max(0, Math.round(rect.x));
    const y0 = Math.max(0, Math.round(rect.y));
    const x1 = Math.min(size, Math.round(rect.x + rect.width));
    const y1 = Math.min(size, Math.round(rect.y + rect.height));

    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const offset = (y * size + x) * 4;
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
      }
    }
  }

  return { data, width: size, height: size };
}

function paintToImage(matrixSize: 33 | 41 | 49, canvasEdge: number, frameIndex = 5): RgbaImage {
  const geometry = frameGeometry(matrixSize, 'medium');
  const payload = Uint8Array.from({ length: geometry.payloadCapacity }, (_, i) => (i * 53 + 9) & 0xff);
  const matrix = encodeFrame(
    {
      transferId: 0x5a5a1234,
      frameIndex,
      totalFrames: 250,
      payloadLength: payload.length,
    },
    payload,
    geometry,
  );

  const { context, rects } = recordingContext();
  paintMatrix(context, matrix, { size: canvasEdge });
  return replay(rects, canvasEdge);
}

describe('canvas renderer', () => {
  it('fills the background before drawing any module', () => {
    const geometry = frameGeometry(41, 'medium');
    const matrix = encodeFrame(
      { transferId: 1, frameIndex: 0, totalFrames: 1, payloadLength: 0 },
      new Uint8Array(0),
      geometry,
    );

    const { context, rects } = recordingContext();
    paintMatrix(context, matrix, { size: 512 });

    expect(rects[0]).toMatchObject({ x: 0, y: 0, width: 512, height: 512, color: '#ffffff' });
    expect(rects.length).toBeGreaterThan(1);
  });

  it('merges horizontal runs instead of drawing one rect per module', () => {
    const geometry = frameGeometry(41, 'medium');
    const matrix = encodeFrame(
      { transferId: 1, frameIndex: 0, totalFrames: 1, payloadLength: 0 },
      new Uint8Array(0),
      geometry,
    );

    const { context, rects } = recordingContext();
    paintMatrix(context, matrix, { size: 512 });

    let darkModules = 0;
    for (let row = 0; row < matrix.size; row += 1) {
      for (let col = 0; col < matrix.size; col += 1) if (matrix.get(row, col)) darkModules += 1;
    }
    // One background rect plus one per run; runs must be meaningfully fewer than
    // modules or the 10 fps repaint would cost far more than it needs to.
    expect(rects.length - 1).toBeLessThan(darkModules * 0.75);
  });

  it('keeps the symbol inside the canvas with a full quiet zone', () => {
    const canvasEdge = 500;
    const geometry = frameGeometry(41, 'medium');
    const matrix = encodeFrame(
      { transferId: 1, frameIndex: 0, totalFrames: 1, payloadLength: 0 },
      new Uint8Array(0),
      geometry,
    );

    const { context, rects } = recordingContext();
    paintMatrix(context, matrix, { size: canvasEdge });

    const modules = matrix.size + QUIET_ZONE_MODULES * 2;
    const moduleSize = Math.floor(canvasEdge / modules);
    const drawn = rects.slice(1);
    const minX = Math.min(...drawn.map((r) => r.x));
    const minY = Math.min(...drawn.map((r) => r.y));
    const maxX = Math.max(...drawn.map((r) => r.x + r.width));
    const maxY = Math.max(...drawn.map((r) => r.y + r.height));

    expect(minX).toBeGreaterThanOrEqual(QUIET_ZONE_MODULES * moduleSize);
    expect(minY).toBeGreaterThanOrEqual(QUIET_ZONE_MODULES * moduleSize);
    expect(maxX).toBeLessThanOrEqual(canvasEdge);
    expect(maxY).toBeLessThanOrEqual(canvasEdge);
  });

  it('snaps every module to whole pixels', () => {
    const { rects } = (() => {
      const geometry = frameGeometry(41, 'medium');
      const matrix = encodeFrame(
        { transferId: 1, frameIndex: 0, totalFrames: 1, payloadLength: 0 },
        new Uint8Array(0),
        geometry,
      );
      const recorder = recordingContext();
      // 733 is deliberately not a multiple of the module count.
      paintMatrix(recorder.context, matrix, { size: 733 });
      return recorder;
    })();

    for (const rect of rects) {
      expect(Number.isInteger(rect.x)).toBe(true);
      expect(Number.isInteger(rect.y)).toBe(true);
      expect(Number.isInteger(rect.width)).toBe(true);
      expect(Number.isInteger(rect.height)).toBe(true);
    }
  });

  it.each(SUPPORTED_GRID_SIZES)('paints a %i-module symbol a camera can decode', (size) => {
    const painted = paintToImage(size, 640, 7);
    const photo = simulateCapture(painted, { fill: 0.85, blur: 1, noise: 10, seed: 4 });
    const { result } = detectFrame(photo.data, photo.width, photo.height);

    expect(result).not.toBeNull();
    expect(result?.gridSize).toBe(size);
    expect(result?.frame.frameIndex).toBe(7);
    expect(result?.frame.transferId).toBe(0x5a5a1234);
  });

  it.each([320, 512, 733, 1024])('stays decodable at a %i px canvas', (canvasEdge) => {
    const painted = paintToImage(41, canvasEdge);
    const photo = simulateCapture(painted, { fill: 0.85, blur: 1, seed: 8 });
    const { result } = detectFrame(photo.data, photo.width, photo.height);

    expect(result?.frame.frameIndex).toBe(5);
  });

  it('decodes when photographed off-axis, as a phone would see a laptop screen', () => {
    const painted = paintToImage(41, 800);
    const photo = simulateCapture(painted, {
      perspective: 0.18,
      rotation: 0.09,
      blur: 1,
      noise: 14,
      glare: 0.2,
      fill: 0.8,
      seed: 3,
    });

    expect(detectFrame(photo.data, photo.width, photo.height).result?.frame.frameIndex).toBe(5);
  });
});
