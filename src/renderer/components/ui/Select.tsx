import type { ComponentProps } from 'react';
import './Input.css';

export type SelectProps = Omit<ComponentProps<'select'>, 'size'> & {
  size?: 'sm' | 'md';
  isInvalid?: boolean;
};

/** Standard select control with centralized geometry and theme styling. */
export function Select({
  size = 'sm',
  isInvalid = false,
  className = '',
  'aria-invalid': ariaInvalid,
  ...props
}: SelectProps) {
  const invalid = isInvalid || ariaInvalid === true || ariaInvalid === 'true';
  return (
    <select
      {...props}
      className={`clanker-select ${className}`}
      data-size={size}
      aria-invalid={invalid ? true : undefined}
    />
  );
}
