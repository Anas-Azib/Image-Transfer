import { useCallback, useId, useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/common/Button';
import styles from './ImagePicker.module.css';

export interface ImagePickerProps {
  onSelect: (file: File) => void;
  disabled?: boolean;
}

const ACCEPT = 'image/*';

export function ImagePicker({ onSelect, disabled = false }: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputId = useId();

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      if (disabled) return;
      const file = event.dataTransfer.files?.[0];
      if (file) onSelect(file);
    },
    [disabled, onSelect],
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!disabled) setDragging(true);
    },
    [disabled],
  );

  return (
    <div
      className={`${styles.zone} ${dragging ? styles.dragging : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
    >
      <svg className={styles.icon} viewBox="0 0 40 40" aria-hidden="true" fill="none">
        <rect x="4" y="8" width="32" height="24" rx="3" stroke="currentColor" strokeWidth="2" />
        <circle cx="14" cy="16" r="2.5" stroke="currentColor" strokeWidth="2" />
        <path
          d="m6 27 8.5-7.5a2 2 0 0 1 2.7.05L26 27m-2-3 3.2-2.8a2 2 0 0 1 2.7.06L34 25"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <div>
        <h2 className={styles.title}>Choose an image to send</h2>
        <p className={styles.hint}>
          Drag a file here, or browse for one. It is read on this device and never uploaded.
        </p>
      </div>

      <label className={styles.input} htmlFor={inputId}>
        Choose an image file
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className={styles.input}
        type="file"
        accept={ACCEPT}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onSelect(file);
          // Clear the value so re-picking the same file still fires a change.
          event.target.value = '';
        }}
      />

      <Button variant="primary" size="large" onClick={openPicker} disabled={disabled}>
        Choose image
      </Button>

      <p className={styles.formats}>PNG, JPEG, WebP, GIF or AVIF</p>
    </div>
  );
}
