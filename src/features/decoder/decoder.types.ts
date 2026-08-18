import type { EccLevel, GridSize } from '@/lib/vdt/constants';
import type { TransferManifest } from '@/lib/vdt/protocol';

/** What the receiver did with a decoded frame. */
export type FrameAcceptance =
  | 'accepted'
  | 'duplicate'
  | 'switched-transfer'
  | 'foreign-transfer'
  | 'inconsistent';

export interface ReceiveProgress {
  transferId: number | null;
  totalFrames: number;
  receivedFrames: number;
  missingFrames: number;
  /** Lowest missing indices, capped — enough to tell the user what to hold for. */
  missingSample: readonly number[];
  /** Frames that decoded cleanly but had already been received. */
  duplicateFrames: number;
  /** Every frame that passed CRC, duplicates included. */
  framesDecoded: number;
  /** Captures where a symbol was found but could not be validated. */
  rejectedFrames: number;
  bytesReceived: number;
  /** 0–1. Frames received over frames needed. */
  completion: number;
  manifest: TransferManifest | null;
  /** 0–1, derived from how much Reed–Solomon repair recent frames needed. */
  linkQuality: number;
  gridSize: GridSize | null;
  eccLevel: EccLevel | null;
  /** `performance.now()` of the last accepted frame, or 0. */
  lastFrameAt: number;
  complete: boolean;
}

export type DecoderPhase =
  | 'idle'
  | 'requesting-camera'
  | 'searching'
  | 'receiving'
  | 'reconstructing'
  | 'complete'
  | 'error';

/** What the camera is currently seeing, for the on-screen scan indicator. */
export type ScanSignal = 'none' | 'partial' | 'locked';
