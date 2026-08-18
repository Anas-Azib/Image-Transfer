/**
 * The full optical path, without a camera.
 *
 * Every frame is rendered to pixels, photographed by the simulated camera, and
 * put through the same detector a phone uses — perspective, defocus, sensor
 * noise, glare and all. Nothing here reaches into the codec directly, so a pass
 * means the visual channel itself works, not just the maths behind it.
 */

import { describe, expect, it } from 'vitest';
import { buildTransferPlan } from '@/features/encoder/encoder';
import { createFrameGenerator } from '@/features/encoder/frameGenerator';
import { TransferReceiver } from '@/features/decoder/transferReceiver';
import { rasterizeMatrix } from '@/lib/vdt/render';
import { detectFrame } from '@/lib/vdt/detect/detector';
import { crc32 } from '@/lib/vdt/checksum';
import type { TransferSettings } from '@/features/encoder/encoder.types';
import { asPreparedImage, createPng } from '../helpers/testImages';
import {
  damageRegion,
  deliverOptically,
  sequentialOrder,
  shuffled,
} from '../helpers/transferHarness';
import { simulateCapture } from '../helpers/syntheticCamera';

const SETTINGS: TransferSettings = { gridSize: 41, eccLevel: 'medium' };

/** Deliberately small: every frame costs a full render + detect cycle. */
function smallImage(): Uint8Array {
  return createPng(24, 24);
}

/**
 * Enough passes to converge with headroom. A real transmitter loops until the
 * receiver reports completion, so the only thing being bounded here is runtime.
 */
const MAX_PASSES = 8;

/**
 * A near-square, well-lit capture, still with a little drift between passes.
 *
 * Even here a small percentage of frames fail: whether a given symbol survives
 * the round trip depends on its own module pattern, so the losses are
 * content-dependent rather than random. Varying the pose is what decorrelates
 * them from one pass to the next.
 */
function steady(pass: number) {
  return {
    fill: 0.8 + pass * 0.01,
    rotation: pass * 0.01,
    blur: 1,
    noise: 10,
    seed: 7 + pass * 29,
  };
}

/**
 * One pass of a handheld capture. The pose drifts a little between passes —
 * which is what actually happens when someone holds a phone up to a screen, and
 * is why the frames that fail are not the same ones every time.
 */
function handheld(pass: number) {
  return {
    perspective: 0.2 - pass * 0.02,
    rotation: 0.1 - pass * 0.015,
    blur: 1,
    noise: 20,
    glare: 0.25,
    fill: 0.75 + pass * 0.01,
    seed: 5 + pass * 40,
  };
}

