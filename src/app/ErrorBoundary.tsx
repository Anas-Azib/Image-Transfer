import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Last line of defence.
 *
 * The transfer engines throw typed errors that the pages handle, so anything
 * reaching here is a genuine bug. The user is shown a plain sentence and a way
 * out; the underlying exception goes to the console for whoever is debugging,
 * never onto the page.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled error in Image Transfer', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <main className={styles.page} id="main">
        <Alert
          tone="critical"
          title="Something went wrong"
          actions={
            <Button size="small" onClick={() => window.location.assign('/')}>
              Back to start
            </Button>
          }
        >
          This page hit an unexpected problem and had to stop. Nothing was sent anywhere — reloading
          will start fresh.
        </Alert>
      </main>
    );
  }
}
