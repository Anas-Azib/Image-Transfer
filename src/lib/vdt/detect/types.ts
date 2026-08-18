/** Image primitives shared by the detection pipeline. */

export interface Point {
  x: number;
  y: number;
}

/** Single-channel 8-bit luminance, row-major. */
export interface LuminanceImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Thresholded image. A byte of 1 means "dark module ink". */
export interface BinaryImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** A candidate finder pattern located in the captured image. */
export interface FinderPattern extends Point {
  /** Estimated module pitch, in pixels, measured at this corner. */
  moduleSize: number;
  /** How many independent scan lines confirmed this centre. */
  confirmations: number;
}

export interface OrderedFinders {
  topLeft: FinderPattern;
  topRight: FinderPattern;
  bottomLeft: FinderPattern;
}

export function isDark(image: BinaryImage, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
  return image.data[y * image.width + x] === 1;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
