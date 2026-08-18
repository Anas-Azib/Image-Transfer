/**
 * React binding for the receive side: camera → scanner → receiver → image.
 *
 * Two decisions shape this hook.
 *
 * The receiver is held in a ref rather than in state. It is mutated ~10 times a
 * second, and re-rendering the tree on every accepted frame would starve the
 * detector of main-thread time; instead a snapshot of its progress is published
 * on a fixed cadence.
 *
 * `phase` is *derived*, not stored. It is a pure function of the camera state,
 * the progress snapshot and whether a result exists — deriving it removes a
 * whole class of bug where the two could disagree (a camera error arriving while
 * the phase still said "searching"), and avoids an effect whose only job was to
 * copy one piece of state into another.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RECEIVE_TIMEOUT_MS } from '@/lib/vdt/constants';
import type { DetectionOutcome } from '@/lib/vdt/detect/detector';
import { FrameScanner } from '@/features/decoder/frameScanner';
import { TransferError, TransferReceiver } from '@/features/decoder/transferReceiver';
import type { DecoderPhase, ReceiveProgress, ScanSignal } from '@/features/decoder/decoder.types';
import {
  reconstructImage,
  releaseImage,
  type ReconstructedImage,
} from '@/features/image/imageReconstructor';
import { useCamera, type UseCameraResult } from './useCamera';

/** How often the receiver's progress is mirrored into React state. */
const PROGRESS_PUBLISH_MS = 150;

/** A lock indicator lingers this long after the last decode, to stop it flickering. */
const LOCK_HOLD_MS = 700;

const EMPTY_PROGRESS: ReceiveProgress = {
  transferId: null,
  totalFrames: 0,
  receivedFrames: 0,
  missingFrames: 0,
  missingSample: [],
  duplicateFrames: 0,
  framesDecoded: 0,
  rejectedFrames: 0,
  bytesReceived: 0,
  completion: 0,
  manifest: null,
  linkQuality: 1,
  gridSize: null,
  eccLevel: null,
  lastFrameAt: 0,
  complete: false,
};

/** Where the transfer itself has got to, independent of the camera. */
type TransferStage = 'idle' | 'scanning' | 'reconstructing' | 'complete' | 'failed';

export interface UseDecoderResult {
  phase: DecoderPhase;
  camera: UseCameraResult;
  progress: ReceiveProgress;
  signal: ScanSignal;
  errorMessage: string | null;
  stalled: boolean;
  image: ReconstructedImage | null;
  begin: (deviceId?: string) => Promise<void>;
  cancel: () => void;
  restart: () => Promise<void>;
  discard: () => void;
}

