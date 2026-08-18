/**
 * Camera access.
 *
 * Thin on purpose: the only jobs here are asking for a stream with sensible
 * constraints, translating the platform's `DOMException` zoo into something a
 * person can act on, and guaranteeing that every track is actually stopped —
 * a leaked track leaves the camera indicator lit, which users reasonably read
 * as the app spying on them.
 */

export type CameraErrorCode =
  | 'unsupported'
  | 'insecure-context'
  | 'permission-denied'
  | 'no-camera'
  | 'in-use'
  | 'failed';

const CAMERA_MESSAGES: Record<CameraErrorCode, string> = {
  unsupported: 'This browser does not support camera access. Try Safari, Chrome, Edge or Firefox.',
  'insecure-context':
    'Camera access needs a secure connection. Open this page over HTTPS, or on localhost.',
  'permission-denied':
    'Camera permission was declined. Allow camera access for this site in your browser settings, then try again.',
  'no-camera': 'No camera was found on this device.',
  'in-use': 'The camera is already in use by another app or tab. Close it and try again.',
  failed: 'The camera could not be started. Reconnect it or reload the page.',
};

export class CameraError extends Error {
  readonly code: CameraErrorCode;

  constructor(code: CameraErrorCode) {
    super(CAMERA_MESSAGES[code]);
    this.name = 'CameraError';
    this.code = code;
  }

  get userMessage(): string {
    return CAMERA_MESSAGES[this.code];
  }
}

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export function isCameraSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

function assertUsable(): void {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new CameraError('insecure-context');
  }
  if (!isCameraSupported()) throw new CameraError('unsupported');
}

function translate(error: unknown): CameraError {
  if (error instanceof CameraError) return error;
  if (!(error instanceof DOMException)) return new CameraError('failed');

  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('permission-denied');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('no-camera');
    case 'NotReadableError':
    case 'TrackStartError':
      return new CameraError('in-use');
    default:
      return new CameraError('failed');
  }
}

export interface StartCameraOptions {
  /** Pin a specific camera; otherwise the rear-facing one is preferred. */
  deviceId?: string;
}

/**
 * Requests a video stream.
 *
 * Resolution is requested rather than demanded: `ideal` lets a device that
 * cannot do 1280×720 fall back instead of failing outright, and the decoder
 * downscales whatever it gets. The rear camera is preferred because the
 * receiving device is nearly always a phone pointed at another screen.
 */
export async function startCamera(options: StartCameraOptions = {}): Promise<MediaStream> {
  assertUsable();

  const video: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
    ...(options.deviceId
      ? { deviceId: { exact: options.deviceId } }
      : { facingMode: { ideal: 'environment' } }),
  };

  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (error) {
    const translated = translate(error);
    // A pinned device that has been unplugged should not strand the user.
    if (translated.code === 'no-camera' && options.deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (fallbackError) {
        throw translate(fallbackError);
      }
    }
    throw translated;
  }
}

/**
 * Stops every track on a stream.
 *
 * Must be called on unmount, on navigation away, and before starting a
 * replacement stream — otherwise the camera stays live.
 */
export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

/**
 * Lists the available cameras.
 *
 * Labels are only populated once permission has been granted, so this is worth
 * calling after {@link startCamera} rather than before.
 */
export async function listCameras(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'videoinput')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      }));
  } catch {
    return [];
  }
}

