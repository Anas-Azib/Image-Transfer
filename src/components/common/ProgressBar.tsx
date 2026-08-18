import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** 0–1. Ignored when `indeterminate` is set. */
  value: number;
  label: string;
  valueLabel?: string;
  tone?: 'accent' | 'positive';
  indeterminate?: boolean;
}

export function ProgressBar({
  value,
  label,
  valueLabel,
  tone = 'accent',
  indeterminate = false,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const classes = [
    styles.wrapper,
    tone === 'positive' ? styles.positive : '',
    indeterminate ? styles.indeterminate : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        {valueLabel ? <span className={styles.value}>{valueLabel}</span> : null}
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(clamped * 100)}
        aria-valuetext={valueLabel}
      >
        <div className={styles.fill} style={{ width: `${clamped * 100}%` }} />
      </div>
    </div>
  );
}
