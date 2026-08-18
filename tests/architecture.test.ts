/**
 * Guards the property the whole project rests on: the two devices talk only
 * through light. If any of these fail, something has quietly introduced a
 * network dependency and the app is no longer what it claims to be.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(process.cwd(), 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}

const FILES = sourceFiles(SOURCE_ROOT).map((path) => ({
  path: relative(process.cwd(), path),
  text: readFileSync(path, 'utf8'),
}));

/**
 * Each pattern is anchored so that an innocent substring in prose or an
 * identifier does not trip it — only a real call or import does.
 */
const FORBIDDEN: Array<{ label: string; pattern: RegExp }> = [
  { label: 'fetch()', pattern: /(^|[^.\w])fetch\s*\(/m },
  { label: 'XMLHttpRequest', pattern: /\bnew\s+XMLHttpRequest\b/ },
  { label: 'WebSocket', pattern: /\bnew\s+WebSocket\b/ },
  { label: 'EventSource', pattern: /\bnew\s+EventSource\b/ },
  { label: 'navigator.sendBeacon', pattern: /\bnavigator\s*\.\s*sendBeacon\b/ },
  { label: 'RTCPeerConnection', pattern: /\bnew\s+RTCPeerConnection\b/ },
  { label: 'Web Bluetooth', pattern: /\bnavigator\s*\.\s*bluetooth\b/ },
  { label: 'axios', pattern: /from\s+['"]axios['"]/ },
  { label: 'a backend SDK', pattern: /from\s+['"](firebase|@supabase\/|aws-sdk|@aws-sdk\/)/ },
];

describe('no network dependency', () => {
  it.each(FORBIDDEN)('never uses $label', ({ pattern }) => {
    const offenders = FILES.filter((file) => pattern.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('has no absolute http(s) URLs outside comments', () => {
    const offenders = FILES.filter((file) =>
      file.text
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .some((line) => /['"`]https?:\/\//.test(line)),
    ).map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it('declares no server, database or cloud dependency', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const runtime = Object.keys(manifest.dependencies ?? {});

    expect(runtime).toEqual(
      expect.arrayContaining(['react', 'react-dom', 'react-router-dom', 'gsap']),
    );
    for (const name of runtime) {
      expect(name).not.toMatch(/express|fastify|firebase|supabase|aws|mongo|prisma|socket\.io/i);
    }
  });

  it('ships no server entry points', () => {
    const serverish = FILES.filter((file) => /\/(api|server|routes\/api)\//.test(file.path));
    expect(serverish).toEqual([]);
  });
});

describe('protocol hygiene', () => {
  it('keeps the frame duration in constants rather than scattered literals', () => {
    const constants = FILES.find((file) => file.path.endsWith('lib/vdt/constants.ts'));
    expect(constants?.text).toMatch(/export const FRAME_DURATION_MS = 100;/);

    // Any other module wanting the cadence must import it.
    const offenders = FILES.filter(
      (file) =>
        !file.path.endsWith('lib/vdt/constants.ts') &&
        /\bframeDurationMs\s*[:=]\s*100\b/.test(file.text),
    ).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('routes every camera stream through the camera service', () => {
    const offenders = FILES.filter(
      (file) =>
        !file.path.endsWith('features/camera/cameraService.ts') &&
        /getUserMedia\s*\(/.test(file.text),
    ).map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});
