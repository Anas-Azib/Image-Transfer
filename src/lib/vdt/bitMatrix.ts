/**
 * A dense square grid of 1-bit modules.
 *
 * Backed by a flat `Uint8Array` (one byte per module) rather than a packed
 * bitset: symbols top out at 57×57 = 3 249 modules, so the memory saving would
 * be irrelevant next to the cost of the extra shifting on every sample.
 */
export class BitMatrix {
  readonly size: number;
  private readonly cells: Uint8Array;

  constructor(size: number, cells?: Uint8Array) {
    if (!Number.isInteger(size) || size <= 0) {
      throw new RangeError(`invalid matrix size: ${size}`);
    }
    this.size = size;
    this.cells = cells ?? new Uint8Array(size * size);
    if (this.cells.length !== size * size) {
      throw new RangeError('backing buffer does not match the requested size');
    }
  }

  /** `true` means a dark module. Out-of-bounds reads return `false` (light). */
  get(row: number, col: number): boolean {
    if (row < 0 || col < 0 || row >= this.size || col >= this.size) return false;
    return this.cells[row * this.size + col] === 1;
  }

  set(row: number, col: number, dark: boolean): void {
    if (row < 0 || col < 0 || row >= this.size || col >= this.size) return;
    this.cells[row * this.size + col] = dark ? 1 : 0;
  }

  clone(): BitMatrix {
    return new BitMatrix(this.size, Uint8Array.from(this.cells));
  }

  /**
   * Reflection about the main diagonal.
   *
   * A symbol captured through a mirror (a front-facing camera, a reflective
   * surface) samples to exactly this. The function patterns are diagonally
   * symmetric so they cannot reveal the flip — only a decode attempt can.
   */
  transpose(): BitMatrix {
    const out = new BitMatrix(this.size);
    for (let row = 0; row < this.size; row += 1) {
      for (let col = 0; col < this.size; col += 1) {
        out.set(col, row, this.get(row, col));
      }
    }
    return out;
  }

  /** Number of modules that differ between two equally sized matrices. */
  differenceCount(other: BitMatrix): number {
    if (other.size !== this.size) throw new RangeError('matrix sizes differ');
    let count = 0;
    for (let i = 0; i < this.cells.length; i += 1) {
      if (this.cells[i] !== other.cells[i]) count += 1;
    }
    return count;
  }

  /** Multi-line `#`/`.` rendering — used by tests and debugging output. */
  toString(): string {
    const rows: string[] = [];
    for (let row = 0; row < this.size; row += 1) {
      let line = '';
      for (let col = 0; col < this.size; col += 1) line += this.get(row, col) ? '#' : '.';
      rows.push(line);
    }
    return rows.join('\n');
  }
}
