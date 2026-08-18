import type { ReactNode } from 'react';
import styles from './Alert.module.css';

export type AlertTone = 'critical' | 'caution' | 'info' | 'positive';

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}

/**
 * Status message. Errors use `role="alert"` so screen readers announce them
 * immediately; informational tones stay polite so they do not interrupt.
 */
export function Alert({ tone = 'info', title, children, actions }: AlertProps) {
  const assertive = tone === 'critical';

  return (
    <div
      className={`${styles.alert} ${styles[tone]}`}
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
    >
      <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true" fill="currentColor">
        {tone === 'positive' ? (
          <path d="M10 1a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm4.1 6.6-4.9 6a.9.9 0 0 1-1.35.06L5.4 11.2a.9.9 0 1 1 1.27-1.27l1.73 1.73 4.3-5.27a.9.9 0 1 1 1.4 1.13Z" />
        ) : (
          <path d="M10 1a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1Zm0 9.6a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z" />
        )}
      </svg>
      <div>
        {title ? <p className={styles.title}>{title}</p> : null}
        <div className={styles.body}>{children}</div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </div>
  );
}
