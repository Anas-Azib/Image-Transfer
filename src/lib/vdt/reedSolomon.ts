/**
 * Systematic Reed–Solomon codec over GF(256).
 *
 * A codeword is `data ‖ parity`. With `parity` symbols of overhead the decoder
 * can repair up to `floor(parity / 2)` byte errors anywhere in the codeword,
 * which is what keeps a frame readable through camera blur, glare and moiré.
 *
 * Decoding is the classic pipeline: syndromes → Berlekamp–Massey →
 * Chien search → Forney.
 */

import {
  gfDiv,
  gfExp,
  gfInverse,
  gfMul,
  polyAdd,
  polyDiv,
  polyEval,
  polyMul,
  polyReverse,
  polyScale,
  polyTrim,
} from './galois';
import { RS_MAX_CODEWORD } from './constants';

export class ReedSolomonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReedSolomonError';
  }
}

export interface ReedSolomonResult {
  /** The repaired data portion (parity stripped). */
  data: Uint8Array;
  /** How many symbols had to be corrected. Useful as a signal-quality metric. */
  correctedErrors: number;
}

const generatorCache = new Map<number, Uint8Array>();

/** g(x) = ∏ (x − α^i) for i in [0, parityLength). */
export function generatorPolynomial(parityLength: number): Uint8Array {
  const cached = generatorCache.get(parityLength);
  if (cached) return cached;

  let generator: Uint8Array = Uint8Array.of(1);
  for (let i = 0; i < parityLength; i += 1) {
    generator = polyMul(generator, Uint8Array.of(1, gfExp(i)));
  }
  generatorCache.set(parityLength, generator);
  return generator;
}

export function encode(data: Uint8Array, parityLength: number): Uint8Array {
  if (parityLength <= 0) return Uint8Array.from(data);
  if (data.length + parityLength > RS_MAX_CODEWORD) {
    throw new ReedSolomonError(
      `codeword of ${data.length + parityLength} bytes exceeds the GF(256) limit of ${RS_MAX_CODEWORD}`,
    );
  }

  const generator = generatorPolynomial(parityLength);
  const codeword = new Uint8Array(data.length + parityLength);
  codeword.set(data, 0);

  for (let i = 0; i < data.length; i += 1) {
    const coefficient = codeword[i];
    if (coefficient === 0) continue;
    for (let j = 1; j < generator.length; j += 1) {
      codeword[i + j] ^= gfMul(generator[j], coefficient);
    }
  }

  // The data bytes were consumed as the dividend, so restore them verbatim.
  codeword.set(data, 0);
  return codeword;
}

/** S_j = C(α^j). An all-zero syndrome vector means the codeword is intact. */
function syndromes(codeword: Uint8Array, parityLength: number): Uint8Array {
  // Index 0 is deliberately left as a zero pad: the Berlekamp–Massey and Forney
  // steps below are both defined against that convention.
  const result = new Uint8Array(parityLength + 1);
  for (let i = 0; i < parityLength; i += 1) {
    result[i + 1] = polyEval(codeword, gfExp(i));
  }
  return result;
}

function errorLocatorPolynomial(syndromeVector: Uint8Array, parityLength: number): Uint8Array {
  let errorLocator: Uint8Array = Uint8Array.of(1);
  let previousLocator: Uint8Array = Uint8Array.of(1);
  const shift = syndromeVector.length - parityLength;

  for (let i = 0; i < parityLength; i += 1) {
    const index = i + shift;
    let delta = syndromeVector[index];
    for (let j = 1; j < errorLocator.length; j += 1) {
      delta ^= gfMul(errorLocator[errorLocator.length - 1 - j], syndromeVector[index - j]);
    }

    // previousLocator *= x
    const shifted: Uint8Array = new Uint8Array(previousLocator.length + 1);
    shifted.set(previousLocator, 0);
    previousLocator = shifted;

    if (delta !== 0) {
      if (previousLocator.length > errorLocator.length) {
        const next = polyScale(previousLocator, delta);
        previousLocator = polyScale(errorLocator, gfInverse(delta));
        errorLocator = next;
      }
      errorLocator = polyAdd(errorLocator, polyScale(previousLocator, delta));
    }
  }

  const trimmed = polyTrim(errorLocator);
  const errorCount = trimmed.length - 1;
  if (errorCount * 2 > parityLength) {
    throw new ReedSolomonError('too many errors to correct');
  }
  return trimmed;
}

