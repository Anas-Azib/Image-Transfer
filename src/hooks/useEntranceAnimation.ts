import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { useReducedMotion } from './useReducedMotion';

export interface EntranceOptions {
  /** Selector, scoped to the container, for the elements to stagger in. */
  selector?: string;
  stagger?: number;
  duration?: number;
  y?: number;
  delay?: number;
  /** Re-runs the animation whenever these values change. */
  deps?: readonly unknown[];
}

/**
 * Staggered entrance for a section's children.
 *
 * Uses `gsap.context` so every tween is scoped to the container and reverted on
 * unmount — without that, a timeline outliving its DOM leaks and can throw when
 * it next tries to write to a detached node.
 */
export function useEntranceAnimation<T extends HTMLElement>(options: EntranceOptions = {}) {
  const {
    selector = '[data-animate]',
    stagger = 0.06,
    duration = 0.6,
    y = 16,
    delay = 0,
    deps = [],
  } = options;

  const containerRef = useRef<T | null>(null);
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const targets = container.querySelectorAll(selector);
    if (targets.length === 0) return undefined;

    if (reducedMotion) {
      gsap.set(targets, { opacity: 1, y: 0, clearProps: 'transform' });
      return undefined;
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        targets,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          duration,
          delay,
          stagger,
          ease: 'power3.out',
          clearProps: 'transform',
        },
      );
    }, container);

    return () => context.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, selector, stagger, duration, y, delay, ...deps]);

  return containerRef;
}
