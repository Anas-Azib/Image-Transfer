/**
 * Pulls frames off the camera and runs detection on them.
 *
 * Two constraints shape this loop. The camera delivers 30–60 fps while the
 * transmitter only changes the picture every 100 ms, so analysing every capture
 * would burn battery to re-read symbols already decoded. And detection is
 * synchronous work on the main thread, so a second pass must never start while
 * the first is still running or the page will stutter and drop the video.
 *
 * Hence: one reusable capture canvas, a minimum interval between attempts, and a
 * hard busy flag.
 */

import { MAX_ANALYSIS_EDGE_PX, SCAN_INTERVAL_MS } from '@/lib/vdt/constants';
import { detectFrame, type DetectionHints, type DetectionOutcome } from '@/lib/vdt/detect/detector';

export interface FrameScannerOptions {
  video: HTMLVideoElement;
  onOutcome: (outcome: DetectionOutcome) => void;
  /** Supplies the current hints so a locked-on transfer skips the size search. */
  getHints?: () => DetectionHints;
  intervalMs?: number;
}

/**
 * `requestVideoFrameCallback` is the right tool — it fires once per decoded
 * video frame — but it is not universal, so `requestAnimationFrame` stands in.
 */
type VideoFrameCallbackHost = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export class FrameScanner {
  private readonly video: VideoFrameCallbackHost;
  private readonly onOutcome: (outcome: DetectionOutcome) => void;
  private readonly getHints?: () => DetectionHints;
  private readonly intervalMs: number;

  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;

  private running = false;
  private busy = false;
  private lastScanAt = 0;
  private rafId: number | null = null;
  private videoCallbackId: number | null = null;

  constructor(options: FrameScannerOptions) {
    this.video = options.video as VideoFrameCallbackHost;
    this.onOutcome = options.onOutcome;
    this.getHints = options.getHints;
    this.intervalMs = options.intervalMs ?? SCAN_INTERVAL_MS;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.videoCallbackId !== null && this.video.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.videoCallbackId);
      this.videoCallbackId = null;
    }
    // Release the capture buffer; a 640×360 RGBA canvas is ~1 MB of retained GPU
    // and heap memory that has no reason to outlive the scan session.
    this.canvas = null;
    this.context = null;
  }

  private schedule(): void {
    if (!this.running) return;

    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.videoCallbackId = this.video.requestVideoFrameCallback(() => {
        this.videoCallbackId = null;
        this.tick();
        this.schedule();
      });
      return;
    }

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.tick();
      this.schedule();
    });
  }

  private tick(): void {
    if (!this.running || this.busy) return;

    const now = performance.now();
    if (now - this.lastScanAt < this.intervalMs) return;

    const { videoWidth, videoHeight } = this.video;
    if (videoWidth === 0 || videoHeight === 0) return;

    this.busy = true;
    this.lastScanAt = now;
    try {
      const capture = this.capture(videoWidth, videoHeight);
      if (capture) {
        this.onOutcome(
          detectFrame(capture.data, capture.width, capture.height, {
            ...this.getHints?.(),
            // The canvas already downscaled to the analysis resolution, so tell
            // the detector not to shrink it a second time.
            maxAnalysisEdge: Math.max(capture.width, capture.height),
          }),
        );
      }
    } finally {
      this.busy = false;
    }
  }

  /**
   * Copies the current video frame into a working canvas.
   *
   * The canvas is deliberately smaller than the camera feed: letting `drawImage`
   * do the downscale hands the resampling to the browser (often the GPU) instead
   * of doing it in JavaScript, and detection wants a modest resolution anyway.
   */
  private capture(videoWidth: number, videoHeight: number): ImageData | null {
    const scale = Math.min(1, MAX_ANALYSIS_EDGE_PX / Math.max(videoWidth, videoHeight));
    const width = Math.max(1, Math.round(videoWidth * scale));
    const height = Math.max(1, Math.round(videoHeight * scale));

    if (!this.canvas || this.canvas.width !== width || this.canvas.height !== height) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!context) return null;
      this.canvas = canvas;
      this.context = context;
    }

    if (!this.context) return null;
    this.context.drawImage(this.video, 0, 0, width, height);
    return this.context.getImageData(0, 0, width, height);
  }
}
