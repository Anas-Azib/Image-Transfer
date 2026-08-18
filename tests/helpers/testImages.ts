/**
 * Real image files, built in-process.
 *
 * The transfer path is format-agnostic — it moves bytes — but testing it with
 * genuine PNG/GIF/BMP byte streams rather than random noise means a
 * byte-for-byte match at the far end really does mean "the same file", and the
 * awkward parts of real files (zero runs, long identical spans, high-entropy
 * compressed blocks) are all exercised.
 */

import { deflateSync } from 'node:zlib';
import type { PreparedImage } from '@/features/image/image.types';

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function pngCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i += 1) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, pngCrc(chunk.subarray(4, 8 + data.length)), false);
  return chunk;
}

/** Deterministic pixel pattern — busy enough that compression cannot flatten it. */
function pixelAt(x: number, y: number): [number, number, number] {
  const r = (x * 7 + y * 3) & 0xff;
  const g = (x * x + y * 13) & 0xff;
  const b = ((x ^ y) * 5) & 0xff;
  return [r, g, b];
}

/** Builds a valid, losslessly-compressed RGB PNG. */
export function createPng(width: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelAt(x, y);
      const offset = rowStart + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width, false);
  headerView.setUint32(4, height, false);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const parts = [
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', new Uint8Array(deflateSync(raw))),
    pngChunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** Builds a valid uncompressed 24-bit BMP — long runs of near-identical bytes. */
export function createBmp(width: number, height: number): Uint8Array {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const bmp = new Uint8Array(54 + pixelBytes);
  const view = new DataView(bmp.buffer);

  bmp[0] = 0x42;
  bmp[1] = 0x4d;
  view.setUint32(2, bmp.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelAt(x, y);
      const offset = 54 + y * rowStride + x * 3;
      bmp[offset] = b;
      bmp[offset + 1] = g;
      bmp[offset + 2] = r;
    }
  }
  return bmp;
}

/** Builds a valid 1-frame GIF87a with a 2-colour palette. */
export function createGif(width: number, height: number): Uint8Array {
  const header = [
    0x47, 0x49, 0x46, 0x38, 0x37, 0x61,
    width & 0xff, (width >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
    0x80, 0x00, 0x00,
    0x00, 0x00, 0x00,
    0xff, 0xff, 0xff,
    0x2c,
    0x00, 0x00, 0x00, 0x00,
    width & 0xff, (width >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
    0x00,
    0x02,
  ];

  // Uncompressed-style LZW: emit a clear code before every literal so no real
  // dictionary state is needed while still producing a decodable stream.
  const body: number[] = [];
  let block: number[] = [];
  for (let i = 0; i < width * height; i += 1) {
    block.push(0x04, (i & 1) === 0 ? 0x01 : 0x02);
    if (block.length >= 250) {
      body.push(block.length, ...block);
      block = [];
    }
  }
  if (block.length > 0) body.push(block.length, ...block);

  return Uint8Array.from([...header, ...body, 0x00, 0x3b]);
}

export interface TestImageOptions {
  fileName?: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

export function asPreparedImage(bytes: Uint8Array, options: TestImageOptions = {}): PreparedImage {
  return {
    bytes,
    mimeType: options.mimeType ?? 'image/png',
    fileName: options.fileName ?? 'test.png',
    width: options.width ?? 32,
    height: options.height ?? 32,
    originalByteLength: bytes.length,
    originalMimeType: options.mimeType ?? 'image/png',
    recompressed: false,
  };
}
