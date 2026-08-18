/**
 * Wire format shared by the encoder and the decoder.
 *
 * Two independent structures travel over the visual link:
 *
 *  1. The **frame header** prefixes every symbol. It is fully self-describing so
 *     that a decoder can join a transmission that is already in flight, and so
 *     that a captured symbol can be placed correctly no matter what order the
 *     camera happened to see it in.
 *
 *  2. The **manifest** is prepended once to the byte stream (so it is simply
 *     chunked like any other data) and describes the file being sent.
 */

import {
  FRAME_HEADER_SIZE,
  FRAME_MAGIC,
  HEADER_OFFSET_CRC,
  HEADER_OFFSET_FRAME_INDEX,
  HEADER_OFFSET_MAGIC,
  HEADER_OFFSET_PAYLOAD_LENGTH,
  HEADER_OFFSET_TOTAL_FRAMES,
  HEADER_OFFSET_TRANSFER_ID,
  HEADER_OFFSET_VERSION,
  MANIFEST_FIXED_SIZE,
  MANIFEST_MAGIC,
  MANIFEST_VERSION,
  MAX_TOTAL_FRAMES,
  PROTOCOL_VERSION,
} from './constants';
import { crc32 } from './checksum';

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

export type ProtocolErrorCode =
  | 'bad-magic'
  | 'unsupported-version'
  | 'bad-length'
  | 'checksum-mismatch'
  | 'malformed-manifest';

export interface VdtFrameHeader {
  version: number;
  transferId: number;
  frameIndex: number;
  totalFrames: number;
  payloadLength: number;
  checksum: number;
}

export interface VdtFrame extends VdtFrameHeader {
  payload: Uint8Array;
}

export interface TransferManifest {
  byteLength: number;
  checksum: number;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Serialises header + payload into the Reed–Solomon message section. */
export function encodeFramePacket(
  header: Omit<VdtFrameHeader, 'version' | 'checksum'>,
  payload: Uint8Array,
): Uint8Array {
  if (header.totalFrames < 1 || header.totalFrames > MAX_TOTAL_FRAMES) {
    throw new ProtocolError('bad-length', `totalFrames out of range: ${header.totalFrames}`);
  }
  if (header.frameIndex < 0 || header.frameIndex >= header.totalFrames) {
    throw new ProtocolError('bad-length', `frameIndex out of range: ${header.frameIndex}`);
  }

  const packet = new Uint8Array(FRAME_HEADER_SIZE + payload.length);
  const view = new DataView(packet.buffer);

  packet[HEADER_OFFSET_MAGIC] = FRAME_MAGIC;
  packet[HEADER_OFFSET_VERSION] = PROTOCOL_VERSION;
  view.setUint32(HEADER_OFFSET_TRANSFER_ID, header.transferId >>> 0, false);
  view.setUint16(HEADER_OFFSET_FRAME_INDEX, header.frameIndex, false);
  view.setUint16(HEADER_OFFSET_TOTAL_FRAMES, header.totalFrames, false);
  view.setUint16(HEADER_OFFSET_PAYLOAD_LENGTH, payload.length, false);
  packet.set(payload, FRAME_HEADER_SIZE);

  // The CRC covers the header fields written so far plus the payload; the four
  // checksum bytes themselves are necessarily excluded.
  const checksum = crc32(packet.subarray(0, HEADER_OFFSET_CRC), payload);
  view.setUint32(HEADER_OFFSET_CRC, checksum, false);

  return packet;
}

/**
 * Parses a message section back into a frame.
 *
 * `message` may be longer than the packet — the encoder pads the Reed–Solomon
 * message block — so the payload length in the header is what bounds the read.
 */
export function decodeFramePacket(message: Uint8Array): VdtFrame {
  if (message.length < FRAME_HEADER_SIZE) {
    throw new ProtocolError('bad-length', 'message is shorter than a frame header');
  }
  if (message[HEADER_OFFSET_MAGIC] !== FRAME_MAGIC) {
    throw new ProtocolError('bad-magic', 'frame magic byte does not match');
  }

  const version = message[HEADER_OFFSET_VERSION];
  if (version !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      'unsupported-version',
      `frame uses protocol version ${version}, this build speaks ${PROTOCOL_VERSION}`,
    );
  }

  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const transferId = view.getUint32(HEADER_OFFSET_TRANSFER_ID, false);
  const frameIndex = view.getUint16(HEADER_OFFSET_FRAME_INDEX, false);
  const totalFrames = view.getUint16(HEADER_OFFSET_TOTAL_FRAMES, false);
  const payloadLength = view.getUint16(HEADER_OFFSET_PAYLOAD_LENGTH, false);
  const checksum = view.getUint32(HEADER_OFFSET_CRC, false);

