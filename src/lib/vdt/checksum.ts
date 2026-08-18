/**
 * CRC-32 (IEEE 802.3, reflected, polynomial 0xedb88320).
 *
 * Reed–Solomon repairs damage; the CRC is the independent judge of whether the
 * repair actually produced the original bytes. Anything that fails here is
 * discarded rather than shown to the user.
 */

const CRC_TABLE = new Uint32Array(256);

{
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    CRC_TABLE[i] = value >>> 0;
  }
}

export function crc32(...parts: readonly Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ part[i]) & 0xff];
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
