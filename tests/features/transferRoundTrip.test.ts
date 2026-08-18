/**
 * The test that matters most: an image goes in one side and the identical bytes
 * come out the other, having travelled as pictures the whole way.
 */

import { describe, expect, it } from 'vitest';
import { buildTransferPlan, chunkForFrame } from '@/features/encoder/encoder';
import { TransferReceiver } from '@/features/decoder/transferReceiver';
import { reconstructImage, sanitizeFileName } from '@/features/image/imageReconstructor';
import { crc32 } from '@/lib/vdt/checksum';
import { SUPPORTED_GRID_SIZES, ECC_LEVELS } from '@/lib/vdt/constants';
import type { TransferSettings } from '@/features/encoder/encoder.types';
import { asPreparedImage, createBmp, createGif, createPng } from '../helpers/testImages';
import {
  deliverDirect,
  sequentialOrder,
  shuffled,
  withDrops,
} from '../helpers/transferHarness';

const SETTINGS: TransferSettings = { gridSize: 41, eccLevel: 'medium' };

function planFor(bytes: Uint8Array, overrides: Partial<TransferSettings> = {}) {
  return buildTransferPlan(asPreparedImage(bytes), { ...SETTINGS, ...overrides });
}

describe('encode → frames → decode → image', () => {
  it('reconstructs a PNG byte for byte', () => {
    const original = createPng(48, 48);
    const plan = planFor(original);
    const receiver = new TransferReceiver();

    deliverDirect(receiver, plan, sequentialOrder(plan.totalFrames));

    expect(receiver.isComplete).toBe(true);
    const { bytes, manifest } = receiver.assemble();
    expect(bytes).toEqual(original);
    expect(crc32(bytes)).toBe(crc32(original));
    expect(manifest.fileName).toBe('test.png');
    expect(manifest.mimeType).toBe('image/png');
    expect(manifest.byteLength).toBe(original.length);
  });

  it.each([
    ['PNG', createPng(40, 40), 'image/png', 'photo.png'],
    ['BMP', createBmp(36, 36), 'image/bmp', 'scan.bmp'],
    ['GIF', createGif(24, 24), 'image/gif', 'loop.gif'],
  ])('carries a %s unchanged', (_label, original, mimeType, fileName) => {
    const plan = buildTransferPlan(asPreparedImage(original, { mimeType, fileName }), SETTINGS);
    const receiver = new TransferReceiver();
    deliverDirect(receiver, plan, sequentialOrder(plan.totalFrames));

    const { bytes, manifest } = receiver.assemble();
    expect(bytes).toEqual(original);
    expect(manifest.mimeType).toBe(mimeType);
    expect(manifest.fileName).toBe(fileName);
  });

  it.each(SUPPORTED_GRID_SIZES)('works at symbol size %i', (gridSize) => {
    const original = createPng(32, 32);
    const plan = planFor(original, { gridSize });
    const receiver = new TransferReceiver();
    deliverDirect(receiver, plan, sequentialOrder(plan.totalFrames));
    expect(receiver.assemble().bytes).toEqual(original);
  });

  it.each(ECC_LEVELS)('works at "%s" error correction', (eccLevel) => {
    const original = createPng(32, 32);
    const plan = planFor(original, { eccLevel });
    const receiver = new TransferReceiver();
    deliverDirect(receiver, plan, sequentialOrder(plan.totalFrames));
    expect(receiver.assemble().bytes).toEqual(original);
  });

  it.each([1, 200, 1024, 9000])('handles a %i-byte payload', (size) => {
    const original = Uint8Array.from({ length: size }, (_, i) => (i * 97 + 11) & 0xff);
    const plan = planFor(original);
    const receiver = new TransferReceiver();
    deliverDirect(receiver, plan, sequentialOrder(plan.totalFrames));
    expect(receiver.assemble().bytes).toEqual(original);
  });

  it('handles a payload that fits in a single frame', () => {
    const original = Uint8Array.of(1, 2, 3);
    const plan = planFor(original, { gridSize: 49 });
    expect(plan.totalFrames).toBe(1);

    const receiver = new TransferReceiver();
    deliverDirect(receiver, plan, [0]);
    expect(receiver.assemble().bytes).toEqual(original);
  });

  it('chunks the stream without gaps or overlap', () => {
    const plan = planFor(createPng(40, 40));
    const rebuilt: number[] = [];
    for (let index = 0; index < plan.totalFrames; index += 1) {
      rebuilt.push(...chunkForFrame(plan, index));
    }
    expect(Uint8Array.from(rebuilt)).toEqual(plan.stream);
  });
});

