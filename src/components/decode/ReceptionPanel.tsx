import { ProgressBar } from '@/components/common/ProgressBar';
import { StatGrid } from '@/components/common/StatGrid';
import type { ReceiveProgress } from '@/features/decoder/decoder.types';
import { formatBytes, formatIndexRanges, formatPercent } from '@/lib/utils/format';
import styles from './ReceptionPanel.module.css';

export interface ReceptionPanelProps {
  progress: ReceiveProgress;
  searching: boolean;
}

const QUALITY_BAR_COUNT = 5;

export function ReceptionPanel({ progress, searching }: ReceptionPanelProps) {
  const litBars = Math.round(progress.linkQuality * QUALITY_BAR_COUNT);

  return (
    <section className={styles.panel} aria-label="Reception status">
      <div>
        {searching ? (
          <>
            <p className={styles.headline}>Searching…</p>
            <p className={styles.subhead}>
              Point this camera at the frames on the other screen. Fit the whole symbol inside the
              guides.
            </p>
          </>
        ) : (
          <>
            <p className={styles.headline}>
              {progress.receivedFrames.toLocaleString()}
              <span className={styles.headlineTotal}>
                {' '}
                / {progress.totalFrames.toLocaleString()}
              </span>
            </p>
            <p className={styles.subhead}>
              {progress.manifest ? (
                <span className={styles.fileName}>
                  Receiving {progress.manifest.fileName} · {formatBytes(progress.manifest.byteLength)}
                </span>
              ) : (
                'Reading transfer details…'
              )}
            </p>
          </>
        )}
      </div>

      <ProgressBar
        label="Frames received"
        value={progress.completion}
        valueLabel={formatPercent(progress.completion)}
        indeterminate={searching}
        tone={progress.complete ? 'positive' : 'accent'}
      />

      <StatGrid
        ariaLabel="Reception statistics"
        stats={[
          { label: 'Missing', value: progress.missingFrames.toLocaleString() },
          { label: 'Duplicates', value: progress.duplicateFrames.toLocaleString() },
          { label: 'Decoded', value: progress.framesDecoded.toLocaleString() },
          { label: 'Rejected', value: progress.rejectedFrames.toLocaleString() },
        ]}
      />

      {progress.missingFrames > 0 && progress.receivedFrames > 0 ? (
        <div>
          <p className={styles.missing}>
            Still waiting on {progress.missingFrames.toLocaleString()} frame
            {progress.missingFrames === 1 ? '' : 's'}. They repeat every pass — keep watching.
          </p>
          <p className={styles.missingList}>Next: {formatIndexRanges(progress.missingSample)}</p>
        </div>
      ) : null}

      <div className={styles.quality}>
        <span className={styles.qualityLabel}>Link</span>
        <span className={styles.bars} role="img" aria-label={`Link quality ${litBars} of ${QUALITY_BAR_COUNT}`}>
          {Array.from({ length: QUALITY_BAR_COUNT }, (_, index) => (
            <span
              key={index}
              className={`${styles.bar} ${index < litBars ? styles.barOn : ''}`}
              style={{ height: `${40 + index * 15}%` }}
            />
          ))}
        </span>
        {progress.gridSize ? (
          <span className={styles.missing}>
            {progress.gridSize}×{progress.gridSize} · {progress.eccLevel} correction
          </span>
        ) : null}
      </div>
    </section>
  );
}
