/**
 * User-facing failure modes for image handling.
 *
 * Every throw site uses one of these codes so the UI can show a sentence a
 * person can act on instead of a raw exception message.
 */

export type ImageErrorCode =
  | 'unsupported-type'
  | 'empty-file'
  | 'too-large'
  | 'decode-failed'
  | 'encode-failed'
  | 'cancelled';

const MESSAGES: Record<ImageErrorCode, string> = {
  'unsupported-type': 'That file is not an image. Choose a PNG, JPEG, WebP, GIF or AVIF file.',
  'empty-file': 'That file is empty. Choose a different image.',
  'too-large': 'That image is too large to send over a visual link.',
  'decode-failed': 'This image could not be opened. It may be corrupted or in an unsupported format.',
  'encode-failed': 'This image could not be prepared for transmission. Try a different quality setting.',
  cancelled: 'Image selection was cancelled.',
};

export class ImageError extends Error {
  readonly code: ImageErrorCode;

  constructor(code: ImageErrorCode, detail?: string) {
    super(detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code]);
    this.name = 'ImageError';
    this.code = code;
  }

  /** The message to show a user — never the underlying exception text. */
  get userMessage(): string {
    return MESSAGES[this.code];
  }
}
