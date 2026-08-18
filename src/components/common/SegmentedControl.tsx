import { useId } from 'react';
import styles from './SegmentedControl.module.css';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  legend: string;
  description?: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/**
 * A single-choice control.
 *
 * Built from real radio inputs inside a fieldset rather than from buttons, so
 * arrow-key navigation, grouping and the selected state all come from the
 * platform instead of being re-implemented.
 */
export function SegmentedControl<T extends string>({
  legend,
  description,
  options,
  value,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>) {
  const name = useId();
  const describedBy = description ? `${name}-description` : undefined;

  return (
    <fieldset className={styles.field}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.group} aria-describedby={describedBy}>
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          return (
            <div key={option.value} className={styles.option}>
              <input
                className={styles.input}
                type="radio"
                id={id}
                name={name}
                value={option.value}
                checked={value === option.value}
                disabled={disabled}
                onChange={() => onChange(option.value)}
              />
              <label className={styles.label} htmlFor={id}>
                {option.label}
              </label>
            </div>
          );
        })}
      </div>
      {description ? (
        <p className={styles.description} id={describedBy}>
          {description}
        </p>
      ) : null}
    </fieldset>
  );
}
