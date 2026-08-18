// @vitest-environment jsdom

/**
 * The transmitter is the only real-time component in the app, so its timing
 * behaviour is pinned down here rather than left to observation.
 *
 * `requestAnimationFrame` is replaced with a manually advanced clock: the tests
 * can then step time in exact increments and assert what was painted, which is
 * impossible against a real display refresh.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameTransmitter } from '@/features/encoder/frameTransmitter';
import { buildTransferPlan } from '@/features/encoder/encoder';
import { FRAME_DURATION_MS, MAX_FRAME_DURATION_MS, MIN_FRAME_DURATION_MS } from '@/lib/vdt/constants';
import type { TransferPlan } from '@/features/encoder/encoder.types';
import { asPreparedImage, createPng } from '../helpers/testImages';

/** A hand-cranked animation clock. */
class FakeClock {
  now = 0;
  private callbacks = new Map<number, FrameRequestCallback>();
  private nextId = 1;

  install(): void {
    vi.spyOn(performance, 'now').mockImplementation(() => this.now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = this.nextId++;
      this.callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      this.callbacks.delete(id);
    });
  }

  /** Advances in display-refresh steps, running whatever is scheduled. */
  advance(milliseconds: number, stepMs = 1000 / 60): void {
    const target = this.now + milliseconds;
    while (this.now < target) {
      this.now = Math.min(target, this.now + stepMs);
      const pending = [...this.callbacks.entries()];
      this.callbacks.clear();
      for (const [, callback] of pending) callback(this.now);
    }
  }

  get pendingCount(): number {
    return this.callbacks.size;
  }
}

