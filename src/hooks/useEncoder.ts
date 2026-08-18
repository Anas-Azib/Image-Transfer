/**
 * React binding for the transmit side.
 *
 * The hook owns *state transitions* — which is deliberate division of labour:
 * the frame loop lives in {@link FrameTransmitter} and never re-enters React,
 * so a re-render here cannot disturb the 100 ms cadence. All this hook does is
 * decide when a transmitter should exist and relay its throttled status.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_ECC_LEVEL,
  DEFAULT_GRID_SIZE,
  FRAME_DURATION_MS,
  type EccLevel,
  type GridSize,
} from '@/lib/vdt/constants';
import { EncoderError, buildTransferPlan } from '@/features/encoder/encoder';
import { createFrameGenerator } from '@/features/encoder/frameGenerator';
import { FrameTransmitter } from '@/features/encoder/frameTransmitter';
import type {
  EncoderPhase,
  TransferPlan,
  TransmissionSettings,
  TransmissionStatus,
} from '@/features/encoder/encoder.types';
import { prepareImage } from '@/features/image/imageReader';
import { ImageError } from '@/features/image/imageErrors';
import {
  DEFAULT_QUALITY,
  type PreparedImage,
  type TransmissionQuality,
} from '@/features/image/image.types';

const INITIAL_SETTINGS: TransmissionSettings = {
  gridSize: DEFAULT_GRID_SIZE,
  eccLevel: DEFAULT_ECC_LEVEL,
  frameDurationMs: FRAME_DURATION_MS,
};

const IDLE_STATUS: TransmissionStatus = {
  frameIndex: 0,
  totalFrames: 0,
  passesCompleted: 0,
  framesPerSecond: 0,
  framesPainted: 0,
  elapsedMs: 0,
  paused: false,
};

export interface UseEncoderResult {
  phase: EncoderPhase;
  errorMessage: string | null;
  image: PreparedImage | null;
  plan: TransferPlan | null;
  status: TransmissionStatus;
  settings: TransmissionSettings;
  quality: TransmissionQuality;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  selectFile: (file: File) => Promise<void>;
  setQuality: (quality: TransmissionQuality) => void;
  setGridSize: (gridSize: GridSize) => void;
  setEccLevel: (eccLevel: EccLevel) => void;
  setFrameDuration: (frameDurationMs: number) => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  reset: () => void;
}

export function useEncoder(): UseEncoderResult {
  const [phase, setPhase] = useState<EncoderPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [quality, setQualityState] = useState<TransmissionQuality>(DEFAULT_QUALITY);
  const [settings, setSettings] = useState<TransmissionSettings>(INITIAL_SETTINGS);
  const [status, setStatus] = useState<TransmissionStatus>(IDLE_STATUS);
  const [active, setActive] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const transmitterRef = useRef<FrameTransmitter | null>(null);
  const sourceFileRef = useRef<File | null>(null);
  const preparationRef = useRef<AbortController | null>(null);

  // The plan depends only on the image and the two settings that change what the
  // frames contain, so retuning the cadence never rebuilds it — and therefore
  // never restarts a transmission that is already under way.
  const { plan, planError } = useMemo<{ plan: TransferPlan | null; planError: string | null }>(() => {
    if (!image) return { plan: null, planError: null };
    try {
      return {
        plan: buildTransferPlan(image, {
          gridSize: settings.gridSize,
          eccLevel: settings.eccLevel,
        }),
        planError: null,
      };
    } catch (error) {
      return {
        plan: null,
        planError:
          error instanceof EncoderError ? error.userMessage : 'This image could not be encoded.',
      };
    }
  }, [image, settings.gridSize, settings.eccLevel]);

  const load = useCallback(
    async (file: File, nextQuality: TransmissionQuality) => {
      preparationRef.current?.abort();
      const controller = new AbortController();
      preparationRef.current = controller;

      setPhase('preparing');
      setErrorMessage(null);

      try {
        const prepared = await prepareImage(file, {
          quality: nextQuality,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setImage(prepared);
        setPhase('ready');
      } catch (error) {
        if (controller.signal.aborted) return;
        setImage(null);
        setPhase('error');
        setErrorMessage(
          error instanceof ImageError ? error.userMessage : 'This image could not be prepared.',
        );
      }
    },
    [],
  );

  const selectFile = useCallback(
    async (file: File) => {
      sourceFileRef.current = file;
      setActive(false);
      setStatus(IDLE_STATUS);
      await load(file, quality);
    },
    [load, quality],
  );

  const setQuality = useCallback(
    (nextQuality: TransmissionQuality) => {
      setQualityState(nextQuality);
      const file = sourceFileRef.current;
      if (!file) return;
      setActive(false);
      setStatus(IDLE_STATUS);
      void load(file, nextQuality);
    },
    [load],
  );

  const setGridSize = useCallback((gridSize: GridSize) => {
    setSettings((current) => ({ ...current, gridSize }));
  }, []);

  const setEccLevel = useCallback((eccLevel: EccLevel) => {
    setSettings((current) => ({ ...current, eccLevel }));
  }, []);

  const setFrameDuration = useCallback((frameDurationMs: number) => {
    setSettings((current) => ({ ...current, frameDurationMs }));
    transmitterRef.current?.setFrameDuration(frameDurationMs);
  }, []);

  const start = useCallback(() => {
    if (!plan) return;

    // Probe canvas support here rather than discovering it inside the effect
    // that mounts the transmitter: failing early keeps the error path a plain
    // state transition instead of a render cascade.
    if (!document.createElement('canvas').getContext('2d')) {
      setPhase('error');
      setErrorMessage('This browser could not open a canvas to display the transfer.');
      return;
    }

    setStatus(IDLE_STATUS);
    setActive(true);
    setPhase('transmitting');
  }, [plan]);

  const pause = useCallback(() => {
    transmitterRef.current?.pause();
    setPhase('paused');
  }, []);

  const resume = useCallback(() => {
    transmitterRef.current?.resume();
    setPhase('transmitting');
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setPhase(image ? 'ready' : 'idle');
  }, [image]);

  const reset = useCallback(() => {
    preparationRef.current?.abort();
    sourceFileRef.current = null;
    setActive(false);
    setImage(null);
    setStatus(IDLE_STATUS);
    setErrorMessage(null);
    setPhase('idle');
  }, []);

  // Attach a transmitter for as long as the transmission is live. Recreating it
  // when the plan changes is correct: different frames means a different symbol
  // sequence, and the receiver identifies transfers by id.
  useEffect(() => {
    if (!active || !plan) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    // Canvas support was already established in `start()`, so this cannot
    // realistically throw; guarding keeps a hostile environment from taking the
    // whole page down with it.
    let transmitter: FrameTransmitter;
    try {
      transmitter = new FrameTransmitter({
        canvas,
        plan,
        generator: createFrameGenerator(plan),
        frameDurationMs: settings.frameDurationMs,
        onStatus: setStatus,
      });
    } catch (error) {
      console.error('Could not start the frame transmitter', error);
      return undefined;
    }

    transmitterRef.current = transmitter;
    transmitter.start();

    return () => {
      transmitter.destroy();
      if (transmitterRef.current === transmitter) transmitterRef.current = null;
    };
    // `frameDurationMs` is applied imperatively via setFrameDuration, so it must
    // not be a dependency here or every cadence tweak would restart the transfer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, plan]);

  useEffect(() => () => preparationRef.current?.abort(), []);

  return {
    phase,
    errorMessage: errorMessage ?? planError,
    image,
    plan,
    status,
    settings,
    quality,
    canvasRef,
    selectFile,
    setQuality,
    setGridSize,
    setEccLevel,
    setFrameDuration,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
