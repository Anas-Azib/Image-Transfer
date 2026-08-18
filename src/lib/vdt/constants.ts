/**
 * Visual Data Transfer (VDT) — protocol constants.
 *
 * Every magic number used by the encoder and the decoder lives here so that both
 * sides are guaranteed to agree. Nothing in this file may depend on the DOM.
 */

/** First byte of every frame codeword. Cheap rejection of noise before CRC. */
export const FRAME_MAGIC = 0xc5;

/** Bumped whenever the wire format changes in a non-backwards-compatible way. */
export const PROTOCOL_VERSION = 1;

/** Marks the start of the stream manifest (ASCII "VDTM"). */
export const MANIFEST_MAGIC = 0x5644544d;

/** Manifest layout revision, independent of the frame protocol version. */
export const MANIFEST_VERSION = 1;

/**
 * Fixed-size portion of the manifest, in bytes.
 * magic(4) + version(1) + length(2) + byteLength(4) + crc32(4) + width(2) +
 * height(2) + mimeLength(1) + nameLength(1)
 */
export const MANIFEST_FIXED_SIZE = 21;

/**
 * Frame header layout, in bytes.
 * magic(1) + version(1) + transferId(4) + frameIndex(2) + totalFrames(2) +
 * payloadLength(2) + crc32(4)
 */
export const FRAME_HEADER_SIZE = 16;

export const HEADER_OFFSET_MAGIC = 0;
export const HEADER_OFFSET_VERSION = 1;
export const HEADER_OFFSET_TRANSFER_ID = 2;
export const HEADER_OFFSET_FRAME_INDEX = 6;
export const HEADER_OFFSET_TOTAL_FRAMES = 8;
export const HEADER_OFFSET_PAYLOAD_LENGTH = 10;
export const HEADER_OFFSET_CRC = 12;

/** Largest frame index representable by the 16-bit header field. */
export const MAX_TOTAL_FRAMES = 0xffff;

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** Target on-screen duration of a single visual frame. */
export const FRAME_DURATION_MS = 100;

/** Slowest and fastest cadence the operator is allowed to dial in. */
export const MIN_FRAME_DURATION_MS = 60;
export const MAX_FRAME_DURATION_MS = 400;

/**
 * Minimum gap between two decode attempts. The camera delivers 30–60 fps but the
 * transmitter only changes the picture every {@link FRAME_DURATION_MS}, so
 * scanning faster than this only burns battery.
 */
export const SCAN_INTERVAL_MS = 50;

/**
 * Longest working edge used for camera analysis; larger inputs are box-filtered
 * down to it.
 *
 * Chosen by measurement rather than taste (see tests/lib/detector.test.ts). A
 * higher-resolution pass is actively *worse*: the adaptive threshold wants a
 * module to span roughly 4–8 px, and feeding it a 1080p capture where a module
 * covers 20 px leaves most threshold tiles entirely inside a single module, with
 * no local contrast to work from. The downscale also averages away sensor noise
 * before it can flip a module. Across the synthetic capture suite this decodes
 * 93/99 versus 78/99 at 960 px, and costs ~25% less time per frame.
 */
export const MAX_ANALYSIS_EDGE_PX = 640;

/** Nothing decoded for this long while receiving ⇒ surface a stalled transfer. */
export const RECEIVE_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Symbol geometry
// ---------------------------------------------------------------------------

/** Side length, in modules, of the three concentric-square finder patterns. */
export const FINDER_SIZE = 7;

/** Blank ring drawn immediately inside each finder pattern. */
export const FINDER_SEPARATOR = 1;

/** Side length, in modules, of the bottom-right alignment pattern. */
export const ALIGNMENT_SIZE = 5;

/** Distance, in modules, from the far edge to the alignment pattern centre. */
export const ALIGNMENT_INSET = 7;

/** Row/column carrying the alternating timing pattern. */
export const TIMING_INDEX = 6;

/** Blank border drawn around the symbol so the finder scanner sees run-in white. */
export const QUIET_ZONE_MODULES = 4;

/**
 * Supported symbol sizes, in modules per side. All are odd and ≥ 25 so that the
 * three finders plus the alignment pattern never overlap.
 *
 * 49 is the largest useful size: its 2 118 data modules already exceed the
 * 255-byte ceiling a single GF(256) Reed–Solomon codeword can hold, so a bigger
 * grid would buy no extra payload — only smaller, harder-to-photograph modules.
 * Splitting into interleaved RS blocks would lift that ceiling, but 49×49 is
 * already at the practical limit of a phone camera reading a screen at 10 fps,
 * so the reliability cost is not worth the theoretical bandwidth.
 */
export const SUPPORTED_GRID_SIZES = [33, 41, 49] as const;
export type GridSize = (typeof SUPPORTED_GRID_SIZES)[number];

export const DEFAULT_GRID_SIZE: GridSize = 41;

// ---------------------------------------------------------------------------
// Error correction
// ---------------------------------------------------------------------------

export const ECC_LEVELS = ['low', 'medium', 'high'] as const;
export type EccLevel = (typeof ECC_LEVELS)[number];

/** Fraction of each codeword spent on Reed–Solomon parity. */
export const ECC_RATIO: Record<EccLevel, number> = {
  low: 0.14,
  medium: 0.24,
  high: 0.36,
};

export const DEFAULT_ECC_LEVEL: EccLevel = 'medium';

/** Reed–Solomon works over GF(256); a codeword can never exceed 255 bytes. */
export const RS_MAX_CODEWORD = 255;

// ---------------------------------------------------------------------------
// Detection tuning
// ---------------------------------------------------------------------------

/** Relative tolerance when matching the 1:1:3:1:1 finder run signature. */
export const FINDER_RATIO_TOLERANCE = 0.55;

/** A finder candidate must be confirmed on this many independent scan lines. */
export const FINDER_MIN_CONFIRMATIONS = 2;

/** Block edge, in pixels, used by the adaptive (hybrid) binarizer. */
export const BINARIZER_BLOCK_SIZE = 8;

/** Blocks flatter than this are assumed to be uniform background. */
export const BINARIZER_MIN_DYNAMIC_RANGE = 24;
