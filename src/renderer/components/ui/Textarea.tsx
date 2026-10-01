import type { ComponentProps } from 'react';
import './Input.css';

export type TextareaProps = ComponentProps<'textarea'> & {
  variant?: 'default' | 'mono';
  isInvalid?: boolean;
};

/** Multiline text input with centralized geometry and theme styling. */
export function Textarea({
  variant = 'default',
  isInvalid = false,
  className = '',
  'aria-invalid': ariaInvalid,
  ...props
}: TextareaProps) {
  const invalid = isInvalid || ariaInvalid === true || ariaInvalid === 'true';
  return (
    <textarea
      {...props}
      className={`clanker-textarea ${className}`}
      data-variant={variant}
      aria-invalid={invalid ? true : undefined}
    />
  );
}
