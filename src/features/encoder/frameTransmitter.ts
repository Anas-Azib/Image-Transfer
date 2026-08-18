/**
 * Drives the on-screen transmission.
 *
 * This is the one piece of the app with a hard real-time requirement, so it is
 * deliberately kept outside React: it owns a canvas and paints into it directly
 * from a `requestAnimationFrame` loop. React is told what is happening through a
 * throttled status callback, and a slow render on the UI side can therefore
 * never stall or skew the frame cadence.
 *
 * Why not `setInterval`: it drifts, it keeps firing while the tab is hidden (so
 * a backgrounded transmitter silently races ahead of what the camera sees), and
 * it can queue callbacks faster than they are serviced. The loop below instead
 * schedules against absolute deadlines, paints at most once per frame slot, and
 * resynchronises rather than replaying a backlog after a stall.
 */

import type { BitMatrix } from '@/lib/vdt/bitMatrix';
import { paintMatrix } from '@/lib/vdt/render';
import { MAX_FRAME_DURATION_MS, MIN_FRAME_DURATION_MS } from '@/lib/vdt/constants';
import type { FrameGenerator } from './frameGenerator';
import type { TransferPlan, TransmissionStatus } from './encoder.types';

/**
 * A frame is painted when the deadline is within half a display refresh. Without
 * this the loop would always fire on the *next* refresh after the deadline,
 * biasing every interval late by up to 16.7 ms.
 */
const REFRESH_TOLERANCE_MS = 8;

/** Cadence of status updates pushed to the UI — far slower than the frame rate. */
const STATUS_INTERVAL_MS = 200;

/** Window over which the displayed frame rate is averaged. */
const RATE_WINDOW_MS = 1500;

export interface FrameTransmitterOptions {
  canvas: HTMLCanvasElement;
  plan: TransferPlan;
  generator: FrameGenerator;
  frameDurationMs: number;
  onStatus?: (status: TransmissionStatus) => void;
  /** Colours are injected so the symbol can follow the app theme. */
  darkColor?: string;
  lightColor?: string;
}

export class FrameTransmitter {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly plan: TransferPlan;
  private readonly generator: FrameGenerator;
  private readonly onStatus?: (status: TransmissionStatus) => void;

  private frameDurationMs: number;
  private darkColor: string;
  private lightColor: string;

  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private running = false;
  private paused = false;
  private destroyed = false;

  private frameIndex = 0;
  private passesCompleted = 0;
  private framesPainted = 0;
  private startedAt = 0;
  private nextFrameAt = 0;
  private lastStatusAt = 0;
  private paintTimestamps: number[] = [];
  private lastMatrix: BitMatrix | null = null;
  private canvasEdge = 0;

