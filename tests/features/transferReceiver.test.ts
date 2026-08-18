import { beforeEach, describe, expect, it } from 'vitest';
import { TransferReceiver, type AcceptedFrame } from '@/features/decoder/transferReceiver';
import { crc32 } from '@/lib/vdt/checksum';
import { encodeManifest, type VdtFrame } from '@/lib/vdt/protocol';
import { PROTOCOL_VERSION } from '@/lib/vdt/constants';

const CHUNK_SIZE = 32;

function frame(overrides: Partial<VdtFrame> & { frameIndex: number }): AcceptedFrame {
  const payload = overrides.payload ?? new Uint8Array(CHUNK_SIZE).fill(overrides.frameIndex + 1);
  return {
    frame: {
      version: PROTOCOL_VERSION,
      transferId: overrides.transferId ?? 1,
      frameIndex: overrides.frameIndex,
      totalFrames: overrides.totalFrames ?? 4,
      payloadLength: payload.length,
      checksum: 0,
      payload,
    },
    gridSize: 41,
    eccLevel: 'medium',
    correctedErrors: overrides.frameIndex % 3,
  };
}

/** Builds a stream that assembles into a valid manifest + payload. */
function buildStreamFrames(fileBytes: Uint8Array, chunkSize: number): AcceptedFrame[] {
  const manifest = encodeManifest({
    byteLength: fileBytes.length,
    checksum: crc32(fileBytes),
    width: 4,
    height: 4,
    mimeType: 'image/png',
    fileName: 'a.png',
  });
  const stream = new Uint8Array(manifest.length + fileBytes.length);
  stream.set(manifest, 0);
  stream.set(fileBytes, manifest.length);

  const totalFrames = Math.ceil(stream.length / chunkSize);
  return Array.from({ length: totalFrames }, (_, index) =>
    frame({
      frameIndex: index,
      totalFrames,
      payload: stream.subarray(index * chunkSize, Math.min((index + 1) * chunkSize, stream.length)),
    }),
  );
}

