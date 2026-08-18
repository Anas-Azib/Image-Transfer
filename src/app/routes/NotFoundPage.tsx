import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import styles from './NotFoundPage.module.css';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Not found" backTo="/" />
      <main className={styles.page} id="main">
        <h1 className={styles.title}>This page does not exist</h1>
        <p className={styles.body}>
          Pick a direction from the home page to start a transfer.
        </p>
        <p className={styles.action}>
          <Link to="/">Go to Image Transfer</Link>
        </p>
      </main>
    </>
  );
}
