import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: string;
  backTo?: string;
  backLabel?: string;
  trailing?: ReactNode;
}

export function PageHeader({ title, backTo, backLabel = 'Home', trailing }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        {backTo ? (
          <Link className={styles.back} to={backTo}>
            <svg className={styles.chevron} viewBox="0 0 12 12" aria-hidden="true" fill="none">
              <path
                d="M7.5 1.5 3 6l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {backLabel}
          </Link>
        ) : null}
        <span className={styles.title}>{title}</span>
        <span className={styles.spacer} />
        {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
      </div>
    </header>
  );
}
