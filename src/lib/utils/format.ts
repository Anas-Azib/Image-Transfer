/** Presentation helpers. Pure, locale-aware where it matters, no side effects. */

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB'] as const;

export function formatBytes(bytes: number, fractionDigits?: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${Math.round(bytes)} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = fractionDigits ?? (value < 10 ? 1 : 0);
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** Compact duration: "8s", "2m 14s", "1h 05m". */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';

  const totalSeconds = Math.round(milliseconds / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatPercent(ratio: number, fractionDigits = 1): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(fractionDigits)}%`;
}

/** Renders a list of frame indices as ranges: "3, 7–9, 42". */
export function formatIndexRanges(indices: readonly number[], limit = 4): string {
  if (indices.length === 0) return 'none';

  const ranges: string[] = [];
  let start = indices[0];
  let previous = indices[0];

  for (let i = 1; i <= indices.length; i += 1) {
    const current = indices[i];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}–${previous}`);
    if (i < indices.length) {
      start = current;
      previous = current;
    }
  }

  if (ranges.length <= limit) return ranges.join(', ');
  return `${ranges.slice(0, limit).join(', ')} +${ranges.length - limit} more`;
}
