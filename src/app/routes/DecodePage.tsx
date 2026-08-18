import { useCallback, useEffect } from 'react';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { PageHeader } from '@/components/common/PageHeader';
import { CameraViewport } from '@/components/decode/CameraViewport';
import { ReceptionPanel } from '@/components/decode/ReceptionPanel';
import { ReceivedImage } from '@/components/decode/ReceivedImage';
import { useDecoder } from '@/hooks/useDecoder';
import { useEntranceAnimation } from '@/hooks/useEntranceAnimation';
import styles from './DecodePage.module.css';

const PERMISSION_POINTS = [
  'The camera feed stays on this device — it is analysed in the page and never uploaded.',
  'Frames are read directly from the video; no photos are stored.',
  'The camera stops the moment you leave this page or finish a transfer.',
];

function TickIcon() {
  return (
    <svg className={styles.tick} viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path
        d="m3.5 8.5 3 3 6-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DecodePage() {
  const decoder = useDecoder();
  const { phase, camera, progress, signal, errorMessage, stalled, image, begin, cancel, restart, discard } =
    decoder;

  const containerRef = useEntranceAnimation<HTMLDivElement>({ deps: [phase] });

  const live = camera.state === 'ready';
  const scanning = phase === 'searching' || phase === 'receiving';
  const complete = phase === 'complete' && image !== null;

  // Releasing the camera on unmount is handled inside useCamera; this covers the
  // in-page transition away from scanning.
  useEffect(() => () => cancel(), [cancel]);

  const handleBegin = useCallback(() => {
    void begin();
  }, [begin]);

  const handleSwitchCamera = useCallback(
    (deviceId: string) => {
      void begin(deviceId);
    },
    [begin],
  );

  return (
    <>
      <PageHeader title="Decode" backTo="/" />

      <main className={styles.page} id="main" ref={containerRef}>
        {complete && image ? (
          <div className={styles.completeWrap}>
            <ReceivedImage image={image} onDiscard={discard} onTransferAnother={() => void restart()} />
          </div>
        ) : (
          <>
            <div className={styles.intro} data-animate>
              <h1 className={styles.title}>Receive an image</h1>
              <p className={styles.lead}>
                Point your camera at the visual code displayed on the other device. Frames are
                decoded here, in this browser tab.
              </p>
            </div>

            {errorMessage ? (
              <div className={styles.notice} data-animate>
                <Alert
                  tone="critical"
                  title={camera.errorCode ? 'Camera unavailable' : 'Transfer failed'}
                  actions={
                    <Button size="small" onClick={handleBegin}>
                      Try again
                    </Button>
                  }
                >
                  {errorMessage}
                </Alert>
              </div>
            ) : null}

            {!camera.supported ? (
              <div className={styles.notice} data-animate>
                <Alert tone="critical" title="Camera not supported">
                  This browser cannot access a camera, so it cannot receive a transfer. Try a recent
                  version of Safari, Chrome, Edge or Firefox.
                </Alert>
              </div>
            ) : null}

            {!live && !scanning ? (
              <section className={styles.permission} data-animate>
                <h2 className={styles.permissionTitle}>Camera access</h2>
                <p className={styles.permissionBody}>
                  Receiving needs the camera so it can watch the other screen. Your browser will ask
                  for permission when you continue.
                </p>
                <ul className={styles.permissionList}>
                  {PERMISSION_POINTS.map((point) => (
                    <li className={styles.permissionItem} key={point}>
                      <TickIcon />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <div className={styles.actions}>
                  <Button
                    variant="primary"
                    size="large"
                    onClick={handleBegin}
                    disabled={!camera.supported || phase === 'requesting-camera'}
                  >
                    {phase === 'requesting-camera' ? 'Requesting…' : 'Enable camera'}
                  </Button>
                </div>
              </section>
            ) : (
              <div className={styles.layout}>
                <div className={styles.column} data-animate>
                  <CameraViewport videoRef={camera.videoRef} signal={signal} live={live} />

                  <div className={styles.actions}>
                    {camera.devices.length > 1 ? (
                      <>
                        <label className="sr-only" htmlFor="camera-select">
                          Camera
                        </label>
                        <select
                          id="camera-select"
                          className={styles.deviceSelect}
                          value={camera.activeDeviceId ?? ''}
                          onChange={(event) => handleSwitchCamera(event.target.value)}
                        >
                          {camera.devices.map((device) => (
                            <option key={device.deviceId} value={device.deviceId}>
                              {device.label}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : null}
                    <Button onClick={cancel}>Stop camera</Button>
                  </div>

                  <p className={styles.tips}>
                    Hold the device so the whole symbol, including its white border, sits inside the
                    guides. Roughly square to the screen works best; a steep angle or a strong
                    reflection will stall the transfer.
                  </p>
                </div>

                <div className={styles.column} data-animate>
                  <ReceptionPanel progress={progress} searching={progress.receivedFrames === 0} />

                  {stalled ? (
                    <Alert tone="caution" title="Nothing received recently">
                      No new frames have arrived for a while. Check that the other device is still
                      transmitting, and try moving closer or reducing glare.
                    </Alert>
                  ) : null}

                  {phase === 'reconstructing' ? (
                    <Alert tone="info" title="Rebuilding the image">
                      All frames are in. Verifying the checksum and reassembling.
                    </Alert>
                  ) : null}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