  if (totalFrames < 1 || frameIndex >= totalFrames) {
    throw new ProtocolError('bad-length', 'frame index is inconsistent with the frame count');
  }
  if (FRAME_HEADER_SIZE + payloadLength > message.length) {
    throw new ProtocolError('bad-length', 'declared payload runs past the end of the codeword');
  }

  const payload = message.slice(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + payloadLength);
  const expected = crc32(message.subarray(0, HEADER_OFFSET_CRC), payload);
  if (expected !== checksum) {
    throw new ProtocolError('checksum-mismatch', 'frame failed its CRC-32 check');
  }

  return { version, transferId, frameIndex, totalFrames, payloadLength, checksum, payload };
}

export function encodeManifest(manifest: TransferManifest): Uint8Array {
  const mime = textEncoder.encode(manifest.mimeType);
  const name = textEncoder.encode(manifest.fileName);
  if (mime.length > 0xff) throw new ProtocolError('malformed-manifest', 'MIME type is too long');
  if (name.length > 0xff) throw new ProtocolError('malformed-manifest', 'file name is too long');

  const total = MANIFEST_FIXED_SIZE + mime.length + name.length;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, MANIFEST_MAGIC, false);
  bytes[4] = MANIFEST_VERSION;
  view.setUint16(5, total, false);
  view.setUint32(7, manifest.byteLength >>> 0, false);
  view.setUint32(11, manifest.checksum >>> 0, false);
  view.setUint16(15, Math.min(manifest.width, 0xffff), false);
  view.setUint16(17, Math.min(manifest.height, 0xffff), false);
  bytes[19] = mime.length;
  bytes[20] = name.length;
  bytes.set(mime, MANIFEST_FIXED_SIZE);
  bytes.set(name, MANIFEST_FIXED_SIZE + mime.length);

  return bytes;
}

export interface DecodedManifest {
  manifest: TransferManifest;
  /** Total manifest length, i.e. where the file bytes start in the stream. */
  byteLength: number;
}

export function decodeManifest(stream: Uint8Array): DecodedManifest {
  if (stream.length < MANIFEST_FIXED_SIZE) {
    throw new ProtocolError('malformed-manifest', 'stream is too short to hold a manifest');
  }

  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  if (view.getUint32(0, false) !== MANIFEST_MAGIC) {
    throw new ProtocolError('malformed-manifest', 'manifest magic does not match');
  }
  if (stream[4] !== MANIFEST_VERSION) {
    throw new ProtocolError('unsupported-version', `unsupported manifest version ${stream[4]}`);
  }

  const total = view.getUint16(5, false);
  const mimeLength = stream[19];
  const nameLength = stream[20];
  if (total !== MANIFEST_FIXED_SIZE + mimeLength + nameLength || total > stream.length) {
    throw new ProtocolError('malformed-manifest', 'manifest length fields are inconsistent');
  }

  const mimeStart = MANIFEST_FIXED_SIZE;
  const nameStart = mimeStart + mimeLength;
  return {
    byteLength: total,
    manifest: {
      byteLength: view.getUint32(7, false),
      checksum: view.getUint32(11, false),
      width: view.getUint16(15, false),
      height: view.getUint16(17, false),
      mimeType: textDecoder.decode(stream.subarray(mimeStart, nameStart)),
      fileName: textDecoder.decode(stream.subarray(nameStart, nameStart + nameLength)),
    },
  };
}

/** Random, non-zero identifier so two nearby transmitters can never be confused. */
export function createTransferId(): number {
  const buffer = new Uint32Array(1);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(buffer);
  } else {
    buffer[0] = Math.floor(Math.random() * 0xffffffff);
  }
  return (buffer[0] || 1) >>> 0;
}
