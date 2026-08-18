/**
 * Rebuilds a received image from the assembled byte stream.
 *
 * The bytes are already verified by the time they reach here (a CRC per frame on
 * the way in, then a CRC over the whole stream once complete), so this module's
 * job is to turn them into something the browser can display and the user can
 * save — entirely locally, with no upload anywhere.
 */

import type { TransferManifest } from '@/lib/vdt/protocol';
import type { ImageDimensions } from './image.types';

export interface ReconstructedImage extends ImageDimensions {
  blob: Blob;
  /** Object URL for previewing. Must be released with {@link releaseImage}. */
  objectUrl: string;
  fileName: string;
  mimeType: string;
  byteLength: number;
}

/** MIME types we are willing to hand to an `<img>` element. */
const DISPLAYABLE = /^image\/(png|jpeg|webp|gif|avif|bmp)$/;

function safeMimeType(declared: string): string {
  // SVG is deliberately excluded: it can carry script, and the bytes came from
  // another device over an unauthenticated channel.
  return DISPLAYABLE.test(declared) ? declared : 'application/octet-stream';
}

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** Strips path separators and control characters from a received file name. */
export function sanitizeFileName(name: string, fallback = 'received-image'): string {
  // The name arrives from another device, so treat it as untrusted text rather
  // than as a path.
  const cleaned = name
    .replace(/[/\\]/g, '-')
    .replace(CONTROL_CHARACTERS, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function reconstructImage(bytes: Uint8Array, manifest: TransferManifest): ReconstructedImage {
  const mimeType = safeMimeType(manifest.mimeType);
  // Copy into a fresh buffer: the assembled stream is a view into a larger
  // allocation that the receiver may still be reusing.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType });

  return {
    blob,
    objectUrl: URL.createObjectURL(blob),
    fileName: sanitizeFileName(manifest.fileName),
    mimeType,
    byteLength: bytes.length,
    width: manifest.width,
    height: manifest.height,
  };
}

export function releaseImage(image: ReconstructedImage | null): void {
  if (image) URL.revokeObjectURL(image.objectUrl);
}

/**
 * Triggers a browser download. Nothing leaves the device: the href is an
 * in-memory object URL, not a network address.
 */
export function saveImage(image: ReconstructedImage): void {
  const anchor = document.createElement('a');
  anchor.href = image.objectUrl;
  anchor.download = image.fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