  constructor(options: FrameTransmitterOptions) {
    const context = options.canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('This browser cannot provide a 2D canvas context.');

    this.canvas = options.canvas;
    this.context = context;
    this.plan = options.plan;
    this.generator = options.generator;
    this.onStatus = options.onStatus;
    this.frameDurationMs = clampDuration(options.frameDurationMs);
    this.darkColor = options.darkColor ?? '#000000';
    this.lightColor = options.lightColor ?? '#ffffff';

    this.observeSize();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.destroyed || this.running) return;
    this.running = true;
    this.paused = false;
    this.frameIndex = 0;
    this.passesCompleted = 0;
    this.framesPainted = 0;
    this.paintTimestamps = [];
    this.startedAt = performance.now();
    this.nextFrameAt = this.startedAt;
    this.loop(this.startedAt);
    this.scheduleNextTick();
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.emitStatus(performance.now(), true);
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    // Restart the schedule from now so the pause does not create a backlog.
    this.nextFrameAt = performance.now();
    this.emitStatus(performance.now(), true);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.paused = false;
    this.cancelTick();
    this.emitStatus(performance.now(), true);
  }

  /** Releases the animation frame and the resize observer. Safe to call twice. */
  destroy(): void {
    this.destroyed = true;
    this.running = false;
    this.cancelTick();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.lastMatrix = null;
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  setFrameDuration(durationMs: number): void {
    this.frameDurationMs = clampDuration(durationMs);
    this.nextFrameAt = performance.now() + this.frameDurationMs;
  }

  setColors(darkColor: string, lightColor: string): void {
    this.darkColor = darkColor;
    this.lightColor = lightColor;
    this.repaint();
  }

  get status(): TransmissionStatus {
    return this.buildStatus(performance.now());
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  private scheduleNextTick(): void {
    if (this.destroyed || !this.running) return;
    this.rafId = requestAnimationFrame((now) => {
      this.rafId = null;
      this.loop(now);
      this.scheduleNextTick();
    });
  }

  private cancelTick(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private loop(now: number): void {
    if (!this.running) return;

    if (!this.paused && now >= this.nextFrameAt - REFRESH_TOLERANCE_MS) {
      this.paintFrame(this.frameIndex, now);

      this.frameIndex += 1;
      if (this.frameIndex >= this.plan.totalFrames) {
        // Wrap around. Continuous repetition is the redundancy mechanism: a
        // frame the camera missed simply comes round again next pass.
        this.frameIndex = 0;
        this.passesCompleted += 1;
      }

      this.nextFrameAt += this.frameDurationMs;
      // After a stall (hidden tab, a long GC pause) the deadline can be several
      // frames in the past. Replaying that backlog as fast as the display allows
      // would show frames the camera cannot possibly resolve, so resynchronise.
      if (this.nextFrameAt < now) this.nextFrameAt = now + this.frameDurationMs;
    }

    this.emitStatus(now, false);
  }

  private paintFrame(index: number, now: number): void {
    const matrix = this.generator(index);
    this.lastMatrix = matrix;
    this.resizeCanvas();
    paintMatrix(this.context, matrix, {
      size: this.canvasEdge,
      darkColor: this.darkColor,
      lightColor: this.lightColor,
    });

    this.framesPainted += 1;
    this.paintTimestamps.push(now);
    while (this.paintTimestamps.length > 0 && now - this.paintTimestamps[0] > RATE_WINDOW_MS) {
      this.paintTimestamps.shift();
    }
  }

  private repaint(): void {
    if (!this.lastMatrix) return;
    this.resizeCanvas();
    paintMatrix(this.context, this.lastMatrix, {
      size: this.canvasEdge,
      darkColor: this.darkColor,
      lightColor: this.lightColor,
    });
  }

  // -------------------------------------------------------------------------
  // Canvas sizing
  // -------------------------------------------------------------------------

  private observeSize(): void {
    if (typeof ResizeObserver === 'undefined') {
      this.resizeCanvas();
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
      this.repaint();
    });
    this.resizeObserver.observe(this.canvas);
  }

  private resizeCanvas(): void {
    const rect = this.canvas.getBoundingClientRect();
    const available = Math.min(rect.width || this.canvas.clientWidth, rect.height || this.canvas.clientHeight);
    if (available <= 0) return;

    // Render at device resolution: a symbol drawn on fractional pixel boundaries
    // develops grey seams, which a camera reads as extra runs.
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const edge = Math.max(1, Math.floor(available * ratio));
    if (edge === this.canvasEdge) return;

    this.canvasEdge = edge;
    this.canvas.width = edge;
    this.canvas.height = edge;
  }

  // -------------------------------------------------------------------------
  // Status reporting
  // -------------------------------------------------------------------------

  private buildStatus(now: number): TransmissionStatus {
    const span =
      this.paintTimestamps.length > 1
        ? this.paintTimestamps[this.paintTimestamps.length - 1] - this.paintTimestamps[0]
        : 0;

    return {
      frameIndex: this.frameIndex,
      totalFrames: this.plan.totalFrames,
      passesCompleted: this.passesCompleted,
      framesPerSecond: span > 0 ? ((this.paintTimestamps.length - 1) * 1000) / span : 0,
      framesPainted: this.framesPainted,
      elapsedMs: this.startedAt > 0 ? now - this.startedAt : 0,
      paused: this.paused,
    };
  }

  private emitStatus(now: number, force: boolean): void {
    if (!this.onStatus) return;
    if (!force && now - this.lastStatusAt < STATUS_INTERVAL_MS) return;
    this.lastStatusAt = now;
    this.onStatus(this.buildStatus(now));
  }
}

function clampDuration(durationMs: number): number {
  return Math.min(MAX_FRAME_DURATION_MS, Math.max(MIN_FRAME_DURATION_MS, Math.round(durationMs)));
}
