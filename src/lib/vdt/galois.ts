/**
 * Arithmetic in GF(2^8) with the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
 * (0x11d) — the same field QR codes use, chosen because it is well understood
 * and easy to cross-check against reference implementations.
 *
 * Log/antilog tables are built once at module load; every operation below is a
 * table lookup, which keeps per-frame encoding cheap enough to run inline.
 */

const PRIMITIVE_POLYNOMIAL = 0x11d;
const FIELD_SIZE = 256;

const EXP_TABLE = new Uint8Array(FIELD_SIZE * 2);
const LOG_TABLE = new Uint8Array(FIELD_SIZE);

{
  let value = 1;
  for (let i = 0; i < FIELD_SIZE - 1; i += 1) {
    EXP_TABLE[i] = value;
    LOG_TABLE[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= PRIMITIVE_POLYNOMIAL;
  }
  // Duplicate the table so `exp(a + b)` never needs a modulo.
  for (let i = FIELD_SIZE - 1; i < EXP_TABLE.length; i += 1) {
    EXP_TABLE[i] = EXP_TABLE[i - (FIELD_SIZE - 1)];
  }
}

export function gfExp(exponent: number): number {
  const normalized = ((exponent % 255) + 255) % 255;
  return EXP_TABLE[normalized];
}

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('division by zero in GF(256)');
  if (a === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a] + 255 - LOG_TABLE[b]) % 255];
}

export function gfInverse(a: number): number {
  if (a === 0) throw new RangeError('0 has no multiplicative inverse in GF(256)');
  return EXP_TABLE[255 - LOG_TABLE[a]];
}

// ---------------------------------------------------------------------------
// Polynomials — index 0 holds the highest-order coefficient.
// ---------------------------------------------------------------------------

export function polyScale(poly: Uint8Array, scalar: number): Uint8Array {
  const out = new Uint8Array(poly.length);
  for (let i = 0; i < poly.length; i += 1) out[i] = gfMul(poly[i], scalar);
  return out;
}

export function polyAdd(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(a.length, b.length));
  for (let i = 0; i < a.length; i += 1) out[i + out.length - a.length] = a[i];
  for (let i = 0; i < b.length; i += 1) out[i + out.length - b.length] ^= b[i];
  return out;
}

export function polyMul(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i += 1) {
    const coefficient = a[i];
    if (coefficient === 0) continue;
    for (let j = 0; j < b.length; j += 1) {
      out[i + j] ^= gfMul(coefficient, b[j]);
    }
  }
  return out;
}

/** Evaluates the polynomial at `x` using Horner's method. */
export function polyEval(poly: Uint8Array, x: number): number {
  let result = poly[0] ?? 0;
  for (let i = 1; i < poly.length; i += 1) {
    result = gfMul(result, x) ^ poly[i];
  }
  return result;
}

/** Drops leading zero coefficients so degree comparisons stay meaningful. */
export function polyTrim(poly: Uint8Array): Uint8Array {
  let start = 0;
  while (start < poly.length - 1 && poly[start] === 0) start += 1;
  return poly.subarray(start);
}

/**
 * Polynomial long division. Returns `[quotient, remainder]`.
 * Used by the error-evaluator step of the Reed–Solomon decoder.
 */
export function polyDiv(dividend: Uint8Array, divisor: Uint8Array): [Uint8Array, Uint8Array] {
  const working = Uint8Array.from(dividend);
  const divisorLead = divisor[0];
  if (divisorLead === 0) throw new RangeError('cannot divide by the zero polynomial');

  for (let i = 0; i < dividend.length - (divisor.length - 1); i += 1) {
    const coefficient = working[i];
    if (coefficient === 0) continue;
    for (let j = 1; j < divisor.length; j += 1) {
      if (divisor[j] === 0) continue;
      working[i + j] ^= gfMul(divisor[j], coefficient);
    }
  }

  const separator = working.length - (divisor.length - 1);
  return [working.subarray(0, separator), working.subarray(separator)];
}

/** Returns a reversed copy — several RS steps are defined on reversed polynomials. */
export function polyReverse(poly: Uint8Array): Uint8Array {
  const out = new Uint8Array(poly.length);
  for (let i = 0; i < poly.length; i += 1) out[i] = poly[poly.length - 1 - i];
  return out;
}
