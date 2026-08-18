import { useId } from 'react';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import {
  ECC_LEVELS,
  MAX_FRAME_DURATION_MS,
  MIN_FRAME_DURATION_MS,
  SUPPORTED_GRID_SIZES,
  type EccLevel,
  type GridSize,
} from '@/lib/vdt/constants';
import { QUALITY_PRESETS, type TransmissionQuality } from '@/features/image/image.types';
import { passDurationMs, throughputBytesPerSecond } from '@/features/encoder/encoder';
import type { TransferPlan } from '@/features/encoder/encoder.types';
import { formatBytes, formatDuration } from '@/lib/utils/format';
import styles from './TransferSettingsPanel.module.css';

const DENSITY_LABELS: Record<GridSize, string> = {
  33: 'Compact',
  41: 'Standard',
  49: 'Dense',
};

const ECC_LABELS: Record<EccLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export interface TransferSettingsPanelProps {
  quality: TransmissionQuality;
  gridSize: GridSize;
  eccLevel: EccLevel;
  frameDurationMs: number;
  plan: TransferPlan | null;
  locked: boolean;
  onQualityChange: (quality: TransmissionQuality) => void;
  onGridSizeChange: (gridSize: GridSize) => void;
  onEccLevelChange: (eccLevel: EccLevel) => void;
  onFrameDurationChange: (frameDurationMs: number) => void;
}

export function TransferSettingsPanel({
  quality,
  gridSize,
  eccLevel,
  frameDurationMs,
  plan,
  locked,
  onQualityChange,
  onGridSizeChange,
  onEccLevelChange,
  onFrameDurationChange,
}: TransferSettingsPanelProps) {
  const sliderId = useId();
  const framesPerSecond = 1000 / frameDurationMs;

  return (
    <section className={styles.panel} aria-label="Transfer settings">
      <div>
        <h2 className={styles.heading}>Transfer settings</h2>
        <p className={styles.subheading}>
          Defaults suit a phone held about a forearm&rsquo;s length from this screen.
        </p>
      </div>

      <SegmentedControl
        legend="Image quality"
        description={QUALITY_PRESETS.find((preset) => preset.id === quality)?.description}
        options={QUALITY_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
        value={quality}
        onChange={onQualityChange}
        disabled={locked}
      />

      <SegmentedControl
        legend="Symbol density"
        description="Denser symbols carry more per frame but need a steadier, closer camera."
        options={SUPPORTED_GRID_SIZES.map((size) => ({
          value: String(size) as `${GridSize}`,
          label: DENSITY_LABELS[size],
        }))}
        value={String(gridSize) as `${GridSize}`}
        onChange={(value) => onGridSizeChange(Number(value) as GridSize)}
        disabled={locked}
      />

      <SegmentedControl
        legend="Error correction"
        description="More correction survives glare and blur, at the cost of payload per frame."
        options={ECC_LEVELS.map((level) => ({ value: level, label: ECC_LABELS[level] }))}
        value={eccLevel}
        onChange={onEccLevelChange}
        disabled={locked}
      />

      <div className={styles.slider}>
        <div className={styles.sliderHeader}>
          <label className={styles.sliderLabel} htmlFor={sliderId}>
            Frame duration
          </label>
          <span className={styles.sliderValue}>
            {frameDurationMs} ms · {framesPerSecond.toFixed(1)} fps
          </span>
        </div>
        <input
          className={styles.range}
          id={sliderId}
          type="range"
          min={MIN_FRAME_DURATION_MS}
          max={MAX_FRAME_DURATION_MS}
          step={10}
          value={frameDurationMs}
          onChange={(event) => onFrameDurationChange(Number(event.target.value))}
          aria-describedby={`${sliderId}-hint`}
        />
        <p className={styles.sliderHint} id={`${sliderId}-hint`}>
          Slower frames are easier for the camera to catch. This can be adjusted while sending.
        </p>
      </div>

      {plan ? (
        <div className={styles.estimate}>
          <div className={styles.estimateItem}>
            <span className={styles.estimateLabel}>Frames</span>
            <span className={styles.estimateValue}>{plan.totalFrames.toLocaleString()}</span>
          </div>
          <div className={styles.estimateItem}>
            <span className={styles.estimateLabel}>One full pass</span>
            <span className={styles.estimateValue}>
              {formatDuration(passDurationMs(plan, frameDurationMs))}
            </span>
          </div>
          <div className={styles.estimateItem}>
            <span className={styles.estimateLabel}>Throughput</span>
            <span className={styles.estimateValue}>
              {formatBytes(throughputBytesPerSecond(plan, frameDurationMs))}/s
            </span>
          </div>
          <div className={styles.estimateItem}>
            <span className={styles.estimateLabel}>Per frame</span>
            <span className={styles.estimateValue}>
              {plan.geometry.payloadCapacity} B
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