/**
 * Chien search.
 *
 * A byte stored at array index `p` is the coefficient of x^(n-1-p), so its error
 * locator value is X = α^(n-1-p). Λ vanishes at the *inverse* of each locator,
 * hence the evaluation at α^(-i).
 */
function errorPositions(errorLocator: Uint8Array, codewordLength: number): number[] {
  const expected = errorLocator.length - 1;
  const positions: number[] = [];

  for (let i = 0; i < codewordLength; i += 1) {
    if (polyEval(errorLocator, gfExp(-i)) === 0) {
      positions.push(codewordLength - 1 - i);
    }
  }

  if (positions.length !== expected) {
    throw new ReedSolomonError('error locator degree does not match the number of roots');
  }
  return positions;
}

function errataLocator(coefficientPositions: number[]): Uint8Array {
  let locator: Uint8Array = Uint8Array.of(1);
  for (const position of coefficientPositions) {
    locator = polyMul(locator, polyAdd(Uint8Array.of(1), Uint8Array.of(gfExp(position), 0)));
  }
  return locator;
}

function errorEvaluator(
  reversedSyndromes: Uint8Array,
  locator: Uint8Array,
  degree: number,
): Uint8Array {
  const modulus = new Uint8Array(degree + 2);
  modulus[0] = 1;
  return polyDiv(polyMul(reversedSyndromes, locator), modulus)[1];
}

/** Forney algorithm: derive each error magnitude and XOR it back out. */
function correctErrata(
  codeword: Uint8Array,
  syndromeVector: Uint8Array,
  positions: number[],
): Uint8Array {
  const coefficientPositions = positions.map((position) => codeword.length - 1 - position);
  const locator = errataLocator(coefficientPositions);
  const evaluator = polyReverse(
    errorEvaluator(polyReverse(syndromeVector), locator, locator.length - 1),
  );

  const locations = coefficientPositions.map((position) => gfExp(-(255 - position)));
  const correction = new Uint8Array(codeword.length);

  for (let i = 0; i < locations.length; i += 1) {
    const location = locations[i];
    const inverseLocation = gfInverse(location);

    let derivative = 1;
    for (let j = 0; j < locations.length; j += 1) {
      if (j === i) continue;
      derivative = gfMul(derivative, 1 ^ gfMul(inverseLocation, locations[j]));
    }
    if (derivative === 0) throw new ReedSolomonError('degenerate error locator derivative');

    const numerator = gfMul(location, polyEval(polyReverse(evaluator), inverseLocation));
    correction[positions[i]] = gfDiv(numerator, derivative);
  }

  const repaired = Uint8Array.from(codeword);
  for (let i = 0; i < repaired.length; i += 1) repaired[i] ^= correction[i];
  return repaired;
}

export function decode(codeword: Uint8Array, parityLength: number): ReedSolomonResult {
  if (parityLength <= 0) {
    return { data: Uint8Array.from(codeword), correctedErrors: 0 };
  }
  if (codeword.length <= parityLength) {
    throw new ReedSolomonError('codeword is shorter than its parity section');
  }
  if (codeword.length > RS_MAX_CODEWORD) {
    throw new ReedSolomonError('codeword exceeds the GF(256) limit');
  }

  const syndromeVector = syndromes(codeword, parityLength);
  if (syndromeVector.every((value) => value === 0)) {
    return { data: codeword.slice(0, codeword.length - parityLength), correctedErrors: 0 };
  }

  const locator = errorLocatorPolynomial(syndromeVector, parityLength);
  const positions = errorPositions(locator, codeword.length);
  const repaired = correctErrata(codeword, syndromeVector, positions);

  // Re-derive the syndromes: a decoder can "succeed" onto a different valid
  // codeword when the error count exceeds the correction capability.
  const verification = syndromes(repaired, parityLength);
  if (!verification.every((value) => value === 0)) {
    throw new ReedSolomonError('correction failed to produce a valid codeword');
  }

  return {
    data: repaired.slice(0, repaired.length - parityLength),
    correctedErrors: positions.length,
  };
}
