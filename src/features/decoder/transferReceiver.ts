/**
 * Accumulates decoded frames into a complete byte stream.
 *
 * The camera is an unreliable, unordered channel: it will miss frames, capture
 * the same one several times, and see them in whatever order the shutter happens
 * to land. This receiver therefore never assumes anything about arrival order —
 * every frame is placed purely by the index in its own header, and completeness
 * is a question about the slot table rather than about a counter.
 */

import { crc32 } from '@/lib/vdt/checksum';
import { ProtocolError, decodeManifest, type TransferManifest, type VdtFrame } from '@/lib/vdt/protocol';
import type { EccLevel, GridSize } from '@/lib/vdt/constants';
import type { FrameAcceptance, ReceiveProgress } from './decoder.types';

/** How many missing indices to surface in the UI. */
const MISSING_SAMPLE_SIZE = 12;

/**
 * Consecutive frames from a different transfer before the receiver gives up on
 * the current one. A single stray frame is far more likely to be a misread than
 * a genuine change of transmitter, but a sustained run means the user has
 * pointed the camera at something new.
 */
const FOREIGN_FRAMES_BEFORE_SWITCH = 3;

/** Recent frames used to estimate link quality. */
const QUALITY_WINDOW = 24;

export type TransferErrorCode = 'checksum-mismatch' | 'incomplete' | 'malformed-manifest';

const TRANSFER_MESSAGES: Record<TransferErrorCode, string> = {
  'checksum-mismatch':
    'The received image failed its integrity check. Run the transfer again.',
  incomplete: 'The transfer is not finished yet.',
  'malformed-manifest': 'The sender described this image in a way this app does not understand.',
};

export class TransferError extends Error {
  readonly code: TransferErrorCode;

  constructor(code: TransferErrorCode) {
    super(TRANSFER_MESSAGES[code]);
    this.name = 'TransferError';
    this.code = code;
  }

  get userMessage(): string {
    return TRANSFER_MESSAGES[this.code];
  }
}

export interface AssembledTransfer {
  bytes: Uint8Array;
  manifest: TransferManifest;
}

export interface AcceptedFrame {
  frame: VdtFrame;
  gridSize: GridSize;
  eccLevel: EccLevel;
  correctedErrors: number;
}

export class TransferReceiver {
  private transferId: number | null = null;
  private totalFrames = 0;
  private chunks: (Uint8Array | null)[] = [];
  private receivedFrames = 0;
  /** Payload size of a non-final frame; fixes every chunk's stream offset. */
  private chunkSize = 0;

  private framesDecoded = 0;
  private duplicateFrames = 0;
  private rejectedFrames = 0;
  private lastFrameAt = 0;

  private gridSize: GridSize | null = null;
  private eccLevel: EccLevel | null = null;
  private correctionHistory: number[] = [];

  private foreignTransferId: number | null = null;
  private foreignRunLength = 0;

  private manifestCache: TransferManifest | null = null;

  /** Records a capture that contained a symbol we could not validate. */
  noteRejectedFrame(): void {
    this.rejectedFrames += 1;
  }

  accept(accepted: AcceptedFrame, now = performance.now()): FrameAcceptance {
    const { frame } = accepted;
    this.framesDecoded += 1;

    if (this.transferId === null) {
      this.begin(accepted);
    } else if (frame.transferId !== this.transferId) {
      return this.handleForeignFrame(accepted, now);
    } else if (frame.totalFrames !== this.totalFrames) {
      // Same id but a different length: one of the two reads is wrong, and the
      // CRC cannot distinguish them. Trust neither.
      return 'inconsistent';
    }

    this.foreignTransferId = null;
    this.foreignRunLength = 0;

    return this.store(accepted, now) ? 'accepted' : 'duplicate';
  }

  private handleForeignFrame(accepted: AcceptedFrame, now: number): FrameAcceptance {
    const { transferId } = accepted.frame;

    if (this.foreignTransferId === transferId) {
      this.foreignRunLength += 1;
    } else {
      this.foreignTransferId = transferId;
      this.foreignRunLength = 1;
    }

    if (this.foreignRunLength < FOREIGN_FRAMES_BEFORE_SWITCH) return 'foreign-transfer';

    this.reset();
    this.begin(accepted);
    this.store(accepted, now);
    return 'switched-transfer';
  }

  private begin(accepted: AcceptedFrame): void {
    const { frame } = accepted;
    this.transferId = frame.transferId;
    this.totalFrames = frame.totalFrames;
    this.chunks = new Array<Uint8Array | null>(frame.totalFrames).fill(null);
    this.receivedFrames = 0;
    this.chunkSize = 0;
    this.manifestCache = null;
  }