describe('end-to-end over the visual channel', () => {
  it('transfers an image through a simulated camera', () => {
    const original = smallImage();
    const plan = buildTransferPlan(asPreparedImage(original), SETTINGS);
    const receiver = new TransferReceiver();
    const order = sequentialOrder(plan.totalFrames);

    // A good first pass gets almost everything. It is deliberately not asserted
    // to get *everything*: whether a particular symbol survives depends on its
    // own module pattern, so a small content-dependent loss rate is expected
    // even in good conditions, and the loop below is how the design absorbs it.
    const firstPass = deliverOptically(receiver, plan, order, steady(0));
    expect(firstPass.decodedCount).toBeGreaterThanOrEqual(Math.floor(plan.totalFrames * 0.9));

    for (let pass = 1; pass <= MAX_PASSES && !receiver.isComplete; pass += 1) {
      deliverOptically(receiver, plan, order, steady(pass));
    }

    expect(receiver.isComplete).toBe(true);
    const { bytes, manifest } = receiver.assemble();
    expect(bytes).toEqual(original);
    expect(crc32(bytes)).toBe(manifest.checksum);
  });

  it('completes a handheld, off-axis, noisy capture across repeated passes', () => {
    const original = smallImage();
    const plan = buildTransferPlan(asPreparedImage(original), SETTINGS);
    const receiver = new TransferReceiver();
    const order = sequentialOrder(plan.totalFrames);

    // Around 8% of frames are lost per pass at this angle and light level, and
    // *which* ones is content-dependent. That is the normal case, and the reason
    // the transmitter loops instead of playing the sequence once.
    const firstPass = deliverOptically(receiver, plan, order, handheld(0));
    expect(firstPass.decodedCount).toBeGreaterThan(plan.totalFrames * 0.7);

    // Subsequent passes are photographed from a slightly different pose, because
    // nobody holds a phone perfectly still. Different frames sit at the margin
    // each time, so the union of the passes converges on the whole transfer.
    for (let pass = 1; pass <= MAX_PASSES && !receiver.isComplete; pass += 1) {
      deliverOptically(receiver, plan, order, handheld(pass));
    }

    expect(receiver.isComplete).toBe(true);
    expect(receiver.assemble().bytes).toEqual(original);
  });

  it('recovers when the camera catches frames out of order and misses some', () => {
    const original = smallImage();
    const plan = buildTransferPlan(asPreparedImage(original), SETTINGS);
    const receiver = new TransferReceiver();
    const order = sequentialOrder(plan.totalFrames);

    // First pass: shuffled, and every third frame missed entirely.
    deliverOptically(
      receiver,
      plan,
      shuffled(order, 3).filter((_, position) => position % 3 !== 0),
      steady(0),
    );
    expect(receiver.isComplete).toBe(false);
    expect(receiver.progress.receivedFrames).toBeGreaterThan(0);

    // Later passes fill the gaps; already-seen frames register as duplicates.
    for (let pass = 1; pass <= MAX_PASSES && !receiver.isComplete; pass += 1) {
      deliverOptically(receiver, plan, order, steady(pass));
    }

    expect(receiver.isComplete).toBe(true);
    expect(receiver.progress.duplicateFrames).toBeGreaterThan(0);
    expect(receiver.assemble().bytes).toEqual(original);
  });

  it('rejects a capture torn across the middle rather than accepting bad data', () => {
    const plan = buildTransferPlan(asPreparedImage(smallImage()), SETTINGS);
    const matrix = createFrameGenerator(plan)(0);

    const rendered = rasterizeMatrix(matrix, { moduleSize: 8 });
    const photo = simulateCapture(rendered, { fill: 0.8 });
    // A camera exposure spanning an LCD refresh sees two half-frames.
    damageRegion(photo, 0.3);

    const { result } = detectFrame(photo.data, photo.width, photo.height);
    expect(result).toBeNull();
  });

  it('reads the correct frame index off each symbol', () => {
    const plan = buildTransferPlan(asPreparedImage(smallImage()), SETTINGS);
    const generate = createFrameGenerator(plan);

    for (const index of [0, 1, Math.floor(plan.totalFrames / 2), plan.totalFrames - 1]) {
      const photo = simulateCapture(rasterizeMatrix(generate(index), { moduleSize: 8 }), {
        fill: 0.8,
        blur: 1,
        seed: index + 1,
      });
      const { result } = detectFrame(photo.data, photo.width, photo.height);

      expect(result?.frame.frameIndex, `frame ${index}`).toBe(index);
      expect(result?.frame.totalFrames).toBe(plan.totalFrames);
      expect(result?.frame.transferId).toBe(plan.transferId);
    }
  });

  it('does not confuse two transfers running side by side', () => {
    const first = buildTransferPlan(asPreparedImage(createPng(20, 20)), SETTINGS);
    const second = buildTransferPlan(asPreparedImage(createPng(22, 22)), SETTINGS);
    expect(first.transferId).not.toBe(second.transferId);

    const receiver = new TransferReceiver();
    deliverOptically(receiver, first, [0, 1], { fill: 0.8, seed: 11 });
    const afterFirst = receiver.progress.receivedFrames;

    // A single stray frame from another transmitter must not reset progress.
    deliverOptically(receiver, second, [0], { fill: 0.8, seed: 12 });
    expect(receiver.progress.transferId).toBe(first.transferId);
    expect(receiver.progress.receivedFrames).toBe(afterFirst);

    // A sustained run of them means the camera really has moved on.
    deliverOptically(receiver, second, [1, 2, 3], { fill: 0.8, seed: 13 });
    expect(receiver.progress.transferId).toBe(second.transferId);
  });
});
