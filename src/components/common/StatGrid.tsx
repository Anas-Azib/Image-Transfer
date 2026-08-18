import styles from './StatGrid.module.css';

export interface Stat {
  label: string;
  value: string;
  hint?: string;
}

export interface StatGridProps {
  stats: readonly Stat[];
  /** Announced as a group; give it a name describing what the numbers describe. */
  ariaLabel: string;
}

/**
 * Compact numeric readout.
 *
 * Rendered as a definition list so the label/value pairing survives in a screen
 * reader, and with tabular figures so values do not jitter as they update.
 */
export function StatGrid({ stats, ariaLabel }: StatGridProps) {
  return (
    <dl className={styles.grid} aria-label={ariaLabel}>
      {stats.map((stat) => (
        <div key={stat.label} className={styles.item}>
          <dt className={styles.label}>{stat.label}</dt>
          <dd className={styles.value}>{stat.value}</dd>
          {stat.hint ? <dd className={styles.hint}>{stat.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