describe('TransferReceiver', () => {
  let receiver: TransferReceiver;

  beforeEach(() => {
    receiver = new TransferReceiver();
  });

  it('accepts the first frame and adopts its transfer', () => {
    expect(receiver.accept(frame({ frameIndex: 0 }))).toBe('accepted');
    expect(receiver.progress.transferId).toBe(1);
    expect(receiver.progress.totalFrames).toBe(4);
    expect(receiver.progress.receivedFrames).toBe(1);
  });

  it('reports a repeat of the same index as a duplicate', () => {
    receiver.accept(frame({ frameIndex: 2 }));
    expect(receiver.accept(frame({ frameIndex: 2 }))).toBe('duplicate');
    expect(receiver.progress.receivedFrames).toBe(1);
    expect(receiver.progress.duplicateFrames).toBe(1);
    expect(receiver.progress.framesDecoded).toBe(2);
  });

  it('places frames by header index regardless of arrival order', () => {
    for (const index of [3, 0, 2, 1]) receiver.accept(frame({ frameIndex: index }));
    expect(receiver.isComplete).toBe(true);
    expect(receiver.progress.missingFrames).toBe(0);
  });

  it('tracks which indices are still outstanding', () => {
    receiver.accept(frame({ frameIndex: 0 }));
    receiver.accept(frame({ frameIndex: 3 }));
    expect(receiver.progress.missingSample).toEqual([1, 2]);
    expect(receiver.progress.missingFrames).toBe(2);
    expect(receiver.isComplete).toBe(false);
  });

  it('rejects a frame claiming a different total for the same transfer', () => {
    receiver.accept(frame({ frameIndex: 0, totalFrames: 4 }));
    expect(receiver.accept(frame({ frameIndex: 1, totalFrames: 9 }))).toBe('inconsistent');
    expect(receiver.progress.receivedFrames).toBe(1);
  });

  it('holds its ground against an isolated frame from another transfer', () => {
    receiver.accept(frame({ frameIndex: 0, transferId: 1 }));
    expect(receiver.accept(frame({ frameIndex: 0, transferId: 77 }))).toBe('foreign-transfer');
    expect(receiver.progress.transferId).toBe(1);
    expect(receiver.progress.receivedFrames).toBe(1);
  });

  it('switches transfers after a sustained run from a new transmitter', () => {
    receiver.accept(frame({ frameIndex: 0, transferId: 1 }));
    receiver.accept(frame({ frameIndex: 0, transferId: 77 }));
    receiver.accept(frame({ frameIndex: 1, transferId: 77 }));
    expect(receiver.accept(frame({ frameIndex: 2, transferId: 77 }))).toBe('switched-transfer');

    expect(receiver.progress.transferId).toBe(77);
    expect(receiver.progress.receivedFrames).toBe(1);
  });

  it('resets the foreign-frame run when the original transfer resumes', () => {
    receiver.accept(frame({ frameIndex: 0, transferId: 1 }));
    receiver.accept(frame({ frameIndex: 0, transferId: 77 }));
    receiver.accept(frame({ frameIndex: 0, transferId: 77 }));
    // The original transmitter is still there, so the run must not carry over.
    receiver.accept(frame({ frameIndex: 1, transferId: 1 }));
    receiver.accept(frame({ frameIndex: 1, transferId: 77 }));

    expect(receiver.progress.transferId).toBe(1);
  });

  it('derives link quality from how much repair the frames needed', () => {
    const clean = new TransferReceiver();
    clean.accept({ ...frame({ frameIndex: 0 }), correctedErrors: 0 });
    expect(clean.progress.linkQuality).toBe(1);

    const noisy = new TransferReceiver();
    noisy.accept({ ...frame({ frameIndex: 0 }), correctedErrors: 8 });
    expect(noisy.progress.linkQuality).toBe(0);
  });

  it('counts captures that contained a symbol it could not validate', () => {
    receiver.noteRejectedFrame();
    receiver.noteRejectedFrame();
    expect(receiver.progress.rejectedFrames).toBe(2);
  });

  it('assembles a stream and verifies the whole-file checksum', () => {
    const fileBytes = Uint8Array.from({ length: 200 }, (_, i) => (i * 13) & 0xff);
    for (const item of buildStreamFrames(fileBytes, CHUNK_SIZE)) receiver.accept(item);

    const { bytes, manifest } = receiver.assemble();
    expect(bytes).toEqual(fileBytes);
    expect(manifest.fileName).toBe('a.png');
  });

  it('refuses a stream whose bytes do not match the manifest checksum', () => {
    const fileBytes = Uint8Array.from({ length: 100 }, (_, i) => i & 0xff);
    const frames = buildStreamFrames(fileBytes, CHUNK_SIZE);

    // Flip a byte in a way a per-frame CRC would have caught on the wire, to
    // prove the whole-stream check is an independent second line of defence.
    const damaged = Uint8Array.from(frames[2].frame.payload);
    damaged[0] ^= 0xff;
    frames[2] = {
      ...frames[2],
      frame: { ...frames[2].frame, payload: damaged },
    };

    for (const item of frames) receiver.accept(item);
    expect(() => receiver.assemble()).toThrow(expect.objectContaining({ code: 'checksum-mismatch' }));
  });

  it('clears everything on reset', () => {
    receiver.accept(frame({ frameIndex: 0 }));
    receiver.noteRejectedFrame();
    receiver.reset();

    const progress = receiver.progress;
    expect(progress.transferId).toBeNull();
    expect(progress.receivedFrames).toBe(0);
    expect(progress.totalFrames).toBe(0);
    expect(progress.rejectedFrames).toBe(0);
    expect(receiver.isComplete).toBe(false);
  });

  it('is not complete before any frame arrives', () => {
    expect(receiver.isComplete).toBe(false);
    expect(() => receiver.assemble()).toThrow(expect.objectContaining({ code: 'incomplete' }));
  });
});
