import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { Button } from '@/components/common/Button';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { saveImage, type ReconstructedImage } from '@/features/image/imageReconstructor';
import { formatBytes } from '@/lib/utils/format';
import styles from './ReceivedImage.module.css';

export interface ReceivedImageProps {
  image: ReconstructedImage;
  onDiscard: () => void;
  onTransferAnother: () => void;
}

export function ReceivedImage({ image, onDiscard, onTransferAnother }: ReceivedImageProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    if (reducedMotion) return undefined;

    const context = gsap.context(() => {
      gsap
        .timeline()
        .from(root, { opacity: 0, y: 20, duration: 0.5, ease: 'power3.out' })
        .from(
          `.${styles.check}`,
          { scale: 0.4, opacity: 0, duration: 0.45, ease: 'back.out(2)' },
          '-=0.25',
        )
        .from(`.${styles.image}`, { opacity: 0, scale: 0.97, duration: 0.5, ease: 'power2.out' }, '-=0.3');
    }, root);

    return () => context.revert();
  }, [reducedMotion]);

  return (
    <section className={styles.result} ref={rootRef} aria-labelledby="received-title">
      <div className={styles.header}>
        <span className={styles.check} aria-hidden="true">
          <svg className={styles.checkIcon} viewBox="0 0 20 20" fill="none">
            <path
              d="m4.5 10.5 3.5 3.5 7.5-8"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div>
          <h2 className={styles.title} id="received-title">
            Transfer complete
          </h2>
          <p className={styles.subtitle}>
            {image.fileName} · {formatBytes(image.byteLength)}
            {image.width > 0 ? ` · ${image.width} × ${image.height}` : ''} · checksum verified
          </p>
        </div>
      </div>

      <figure className={styles.figure}>
        <img className={styles.image} src={image.objectUrl} alt="The image received over the visual link" />
      </figure>

      <div className={styles.actions}>
        <Button variant="primary" size="large" onClick={() => saveImage(image)}>
          Save image
        </Button>
        <Button size="large" onClick={onTransferAnother}>
          Receive another
        </Button>
        <Button variant="quiet" size="large" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </section>
  );
}
