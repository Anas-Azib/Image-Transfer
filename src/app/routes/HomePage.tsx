import { Link } from 'react-router-dom';
import { useEntranceAnimation } from '@/hooks/useEntranceAnimation';
import styles from './HomePage.module.css';

const STEPS = [
  {
    title: 'Pick an image on the sending device',
    body: 'The file is read in the browser and split into numbered, checksummed frames.',
  },
  {
    title: 'The screen becomes the transmitter',
    body: 'Frames are drawn as machine-readable symbols and cycled ten times a second.',
  },
  {
    title: 'The other device watches',
    body: 'Its camera locates each symbol, corrects for angle and blur, and reads the data back.',
  },
  {
    title: 'The image is rebuilt',
    body: 'Once every frame has arrived and the checksums agree, the picture is reassembled and ready to save.',
  },
];

function ArrowIcon() {
  return (
    <svg className={styles.arrow} viewBox="0 0 14 14" aria-hidden="true" fill="none">
      <path
        d="M2 7h10M8 3l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HomePage() {
  const containerRef = useEntranceAnimation<HTMLDivElement>({ stagger: 0.07 });

  return (
    <main className={styles.page} id="main" ref={containerRef}>
      <section className={styles.hero}>
        <span className={styles.eyebrow} data-animate>
          Visual Data Transfer
        </span>
        <h1 className={styles.title} data-animate>
          Image Transfer
        </h1>
        <p className={styles.lead} data-animate>
          Move a picture from one device to another using nothing but a screen and a camera. No
          internet, no pairing, no cables — the data travels as light.
        </p>
      </section>

      <nav className={styles.choices} aria-label="Choose a direction">
        <Link className={styles.card} to="/encode" data-animate>
          <svg className={styles.cardIcon} viewBox="0 0 32 32" aria-hidden="true" fill="none">
            <rect x="3" y="6" width="26" height="18" rx="2.5" stroke="currentColor" strokeWidth="2" />
            <path d="M11 28h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <rect x="8" y="11" width="4" height="4" fill="currentColor" />
            <rect x="20" y="11" width="4" height="4" fill="currentColor" />
            <rect x="8" y="17" width="4" height="2" fill="currentColor" />
            <rect x="14" y="11" width="2" height="8" fill="currentColor" />
            <rect x="18" y="17" width="6" height="2" fill="currentColor" />
          </svg>
          <h2 className={styles.cardTitle}>Encode Image</h2>
          <p className={styles.cardBody}>
            Turn a picture into a stream of visual frames and display them. Best on the device with
            the larger screen.
          </p>
          <span className={styles.cardAction}>
            Start sending
            <ArrowIcon />
          </span>
        </Link>

        <Link className={styles.card} to="/decode" data-animate>
          <svg className={styles.cardIcon} viewBox="0 0 32 32" aria-hidden="true" fill="none">
            <path
              d="M4 11a3 3 0 0 1 3-3h2.5l1.8-2.7a1 1 0 0 1 .84-.45h7.72a1 1 0 0 1 .83.45L22.5 8H25a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V11Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <circle cx="16" cy="16" r="5" stroke="currentColor" strokeWidth="2" />
          </svg>
          <h2 className={styles.cardTitle}>Decode Image</h2>
          <p className={styles.cardBody}>
            Point this device&rsquo;s camera at the frames on the other screen and watch the picture
            rebuild itself.
          </p>
          <span className={styles.cardAction}>
            Start receiving
            <ArrowIcon />
          </span>
        </Link>
      </nav>

      <section className={styles.explainer} data-animate>
        <h2 className={styles.explainerTitle}>How it works</h2>
        <ol className={styles.steps}>
          {STEPS.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepNumber}>Step {index + 1}</span>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepBody}>{step.body}</p>
            </li>
          ))}
        </ol>
        <p className={styles.note}>
          Everything happens inside this browser tab. The image is never uploaded, and the two
          devices never talk to each other over a network — the camera reading the screen is the
          entire channel. Once this page has loaded it keeps working with the connection switched
          off.
        </p>
      </section>
    </main>
  );
}
