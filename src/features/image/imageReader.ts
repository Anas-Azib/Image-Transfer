/**
 * Reads a picked file and prepares the exact byte stream that will be
 * transmitted. Everything here runs in the browser; nothing is uploaded.
 */

import { ImageError } from './imageErrors';
import {
  findQualityPreset,
  type PreparedImage,
  type QualityPreset,
  type TransmissionQuality,
} from './image.types';

/**
 * Hard ceiling on the source file. Well above anything sensible to transmit —
 * it exists to stop a very large file from exhausting memory during decoding,
 * not to enforce a transfer budget.
 */
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

const RECOMPRESSION_FORMATS = ['image/webp', 'image/jpeg'] as const;

export function isSupportedImageFile(file: File): boolean {
  // Some platforms hand over an empty type for files picked from cloud storage,
  // so fall back to the extension rather than rejecting outright.
  if (file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name);
}

interface DecodedSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

async function decodeImage(file: File): Promise<DecodedSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Some browsers reject certain formats here; fall through to <img>.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new ImageError('decode-failed'));
      image.src = url;
    });
    return {
      source: element,
      width: element.naturalWidth,
      height: element.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error instanceof ImageError ? error : new ImageError('decode-failed');
  }
}

function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const factor = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function recompress(
  decoded: DecodedSource,
  preset: QualityPreset,
): Promise<{ blob: Blob; width: number; height: number }> {
  const target = scaledDimensions(decoded.width, decoded.height, preset.maxEdge ?? decoded.width);

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;

  const context = canvas.getContext('2d');
  if (!context) throw new ImageError('encode-failed', 'no 2D context');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(decoded.source, 0, 0, target.width, target.height);

  for (const type of RECOMPRESSION_FORMATS) {
    const blob = await canvasToBlob(canvas, type, preset.quality);
    // A browser that cannot produce the requested format silently returns PNG,
    // which would be larger than the original — so check what actually came back.
    if (blob && blob.type === type) return { blob, width: target.width, height: target.height };
  }

  throw new ImageError('encode-failed', 'no supported output format');
}

export interface PrepareImageOptions {
  quality: TransmissionQuality;
  signal?: AbortSignal;
}

async function asOriginal(file: File, decoded: DecodedSource): Promise<PreparedImage> {
  const mimeType = file.type || 'application/octet-stream';
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    mimeType,
    fileName: file.name,
    width: decoded.width,
    height: decoded.height,
    originalByteLength: file.size,
    originalMimeType: mimeType,
    recompressed: false,
  };
}

/** Reads, validates and (unless `quality` is `original`) recompresses an image. */
export async function prepareImage(
  file: File,
  options: PrepareImageOptions,
): Promise<PreparedImage> {
  if (!isSupportedImageFile(file)) throw new ImageError('unsupported-type');
  if (file.size === 0) throw new ImageError('empty-file');
  if (file.size > MAX_SOURCE_BYTES) throw new ImageError('too-large');

  const preset = findQualityPreset(options.quality);
  const decoded = await decodeImage(file);

  try {
    if (options.signal?.aborted) throw new ImageError('cancelled');
    if (preset.maxEdge === null) return await asOriginal(file, decoded);

    const { blob, width, height } = await recompress(decoded, preset);
    if (options.signal?.aborted) throw new ImageError('cancelled');

    // Recompression can lose to an already well-optimised small source. Keeping
    // whichever is smaller means the quality setting can never make a transfer
    // take longer than sending the file untouched.
    if (blob.size >= file.size && preset.maxEdge >= Math.max(decoded.width, decoded.height)) {
      return await asOriginal(file, decoded);
    }

    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: blob.type,
      fileName: replaceExtension(file.name, blob.type),
      width,
      height,
      originalByteLength: file.size,
      originalMimeType: file.type || 'application/octet-stream',
      recompressed: true,
    };
  } finally {
    decoded.release();
  }
}

function replaceExtension(fileName: string, mimeType: string): string {
  const extension = mimeType === 'image/webp' ? 'webp' : 'jpg';
  const base = fileName.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.${extension}`;
}