  /** @returns `true` when the frame filled an empty slot. */
  private store(accepted: AcceptedFrame, now: number): boolean {
    const { frame } = accepted;
    this.gridSize = accepted.gridSize;
    this.eccLevel = accepted.eccLevel;

    this.correctionHistory.push(accepted.correctedErrors);
    if (this.correctionHistory.length > QUALITY_WINDOW) this.correctionHistory.shift();

    // Every frame but the last carries a full payload, which is what makes each
    // chunk's offset in the stream computable without any ordering assumption.
    if (frame.frameIndex < this.totalFrames - 1) {
      this.chunkSize = Math.max(this.chunkSize, frame.payloadLength);
    } else if (this.totalFrames === 1) {
      this.chunkSize = Math.max(this.chunkSize, frame.payloadLength);
    }

    if (this.chunks[frame.frameIndex] !== null) {
      this.duplicateFrames += 1;
      this.lastFrameAt = now;
      return false;
    }

    this.chunks[frame.frameIndex] = frame.payload;
    this.receivedFrames += 1;
    this.lastFrameAt = now;
    this.manifestCache = null;
    return true;
  }

  get isComplete(): boolean {
    return this.totalFrames > 0 && this.receivedFrames === this.totalFrames;
  }

  /** Indices of frames not yet received, lowest first, capped for display. */
  missingSample(limit = MISSING_SAMPLE_SIZE): number[] {
    const missing: number[] = [];
    for (let index = 0; index < this.chunks.length && missing.length < limit; index += 1) {
      if (this.chunks[index] === null) missing.push(index);
    }
    return missing;
  }

  /**
   * Reads the manifest as soon as frame 0 has arrived, so the UI can show the
   * incoming file's name and size while the rest is still in flight.
   */
  get manifest(): TransferManifest | null {
    if (this.manifestCache) return this.manifestCache;
    const first = this.chunks[0];
    if (!first) return null;
    try {
      this.manifestCache = decodeManifest(first).manifest;
      return this.manifestCache;
    } catch {
      // A truncated first chunk simply means the manifest spans two frames.
      return null;
    }
  }

  get progress(): ReceiveProgress {
    const bytesReceived = this.chunks.reduce((total, chunk) => total + (chunk?.length ?? 0), 0);
    const averageCorrections =
      this.correctionHistory.length > 0
        ? this.correctionHistory.reduce((a, b) => a + b, 0) / this.correctionHistory.length
        : 0;

    return {
      transferId: this.transferId,
      totalFrames: this.totalFrames,
      receivedFrames: this.receivedFrames,
      missingFrames: Math.max(0, this.totalFrames - this.receivedFrames),
      missingSample: this.missingSample(),
      duplicateFrames: this.duplicateFrames,
      framesDecoded: this.framesDecoded,
      rejectedFrames: this.rejectedFrames,
      bytesReceived,
      completion: this.totalFrames > 0 ? this.receivedFrames / this.totalFrames : 0,
      manifest: this.manifest,
      // Corrections scale with parity; 8 repaired bytes in a frame is a poor but
      // still usable link, so that is where the indicator bottoms out.
      linkQuality: Math.max(0, Math.min(1, 1 - averageCorrections / 8)),
      gridSize: this.gridSize,
      eccLevel: this.eccLevel,
      lastFrameAt: this.lastFrameAt,
      complete: this.isComplete,
    };
  }

  /**
   * Joins the received chunks and verifies the whole stream.
   *
   * Per-frame CRCs already guarantee each chunk is intact, so this check catches
   * the assembly-level failures they cannot: a chunk stored at the wrong offset,
   * or two transmissions that collided on the same identifier.
   */
  assemble(): AssembledTransfer {
    if (!this.isComplete) throw new TransferError('incomplete');

    const last = this.chunks[this.totalFrames - 1];
    if (!last) throw new TransferError('incomplete');

    const streamLength = this.chunkSize * (this.totalFrames - 1) + last.length;
    const stream = new Uint8Array(streamLength);
    for (let index = 0; index < this.totalFrames; index += 1) {
      const chunk = this.chunks[index];
      if (!chunk) throw new TransferError('incomplete');
      stream.set(chunk, index * this.chunkSize);
    }

    let manifest: TransferManifest;
    let headerLength: number;
    try {
      const decoded = decodeManifest(stream);
      manifest = decoded.manifest;
      headerLength = decoded.byteLength;
    } catch (error) {
      if (error instanceof ProtocolError) throw new TransferError('malformed-manifest');
      throw error;
    }

    const payload = stream.subarray(headerLength, headerLength + manifest.byteLength);
    if (payload.length !== manifest.byteLength) throw new TransferError('checksum-mismatch');
    if (crc32(payload) !== manifest.checksum) throw new TransferError('checksum-mismatch');

    return { bytes: payload, manifest };
  }

  reset(): void {
    this.transferId = null;
    this.totalFrames = 0;
    this.chunks = [];
    this.receivedFrames = 0;
    this.chunkSize = 0;
    this.framesDecoded = 0;
    this.duplicateFrames = 0;
    this.rejectedFrames = 0;
    this.lastFrameAt = 0;
    this.gridSize = null;
    this.eccLevel = null;
    this.correctionHistory = [];
    this.foreignTransferId = null;
    this.foreignRunLength = 0;
    this.manifestCache = null;
  }
}