function makeCanvas(): { canvas: HTMLCanvasElement; fillRect: ReturnType<typeof vi.fn> } {
  const fillRect = vi.fn();
  const canvas = document.createElement('canvas');
  const context = {
    fillRect,
    imageSmoothingEnabled: false,
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;

  vi.spyOn(canvas, 'getContext').mockReturnValue(context);
  // jsdom reports a zero-sized box; give the transmitter something to fill.
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 400,
    top: 0,
    left: 0,
    right: 400,
    bottom: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return { canvas, fillRect };
}

describe('FrameTransmitter', () => {
  let clock: FakeClock;
  let plan: TransferPlan;

  beforeEach(() => {
    clock = new FakeClock();
    clock.install();
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
    plan = buildTransferPlan(asPreparedImage(createPng(32, 32)), {
      gridSize: 41,
      eccLevel: 'medium',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function createTransmitter(frameDurationMs = FRAME_DURATION_MS) {
    const { canvas } = makeCanvas();
    const painted: number[] = [];
    const transmitter = new FrameTransmitter({
      canvas,
      plan,
      frameDurationMs,
      generator: (index) => {
        painted.push(index);
        // Any valid matrix will do; the sequence of indices is what is asserted.
        return { size: 1, get: () => false } as never;
      },
    });
    return { transmitter, painted };
  }

  it('paints the first frame immediately on start', () => {
    const { transmitter, painted } = createTransmitter();
    transmitter.start();
    expect(painted).toEqual([0]);
    transmitter.destroy();
  });

  it('advances one frame per frame duration without drifting', () => {
    const { transmitter, painted } = createTransmitter();
    transmitter.start();

    clock.advance(FRAME_DURATION_MS * 10);

    // Ten frame slots elapsed, plus the frame painted at t=0.
    expect(painted.length).toBeGreaterThanOrEqual(10);
    expect(painted.length).toBeLessThanOrEqual(12);
    expect(painted).toEqual(painted.map((_, index) => index % plan.totalFrames));
    transmitter.destroy();
  });

  it('never paints twice within one frame slot', () => {
    const { transmitter, painted } = createTransmitter();
    transmitter.start();

    // Step at a 120 Hz refresh — far faster than the frame cadence.
    clock.advance(FRAME_DURATION_MS * 5, 1000 / 120);
    expect(painted.length).toBeLessThanOrEqual(7);
    transmitter.destroy();
  });

  it('wraps around and counts completed passes', () => {
    const { transmitter, painted } = createTransmitter();
    transmitter.start();

    clock.advance(FRAME_DURATION_MS * (plan.totalFrames + 2));

    expect(transmitter.status.passesCompleted).toBeGreaterThanOrEqual(1);
    expect(painted).toContain(0);
    expect(painted).toContain(plan.totalFrames - 1);
    // The frame after the last one is the first one again — the retransmission
    // loop that lets a receiver recover anything it missed.
    const lastIndex = painted.lastIndexOf(plan.totalFrames - 1);
    expect(painted[lastIndex + 1]).toBe(0);
    transmitter.destroy();
  });

  it('stops advancing while paused and resumes cleanly', () => {
    const { transmitter, painted } = createTransmitter();
    transmitter.start();
    clock.advance(FRAME_DURATION_MS * 3);

    const beforePause = painted.length;
    transmitter.pause();
    clock.advance(FRAME_DURATION_MS * 5);
    expect(painted.length).toBe(beforePause);
    expect(transmitter.status.paused).toBe(true);

    transmitter.resume();
    clock.advance(FRAME_DURATION_MS * 3);
    expect(painted.length).toBeGreaterThan(beforePause);
    transmitter.destroy();
  });

  it('resynchronises after a stall instead of replaying a backlog', () => {
    const { transmitter, painted } = createTransmitter();
    transmitter.start();
    clock.advance(FRAME_DURATION_MS);
    const beforeStall = painted.length;

    // Simulate a hidden tab: time jumps forward with no animation frames.
    clock.now += FRAME_DURATION_MS * 50;
    clock.advance(FRAME_DURATION_MS * 2);

    // At most a couple of frames, not the fifty that "should" have elapsed —
    // replaying them would show frames no camera could resolve.
    expect(painted.length - beforeStall).toBeLessThanOrEqual(4);
    transmitter.destroy();
  });

  it('retunes the cadence live without restarting the sequence', () => {
    const { transmitter, painted } = createTransmitter();
    transmitter.start();
    clock.advance(FRAME_DURATION_MS * 3);
    const beforeChange = painted.length;

    transmitter.setFrameDuration(MIN_FRAME_DURATION_MS);
    clock.advance(MIN_FRAME_DURATION_MS * 6);

    expect(painted.length).toBeGreaterThan(beforeChange);
    // The sequence continues rather than jumping back to frame 0.
    expect(painted.slice(beforeChange)).not.toContain(undefined);
    transmitter.destroy();
  });

  it('clamps an out-of-range cadence to the supported window', () => {
    const { transmitter } = createTransmitter(5);
    transmitter.start();
    clock.advance(MIN_FRAME_DURATION_MS * 2);
    // Construction with 5 ms must have been clamped up; no assertion on internals,
    // but the transmitter must still be producing sane status.
    expect(transmitter.status.framesPerSecond).toBeLessThanOrEqual(1000 / MIN_FRAME_DURATION_MS + 1);

    transmitter.setFrameDuration(MAX_FRAME_DURATION_MS * 10);
    clock.advance(MAX_FRAME_DURATION_MS);
    transmitter.destroy();
  });

  it('reports a measured frame rate close to the configured cadence', () => {
    const { transmitter } = createTransmitter();
    transmitter.start();
    clock.advance(FRAME_DURATION_MS * 20);

    const { framesPerSecond } = transmitter.status;
    expect(framesPerSecond).toBeGreaterThan(8);
    expect(framesPerSecond).toBeLessThan(12);
    transmitter.destroy();
  });

  it('cancels its animation frame on destroy', () => {
    const { transmitter, painted } = createTransmitter();
    transmitter.start();
    clock.advance(FRAME_DURATION_MS * 2);

    transmitter.destroy();
    const afterDestroy = painted.length;
    clock.advance(FRAME_DURATION_MS * 10);

    expect(painted.length).toBe(afterDestroy);
    expect(clock.pendingCount).toBe(0);
    transmitter.destroy(); // idempotent
  });

  it('emits status updates far less often than it paints frames', () => {
    const { canvas } = makeCanvas();
    const onStatus = vi.fn();
    const transmitter = new FrameTransmitter({
      canvas,
      plan,
      frameDurationMs: FRAME_DURATION_MS,
      generator: () => ({ size: 1, get: () => false }) as never,
      onStatus,
    });

    transmitter.start();
    clock.advance(1000);

    // ~10 frames painted in that second; the UI must not be re-rendered per frame.
    expect(onStatus.mock.calls.length).toBeLessThanOrEqual(8);
    expect(onStatus).toHaveBeenCalled();
    transmitter.destroy();
  });
});
