import { describe, expect, it } from 'vitest';
import { SUPPORTED_GRID_SIZES, type GridSize } from '@/lib/vdt/constants';
import { frameGeometry } from '@/lib/vdt/layout';
import { encodeFrame } from '@/lib/vdt/encoding';
import { rasterizeMatrix } from '@/lib/vdt/render';
import { detectFrame } from '@/lib/vdt/detect/detector';
import { simulateCapture, type CaptureOptions } from '../helpers/syntheticCamera';

function makePayload(length: number, seed = 3): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    out[i] = (state >>> 16) & 0xff;
  }
  return out;
}

function captureOf(size: GridSize, capture: CaptureOptions, payloadLength = 40) {
  const geometry = frameGeometry(size, 'medium');
  const payload = makePayload(Math.min(payloadLength, geometry.payloadCapacity));
  const matrix = encodeFrame(
    { transferId: 0x11223344, frameIndex: 12, totalFrames: 400, payloadLength: payload.length },
    payload,
    geometry,
  );
  const rendered = rasterizeMatrix(matrix, { moduleSize: 10 });
  const frame = simulateCapture(rendered, capture);
  return { payload, frame };
}

describe('camera detection pipeline', () => {
  it.each(SUPPORTED_GRID_SIZES)('decodes a head-on capture of a %i-module symbol', (size) => {
    const { payload, frame } = captureOf(size, { fill: 0.85 });
    const { result } = detectFrame(frame.data, frame.width, frame.height);

    expect(result).not.toBeNull();
    expect(result?.gridSize).toBe(size);
    expect(result?.frame.transferId).toBe(0x11223344);
    expect(result?.frame.frameIndex).toBe(12);
    expect(result?.frame.totalFrames).toBe(400);
    expect(result?.frame.payload).toEqual(payload);
  });

  it('decodes through perspective distortion', () => {
    const { payload, frame } = captureOf(41, { perspective: 0.3, fill: 0.85 });
    const { result } = detectFrame(frame.data, frame.width, frame.height);
    expect(result?.frame.payload).toEqual(payload);
  });

  it('decodes a rotated capture', () => {
    for (const rotation of [0.15, Math.PI / 2, Math.PI, -0.4]) {
      const { payload, frame } = captureOf(41, { rotation, fill: 0.7 });
      const { result } = detectFrame(frame.data, frame.width, frame.height);
      expect(result?.frame.payload, `rotation ${rotation}`).toEqual(payload);
    }
  });

  it('decodes a defocused, noisy capture', () => {
    const { payload, frame } = captureOf(41, { blur: 2, noise: 26, fill: 0.85, seed: 99 });
    const { result } = detectFrame(frame.data, frame.width, frame.height);
    expect(result?.frame.payload).toEqual(payload);
  });

  it('decodes despite a specular hotspot', () => {
    const { payload, frame } = captureOf(41, { glare: 0.55, blur: 1, fill: 0.85 });
    const { result } = detectFrame(frame.data, frame.width, frame.height);
    expect(result?.frame.payload).toEqual(payload);
  });

  it('decodes a mirrored capture and reports it', () => {
    const { payload, frame } = captureOf(41, { mirror: true, fill: 0.85 });
    const { result } = detectFrame(frame.data, frame.width, frame.height);
    expect(result?.mirrored).toBe(true);
    expect(result?.frame.payload).toEqual(payload);
  });

  it('handles a combination of angle, blur, noise and glare', () => {
    const { payload, frame } = captureOf(41, {
      perspective: 0.22,
      rotation: 0.12,
      blur: 1,
      noise: 18,
      glare: 0.3,
      fill: 0.8,
      seed: 7,
    });
    const { result } = detectFrame(frame.data, frame.width, frame.height);
    expect(result?.frame.payload).toEqual(payload);
  });

  it('reports no finders for a frame with no symbol in it', () => {
    const width = 320;
    const height = 240;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const { result, diagnostics } = detectFrame(data, width, height);
    expect(result).toBeNull();
    expect(diagnostics.stage).toBe('no-finders');
  });

  it('does not hallucinate a frame from unrelated imagery', () => {
    const width = 320;
    const height = 240;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      const value = ((i * 37) % 255) ^ ((i >> 5) & 0xff);
      data[i * 4] = value;
      data[i * 4 + 1] = value;
      data[i * 4 + 2] = value;
      data[i * 4 + 3] = 255;
    }
    expect(detectFrame(data, width, height).result).toBeNull();
  });
});