describe('unreliable delivery', () => {
  it('reassembles frames received completely out of order', () => {
    const original = createPng(40, 40);
    const plan = planFor(original);
    const receiver = new TransferReceiver();

    deliverDirect(receiver, plan, shuffled(sequentialOrder(plan.totalFrames), 99));

    expect(receiver.isComplete).toBe(true);
    expect(receiver.assemble().bytes).toEqual(original);
  });

  it('ignores duplicates and counts them', () => {
    const original = createPng(32, 32);
    const plan = planFor(original);
    const receiver = new TransferReceiver();
    const order = sequentialOrder(plan.totalFrames);

    // Every frame twice, as a 30 fps camera reading a 10 fps display would.
    deliverDirect(receiver, plan, [...order, ...order]);

    expect(receiver.progress.duplicateFrames).toBe(plan.totalFrames);
    expect(receiver.progress.receivedFrames).toBe(plan.totalFrames);
    expect(receiver.assemble().bytes).toEqual(original);
  });

  it('reports exactly which frames are missing', () => {
    const plan = planFor(createPng(40, 40));
    const receiver = new TransferReceiver();
    const order = sequentialOrder(plan.totalFrames).filter((index) => index !== 2 && index !== 5);

    deliverDirect(receiver, plan, order);

    expect(receiver.isComplete).toBe(false);
    expect(receiver.progress.missingFrames).toBe(2);
    expect(receiver.progress.missingSample).toEqual([2, 5]);
  });

  it('completes on a later pass after dropping frames on the first', () => {
    const original = createPng(40, 40);
    const plan = planFor(original);
    const receiver = new TransferReceiver();
    const order = sequentialOrder(plan.totalFrames);

    deliverDirect(receiver, plan, withDrops(order, 3));
    expect(receiver.isComplete).toBe(false);

    // The transmitter loops, so the missed frames come round again.
    deliverDirect(receiver, plan, order);

    expect(receiver.isComplete).toBe(true);
    expect(receiver.assemble().bytes).toEqual(original);
  });

  it('refuses to assemble an incomplete transfer', () => {
    const plan = planFor(createPng(40, 40));
    const receiver = new TransferReceiver();
    deliverDirect(receiver, plan, [0, 1]);

    expect(() => receiver.assemble()).toThrow(expect.objectContaining({ code: 'incomplete' }));
  });

  it('exposes the manifest as soon as the first frame lands', () => {
    const plan = planFor(createPng(40, 40), { gridSize: 49 });
    const receiver = new TransferReceiver();
    deliverDirect(receiver, plan, [0]);

    expect(receiver.progress.manifest?.fileName).toBe('test.png');
    expect(receiver.isComplete).toBe(false);
  });
});

describe('reconstruction', () => {
  it('sanitises a hostile file name from the sender', () => {
    // Separators become hyphens and any leading dots are dropped, so nothing
    // that reaches the download attribute can still read as a path.
    const traversal = sanitizeFileName('../../etc/passwd');
    expect(traversal).not.toMatch(/[/\\]/);
    expect(traversal.startsWith('.')).toBe(false);
    expect(traversal).toBe('-..-etc-passwd');

    expect(sanitizeFileName('')).toBe('received-image');
    expect(sanitizeFileName('...')).toBe('received-image');
    expect(sanitizeFileName('a'.repeat(300))).toHaveLength(120);
  });

  it('refuses to hand an unexpected MIME type to the browser', () => {
    const bytes = createPng(8, 8);
    const image = reconstructImage(bytes, {
      byteLength: bytes.length,
      checksum: crc32(bytes),
      width: 8,
      height: 8,
      // SVG can carry script and arrives from an unauthenticated channel.
      mimeType: 'image/svg+xml',
      fileName: 'payload.svg',
    });
    expect(image.mimeType).toBe('application/octet-stream');
    URL.revokeObjectURL(image.objectUrl);
  });
});
