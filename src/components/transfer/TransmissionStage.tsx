import { useCallback, useEffect, useState, type RefObject } from 'react';
import { Button } from '@/components/common/Button';
import { ProgressBar } from '@/components/common/ProgressBar';
import { StatGrid } from '@/components/common/StatGrid';
import type { TransferPlan, TransmissionStatus } from '@/features/encoder/encoder.types';
import { formatDuration } from '@/lib/utils/format';
import styles from './TransmissionStage.module.css';

export interface TransmissionStageProps {
  plan: TransferPlan;
  status: TransmissionStatus;
  paused: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function TransmissionStage({
  plan,
  status,
  paused,
  canvasRef,
  onPause,
  onResume,
  onStop,
}: TransmissionStageProps) {
  const [fullscreen, setFullscreen] = useState(false);

  // Escape leaves the presentation view. Registered only while it is open so it
  // never competes with anything else on the page for the key.
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  const toggleFullscreen = useCallback(() => setFullscreen((current) => !current), []);

  const passProgress = plan.totalFrames > 0 ? status.frameIndex / plan.totalFrames : 0;

  return (
    <div className={`${styles.stage} ${fullscreen ? styles.fullscreen : ''}`}>
      <div className={styles.display}>
        {/* The canvas is painted imperatively by FrameTransmitter, ten times a
            second. React never re-renders it. */}
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label={`Visual transfer frame ${status.frameIndex + 1} of ${plan.totalFrames}`}
        />
        {paused ? (
          <div className={styles.pausedVeil} aria-hidden="true">
            Paused
          </div>
        ) : null}
      </div>

      <div className={styles.side}>
        <div>
          <p className={styles.frameCounter}>
            {(status.frameIndex + 1).toLocaleString()}
            <span className={styles.frameCounterTotal}> / {plan.totalFrames.toLocaleString()}</span>
          </p>
          <ProgressBar
            label="Current pass"
            value={passProgress}
            valueLabel={`${(passProgress * 100).toFixed(1)}%`}
          />
        </div>

        <div className={styles.statsBlock}>
          <StatGrid
            ariaLabel="Transmission statistics"
            stats={[
              { label: 'Rate', value: `${status.framesPerSecond.toFixed(1)} fps` },
              { label: 'Passes', value: String(status.passesCompleted) },
              { label: 'Elapsed', value: formatDuration(status.elapsedMs) },
              { label: 'Frames sent', value: status.framesPainted.toLocaleString() },
            ]}
          />
        </div>

        <p className={styles.guidance}>
          Keep this screen still and fully visible to the other device&rsquo;s camera. Frames repeat
          continuously, so any the camera misses will come round again — leave it running until the
          receiver says the transfer is complete.
        </p>

        <div className={styles.controls}>
          {paused ? (
            <Button variant="primary" onClick={onResume}>
              Resume
            </Button>
          ) : (
            <Button onClick={onPause}>Pause</Button>
          )}
          <Button onClick={toggleFullscreen}>
            {fullscreen ? 'Exit full screen' : 'Full screen'}
          </Button>
          <Button variant="quiet" onClick={onStop}>
            Stop
          </Button>
        </div>
      </div>

      {/* Deliberately coarse: announcing every frame would make the page
          unusable with a screen reader, so this only changes when the
          transmission is paused or a full pass completes. */}
      <p className="sr-only" role="status" aria-live="polite">
        {paused
          ? 'Transmission paused.'
          : `Transmitting ${plan.totalFrames} frames. ${status.passesCompleted} complete ${
              status.passesCompleted === 1 ? 'pass' : 'passes'
            } so far.`}
      </p>
    </div>
  );
}
