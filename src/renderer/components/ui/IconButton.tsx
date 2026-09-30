import { Button, type ButtonProps } from './Button';

export type IconButtonProps = Omit<ButtonProps, 'aria-label' | 'aria-labelledby'> & (
  | { 'aria-label': string; 'aria-labelledby'?: never }
  | { 'aria-labelledby': string; 'aria-label'?: never }
);

/** An accessible name is required; title alone is not a label. */
export function IconButton({ className = '', ...props }: IconButtonProps) {
  return <Button {...props} className={`clanker-icon-button ${className}`} />;
}