export function useDecoder(): UseDecoderResult {
  const camera = useCamera();
  const [stage, setStage] = useState<TransferStage>('idle');
  const [progress, setProgress] = useState<ReceiveProgress>(EMPTY_PROGRESS);
  const [signal, setSignal] = useState<ScanSignal>('none');
  const [transferError, setTransferError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [image, setImage] = useState<ReconstructedImage | null>(null);

  const receiverRef = useRef(new TransferReceiver());
  const scannerRef = useRef<FrameScanner | null>(null);
  const imageRef = useRef<ReconstructedImage | null>(null);
  const lastDecodeAtRef = useRef(0);
  const lastPartialAtRef = useRef(0);

  const {
    videoElement,
    start: startCameraStream,
    stop: stopCameraStream,
    state: cameraState,
  } = camera;

  const finished = stage === 'complete' || stage === 'reconstructing';

  const phase = useMemo<DecoderPhase>(() => {
    if (stage === 'complete') return 'complete';
    if (stage === 'reconstructing') return 'reconstructing';
    if (stage === 'failed' || cameraState === 'error') return 'error';
    if (cameraState === 'starting') return 'requesting-camera';
    if (cameraState === 'ready') return progress.receivedFrames > 0 ? 'receiving' : 'searching';
    return 'idle';
  }, [stage, cameraState, progress.receivedFrames]);

  const errorMessage = transferError ?? (cameraState === 'error' ? camera.errorMessage : null);

  const replaceImage = useCallback((next: ReconstructedImage | null) => {
    releaseImage(imageRef.current);
    imageRef.current = next;
    setImage(next);
  }, []);

  const finish = useCallback(() => {
    scannerRef.current?.stop();
    setStage('reconstructing');

    try {
      const { bytes, manifest } = receiverRef.current.assemble();
      replaceImage(reconstructImage(bytes, manifest));
      setProgress(receiverRef.current.progress);
      setStage('complete');
    } catch (error) {
      setTransferError(
        error instanceof TransferError
          ? error.userMessage
          : 'The received data could not be turned back into an image.',
      );
      setStage('failed');
    } finally {
      // The camera has done its job either way; leaving it running would keep
      // the device's recording indicator lit for no reason.
      stopCameraStream();
    }
  }, [replaceImage, stopCameraStream]);

  const handleOutcome = useCallback(
    (outcome: DetectionOutcome) => {
      const now = performance.now();

      if (!outcome.result) {
        if (outcome.diagnostics.stage !== 'no-finders') {
          lastPartialAtRef.current = now;
          if (outcome.diagnostics.stage === 'undecodable') {
            receiverRef.current.noteRejectedFrame();
          }
        }
        return;
      }

      lastDecodeAtRef.current = now;
      receiverRef.current.accept(
        {
          frame: outcome.result.frame,
          gridSize: outcome.result.gridSize,
          eccLevel: outcome.result.eccLevel,
          correctedErrors: outcome.result.correctedErrors,
        },
        now,
      );

      if (receiverRef.current.isComplete) finish();
    },
    [finish],
  );

  const begin = useCallback(
    async (deviceId?: string) => {
      receiverRef.current.reset();
      lastDecodeAtRef.current = 0;
      lastPartialAtRef.current = 0;
      replaceImage(null);
      setProgress(EMPTY_PROGRESS);
      setSignal('none');
      setStalled(false);
      setTransferError(null);
      setStage('scanning');

      await startCameraStream(deviceId);
    },
    [replaceImage, startCameraStream],
  );

  const cancel = useCallback(() => {
    scannerRef.current?.stop();
    scannerRef.current = null;
    stopCameraStream();
    setStage((current) => (current === 'scanning' ? 'idle' : current));
    setSignal('none');
  }, [stopCameraStream]);

  const restart = useCallback(async () => {
    await begin();
  }, [begin]);

  const discard = useCallback(() => {
    replaceImage(null);
    receiverRef.current.reset();
    setProgress(EMPTY_PROGRESS);
    setTransferError(null);
    setStage('idle');
  }, [replaceImage]);

  // Run the scanner exactly while the camera is live and the transfer is still
  // in flight. Both conditions are needed: a completed transfer must not keep
  // decoding, and a stopped camera has nothing to decode from.
  useEffect(() => {
    if (cameraState !== 'ready' || !videoElement || finished) return undefined;

    const scanner = new FrameScanner({
      video: videoElement,
      onOutcome: handleOutcome,
      getHints: () => {
        const { gridSize, eccLevel } = receiverRef.current.progress;
        return {
          ...(gridSize ? { gridSize } : {}),
          ...(eccLevel ? { eccLevel } : {}),
        };
      },
    });

    scannerRef.current = scanner;
    scanner.start();

    return () => {
      scanner.stop();
      if (scannerRef.current === scanner) scannerRef.current = null;
    };
  }, [cameraState, handleOutcome, videoElement, finished]);

  // Publish progress on a timer rather than per frame: the detector needs the
  // main thread more than the UI needs sub-100 ms freshness.
  useEffect(() => {
    if (stage !== 'scanning' || cameraState !== 'ready') return undefined;

    const interval = window.setInterval(() => {
      const snapshot = receiverRef.current.progress;
      setProgress(snapshot);

      const now = performance.now();
      const sinceDecode = now - lastDecodeAtRef.current;
      const sincePartial = now - lastPartialAtRef.current;

      if (lastDecodeAtRef.current > 0 && sinceDecode < LOCK_HOLD_MS) setSignal('locked');
      else if (lastPartialAtRef.current > 0 && sincePartial < LOCK_HOLD_MS) setSignal('partial');
      else setSignal('none');

      setStalled(snapshot.receivedFrames > 0 && sinceDecode > RECEIVE_TIMEOUT_MS);
    }, PROGRESS_PUBLISH_MS);

    return () => window.clearInterval(interval);
  }, [stage, cameraState]);

  // Final cleanup: stop scanning and release the preview URL for the last image.
  useEffect(
    () => () => {
      scannerRef.current?.stop();
      scannerRef.current = null;
      releaseImage(imageRef.current);
      imageRef.current = null;
    },
    [],
  );

  return {
    phase,
    camera,
    progress,
    signal,
    errorMessage,
    stalled,
    image,
    begin,
    cancel,
    restart,
    discard,
  };
}
