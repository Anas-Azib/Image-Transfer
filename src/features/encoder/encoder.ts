/**
 * Builds the transmission plan for one image.
 *
 * The byte stream is `manifest ‖ file`. Putting the manifest inside the stream
 * (rather than in a dedicated frame) means it is chunked, checksummed and
 * retransmitted by exactly the same machinery as the payload — there is no
 * special first frame whose loss would strand the receiver.
 */

import { MAX_TOTAL_FRAMES } from '@/lib/vdt/constants';
import { crc32 } from '@/lib/vdt/checksum';
import { frameGeometry } from '@/lib/vdt/layout';
import { createTransferId, encodeManifest } from '@/lib/vdt/protocol';
import type { PreparedImage } from '@/features/image/image.types';
import type { TransferPlan, TransferSettings } from './encoder.types';

export type EncoderErrorCode = 'too-many-frames' | 'empty-payload';

const ENCODER_MESSAGES: Record<EncoderErrorCode, string> = {
  'too-many-frames':
    'This image needs more frames than the protocol can address. Choose a lower transmission quality.',
  'empty-payload': 'There is nothing to send.',
};

export class EncoderError extends Error {
  readonly code: EncoderErrorCode;

  constructor(code: EncoderErrorCode) {
    super(ENCODER_MESSAGES[code]);
    this.name = 'EncoderError';
    this.code = code;
  }

  get userMessage(): string {
    return ENCODER_MESSAGES[this.code];
  }
}

export function buildTransferPlan(image: PreparedImage, settings: TransferSettings): TransferPlan {
  if (image.bytes.length === 0) throw new EncoderError('empty-payload');

  const geometry = frameGeometry(settings.gridSize, settings.eccLevel);
  const manifest = encodeManifest({
    byteLength: image.bytes.length,
    checksum: crc32(image.bytes),
    width: image.width,
    height: image.height,
    mimeType: image.mimeType,
    fileName: image.fileName,
  });

  const stream = new Uint8Array(manifest.length + image.bytes.length);
  stream.set(manifest, 0);
  stream.set(image.bytes, manifest.length);

  const totalFrames = Math.ceil(stream.length / geometry.payloadCapacity);
  if (totalFrames > MAX_TOTAL_FRAMES) throw new EncoderError('too-many-frames');

  return {
    transferId: createTransferId(),
    geometry,
    settings,
    stream,
    manifestByteLength: manifest.length,
    payloadByteLength: image.bytes.length,
    totalFrames,
  };
}

/** Wall-clock time for one complete pass through every frame. */
export function passDurationMs(plan: TransferPlan, frameDurationMs: number): number {
  return plan.totalFrames * frameDurationMs;
}

/** The slice of the stream carried by a given frame. */
export function chunkForFrame(plan: TransferPlan, frameIndex: number): Uint8Array {
  const size = plan.geometry.payloadCapacity;
  const start = frameIndex * size;
  return plan.stream.subarray(start, Math.min(start + size, plan.stream.length));
}

/** Effective throughput, in bytes of file per second. */
export function throughputBytesPerSecond(plan: TransferPlan, frameDurationMs: number): number {
  return (plan.geometry.payloadCapacity * 1000) / frameDurationMs;
}
