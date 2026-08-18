import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDuration,
  formatIndexRanges,
  formatPercent,
} from '@/lib/utils/format';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1000, '1.0 kB'],
    [15_400, '15 kB'],
    [1_500_000, '1.5 MB'],
    [2_000_000_000, '2.0 GB'],
  ])('formats %i as %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it('handles nonsense input without throwing', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [8_400, '8s'],
    [134_000, '2m 14s'],
    [3_900_000, '1h 05m'],
  ])('formats %i ms as %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });

  it('handles nonsense input', () => {
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('clamps to the 0–100 range', () => {
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(0.154)).toBe('15.4%');
    expect(formatPercent(1)).toBe('100.0%');
    expect(formatPercent(1.4)).toBe('100.0%');
    expect(formatPercent(-2)).toBe('0.0%');
  });
});

describe('formatIndexRanges', () => {
  it('collapses runs of consecutive indices', () => {
    expect(formatIndexRanges([3, 7, 8, 9, 42])).toBe('3, 7–9, 42');
  });

  it('handles single values and empty input', () => {
    expect(formatIndexRanges([5])).toBe('5');
    expect(formatIndexRanges([])).toBe('none');
  });

  it('truncates a long list', () => {
    expect(formatIndexRanges([1, 3, 5, 7, 9, 11], 3)).toBe('1, 3, 5 +3 more');
  });

  it('handles one unbroken run', () => {
    expect(formatIndexRanges([10, 11, 12, 13])).toBe('10–13');
  });
});
