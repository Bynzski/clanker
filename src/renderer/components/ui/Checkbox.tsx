import type { ComponentProps, ReactNode } from 'react';
import './Checkbox.css';

/** Labelled native checkbox; shares form geometry, colors and focus treatment. */
export function Checkbox({ children, className = '', ...props }: Omit<ComponentProps<'input'>, 'type' | 'children'> & { children: ReactNode }) {
  return <label className={`clanker-checkbox ${className}`}>
    <input {...props} type="checkbox" />
    <span>{children}</span>
  </label>;
}
