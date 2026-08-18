import type { EccLevel, GridSize } from '@/lib/vdt/constants';
import type { FrameGeometry } from '@/lib/vdt/layout';

/**
 * Choices that change the *content* of the frames. Altering either one produces
 * a different set of symbols, so it invalidates the plan.
 */
export interface TransferSettings {
  gridSize: GridSize;
  eccLevel: EccLevel;
}

/**
 * Frame cadence is deliberately not part of {@link TransferSettings}: it only
 * affects how fast the same frames are shown, so it can be retuned mid-transfer
 * without rebuilding the plan or restarting the transmission.
 */
export interface TransmissionSettings extends TransferSettings {
  frameDurationMs: number;
}

/** Everything needed to transmit one image, computed once before playback. */
export interface TransferPlan {
  transferId: number;
  geometry: FrameGeometry;
  settings: TransferSettings;
  /** Manifest followed by the file bytes — the stream that gets chunked. */
  stream: Uint8Array;
  manifestByteLength: number;
  payloadByteLength: number;
  totalFrames: number;
}

/** Live state of the on-screen transmission. */
export interface TransmissionStatus {
  frameIndex: number;
  totalFrames: number;
  /** How many complete passes have finished. Repeats are the redundancy. */
  passesCompleted: number;
  /** Measured display rate, in frames per second. */
  framesPerSecond: number;
  /** Frames painted since the transmission started. */
  framesPainted: number;
  elapsedMs: number;
  paused: boolean;
}

export type EncoderPhase =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'transmitting'
  | 'paused'
  | 'error';
