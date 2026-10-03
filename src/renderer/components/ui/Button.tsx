import type { ComponentProps } from 'react';
import './Button.css';

export type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** `xs` (24px) for toolbars and row actions; `sm` (28px) for forms and dialog actions. */
  size?: 'xs' | 'sm';
};

/** Native semantics, including React 19's ref prop. Actions default to non-submit. */
export function Button({ variant = 'secondary', size = 'sm', type = 'button', className = '', ...props }: ButtonProps) {
  return <button {...props} type={type} className={`clanker-button ${className}`} data-variant={variant} data-size={size} />;
}
