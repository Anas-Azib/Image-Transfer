/**
 * Drives a whole transfer without a camera.
 *
 * Two levels are available, and both are useful:
 *
 *  • `deliverDirect` feeds symbol matrices straight to the decoder. Fast enough
 *    to run every frame of a realistic transfer, which is what makes the
 *    end-to-end byte-equality assertion practical.
 *  • `deliverOptically` renders each symbol to pixels, pushes it through the
 *    simulated camera, and runs the real detection pipeline — the same code path
 *    a phone uses.
 */

import { decodeSymbolAt } from '@/lib/vdt/decoding';
import { detectFrame } from '@/lib/vdt/detect/detector';
import { rasterizeMatrix } from '@/lib/vdt/render';
import { createFrameGenerator } from '@/features/encoder/frameGenerator';
import type { TransferPlan } from '@/features/encoder/encoder.types';
import type { AcceptedFrame, TransferReceiver } from '@/features/decoder/transferReceiver';
import type { FrameAcceptance } from '@/features/decoder/decoder.types';
import { simulateCapture, type CaptureOptions } from './syntheticCamera';

/** Frame indices in the order a camera happened to catch them. */
export type DeliveryOrder = readonly number[];

export function sequentialOrder(totalFrames: number): number[] {
  return Array.from({ length: totalFrames }, (_, index) => index);
}

/** Drops every `nth` frame, as a camera missing part of a pass would. */
export function withDrops(order: DeliveryOrder, nth: number): number[] {
  return order.filter((_, position) => (position + 1) % nth !== 0);
}

export function shuffled(order: DeliveryOrder, seed = 1): number[] {
  const items = [...order];
  let state = seed >>> 0;
  for (let i = items.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export interface DeliveryReport {
  acceptances: FrameAcceptance[];
  decodedCount: number;
  failedCaptures: number;
}

function acceptedFrameFromMatrix(plan: TransferPlan, frameIndex: number): AcceptedFrame {
  const matrix = createFrameGenerator(plan)(frameIndex);
  const decoded = decodeSymbolAt(matrix, plan.settings.eccLevel);
  return {
    frame: decoded.frame,
    gridSize: plan.settings.gridSize,
    eccLevel: decoded.eccLevel,
    correctedErrors: decoded.correctedErrors,
  };
}

/** Symbol matrix → decoder, skipping the optics. */
export function deliverDirect(
  receiver: TransferReceiver,
  plan: TransferPlan,
  order: DeliveryOrder,
): DeliveryReport {
  const acceptances: FrameAcceptance[] = [];
  for (const frameIndex of order) {
    acceptances.push(receiver.accept(acceptedFrameFromMatrix(plan, frameIndex)));
  }
  return { acceptances, decodedCount: order.length, failedCaptures: 0 };
}

export interface OpticalDeliveryOptions extends CaptureOptions {
  /** Pixels per module in the rendered symbol before the camera sees it. */
  moduleSize?: number;
}

/** Symbol matrix → screen pixels → simulated camera → real detector → decoder. */
export function deliverOptically(
  receiver: TransferReceiver,
  plan: TransferPlan,
  order: DeliveryOrder,
  options: OpticalDeliveryOptions = {},
): DeliveryReport {
  const { moduleSize = 8, ...capture } = options;
  const generate = createFrameGenerator(plan);
  const acceptances: FrameAcceptance[] = [];
  let failedCaptures = 0;

  for (const frameIndex of order) {
    const rendered = rasterizeMatrix(generate(frameIndex), { moduleSize });
    // Vary the seed per frame so noise is not identical on every capture.
    const photo = simulateCapture(rendered, { ...capture, seed: (capture.seed ?? 1) + frameIndex });
    const { result } = detectFrame(photo.data, photo.width, photo.height);

    if (!result) {
      failedCaptures += 1;
      receiver.noteRejectedFrame();
      continue;
    }

    acceptances.push(
      receiver.accept({
        frame: result.frame,
        gridSize: result.gridSize,
        eccLevel: result.eccLevel,
        correctedErrors: result.correctedErrors,
      }),
    );
  }

  return { acceptances, decodedCount: acceptances.length, failedCaptures };
}

/** Corrupts a rendered symbol the way a torn LCD refresh or a smudge would. */
export function damageRegion(
  image: { data: Uint8ClampedArray; width: number; height: number },
  fraction: number,
): void {
  const rows = Math.round(image.height * fraction);
  const start = Math.round(image.height * 0.35);
  for (let y = start; y < Math.min(image.height, start + rows); y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const value = (x * 13 + y * 7) & 0xff;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
    }
  }
}
