/**
 * Owns the camera stream's lifecycle.
 *
 * Kept separate from decoding so that stopping the camera is a single, obvious
 * responsibility: the stream is torn down on unmount, on route change, and
 * before any replacement stream is opened. A track left running keeps the
 * device's camera indicator lit, which users rightly find alarming.
 *
 * The preview element is tracked in *state* via a callback ref rather than held
 * in a plain `useRef`. Two things have to meet before a picture appears — the
 * `MediaStream` and the `<video>` — and they can arrive in either order: the
 * element may mount while permission is still pending, or only after the stream
 * is already live. Keeping both in state means the attachment effect re-runs
 * whichever one turns up second. A plain ref cannot express that, because
 * assigning to `.current` triggers no render, so an element that mounted late
 * would silently never receive the stream.
 */

import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react';
import {
  CameraError,
  isCameraSupported,
  listCameras,
  startCamera,
  stopStream,
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
  /** Callback ref to place on the preview `<video>`. */
  videoRef: RefCallback<HTMLVideoElement>;
  /** The mounted preview element, or `null`. Re-renders when it changes. */
  videoElement: HTMLVideoElement | null;
  start: (deviceId?: string) => Promise<void>;
  stop: () => void;
}

/**
 * Points a `<video>` at a stream and gets it playing.
 *
 * Kept out of the hook, and taking the element as an argument, so that the
 * "when to bind" decision stays in React while the DOM manipulation lives in
 * plain imperative code.
 *
 * @returns a teardown function for the effect that called it.
 */
function attachStream(video: HTMLVideoElement, stream: MediaStream): () => void {
  if (video.srcObject !== stream) video.srcObject = stream;

  // Set imperatively as well as via JSX. iOS Safari refuses to play a stream
  // inline unless all of these are in place, and shows a black frame rather
  // than reporting an error.
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', 'true');

  const play = () => {
    // A rejected autoplay still leaves a usable stream on most platforms, and
    // the metadata listener below gets a second attempt.
    void video.play().catch(() => undefined);
  };

  play();
  // The first play() can land before the element has metadata, which some
  // browsers drop. Retrying on loadedmetadata covers that race.
  video.addEventListener('loadedmetadata', play);
  return () => video.removeEventListener('loadedmetadata', play);
}

function detachStream(video: HTMLVideoElement): undefined {
  video.srcObject = null;
  return undefined;
}

export function useCamera(): UseCameraResult {
  const [state, setState] = useState<CameraState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  // Mirrors `stream` for teardown paths that must not wait for a render.
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  // Guards against a slow getUserMedia resolving after a newer request started.
  const requestIdRef = useRef(0);

  const videoRef = useCallback<RefCallback<HTMLVideoElement>>((element) => {
    setVideoElement(element);
  }, []);

  const stop = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (mountedRef.current) {
      setStream(null);
      setState('idle');
    }
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
      const nextStream = await startCamera(deviceId ? { deviceId } : {});
      if (requestIdRef.current !== requestId || !mountedRef.current) {
        stopStream(nextStream);
        return;
      }

      streamRef.current = nextStream;
      setActiveDeviceId(nextStream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? null);
      setStream(nextStream);
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

  /** Binds stream to element whenever both are present, in whichever order. */
  useEffect(() => {
    if (!videoElement) return undefined;
    if (!stream) return detachStream(videoElement);
    return attachStream(videoElement, stream);
  }, [stream, videoElement]);

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
    videoElement,
    start,
    stop,
  };
}
