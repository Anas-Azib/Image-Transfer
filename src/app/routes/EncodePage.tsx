import { useCallback } from 'react';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { PageHeader } from '@/components/common/PageHeader';
import { ImagePicker } from '@/components/encode/ImagePicker';
import { ImageSummary } from '@/components/encode/ImageSummary';
import { TransferSettingsPanel } from '@/components/encode/TransferSettingsPanel';
import { TransmissionStage } from '@/components/transfer/TransmissionStage';
import { useEncoder } from '@/hooks/useEncoder';
import { useEntranceAnimation } from '@/hooks/useEntranceAnimation';
import { passDurationMs } from '@/features/encoder/encoder';
import { formatDuration } from '@/lib/utils/format';
import styles from './EncodePage.module.css';

export function EncodePage() {
  const encoder = useEncoder();
  const {
    phase,
    errorMessage,
    image,
    plan,
    status,
    settings,
    quality,
    canvasRef,
    selectFile,
    setQuality,
    setGridSize,
    setEccLevel,
    setFrameDuration,
    start,
    pause,
    resume,
    stop,
    reset,
  } = encoder;

  const transmitting = phase === 'transmitting' || phase === 'paused';
  const containerRef = useEntranceAnimation<HTMLDivElement>({ deps: [transmitting] });

  const handleSelect = useCallback(
    (file: File) => {
      void selectFile(file);
    },
    [selectFile],
  );

  return (
    <>
      <PageHeader title="Encode" backTo="/" />

      <main className={styles.page} id="main" ref={containerRef}>
        {transmitting && plan ? (
          <TransmissionStage
            plan={plan}
            status={status}
            paused={phase === 'paused'}
            canvasRef={canvasRef}
            onPause={pause}
            onResume={resume}
            onStop={stop}
          />
        ) : (
          <>
            <div className={styles.intro} data-animate>
              <h1 className={styles.title}>Send an image</h1>
              <p className={styles.lead}>
                Choose a picture, then point the other device&rsquo;s camera at this screen. The
                image is encoded and displayed here — nothing is uploaded.
              </p>
            </div>

            {errorMessage ? (
              <div className={styles.notice} data-animate>
                <Alert tone="critical" title="Could not prepare that image">
                  {errorMessage}
                </Alert>
              </div>
            ) : null}

            {phase === 'preparing' ? (
              <div className={styles.preparing} data-animate>
                <span className={styles.spinner} aria-hidden="true" />
                <span role="status">Preparing image…</span>
              </div>
            ) : null}

            {!image && phase !== 'preparing' ? (
              <div data-animate>
                <ImagePicker onSelect={handleSelect} />
              </div>
            ) : null}

            {image ? (
              <div className={styles.layout}>
                <div className={styles.primary}>
                  <div data-animate>
                    <ImageSummary image={image} onReplace={reset} />
                  </div>

                  <div className={styles.startBar} data-animate>
                    <Button variant="primary" size="large" onClick={start} disabled={!plan}>
                      Start transmission
                    </Button>
                    {plan ? (
                      <span className={styles.startHint}>
                        {plan.totalFrames.toLocaleString()} frames ·{' '}
                        {formatDuration(passDurationMs(plan, settings.frameDurationMs))} per pass
                      </span>
                    ) : null}
                  </div>

                  <div data-animate>
                    <Alert tone="info" title="Before you start">
                      Open the Decode page on the receiving device first, then start here. Hold the
                      camera steady, roughly square to this screen, with the whole symbol in view.
                    </Alert>
                  </div>
                </div>

                <aside className={styles.aside} data-animate>
                  <TransferSettingsPanel
                    quality={quality}
                    gridSize={settings.gridSize}
                    eccLevel={settings.eccLevel}
                    frameDurationMs={settings.frameDurationMs}
                    plan={plan}
                    locked={phase === 'preparing'}
                    onQualityChange={setQuality}
                    onGridSizeChange={setGridSize}
                    onEccLevelChange={setEccLevel}
                    onFrameDurationChange={setFrameDuration}
                  />
                </aside>
              </div>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
