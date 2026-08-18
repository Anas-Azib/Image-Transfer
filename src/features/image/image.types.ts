/** Types describing an image on its way into, or out of, a visual transfer. */

export interface ImageDimensions {
  width: number;
  height: number;
}

/** An image that has been read, optionally recompressed, and is ready to send. */
export interface PreparedImage extends ImageDimensions {
  /** Exact bytes that will travel over the visual link. */
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  /** Size of the file the user picked, before any recompression. */
  originalByteLength: number;
  originalMimeType: string;
  /** `true` when the bytes were re-encoded rather than sent verbatim. */
  recompressed: boolean;
}

/**
 * How aggressively to shrink an image before transmitting it.
 *
 * The visual channel runs at roughly 0.6–1.8 kB/s, so a stock phone photo would
 * take the better part of an hour. Recompression is not an optimisation here —
 * it is what makes the feature usable — so it is surfaced as a first-class
 * choice rather than hidden.
 */
export type TransmissionQuality = 'original' | 'high' | 'balanced' | 'fast';

export interface QualityPreset {
  id: TransmissionQuality;
  label: string;
  description: string;
  /** Longest edge, in pixels, after downscaling. `null` keeps the original. */
  maxEdge: number | null;
  quality: number;
}

export const QUALITY_PRESETS: readonly QualityPreset[] = [
  {
    id: 'high',
    label: 'High',
    description: 'Up to 1024 px. Best detail that still finishes in minutes.',
    maxEdge: 1024,
    quality: 0.78,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Up to 640 px. Recommended for most transfers.',
    maxEdge: 640,
    quality: 0.7,
  },
  {
    id: 'fast',
    label: 'Fast',
    description: 'Up to 400 px. Quickest way to get a recognisable image across.',
    maxEdge: 400,
    quality: 0.62,
  },
  {
    id: 'original',
    label: 'Original',
    description: 'Sends the untouched file. Exact, but can take a very long time.',
    maxEdge: null,
    quality: 1,
  },
];

export const DEFAULT_QUALITY: TransmissionQuality = 'balanced';

export function findQualityPreset(id: TransmissionQuality): QualityPreset {
  const preset = QUALITY_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`unknown transmission quality "${id}"`);
  return preset;
}
