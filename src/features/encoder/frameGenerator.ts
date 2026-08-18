/**
 * Turns a frame index into the module grid to display.
 *
 * Symbols are generated on demand rather than pre-rendered in bulk. One frame
 * costs well under a millisecond to build, while a long transfer would hold tens
 * of megabytes of matrices — and because transmission loops continuously, any
 * cache smaller than the whole transfer would never see a hit anyway.
 */

import type { BitMatrix } from '@/lib/vdt/bitMatrix';
import { encodeFrame } from '@/lib/vdt/encoding';
import { chunkForFrame } from './encoder';
import type { TransferPlan } from './encoder.types';

export type FrameGenerator = (frameIndex: number) => BitMatrix;

export function createFrameGenerator(plan: TransferPlan): FrameGenerator {
  return (frameIndex: number) => {
    const index = ((frameIndex % plan.totalFrames) + plan.totalFrames) % plan.totalFrames;
    const payload = chunkForFrame(plan, index);
    return encodeFrame(
      {
        transferId: plan.transferId,
        frameIndex: index,
        totalFrames: plan.totalFrames,
        payloadLength: payload.length,
      },
      payload,
      plan.geometry,
    );
  };
}
