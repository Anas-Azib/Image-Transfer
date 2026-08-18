/**
 * Turns a frame packet into the module grid that gets painted on screen.
 *
 * Pipeline: packet → pad to the RS message length → Reed–Solomon encode →
 * write bits along the serpentine data order, XORed with the fixed mask →
 * overlay the function patterns.
 */

import { BitMatrix } from './bitMatrix';
import { encode as rsEncode } from './reedSolomon';
import {
  dataModuleOrder,
  functionModuleValue,
  isFunctionModule,
  maskBit,
  type FrameGeometry,
} from './layout';
import { encodeFramePacket, type VdtFrameHeader } from './protocol';

/**
 * QR's padding alternation. Any fixed filler works — this one is simply
 * well-tested at producing an even module distribution once masked.
 */
const PAD_BYTES = [0xec, 0x11] as const;

/** Writes the three finders, their separators, the alignment mark and the timing rows. */
export function drawFunctionPatterns(matrix: BitMatrix): void {
  const { size } = matrix;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!isFunctionModule(size, row, col)) continue;
      matrix.set(row, col, functionModuleValue(size, row, col));
    }
  }
}

/** Pads a packet out to the Reed–Solomon message length. */
export function padMessage(packet: Uint8Array, messageLength: number): Uint8Array {
  if (packet.length > messageLength) {
    throw new RangeError(`packet of ${packet.length} bytes exceeds the message block`);
  }
  const message = new Uint8Array(messageLength);
  message.set(packet, 0);
  for (let i = packet.length; i < messageLength; i += 1) {
    message[i] = PAD_BYTES[(i - packet.length) % PAD_BYTES.length];
  }
  return message;
}

/** Paints a finished Reed–Solomon codeword into a symbol. */
export function renderCodeword(codeword: Uint8Array, geometry: FrameGeometry): BitMatrix {
  const { size } = geometry;
  const matrix = new BitMatrix(size);
  drawFunctionPatterns(matrix);

  const order = dataModuleOrder(size);
  const totalBits = codeword.length * 8;

  for (let i = 0; i < order.length; i += 1) {
    const flat = order[i];
    const row = (flat / size) | 0;
    const col = flat % size;

    // Modules past the end of the codeword carry the bare mask. They keep the
    // symbol visually uniform and are ignored by the decoder.
    const bit = i < totalBits ? (codeword[i >> 3] >> (7 - (i & 7))) & 1 : 0;
    matrix.set(row, col, (bit === 1) !== maskBit(row, col));
  }

  return matrix;
}

/** Full encode of one frame: header + payload → on-screen module grid. */
export function encodeFrame(
  header: Omit<VdtFrameHeader, 'version' | 'checksum'>,
  payload: Uint8Array,
  geometry: FrameGeometry,
): BitMatrix {
  if (payload.length > geometry.payloadCapacity) {
    throw new RangeError(
      `payload of ${payload.length} bytes exceeds the ${geometry.payloadCapacity}-byte frame capacity`,
    );
  }
  const packet = encodeFramePacket(header, payload);
  const message = padMessage(packet, geometry.messageLength);
  const codeword = rsEncode(message, geometry.parityLength);
  return renderCodeword(codeword, geometry);
}
