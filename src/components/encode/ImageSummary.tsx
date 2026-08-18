import { useEffect, useMemo } from 'react';
import { Button } from '@/components/common/Button';
import type { PreparedImage } from '@/features/image/image.types';
import { formatBytes } from '@/lib/utils/format';
import styles from './ImageSummary.module.css';

export interface ImageSummaryProps {
  image: PreparedImage;
  onReplace: () => void;
  replaceDisabled?: boolean;
}

/** Preview of the exact bytes that will be transmitted, not of the source file. */
export function ImageSummary({ image, onReplace, replaceDisabled = false }: ImageSummaryProps) {
  // Derived rather than held in state: computing it during render avoids the
  // extra render pass an effect would cause, and keeps the preview in step with
  // the bytes on the very first paint.
  const previewUrl = useMemo(
    () => URL.createObjectURL(new Blob([image.bytes.slice().buffer as ArrayBuffer], { type: image.mimeType })),
    [image],
  );

  // Object URLs are never garbage collected on their own; releasing the previous
  // one is what keeps repeated image swaps from leaking.
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  const savings =
    image.recompressed && image.originalByteLength > 0
      ? Math.round((1 - image.bytes.length / image.originalByteLength) * 100)
      : 0;

  return (
    <div className={styles.summary}>
      <img className={styles.thumbnail} src={previewUrl} alt="" />

      <div className={styles.details}>
        <p className={styles.name} title={image.fileName}>
          {image.fileName}
        </p>
        <p className={styles.meta}>
          {image.width} × {image.height} · {formatBytes(image.bytes.length)}
        </p>

        {image.recompressed ? (
          <span className={styles.recompressed}>
            Recompressed from {formatBytes(image.originalByteLength)}
            {savings > 0 ? ` · ${savings}% smaller` : ''}
          </span>
        ) : (
          <span className={styles.recompressed}>Sending the original file, byte for byte</span>
        )}

        <div className={styles.actions}>
          <Button size="small" onClick={onReplace} disabled={replaceDisabled}>
            Choose a different image
          </Button>
        </div>
      </div>
    </div>
  );
}
