// @vitest-environment jsdom

/**
 * Regression cover for the camera preview.
 *
 * The original bug: `useCamera` assigned `srcObject` inside `start()`, but the
 * `<video>` was rendered by a branch that only mounts once the camera reports
 * ready — so at the moment `getUserMedia` resolved the ref was still null, the
 * assignment was skipped, and the app sat on a live track feeding a blank
 * element. Every visible signal said "working" (permission granted, device list
 * populated, scanner running); only the picture was missing.
 *
 * Nothing in the unit suite could see that, because it is a wiring failure
 * between a hook and the component that renders its ref target. These tests
 * drive the real page against a fake `mediaDevices`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DecodePage } from '@/app/routes/DecodePage';
import { useCamera } from '@/hooks/useCamera';

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  getSettings: () => MediaTrackSettings;
}

function createFakeStream(deviceId = 'back-camera'): { stream: MediaStream; track: FakeTrack } {
  const track: FakeTrack = {
    stop: vi.fn(),
    getSettings: () => ({ deviceId }) as MediaTrackSettings,
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

function installMediaDevices(getUserMedia: ReturnType<typeof vi.fn>) {
  const enumerateDevices = vi.fn().mockResolvedValue([
    { kind: 'videoinput', deviceId: 'back-camera', label: 'Back Camera' },
    { kind: 'videoinput', deviceId: 'front-camera', label: 'Front Camera' },
  ]);

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: { getUserMedia, enumerateDevices },
  });

  return { getUserMedia, enumerateDevices };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DecodePage />
    </MemoryRouter>,
  );
}

async function enableCamera() {
  await userEvent.setup().click(screen.getByRole('button', { name: /enable camera/i }));
}

function previewElement(): HTMLVideoElement {
  return screen.getByLabelText('Camera preview') as HTMLVideoElement;
}

describe('decode camera preview', () => {
  beforeEach(() => {
    // jsdom implements neither of these; without stubs the element throws.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('attaches the stream to the video element once the camera starts', async () => {
    const { stream } = createFakeStream();
    installMediaDevices(vi.fn().mockResolvedValue(stream));

    renderPage();
    await enableCamera();

    // The assertion the original bug failed: a live track is not enough, the
    // element itself has to be carrying it.
    await waitFor(() => expect(previewElement().srcObject).toBe(stream));
  });

  it('starts playback on the preview', async () => {
    const { stream } = createFakeStream();
    installMediaDevices(vi.fn().mockResolvedValue(stream));

    renderPage();
    await enableCamera();

    await waitFor(() => expect(previewElement().srcObject).toBe(stream));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('sets the inline playback flags iOS requires', async () => {
    const { stream } = createFakeStream();
    installMediaDevices(vi.fn().mockResolvedValue(stream));

    renderPage();
    await enableCamera();

    await waitFor(() => expect(previewElement().srcObject).toBe(stream));
    const video = previewElement();
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
  });

  it('mounts the preview while permission is still pending', async () => {
    let release: ((stream: MediaStream) => void) | undefined;
    const pending = new Promise<MediaStream>((resolve) => {
      release = resolve;
    });
    installMediaDevices(vi.fn().mockReturnValue(pending));

    renderPage();
    await enableCamera();

    // The element must exist before the stream arrives — that ordering is the
    // whole point, and is what the original code got wrong.
    await waitFor(() => expect(screen.queryByLabelText('Camera preview')).not.toBeNull());

    const { stream } = createFakeStream();
    release?.(stream);
    await waitFor(() => expect(previewElement().srcObject).toBe(stream));
  });

  it('lists the available cameras once permission is granted', async () => {
    const { stream } = createFakeStream();
    installMediaDevices(vi.fn().mockResolvedValue(stream));

    renderPage();
    await enableCamera();

    await waitFor(() => expect(screen.getByLabelText('Camera')).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Back Camera' })).toBeInTheDocument();
  });

  it('releases the track and clears the element when stopped', async () => {
    const { stream, track } = createFakeStream();
    installMediaDevices(vi.fn().mockResolvedValue(stream));

    renderPage();
    await enableCamera();
    await waitFor(() => expect(previewElement().srcObject).toBe(stream));

    await userEvent.setup().click(screen.getByRole('button', { name: /stop camera/i }));

    expect(track.stop).toHaveBeenCalled();
  });

  it('stops the track when the page unmounts', async () => {
    const { stream, track } = createFakeStream();
    installMediaDevices(vi.fn().mockResolvedValue(stream));

    const { unmount } = renderPage();
    await enableCamera();
    await waitFor(() => expect(previewElement().srcObject).toBe(stream));

    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it('shows an actionable message when permission is denied', async () => {
    const denied = new DOMException('Permission denied', 'NotAllowedError');
    installMediaDevices(vi.fn().mockRejectedValue(denied));

    renderPage();
    await enableCamera();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/camera permission was declined/i);
    // Raw exception text must never reach the user.
    expect(alert).not.toHaveTextContent(/NotAllowedError/);
  });

  it('reports a camera that is already in use', async () => {
    installMediaDevices(vi.fn().mockRejectedValue(new DOMException('busy', 'NotReadableError')));

    renderPage();
    await enableCamera();

    expect(await screen.findByRole('alert')).toHaveTextContent(/already in use/i);
  });

  /**
   * The invariant, pinned independently of how any page happens to render.
   *
   * The stream and the <video> can show up in either order. Testing only
   * through DecodePage would not catch a regression here, because that page
   * mounts the element early — which masks the failure rather than preventing
   * it.
   */
  describe('attachment is order-independent', () => {
    it('attaches when the element mounts after the stream is already live', async () => {
      const { stream } = createFakeStream();
      installMediaDevices(vi.fn().mockResolvedValue(stream));

      const { result } = renderHook(() => useCamera());

      // Stream first, with no element anywhere in sight.
      await act(async () => {
        await result.current.start();
      });
      expect(result.current.state).toBe('ready');

      // Element second — the exact ordering the original code dropped.
      const video = document.createElement('video');
      await act(async () => {
        result.current.videoRef(video);
      });

      expect(video.srcObject).toBe(stream);
    });

    it('attaches when the element mounts before the stream arrives', async () => {
      const { stream } = createFakeStream();
      installMediaDevices(vi.fn().mockResolvedValue(stream));

      const { result } = renderHook(() => useCamera());

      const video = document.createElement('video');
      await act(async () => {
        result.current.videoRef(video);
      });
      expect(video.srcObject).toBeFalsy();

      await act(async () => {
        await result.current.start();
      });

      expect(video.srcObject).toBe(stream);
    });

    it('clears the element when the camera is stopped', async () => {
      const { stream } = createFakeStream();
      installMediaDevices(vi.fn().mockResolvedValue(stream));

      const { result } = renderHook(() => useCamera());
      const video = document.createElement('video');

      await act(async () => {
        result.current.videoRef(video);
        await result.current.start();
      });
      expect(video.srcObject).toBe(stream);

      await act(async () => {
        result.current.stop();
      });

      expect(video.srcObject).toBeNull();
    });
  });
});
