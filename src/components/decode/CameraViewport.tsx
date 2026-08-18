import type { RefObject } from 'react';
import type { ScanSignal } from '@/features/decoder/decoder.types';
import styles from './CameraViewport.module.css';

export interface CameraViewportProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  signal: ScanSignal;
  live: boolean;
}

const SIGNAL_TEXT: Record<ScanSignal, string> = {
  none: 'Searching',
  partial: 'Symbol in view',
  locked: 'Reading frames',
};

export function CameraViewport({ videoRef, signal, live }: CameraViewportProps) {
  const signalClass =
    signal === 'locked' ? styles.locked : signal === 'partial' ? styles.partial : '';

  return (
    <div className={`${styles.viewport} ${signalClass}`}>
      {/* muted + playsInline are required for autoplay on iOS. */}
      <video ref={videoRef} className={styles.video} playsInline muted aria-label="Camera preview" />

      {!live ? (
        <div className={styles.placeholder}>
          <svg className={styles.placeholderIcon} viewBox="0 0 32 32" aria-hidden="true" fill="none">
            <path
              d="M4 11a3 3 0 0 1 3-3h2.5l1.8-2.7a1 1 0 0 1 .84-.45h7.72a1 1 0 0 1 .83.45L22.5 8H25a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V11Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <circle cx="16" cy="16" r="5" stroke="currentColor" strokeWidth="2" />
          </svg>
          <p>The camera preview appears here once access is granted.</p>
        </div>
      ) : null}

      {live ? (
        <div className={styles.overlay} aria-hidden="true">
          <div className={styles.reticle}>
            <span className={`${styles.corner} ${styles.topLeft}`} />
            <span className={`${styles.corner} ${styles.topRight}`} />
            <span className={`${styles.corner} ${styles.bottomLeft}`} />
            <span className={`${styles.corner} ${styles.bottomRight}`} />
          </div>
          {signal === 'none' ? <div className={styles.sweep} /> : null}

          <span className={styles.badge}>
            <span
              className={`${styles.dot} ${
                signal === 'locked'
                  ? styles.dotLocked
                  : signal === 'partial'
                    ? styles.dotPartial
                    : styles.dotNone
              }`}
            />
            {SIGNAL_TEXT[signal]}
          </span>
        </div>
      ) : null}
    </div>
  );
}
