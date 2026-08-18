/**
 * Projective (homography) mapping between module space and image space.
 *
 * Photographing a screen almost never happens head-on, so a plain affine fit
 * drifts badly across the symbol. A full 3×3 projective transform is fitted from
 * four correspondences instead, which is exactly the number the three finders
 * plus the alignment pattern supply.
 *
 * The construction goes through the unit square: `quad → square → quad`. Each
 * half has a closed form, so no iterative solver or matrix library is needed.
 */

import type { Point } from './types';

export class PerspectiveTransform {
  private constructor(
    private readonly a11: number,
    private readonly a21: number,
    private readonly a31: number,
    private readonly a12: number,
    private readonly a22: number,
    private readonly a32: number,
    private readonly a13: number,
    private readonly a23: number,
    private readonly a33: number,
  ) {}

  /** Maps (0,0) (1,0) (1,1) (0,1) onto the supplied quadrilateral. */
  static squareToQuadrilateral(p0: Point, p1: Point, p2: Point, p3: Point): PerspectiveTransform {
    const dx3 = p0.x - p1.x + p2.x - p3.x;
    const dy3 = p0.y - p1.y + p2.y - p3.y;

    if (dx3 === 0 && dy3 === 0) {
      // The quadrilateral is a parallelogram, so the mapping is purely affine.
      return new PerspectiveTransform(
        p1.x - p0.x,
        p2.x - p1.x,
        p0.x,
        p1.y - p0.y,
        p2.y - p1.y,
        p0.y,
        0,
        0,
        1,
      );
    }

    const dx1 = p1.x - p2.x;
    const dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y;
    const dy2 = p3.y - p2.y;
    const denominator = dx1 * dy2 - dx2 * dy1;
    if (denominator === 0) throw new Error('degenerate quadrilateral');

    const a13 = (dx3 * dy2 - dx2 * dy3) / denominator;
    const a23 = (dx1 * dy3 - dx3 * dy1) / denominator;

    return new PerspectiveTransform(
      p1.x - p0.x + a13 * p1.x,
      p3.x - p0.x + a23 * p3.x,
      p0.x,
      p1.y - p0.y + a13 * p1.y,
      p3.y - p0.y + a23 * p3.y,
      p0.y,
      a13,
      a23,
      1,
    );
  }

  static quadrilateralToSquare(p0: Point, p1: Point, p2: Point, p3: Point): PerspectiveTransform {
    return PerspectiveTransform.squareToQuadrilateral(p0, p1, p2, p3).adjugate();
  }

  /** Fits the transform that carries `from[i]` onto `to[i]` for four points. */
  static quadrilateralToQuadrilateral(
    from: readonly [Point, Point, Point, Point],
    to: readonly [Point, Point, Point, Point],
  ): PerspectiveTransform {
    const toSquare = PerspectiveTransform.quadrilateralToSquare(from[0], from[1], from[2], from[3]);
    const fromSquare = PerspectiveTransform.squareToQuadrilateral(to[0], to[1], to[2], to[3]);
    return fromSquare.times(toSquare);
  }

  /** The inverse, up to scale — which is all a homography ever needs. */
  private adjugate(): PerspectiveTransform {
    return new PerspectiveTransform(
      this.a22 * this.a33 - this.a23 * this.a32,
      this.a23 * this.a31 - this.a21 * this.a33,
      this.a21 * this.a32 - this.a22 * this.a31,
      this.a13 * this.a32 - this.a12 * this.a33,
      this.a11 * this.a33 - this.a13 * this.a31,
      this.a12 * this.a31 - this.a11 * this.a32,
      this.a12 * this.a23 - this.a13 * this.a22,
      this.a13 * this.a21 - this.a11 * this.a23,
      this.a11 * this.a22 - this.a12 * this.a21,
    );
  }

  private times(other: PerspectiveTransform): PerspectiveTransform {
    return new PerspectiveTransform(
      this.a11 * other.a11 + this.a21 * other.a12 + this.a31 * other.a13,
      this.a11 * other.a21 + this.a21 * other.a22 + this.a31 * other.a23,
      this.a11 * other.a31 + this.a21 * other.a32 + this.a31 * other.a33,
      this.a12 * other.a11 + this.a22 * other.a12 + this.a32 * other.a13,
      this.a12 * other.a21 + this.a22 * other.a22 + this.a32 * other.a23,
      this.a12 * other.a31 + this.a22 * other.a32 + this.a32 * other.a33,
      this.a13 * other.a11 + this.a23 * other.a12 + this.a33 * other.a13,
      this.a13 * other.a21 + this.a23 * other.a22 + this.a33 * other.a23,
      this.a13 * other.a31 + this.a23 * other.a32 + this.a33 * other.a33,
    );
  }

  transform(point: Point): Point {
    const denominator = this.a13 * point.x + this.a23 * point.y + this.a33;
    if (denominator === 0) return { x: Number.NaN, y: Number.NaN };
    return {
      x: (this.a11 * point.x + this.a21 * point.y + this.a31) / denominator,
      y: (this.a12 * point.x + this.a22 * point.y + this.a32) / denominator,
    };
  }
}
