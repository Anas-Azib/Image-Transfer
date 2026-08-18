/**
 * Owns the camera stream's lifecycle.
 *
 * Kept separate from decoding so that stopping the camera is a single, obvious
 * responsibility: the stream is torn down on unmount, on route change, and
 * before any replacement stream is opened. A track left running keeps the
 * device's camera indicator lit, which users rightly find alarming.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CameraError,
  isCameraSupported,
  listCameras,
  startCamera,
  stopStream,
  waitForVideoReady,
  type CameraDevice,
} from '@/features/camera/cameraService';

export type CameraState = 'idle' | 'starting' | 'ready' | 'error';

export interface UseCameraResult {
  state: CameraState;
  errorMessage: string | null;
  errorCode: string | null;
  devices: CameraDevice[];
  activeDeviceId: string | null;
  supported: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  start: (deviceId?: string) => Promise<void>;
  stop: () => void;
}

export function useCamera(): UseCameraResult {
  const [state, setState] = useState<CameraState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  // Guards against a slow getUserMedia resolving after a newer request started.
  const requestIdRef = useRef(0);

  const stop = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    if (mountedRef.current) setState('idle');
  }, []);

  const start = useCallback(async (deviceId?: string) => {
    if (!isCameraSupported()) {
      setState('error');
      setErrorCode('unsupported');
      setErrorMessage(new CameraError('unsupported').userMessage);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setState('starting');
    setErrorMessage(null);
    setErrorCode(null);

    // Release the previous stream first: some devices refuse a second
    // simultaneous grab of the same camera.
    stopStream(streamRef.current);
    streamRef.current = null;

    try {
      const stream = await startCamera(deviceId ? { deviceId } : {});
      if (requestIdRef.current !== requestId || !mountedRef.current) {
        stopStream(stream);
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // iOS Safari will not play an inline video without these two flags, and
        // silently shows a black frame instead.
        video.playsInline = true;
        video.muted = true;
        try {
          await video.play();
        } catch {
          // Autoplay rejection still leaves a usable stream on most platforms.
        }
        await waitForVideoReady(video);
      }

      if (requestIdRef.current !== requestId || !mountedRef.current) return;

      setActiveDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? null);
      setState('ready');
      setDevices(await listCameras());
    } catch (error) {
      if (requestIdRef.current !== requestId || !mountedRef.current) return;
      const cameraError = error instanceof CameraError ? error : new CameraError('failed');
      setState('error');
      setErrorCode(cameraError.code);
      setErrorMessage(cameraError.userMessage);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  return {
    state,
    errorMessage,
    errorCode,
    devices,
    activeDeviceId,
    supported: isCameraSupported(),
    videoRef,
    start,
    stop,
  };
}
