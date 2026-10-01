import type { ComponentProps } from 'react';
import './Input.css';

export type InputProps = Omit<ComponentProps<'input'>, 'size'> & {
  size?: 'sm' | 'md';
  variant?: 'default' | 'mono';
  isInvalid?: boolean;
};

/** Standard text/search/password input with centralized geometry and theme styling. */
export function Input({
  size = 'sm',
  variant = 'default',
  isInvalid = false,
  className = '',
  type = 'text',
  'aria-invalid': ariaInvalid,
  ...props
}: InputProps) {
  const invalid = isInvalid || ariaInvalid === true || ariaInvalid === 'true';
  return (
    <input
      {...props}
      type={type}
      className={`clanker-input ${className}`}
      data-size={size}
      data-variant={variant}
      aria-invalid={invalid ? true : undefined}
    />
  );
}
